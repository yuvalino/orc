import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Activity } from '@shared/api'
import { baseUserData, remoteHost } from './shell'

/**
 * Whether Orc is idle, for installing updates: no chat working or waiting on you, no unsent text, no input — in every Orc
 * process, since each remote host runs as its own. Each window reports its part; each process publishes its total in
 * <userData>/activity/<pid>.json, refreshed every 10 s, so the one that installs updates can read them all. A <pid>.quit
 * file next to it asks that process to quit (before an update installs), which it notices within a second.
 */
interface Published extends Activity { pid: number; host: string | null; lastInput: number; at: number }
const windows = new Map<number, Activity>()
let lastInput = Date.now()
const dir = join(baseUserData, 'activity'), own = join(dir, `${process.pid}.json`)
const STALE = 30_000 // a process that stopped refreshing has crashed or quit

// A chat open in two windows of one instance is still one chat.
const sum = (all: Activity[]): Activity => ({ working: [...new Set(all.flatMap((a) => a.working))], waiting: [...new Set(all.flatMap((a) => a.waiting))], drafts: all.reduce((n, a) => n + a.drafts, 0) })
function publish(): void {
  try { mkdirSync(dir, { recursive: true }); writeFileSync(own, JSON.stringify({ pid: process.pid, host: remoteHost ?? null, ...sum([...windows.values()]), lastInput, at: Date.now() } satisfies Published)) } catch { /* best effort */ }
}

export function startActivity(): void {
  ipcMain.handle('activity.report', (e, a: Activity) => { windows.set(e.sender.id, a); publish() })
  ipcMain.handle('activity.input', () => { lastInput = Date.now() }) // published with the next refresh
  app.on('web-contents-created', (_e, wc) => wc.once('destroyed', () => { if (windows.delete(wc.id)) publish() }))
  publish()
  setInterval(publish, 10_000) // not unref()d: in Electron's main process an unref()d timer may never fire
  const quitFile = join(dir, `${process.pid}.quit`)
  setInterval(() => { if (existsSync(quitFile)) { rmSync(quitFile, { force: true }); app.quit() } }, 1000)
  app.on('quit', () => rmSync(own, { force: true }))
}

/** Every live Orc process's activity together, when any of them was last used, and the other processes (remote hosts). */
export function allActivity(): { activity: Activity; lastInput: number; others: { pid: number; host: string | null }[] } {
  const others: Published[] = []
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f === `${process.pid}.json`) continue
      try {
        const p = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Published
        if (Date.now() - p.at < STALE) others.push(p); else rmSync(join(dir, f), { force: true })
      } catch { /* mid-write: next time */ }
    }
  } catch { /* no dir yet */ }
  return {
    activity: sum([...windows.values(), ...others]),
    lastInput: Math.max(lastInput, ...others.map((o) => o.lastInput)),
    others: others.map(({ pid, host }) => ({ pid, host }))
  }
}

/**
 * Ask other Orc processes to quit the normal way (a remote host's then stops its server and ssh); after `wait` ms, any
 * still running is ended by force.
 */
export async function quitOthers(pids: number[], wait = 8000): Promise<void> {
  for (const pid of pids) try { writeFileSync(join(dir, `${pid}.quit`), '') } catch { /* gone */ }
  const live = () => pids.filter((pid) => existsSync(join(dir, `${pid}.json`))) // each removes its file as it quits
  for (const end = Date.now() + wait; live().length && Date.now() < end;) await new Promise((r) => setTimeout(r, 200))
  for (const pid of live()) {
    try { process.kill(pid) } catch { /* gone */ }
    rmSync(join(dir, `${pid}.json`), { force: true }); rmSync(join(dir, `${pid}.quit`), { force: true })
  }
}
