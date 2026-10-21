import { expect, test } from '@playwright/test'
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { launch, send, shot } from './helpers'
import { fakeSsh } from './remote'

const electron = require('electron') as unknown as string
const root = join(__dirname, '..')
const server = join(root, 'out/main/orc-server.js')
const version = require('../package.json').version as string
const win = process.platform === 'win32'
const tar = win ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar' // never Git's GNU tar

/** A real orc-server.exe for this machine (a Node SEA of the current build), rebuilt when the server changed. */
function seaServer(): string {
  const exe = join(root, 'out/server', `${process.platform}-${process.arch}`, 'orc-server.exe')
  if (!existsSync(exe) || statSync(exe).mtimeMs < statSync(server).mtimeMs) execFileSync(process.execPath, ['scripts/build-server.mjs', '--sea-only'], { cwd: root, stdio: 'ignore' })
  return exe
}

/**
 * A flat bundle in the real one's layout. Unix: an orc-server script that runs the fake-SDK server. Windows hosts run
 * orc-server.exe straight from cmd, so there it is the real thing (which reads the fake SDK and data dir from its env).
 */
function bundle(dataDir: string): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'orc-bundle-'))
  const [srv, claude] = win ? ['orc-server.exe', 'claude.exe'] : ['orc-server', 'claude']
  if (win) copyFileSync(seaServer(), join(dir, srv))
  else writeFileSync(join(dir, srv), `#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 ORC_FAKE_SDK="${join(__dirname, 'fixtures')}" "${electron}" "${server}" "$@" --data-dir "${dataDir}"\n`)
  writeFileSync(join(dir, claude), win ? '' : '#!/bin/sh\nexit 0\n')
  chmodSync(join(dir, srv), 0o755); chmodSync(join(dir, claude), 0o755)
  return execFileSync(tar, ['czf', '-', srv, claude], { cwd: dir, maxBuffer: 512 * 1024 * 1024 })
}

test('first connect has the host download orc-server: checksum refusal, the ~/.orc layout, no second download', async () => {
  test.setTimeout(120_000) // the first run on Windows builds orc-server.exe
  const home = mkdtempSync(join(tmpdir(), 'orc-home-')), dataDir = mkdtempSync(join(tmpdir(), 'orc-remote-data-'))
  const good = bundle(dataDir)
  const bad = Buffer.from(good); bad[100] ^= 0xff
  let body = bad, hits = 0 // corrupted first
  const http = createServer((_req, res) => { hits++; res.end(body) }).listen(0, '127.0.0.1')
  await new Promise((r) => http.once('listening', r))
  const port = (http.address() as { port: number }).port
  const sha256 = createHash('sha256').update(good).digest('hex')
  const manifest = join(home, 'bundles.json')
  writeFileSync(manifest, JSON.stringify({ version, bundles: { [`${process.platform}-${process.arch}`]: { url: `http://127.0.0.1:${port}/bundle.tgz`, sha256 } } }))

  // The host runs the real bootstrap under a temp home: sh on Unix; on Windows cmd, which turns the Unix bootstrap away
  // so Orc switches to the PowerShell one.
  const ssh = fakeSsh(dataDir, { mode: 'runner', windows: win })
  const c = await launch({ remote: 'fakehost', dataDir, seed: true, waitFor: 'none', env: { ...ssh.env, HOME: home, USERPROFILE: home, ORC_BUNDLES_JSON: manifest, ORC_EDITION: 'regular' } })
  const { page } = c
  await expect(page.getByText(/did not match its checksum/)).toBeVisible({ timeout: 20_000 })
  expect(existsSync(join(home, '.orc', version))).toBe(false) // nothing half-installed
  await expect.poll(() => readdirSync(join(home, '.orc')).filter((e) => e.startsWith('.tmp.'))).toEqual([]) // staging cleaned up (just after the error is reported)

  body = good
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText(/Installing Orc server on fakehost/)).toBeVisible()
  await shot(page, 'install')
  await expect(page.locator('textarea')).toBeVisible({ timeout: 30_000 })
  expect(readdirSync(join(home, '.orc', version)).sort()).toEqual(win ? ['claude.exe', 'orc-server.exe'] : ['claude', 'orc-server'])
  await send(page, 'hello there')
  await expect(page.getByText('Hello from Claude')).toBeVisible()
  expect(hits).toBe(2)

  // The link drops: the reconnect finds the install in place and starts the server without downloading again.
  ssh.drop()
  await expect(page.getByText('Disconnected from fakehost')).toBeVisible()
  await expect(page.locator('textarea')).toBeVisible({ timeout: 20_000 })
  expect(hits).toBe(2)
  await c.close()
  http.close()
})

test('Orc Offline sends orc-server over ssh: nothing is fetched, a corrupt copy is refused, the install is kept', async () => {
  test.setTimeout(120_000) // the first run on Windows builds orc-server.exe
  const home = mkdtempSync(join(tmpdir(), 'orc-home-')), dataDir = mkdtempSync(join(tmpdir(), 'orc-remote-data-'))
  const servers = mkdtempSync(join(tmpdir(), 'orc-servers-')), file = join(servers, `orc-server-${process.platform}-${process.arch}.tar.gz`)
  const good = bundle(dataDir)
  const bad = Buffer.from(good); bad[100] ^= 0xff
  writeFileSync(file, bad) // corrupted first, as if damaged on the way
  const manifest = join(home, 'bundles.json') // the URL is never used: anything fetched would fail
  writeFileSync(manifest, JSON.stringify({ version, bundles: { [`${process.platform}-${process.arch}`]: { url: 'http://127.0.0.1:9/unused', sha256: createHash('sha256').update(good).digest('hex') } } }))

  const ssh = fakeSsh(dataDir, { mode: 'runner', windows: win })
  const c = await launch({ remote: 'fakehost', dataDir, seed: true, waitFor: 'none', env: { ...ssh.env, HOME: home, USERPROFILE: home, ORC_BUNDLES_JSON: manifest, ORC_EDITION: 'offline', ORC_SERVERS_DIR: servers } })
  const { page } = c
  await expect(page.getByText(/did not match its checksum/)).toBeVisible({ timeout: 20_000 })
  expect(existsSync(join(home, '.orc', version))).toBe(false) // nothing half-installed
  await expect.poll(() => readdirSync(join(home, '.orc')).filter((e) => e.startsWith('.tmp.'))).toEqual([]) // staging cleaned up (just after the error is reported)

  writeFileSync(file, good)
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.locator('textarea')).toBeVisible({ timeout: 30_000 })
  expect(readdirSync(join(home, '.orc', version)).sort()).toEqual(win ? ['claude.exe', 'orc-server.exe'] : ['claude', 'orc-server'])
  await send(page, 'hello there')
  await expect(page.getByText('Hello from Claude')).toBeVisible()

  // The link drops: the reconnect starts the installed server, with nothing left to send.
  rmSync(servers, { recursive: true, force: true })
  ssh.drop()
  await expect(page.getByText('Disconnected from fakehost')).toBeVisible()
  await expect(page.locator('textarea')).toBeVisible({ timeout: 20_000 })
  await c.close()
})
