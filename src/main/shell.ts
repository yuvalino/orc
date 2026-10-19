import { spawn } from 'child_process'
import { app } from 'electron'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { JsonFile } from '../server/store'

export const remoteHost = (() => { const i = process.argv.indexOf('--remote'); return i >= 0 ? process.argv[i + 1] : undefined })()

/** The app's own userData, before index.ts points a remote instance at a per-host subdirectory: what every instance of this app shares. */
export const baseUserData = process.env.ORC_USER_DATA_DIR || process.env.ORC_DATA_DIR || app.getPath('userData')
/** Shell-local state (window bounds): under this instance's userData, never in the engine's settings, which may live on another machine. */
export const shellStore = new JsonFile<Record<string, unknown>>(() => join(app.getPath('userData'), 'shell.json'), {})
/** What all instances share: recent hosts, which of them run Windows (the sign-in token sits beside it, see signin.ts). */
export const sharedStore = new JsonFile<Record<string, unknown>>(() => join(baseUserData, 'hosts.json'), {})

/** Hosts to offer: recent ones first, then `Host` entries from ~/.ssh/config (patterns skipped). */
export function hosts(): string[] {
  const recent = (sharedStore.read().hosts as string[] | undefined) ?? []
  let config: string[] = []
  try {
    config = readFileSync(join(homedir(), '.ssh', 'config'), 'utf-8').split('\n')
      .flatMap((l) => { const m = /^\s*Host\s+(.+)$/i.exec(l); return m ? m[1].trim().split(/\s+/) : [] })
      .filter((h) => !/[*?!]/.test(h))
  } catch { /* no config */ }
  return [...new Set([...recent, ...config])]
}

/** A remote target is its own instance: spawn ourselves with --remote (the dev electron binary needs the app path, a packaged one must not get it). */
export function openRemote(host: string): void {
  if (host.startsWith('-')) return // would be read as an ssh option
  const recent = (sharedStore.read().hosts as string[] | undefined) ?? []
  sharedStore.write({ ...sharedStore.read(), hosts: [host, ...recent.filter((h) => h !== host)].slice(0, 10) })
  const env = { ...process.env }; delete env.ORC_USER_DATA_DIR; delete env.ORC_DATA_DIR // a dev/test instance's dirs are its own; the child derives its own from the host
  spawn(process.execPath, [...(app.isPackaged ? [] : [app.getAppPath()]), '--remote', host], { detached: true, stdio: 'ignore', env }).unref()
}
