import { expect, test } from '@playwright/test'
import { execSync } from 'child_process'
import { createHash } from 'crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { launch, send, shot } from './helpers'

const electron = require('electron') as unknown as string
const server = join(__dirname, '../out/main/orc-server.js')
const version = require('../package.json').version as string

/** An `ssh` that runs the remote command (its last argument) locally, so the real bootstrap executes under the temp HOME. */
function sshRunner(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orc-ssh-'))
  writeFileSync(join(dir, 'ssh'), '#!/bin/sh\nfor a; do last=$a; done\nexec sh -c "$last"\n')
  chmodSync(join(dir, 'ssh'), 0o755)
  return dir
}

/** A flat bundle whose orc-server is the fake-SDK server, like the real one's layout. */
function bundle(dataDir: string): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'orc-bundle-'))
  writeFileSync(join(dir, 'orc-server'), `#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 ORC_FAKE_SDK="${join(__dirname, 'fixtures')}" "${electron}" "${server}" "$@" --data-dir "${dataDir}"\n`)
  writeFileSync(join(dir, 'claude'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(dir, 'orc-server'), 0o755); chmodSync(join(dir, 'claude'), 0o755)
  return execSync('tar cf - orc-server claude | gzip', { cwd: dir })
}

test('first connect installs orc-server on the host: checksum refusal, the ~/.orc layout, no second download', async () => {
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

  const c = await launch({ remote: 'fakehost', dataDir, seed: true, waitFor: 'none', env: { PATH: `${sshRunner()}:${process.env.PATH}`, HOME: home, ORC_BUNDLES_JSON: manifest } })
  const { page } = c
  await expect(page.getByText(/did not match its checksum/)).toBeVisible()
  expect(existsSync(join(home, '.orc', version))).toBe(false) // nothing half-installed
  expect(readdirSync(join(home, '.orc')).filter((e) => e.startsWith('.tmp.'))).toEqual([]) // staging cleaned by the trap

  body = good
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText(/Installing Orc server on fakehost/)).toBeVisible()
  await shot(page, 'install')
  await expect(page.locator('textarea')).toBeVisible({ timeout: 15_000 })
  expect(readdirSync(join(home, '.orc', version)).sort()).toEqual(['claude', 'orc-server'])
  await send(page, 'hello there')
  await expect(page.getByText('Hello from Claude')).toBeVisible()
  expect(hits).toBe(2)

  // The link drops: the reconnect finds the install in place and starts the server without downloading again.
  execSync(`pkill -f "orc-server.js --stdio --data-dir ${dataDir}"`)
  await expect(page.getByText('Disconnected from fakehost')).toBeVisible()
  await expect(page.locator('textarea')).toBeVisible({ timeout: 10_000 })
  expect(hits).toBe(2)
  await c.close()
  http.close()
})
