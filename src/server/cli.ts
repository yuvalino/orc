import { execFile, execFileSync } from 'child_process'
import { readdirSync, rmSync, statSync } from 'fs'
import { createRequire } from 'module'
import { hostname } from 'os'
import { dirname, join, sep } from 'path'
import { createInterface } from 'readline'
import { decode, encode, type ClientFrame, type Hello, type ServerFrame } from '@shared/protocol'
import { claudeBinary, configureClaude } from './codecs/claude/codec'
import { Engine, type Push } from './engine'
import { createHandlers, methodTable } from './handlers'
import { Lock } from './lock'
import { dataDir, setDataDir } from './store'

/**
 * orc-server --stdio [--data-dir <dir>]: the engine behind one client, spoken to over stdin/stdout.
 * Started by `ssh host '~/.orc/<version>/orc-server --stdio'`; lives exactly as long as that connection.
 */
const args = process.argv.slice(2)
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const dd = flag('--data-dir')
if (dd) setDataDir(dd)

const win = process.platform === 'win32', exe = win ? 'claude.exe' : 'claude'
const isSea = (() => { try { return (require('node:sea') as { isSea(): boolean }).isSea() } catch { return false } })()
configureClaude({ version: __ORC_VERSION__, binaryPath: isSea ? join(dirname(process.execPath), exe) : undefined }) // under plain node the SDK finds its own binary

const write = (f: ServerFrame) => { process.stdout.write(encode(f)) }
const push: Push = (event, payload) => write({ event, payload })
const engine = new Engine(push)
const methods = methodTable(createHandlers(engine, push))
const lock = new Lock(dataDir())
let ready = false, last = Date.now()

function exit(code = 0): void {
  engine.closeAll()
  lock.release()
  process.exit(code)
}
process.stdin.on('end', () => exit())
process.stdout.on('error', () => exit()) // EPIPE: the client is gone
process.on('SIGHUP', () => exit())
lock.onTakeover(() => { // a take-over by another instance, or a plain kill
  const by = ready ? lock.takenOverBy() : null
  engine.closeAll(); lock.release()
  if (by) process.stdout.write(encode({ event: 'taken-over', payload: { by } }), () => process.exit(0)) // flushed before exit, even behind a backed-up pipe
  else process.exit(0)
})
setInterval(() => { if (Date.now() - last > 45_000) exit() }, 5_000).unref() // a half-open link the client never closes

/**
 * Old installs under ~/.orc: keep the two newest versions and any a running server executes from, drop staging dirs
 * older than a day. Done by the server after it holds the lock, never by the installer, so nothing is pulled from under a live one.
 */
function prune(): void {
  if (!isSea) return
  const root = dirname(dirname(process.execPath))
  const num = (v: string) => v.split('.').map((x) => parseInt(x, 10) || 0)
  const newer = (a: string, b: string) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (y[i] ?? 0) - (x[i] ?? 0); return 0 }
  let ps = ''
  try { ps = win ? execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Process).CommandLine'], { encoding: 'utf-8', windowsHide: true }) : execFileSync('ps', ['-axo', 'args='], { encoding: 'utf-8' }) } catch { return }
  try {
    const entries = readdirSync(root)
    const versions = entries.filter((e) => /^\d+\.\d+\.\d+/.test(e)).sort(newer)
    const rm = (p: string) => { try { rmSync(p, { recursive: true, force: true }) } catch { /* in use */ } }
    for (const v of versions.slice(2)) if (!ps.includes(join(root, v) + sep)) rm(join(root, v))
    for (const e of entries) if (e.startsWith('.tmp.') && Date.now() - statSync(join(root, e)).mtimeMs > 86_400_000) rm(join(root, e))
  } catch { /* best effort */ }
}

/** Without a forwarded token the host's own Claude login must exist; the SDK's binary answers that. */
async function loggedIn(): Promise<{ ok: boolean; claude: string }> {
  const claude = claudeBinary() ?? (() => { try { return createRequire(__filename).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${exe}`) } catch { return 'claude' } })()
  if (process.env.ORC_FAKE_SDK) return { ok: !process.env.ORC_FAKE_LOGGED_OUT, claude }
  return new Promise((r) => execFile(claude, ['auth', 'status', '--json'], { env: { ...process.env }, windowsHide: true }, (_e, out) => { try { r({ ok: !!JSON.parse(out).loggedIn, claude }) } catch { r({ ok: false, claude }) } }))
}

async function hello(h: Hello): Promise<void> {
  const client = h.client
  if (h.takeover && !(await lock.takeover(client))) { write({ error: 'orc is running on another machine with this folder; stop it there first.' }); return }
  if (h.oauthToken) configureClaude({ env: { CLAUDE_CODE_OAUTH_TOKEN: h.oauthToken } }) // SDK process only; never this process's env or disk
  else { const l = await loggedIn(); if (!l.ok) { write({ error: 'not-logged-in', claude: l.claude }); return } }
  if (lock.acquire('server', client)) {
    ready = true
    prune()
    engine.hydrateTitles()
    write({ ready: { version: __ORC_VERSION__, host: hostname(), dataDir: dataDir(), now: Date.now() } })
  } else {
    const holder = lock.holder()
    write(holder ? { busy: { holder: { client: holder.client, since: holder.since, kind: holder.kind } } } : { error: 'Could not take the lock' })
  }
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  const f = decode<ClientFrame>(line)
  if (!f) return
  last = Date.now()
  if ('ping' in f) write({ pong: f.ping })
  else if ('shutdown' in f) exit()
  else if ('hello' in f) await hello(f.hello)
  else if ('method' in f) {
    if (!ready) return write({ id: f.id, error: 'Not ready' })
    const fn = methods[f.method]
    if (!fn) return write({ id: f.id, error: `Unknown method: ${f.method}` })
    try { write({ id: f.id, result: (await fn(...f.args)) ?? null }) } catch (e) { write({ id: f.id, error: e instanceof Error ? e.message : String(e) }) }
  }
})
