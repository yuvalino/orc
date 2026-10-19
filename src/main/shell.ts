import { spawn } from 'child_process'
import { app } from 'electron'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { JsonFile } from '../server/store'

/** Shell-local state (window bounds, recent hosts): under userData, never in the engine's settings, which may live on another machine. */
export const shellStore = new JsonFile<Record<string, unknown>>(() => join(app.getPath('userData'), 'shell.json'), {})

export const remoteHost = (() => { const i = process.argv.indexOf('--remote'); return i >= 0 ? process.argv[i + 1] : undefined })()

/** Hosts to offer: recent ones first, then `Host` entries from ~/.ssh/config (patterns skipped). */
export function hosts(): string[] {
  const recent = (shellStore.read().hosts as string[] | undefined) ?? []
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
  const recent = (shellStore.read().hosts as string[] | undefined) ?? []
  shellStore.write({ ...shellStore.read(), hosts: [host, ...recent.filter((h) => h !== host)].slice(0, 10) })
  spawn(process.execPath, [...(app.isPackaged ? [] : [app.getAppPath()]), '--remote', host], { detached: true, stdio: 'ignore' }).unref()
}
