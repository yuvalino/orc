#!/usr/bin/env node
// Drives an orc-server over stdio with the fake SDK: hello → ready, projects.list, a streamed chat.
// Usage: node scripts/check-server.mjs [path/to/orc-server]   (default: out/main/orc-server.js under Electron's Node)
import { spawn } from 'child_process'
import { createRequire } from 'module'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { createInterface } from 'readline'

const require = createRequire(import.meta.url)
const dataDir = mkdtempSync(join(tmpdir(), 'orc-check-'))
const [bin] = process.argv.slice(2)
const env = { ...process.env, ORC_FAKE_SDK: resolve('tests/fixtures'), ELECTRON_RUN_AS_NODE: '1' }
const child = bin ? spawn(bin, ['--stdio', '--data-dir', dataDir], { env }) : spawn(require('electron'), [resolve('out/main/orc-server.js'), '--stdio', '--data-dir', dataDir], { env })
const send = (f) => child.stdin.write(JSON.stringify(f) + '\n')
let id = 0
const pending = new Map()
const call = (method, ...args) => new Promise((res, rej) => { pending.set(++id, [res, rej]); send({ id, method, args }) })
const events = []
let ready
const onReady = new Promise((r) => (ready = r))
createInterface({ input: child.stdout }).on('line', (l) => {
  if (!l.startsWith('{')) { console.log('noise:', l); return }
  const f = JSON.parse(l)
  if (f.ready) ready(f.ready)
  else if (f.busy || (f.error && !('id' in f))) { console.error('handshake failed:', f); process.exit(1) }
  else if ('id' in f) { const [res, rej] = pending.get(f.id); pending.delete(f.id); f.error ? rej(new Error(f.error)) : res(f.result) }
  else if (f.event) events.push(f)
})
child.stderr.on('data', (d) => process.stderr.write(d))
child.on('exit', (c) => { if (c) { console.error('server exited', c); process.exit(1) } })

send({ hello: { version: '0.0.0-check', client: { host: 'check', user: 'check' }, takeover: false } })
const r = await onReady
console.log('ready:', r.version, r.host)
console.log('projects.list:', await call('projects.list'))
const s = await call('sessions.create', null)
await call('sessions.send', s.id, 'hello there')
const t0 = Date.now()
while (!events.some((e) => e.event === 'transcript:patch' && JSON.stringify(e.payload).includes('Hello from Claude')) && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 50))
const ok = events.some((e) => e.event === 'transcript:patch' && JSON.stringify(e.payload).includes('Hello from Claude'))
console.log(ok ? 'chat streamed: OK' : 'chat streamed: FAIL', `(${events.length} events)`)
send({ shutdown: true })
await new Promise((r) => child.on('close', r))
rmSync(dataDir, { recursive: true, force: true })
process.exit(ok ? 0 : 1)
