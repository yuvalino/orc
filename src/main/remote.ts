import { spawn, type ChildProcess } from 'child_process'
import { readFileSync } from 'fs'
import { hostname, tmpdir, userInfo } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import type { TransportState } from '@shared/api'
import { decode, encode, type ClientFrame, type ServerFrame } from '@shared/protocol'
import type { Push } from '../server/engine'
import { Askpass } from './askpass'
import manifest from '../../bundles.json'
import bootstrap from './bootstrap.sh?raw'
import { token } from './signin'

/** Hints for the ssh failures everyone hits. */
function explain(detail: string, code: number | null): string {
  if (/Permission denied/.test(detail)) return `${detail.trim()}\nThe host did not accept your key or password.`
  if (/Host key verification failed/.test(detail)) return `${detail.trim()}\nThe host's key changed; check with its admin, then remove the old entry from ~/.ssh/known_hosts.`
  return detail.trim() || `ssh exited with code ${code}`
}
const INSTALL_FAILED: Record<string, string> = {
  'no-curl': 'The host has no curl, which the one-time install needs.',
  download: 'The host could not download the orc server bundle; it needs internet access to github.com.',
  sha256: 'The downloaded orc server bundle did not match its checksum.',
  unpacking: 'The orc server bundle could not be unpacked on the host.',
  'unsupported-host': 'orc-server runs on macOS and glibc ≥ 2.28 Linux (x64/arm64); this host is something else.'
}

/**
 * The remote command: a bootstrap that installs ~/.orc/<version>/ on first use and then becomes the server. It is
 * base64-encoded so the user's login shell (whatever it is) hands it to `sh` untouched; the bundle table is the repo's
 * bundles.json, compiled in (ORC_BUNDLES_JSON points tests at another one).
 */
function remoteCommand(): string {
  const { bundles } = (process.env.ORC_BUNDLES_JSON ? JSON.parse(readFileSync(process.env.ORC_BUNDLES_JSON, 'utf-8')) : manifest) as { bundles: Record<string, { url: string; sha256: string }> }
  const table = Object.entries(bundles).map(([t, b]) => `${t} ${b.url} ${b.sha256}`).join('\n')
  const script = bootstrap.replaceAll('__VERSION__', () => __ORC_VERSION__).replaceAll('__BUNDLES__', () => table)
  return `sh -c 'eval "$(printf %s ${Buffer.from(script).toString('base64')} | base64 --decode)"'`
}

/**
 * The remote transport: `ssh host orc-server --stdio` spoken to over its stdio. The server lives exactly as long
 * as the connection, so a reconnect is a fresh server (history reloads from the host, running turns were interrupted).
 */
export class Remote {
  state: TransportState
  private proc: ChildProcess | null = null
  private pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>()
  private queue: ClientFrame[] = [] // requests made before ready
  private seq = 0
  private backoff = 1000
  private retry?: ReturnType<typeof setTimeout>
  private pinger?: ReturnType<typeof setInterval>
  private stderr = ''
  private noise: string[] = [] // host stdout before the first frame (shell profiles)
  private askpass = new Askpass((prompt) => { if (prompt) this.set({ phase: 'prompt', prompt }); else if (this.state.phase === 'prompt') this.set({ phase: 'connecting', prompt: undefined }) })
  private control = join(tmpdir(), `orc-cm-${process.pid}-%C`) // one authenticated connection per host, reused for 60 s after it closes

  constructor(private host: string, private push: Push) { this.state = { kind: 'remote', host, phase: 'connecting', clockOffset: 0 } }
  private set(p: Partial<TransportState>): void { this.state = { ...this.state, ...p }; this.push('transport:state', this.state) }
  private hello(takeover: boolean): ClientFrame { return { hello: { version: __ORC_VERSION__, client: { host: hostname(), user: userInfo().username }, takeover, oauthToken: token() } } }
  private write(f: ClientFrame): void { this.proc?.stdin?.write(encode(f)) }

  connect(takeover = false): void {
    clearTimeout(this.retry)
    this.stop()
    this.set({ phase: 'connecting', error: undefined, holder: undefined, prompt: undefined, install: undefined })
    this.stderr = ''; this.noise = []
    const proc = spawn('ssh', [
      '-T', '-o', 'StrictHostKeyChecking=ask', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
      '-o', 'ControlMaster=auto', '-o', `ControlPath=${this.control}`, '-o', 'ControlPersist=60',
      this.host, remoteCommand()
    ], { env: { ...process.env, ...this.askpass.env } })
    this.proc = proc
    proc.stderr!.on('data', (d) => { this.stderr += d })
    createInterface({ input: proc.stdout! }).on('line', (l) => this.onLine(proc, l))
    proc.on('close', (code) => this.onClose(proc, code))
    proc.stdin!.on('error', () => {}) // EPIPE when the server is already gone; close handles it
    this.write(this.hello(takeover))
    this.pinger = setInterval(() => this.write({ ping: Date.now() }), 15_000) // feeds the server's liveness timer, from hello on
  }

  call(method: string, args: unknown[]): Promise<unknown> {
    return new Promise((res, rej) => {
      const id = ++this.seq
      this.pending.set(id, { res, rej })
      const f = { id, method, args }
      if (this.state.phase === 'ready') this.write(f); else this.queue.push(f)
    })
  }

  private onLine(proc: ChildProcess, line: string): void {
    if (proc !== this.proc) return
    const f = decode<ServerFrame>(line)
    if (!f) { if (this.state.phase !== 'ready') this.noise.push(line); return }
    if ('ready' in f) {
      if (f.ready.version !== __ORC_VERSION__) return this.fail(`Server is ${f.ready.version}, this app is ${__ORC_VERSION__} — push a matching build with scripts/dev-remote.sh ${this.host}.`)
      this.backoff = 1000
      this.set({ phase: 'ready', clockOffset: f.ready.now - Date.now(), holder: undefined, by: undefined, error: undefined })
      for (const q of this.queue.splice(0)) this.write(q)
    } else if ('busy' in f) {
      const h = f.busy.holder, mine = h.kind === 'server' && h.client.host === hostname() && h.client.user === userInfo().username
      if (mine) this.write(this.hello(true)) // our own server from a dropped link, not another person
      else this.set({ phase: 'busy', holder: h })
    } else if ('event' in f) {
      if (f.event === 'taken-over') this.set({ phase: 'taken-over', by: (f.payload as { by: TransportState['by'] }).by })
      else this.push(f.event, f.payload as never)
    } else if ('id' in f) {
      const p = this.pending.get(f.id); this.pending.delete(f.id)
      if (p) f.error ? p.rej(new Error(f.error)) : p.res(f.result ?? null)
    } else if ('install' in f) {
      this.set({ phase: 'installing', install: f.install.phase })
    } else if ('error' in f) {
      if (f.error === 'not-logged-in') this.fail(`Claude isn't signed in on ${this.host}. Sign in for remote hosts (⌘K → Remote sign-in…), or run: ssh -t ${this.host} ${f.claude ?? 'claude'} auth login`)
      else if (f.error === 'install-failed') this.fail(INSTALL_FAILED[f.reason ?? ''] ?? `Installing orc-server on ${this.host} failed (${f.reason}).`)
      else this.fail(f.error)
    }
  }

  private fail(error: string): void { this.set({ phase: 'error', error, prompt: undefined }); this.stop() }

  private onClose(proc: ChildProcess, code: number | null): void {
    if (proc !== this.proc) return
    this.proc = null; clearInterval(this.pinger)
    for (const p of this.pending.values()) p.rej(new Error('Disconnected'))
    this.pending.clear()
    const { phase } = this.state
    if (phase === 'taken-over' || phase === 'error' || phase === 'busy') return // terminal, or waiting on the user
    const detail = this.stderr || this.noise.join('\n')
    if (phase !== 'ready') return this.set({ phase: 'error', error: explain(detail, code), prompt: undefined }) // the handshake never completed: don't loop on it
    this.set({ phase: 'disconnected', error: detail.trim() || undefined })
    this.retry = setTimeout(() => this.connect(), this.backoff)
    this.backoff = Math.min(this.backoff * 2, 30_000)
  }

  answer(text: string | null): void { this.askpass.answer(text) }
  takeover(): void { if (this.proc && this.state.phase === 'busy') this.write(this.hello(true)); else this.connect(true) } // a busy server waits for a second hello
  reconnect(): void { this.connect() }
  shutdown(): void { clearTimeout(this.retry); this.write({ shutdown: true }); this.proc?.stdin?.end(); this.askpass.close() }
  private stop(): void { clearInterval(this.pinger); const p = this.proc; this.proc = null; p?.kill(); this.askpass.answer(null) }
}
