import { spawn, type ChildProcess } from 'child_process'
import { createReadStream, existsSync, readFileSync } from 'fs'
import { hostname, tmpdir, userInfo } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { app } from 'electron'
import type { TransportState } from '@shared/api'
import { decode, encode, type ClientFrame, type ServerFrame } from '@shared/protocol'
import type { Push } from '../server/engine'
import manifest from '../../bundles.json'
import { Askpass } from './askpass'
import bootstrap from './bootstrap.sh?raw'
import bootstrapPs from './bootstrap.ps1?raw'
import { sharedStore } from './shell'
import { token } from './signin'

/** Hints for the ssh failures everyone hits. */
function explain(detail: string, code: number | null): string {
  if (/Permission denied/.test(detail)) return `${detail.trim()}\nThe host did not accept your key or password.`
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/.test(detail)) return `${detail.trim()}\nThe host's key changed; check with its admin, then remove the old entry from ~/.ssh/known_hosts.`
  if (/Host key verification failed/.test(detail)) return `${detail.trim()}\nThe host's key was not accepted.`
  return detail.trim() || `ssh exited with code ${code}`
}
const INSTALL_FAILED: Record<string, string> = {
  'no-curl': 'The host has no curl, which the one-time install needs.',
  download: 'The host could not download the Orc server bundle; it needs internet access to github.com.',
  upload: 'The Orc server bundle could not be written on the host.',
  sha256: 'The Orc server bundle did not match its checksum on the host.',
  unpacking: 'The Orc server bundle could not be unpacked on the host.',
  'no-bundle': "This build of Orc ships no server bundle for the host's platform.",
  'unsupported-host': 'orc-server runs on macOS, glibc ≥ 2.28 Linux and Windows (x64/arm64); this host is something else.'
}

/**
 * Two editions, set when the app is built (ORC_OFFLINE=1, see electron.vite.config.ts; ORC_EDITION for tests). The
 * regular one has a host download orc-server from the GitHub release; the offline one carries every host's bundle and
 * sends it over ssh, so nothing anywhere is fetched. Neither falls back to the other.
 */
const offline = process.env.ORC_EDITION ? process.env.ORC_EDITION === 'offline' : __ORC_OFFLINE__
/** The offline edition's bundles: in the app's resources once packaged, scripts/build-server.mjs's out/server in development. */
const serversDir = () => process.env.ORC_SERVERS_DIR || (app.isPackaged ? join(process.resourcesPath, 'servers') : join(__dirname, '../server'))
type Mode = 'download' | 'probe' | 'receive'

/**
 * The remote command: a bootstrap that installs ~/.orc/<version>/ on first use and then becomes the server (modes in
 * bootstrap.sh). The bundle table is the repo's bundles.json, compiled in (ORC_BUNDLES_JSON points tests at another one).
 * Unix hosts: a sh script, base64-encoded so the user's login shell (whatever it is) hands it to `sh` untouched.
 * Windows hosts: a PowerShell install script (-EncodedCommand, so cmd and PowerShell both pass it untouched) chained
 * with the server by cmd, which hands it our stdio intact. Which kind a host is gets learnt on the first connect.
 */
function remoteCommand(windows: boolean, mode: Mode): string {
  const { bundles } = (process.env.ORC_BUNDLES_JSON ? JSON.parse(readFileSync(process.env.ORC_BUNDLES_JSON, 'utf-8')) : manifest) as { bundles: Record<string, { url: string; sha256: string }> }
  const table = Object.entries(bundles).filter(([t]) => t.startsWith('win32') === windows).map(([t, b]) => `${t} ${b.url} ${b.sha256}`).join('\n')
  const script = (windows ? bootstrapPs : bootstrap).replaceAll('__VERSION__', () => __ORC_VERSION__).replaceAll('__BUNDLES__', () => table).replaceAll('__MODE__', () => mode)
  if (windows && mode === 'receive') return `cmd /c "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}"` // stdin: the bundle
  if (windows) return `cmd /c "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')} <NUL && %USERPROFILE%\\.orc\\${__ORC_VERSION__}\\orc-server.exe --stdio"`
  return `sh -c 'eval "$(printf %s ${Buffer.from(script).toString('base64')} | base64 --decode)"'`
}
/** What a Unix bootstrap sent to a Windows host comes back with: cmd, PowerShell, or Git's bash via the script itself. */
const WINDOWS_HOST = /'sh' is not recognized|The term 'sh' is not recognized/
/** `user@host:port` as typed → an ssh destination (`host:port` alone would be taken for a hostname). */
const destination = (host: string) => (/:\d+$/.test(host) ? `ssh://${host}` : host)

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
  private dropped = false // a link we had is gone: keep retrying through transport failures until the user says stop
  private askpass = new Askpass((prompt, notice) => { if (prompt) this.set({ phase: 'prompt', prompt, notice }); else if (this.state.phase === 'prompt') this.set({ phase: 'connecting', prompt: undefined, notice: undefined }) })
  private control = join(process.platform === 'darwin' ? '/tmp' : tmpdir(), `orc-cm-${process.pid}-%C`) // one authenticated connection per host, reused for 60 s after it closes; short because sun_path is 104 bytes
  private windows: boolean // the host runs Windows (learnt on the first connect, remembered per host)
  private takeoverWanted = false

  constructor(private host: string, private push: Push) {
    this.state = { kind: 'remote', host, phase: 'connecting', clockOffset: 0 }
    this.windows = ((sharedStore.read().windowsHosts as string[] | undefined) ?? []).includes(host)
  }
  private learnWindows(): void {
    this.windows = true
    const s = sharedStore.read(), known = (s.windowsHosts as string[] | undefined) ?? []
    sharedStore.write({ ...s, windowsHosts: [...new Set([...known, this.host])] })
  }
  private set(p: Partial<TransportState>): void { this.state = { ...this.state, ...p }; this.push('transport:state', this.state) }
  private hello(takeover: boolean): ClientFrame { return { hello: { version: __ORC_VERSION__, client: { host: hostname(), user: userInfo().username }, takeover, oauthToken: token() } } }
  private write(f: ClientFrame): void { this.proc?.stdin?.write(encode(f)) }

  connect(takeover = false): void {
    clearTimeout(this.retry)
    this.stop()
    this.set({ phase: 'connecting', error: undefined, holder: undefined, prompt: undefined, notice: undefined, install: undefined })
    this.stderr = ''; this.noise = []
    this.takeoverWanted = takeover
    this.ssh(remoteCommand(this.windows, offline ? 'probe' : 'download'))
    this.write(this.hello(takeover))
    this.pinger = setInterval(() => this.write({ ping: Date.now() }), 15_000) // feeds the server's liveness timer, from hello on
  }

  /** One ssh connection running `command` on the host; its stdout frames go to onLine. */
  private ssh(command: string): ChildProcess {
    const [ssh, ...pre] = process.env.ORC_SSH ? JSON.parse(process.env.ORC_SSH) as string[] : ['ssh'] // tests: a fake ssh, as an argv prefix
    const proc = spawn(ssh, [
      ...pre, '-T', '-o', 'StrictHostKeyChecking=ask', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
      ...(process.platform === 'win32' ? [] : ['-o', 'ControlMaster=auto', '-o', `ControlPath=${this.control}`, '-o', 'ControlPersist=60']), // Windows' OpenSSH has no multiplexing
      '--', destination(this.host), command
    ], { env: { ...process.env, ...this.askpass.env }, windowsHide: true })
    this.proc = proc
    proc.stderr!.on('data', (d) => { if (proc === this.proc) this.stderr += d })
    createInterface({ input: proc.stdout! }).on('line', (l) => this.onLine(proc, l))
    proc.on('close', (code) => this.onClose(proc, code))
    proc.stdin!.on('error', () => {}) // EPIPE when the server is already gone; close handles it
    return proc
  }

  /** The offline edition's install: a second connection whose stdin is the host's bundle; "done" connects again. */
  private upload(target: string): void {
    const file = join(serversDir(), `orc-server-${target}.tar.gz`)
    this.stop()
    if (!existsSync(file)) return this.fail(INSTALL_FAILED['no-bundle'])
    this.set({ phase: 'installing', install: 'uploading' })
    this.stderr = ''; this.noise = []
    const proc = this.ssh(remoteCommand(this.windows, 'receive'))
    createReadStream(file).pipe(proc.stdin!)
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
      this.backoff = 1000; this.dropped = false
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
      const { phase, target } = f.install
      if (phase === 'needed') this.upload(target ?? '')
      else if (phase === 'done') this.connect(this.takeoverWanted)
      else this.set({ phase: 'installing', install: phase })
    } else if ('error' in f) {
      if (f.error === 'not-logged-in') this.fail(`Claude isn't signed in on ${this.host}. Sign in for remote hosts (${process.platform === 'darwin' ? '⌘P' : 'Ctrl+P'} → Remote sign-in…), or run: ssh -t ${this.host} ${f.claude ?? 'claude'} auth login`)
      else if (f.error === 'install-failed' && f.reason === 'windows-shell' && !this.windows) { this.learnWindows(); this.connect(this.takeoverWanted) }
      else if (f.error === 'install-failed') this.fail(INSTALL_FAILED[f.reason ?? ''] ?? `Installing orc-server on ${this.host} failed (${f.reason}).`)
      else this.fail(f.error)
    }
  }

  /** A handshake-level refusal: terminal until the user retries. */
  private fail(error: string): void {
    this.dropped = false
    this.set({ phase: 'error', error, prompt: undefined, notice: undefined })
    this.stop()
    for (const p of this.pending.values()) p.rej(new Error(error))
    this.pending.clear(); this.queue.length = 0
  }

  private onClose(proc: ChildProcess, code: number | null): void {
    if (proc !== this.proc) return
    this.proc = null; clearInterval(this.pinger)
    for (const p of this.pending.values()) p.rej(new Error('Disconnected'))
    this.pending.clear()
    const { phase } = this.state
    if (phase === 'taken-over' || phase === 'error' || phase === 'busy') return // terminal, or waiting on the user
    const detail = this.stderr || this.noise.join('\n')
    if (phase !== 'ready' && !this.windows && WINDOWS_HOST.test(detail)) { this.learnWindows(); return this.connect(this.takeoverWanted) } // once per host
    if (phase !== 'ready' && !this.dropped) return this.set({ phase: 'error', error: explain(detail, code), prompt: undefined, notice: undefined }) // a first connect never completed: don't loop on it
    this.dropped = true // a transport failure on the way back (DNS, Wi-Fi, host rebooting): keep trying, backing off
    this.set({ phase: 'disconnected', error: detail.trim() || undefined, prompt: undefined, notice: undefined })
    this.retry = setTimeout(() => this.connect(), this.backoff)
    this.backoff = Math.min(this.backoff * 2, 30_000)
  }

  answer(text: string | null): void { this.askpass.answer(text) }
  takeover(): void { if (this.proc && this.state.phase === 'busy') this.write(this.hello(true)); else this.connect(true) } // a busy server waits for a second hello
  reconnect(): void { this.dropped = false; this.backoff = 1000; this.connect() }
  shutdown(): void { clearTimeout(this.retry); this.write({ shutdown: true }); this.proc?.stdin?.end(); this.askpass.close() }
  private stop(): void { clearInterval(this.pinger); const p = this.proc; this.proc = null; p?.kill(); this.askpass.answer(null) }
}
