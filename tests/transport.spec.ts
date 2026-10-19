import { expect, test } from '@playwright/test'
import { execSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launch, send, shot } from './helpers'

const electron = require('electron') as unknown as string
const server = join(__dirname, '../out/main/orc-server.js')

/** An `ssh` on PATH that ignores its arguments and runs orc-server locally — with a line of "profile noise" first, like a real host's shell would. */
export function sshShim(dataDir: string, fail?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'orc-ssh-'))
  const body = fail
    ? `#!/bin/sh\necho "${fail}" >&2\nexit 255\n`
    : `#!/bin/sh\necho "Welcome to fakehost (motd)"\nexec env ELECTRON_RUN_AS_NODE=1 ORC_FAKE_SDK="${join(__dirname, 'fixtures')}" "${electron}" "${server}" --stdio --data-dir "${dataDir}"\n`
  writeFileSync(join(dir, 'ssh'), body)
  chmodSync(join(dir, 'ssh'), 0o755)
  return dir
}

test('remote target over the stdio transport: chat, disconnect and reconnect, connection errors', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orc-remote-data-'))
  const c = await launch({ remote: 'fakehost', dataDir, seed: true, chats: [{ id: 'history-1', title: null as unknown as string }], env: { PATH: `${sshShim(dataDir)}:${process.env.PATH}` } })
  const { page } = c
  await expect(page.getByText('ssh: fakehost')).toBeVisible()
  await expect(page.getByText('Recorded chat').first()).toBeVisible() // the host's saved chat
  await send(page, 'hello there')
  await expect(page.getByText('Hello from Claude')).toBeVisible()
  await shot(page, 'transport-chat')

  // The link drops: the server dies with it; a fresh one is started and history reloads from the host.
  execSync(`pkill -f "orc-server.js --stdio --data-dir ${dataDir}"`)
  await expect(page.getByText('Disconnected from fakehost')).toBeVisible()
  await expect(page.locator('textarea')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Recorded chat').first()).toBeVisible()
  await page.getByText('Chat about hello').first().click()
  await expect(page.getByText('Hello from Claude')).toHaveCount(0) // the fake SDK persists nothing it streamed
  await c.close()

  const bad = await launch({ remote: 'fakehost', waitFor: 'none', env: { PATH: `${sshShim(dataDir, 'ssh: connect to host fakehost port 22: Connection refused')}:${process.env.PATH}` } })
  await expect(bad.page.getByText('Could not connect')).toBeVisible()
  await expect(bad.page.getByText(/Connection refused/)).toBeVisible()
  await expect(bad.page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await shot(bad.page, 'transport-error')
  await bad.close()
})

test('remote UI: hosts from ~/.ssh/config, the remote folder picker', async () => {
  const home = mkdtempSync(join(tmpdir(), 'orc-home-'))
  mkdirSync(join(home, '.ssh')); mkdirSync(join(home, 'projA'))
  writeFileSync(join(home, '.ssh', 'config'), 'Host devbox\n  HostName 10.0.0.5\nHost *\n  ServerAliveInterval 30\n')
  const local = await launch({ env: { HOME: home } })
  await local.page.keyboard.press('Meta+k')
  await local.page.getByText('Connect to host…').click()
  await expect(local.page.getByText('devbox')).toBeVisible()
  await expect(local.page.getByText('*', { exact: true })).toHaveCount(0)
  await shot(local.page, 'remote-hosts')
  await local.close()

  const dataDir = mkdtempSync(join(tmpdir(), 'orc-remote-data-'))
  const c = await launch({ remote: 'fakehost', dataDir, env: { PATH: `${sshShim(dataDir)}:${process.env.PATH}`, HOME: home } })
  await c.page.getByText('No project', { exact: true }).click()
  await c.page.getByText('Open folder…').click()
  await expect(c.page.getByText('projA')).toBeVisible() // the host's home, not a native dialog
  await c.page.getByText('projA').click()
  await c.page.getByText(/^Use .*projA$/).click()
  await expect(c.page.locator('aside').getByText('projA')).toBeVisible()
  await shot(c.page, 'remote-folders')
  await c.close()
})
