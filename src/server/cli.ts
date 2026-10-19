import { hostname } from 'os'
import { dirname, join } from 'path'
import { createInterface } from 'readline'
import { decode, encode, type ClientFrame, type Hello, type ServerFrame } from '@shared/protocol'
import { configureClaude } from './codecs/claude/codec'
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

const isSea = (() => { try { return (require('node:sea') as { isSea(): boolean }).isSea() } catch { return false } })()
configureClaude({ version: __ORC_VERSION__, binaryPath: isSea ? join(dirname(process.execPath), 'claude') : undefined }) // under plain node the SDK finds its own binary

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
process.on('SIGTERM', () => { // a take-over by another instance, or a plain kill
  const by = ready ? lock.takenOverBy() : null
  engine.closeAll(); lock.release()
  if (by) write({ event: 'taken-over', payload: { by } })
  process.exit(0)
})
setInterval(() => { if (Date.now() - last > 45_000) exit() }, 5_000).unref() // a half-open link the client never closes

async function hello(h: Hello): Promise<void> {
  const client = h.client
  if (h.takeover && !(await lock.takeover(client))) { write({ error: 'orc is running on another machine with this folder; stop it there first.' }); return }
  if (lock.acquire('server', client)) {
    ready = true
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
