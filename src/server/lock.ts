import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, watchFile, writeFileSync } from 'fs'
import { hostname, userInfo } from 'os'
import { join } from 'path'

export interface Client { host: string; user: string }
/** `host`/`user`/`pid` identify the holder process (liveness); `client` is who drives it (what the busy screen shows). */
export interface Holder { pid: number; startedAt: string; host: string; user: string; client: Client; since: number; kind: 'local' | 'server' }

const win = process.platform === 'win32'
const powershell = (cmd: string) => execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf-8', windowsHide: true }).trim()

/** Process start time, compared verbatim so a recycled pid never passes for the holder. */
function startTime(pid: number): string | null {
  try {
    if (process.platform === 'linux') { const s = readFileSync(`/proc/${pid}/stat`, 'utf-8'); return s.slice(s.lastIndexOf(')') + 2).split(' ')[19] ?? null }
    if (win) return powershell(`(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CreationDate.ToFileTimeUtc()`) || null // CIM, unlike Get-Process, also sees other users' processes
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf-8' }).trim() || null // locale-dependent output otherwise
  } catch { return null }
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * One engine per data dir: `<dataDir>/lock` names the holder; `<dataDir>/takeover` tells an evicted holder who evicted it.
 * The eviction signal is SIGTERM; on Windows, where a signal is a plain kill, the holder watches for the marker instead.
 */
export class Lock {
  readonly client: Client = { host: hostname(), user: userInfo().username }
  constructor(private dir: string) {}
  private get path() { return join(this.dir, 'lock') }
  private get marker() { return join(this.dir, 'takeover') }

  /** The live holder, or null when free; a stale lock (dead or recycled pid) is removed on the way. */
  holder(): Holder | null {
    let h: Holder
    if (!existsSync(this.path)) return null
    try { h = JSON.parse(readFileSync(this.path, 'utf-8')) } catch { rmSync(this.path, { force: true }); return null } // a crash mid-write must not lock the target for good
    if (h.host !== hostname()) return h // another machine's process (shared home): can't check, so it counts as live
    if (alive(h.pid) && startTime(h.pid) === h.startedAt) return h
    rmSync(this.path, { force: true })
    return null
  }

  /** Take the lock; false when a live holder has it or a concurrent taker won the race (retry the handshake). */
  acquire(kind: Holder['kind'], client = this.client): boolean {
    mkdirSync(this.dir, { recursive: true })
    if (this.holder()) return false
    const h: Holder = { pid: process.pid, startedAt: startTime(process.pid) ?? '', host: hostname(), user: userInfo().username, client, since: Date.now(), kind }
    try { writeFileSync(this.path, JSON.stringify(h), { flag: 'wx' }) } catch { return false }
    rmSync(this.marker, { force: true })
    return true
  }

  release(): void {
    try { if (JSON.parse(readFileSync(this.path, 'utf-8')).pid === process.pid) rmSync(this.path) } catch { /* not ours */ }
  }

  /** Evict the holder: marker, SIGTERM, up to 5 s, then its children and SIGKILL. False when the holder is on another host. */
  async takeover(client = this.client): Promise<boolean> {
    const h = this.holder()
    if (!h) return true
    if (h.host !== hostname()) return false
    writeFileSync(this.marker, JSON.stringify({ client, at: Date.now() }))
    if (!win) try { process.kill(h.pid, 'SIGTERM') } catch { /* already gone */ }
    for (let i = 0; i < 50 && existsSync(this.path); i++) await sleep(100)
    if (existsSync(this.path)) { // the holder's event loop is stuck: the claude children only die with their parent's cooperation
      if (win) try { execFileSync('taskkill', ['/PID', String(h.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch { /* gone */ }
      else {
        try { for (const c of execFileSync('pgrep', ['-P', String(h.pid)], { encoding: 'utf-8' }).split('\n').filter(Boolean)) process.kill(Number(c), 'SIGTERM') } catch { /* none */ }
        try { process.kill(h.pid, 'SIGKILL') } catch { /* gone */ }
      }
      rmSync(this.path, { force: true })
    }
    return true
  }

  /** Run `cb` whenever this process is being evicted (or, outside Windows, plainly SIGTERMed) — also after it took the lock back. */
  onTakeover(cb: () => void): void {
    if (!win) { process.on('SIGTERM', cb); return }
    watchFile(this.marker, { interval: 300 }, (cur) => { if (cur.mtimeMs) cb() })
  }

  /** For an evicted holder: who took over, or null when it was an ordinary kill (no fresh marker). */
  takenOverBy(): Client | null {
    try {
      const m = JSON.parse(readFileSync(this.marker, 'utf-8'))
      rmSync(this.marker, { force: true })
      return Date.now() - m.at < 30_000 ? m.client : null
    } catch { return null }
  }
}
