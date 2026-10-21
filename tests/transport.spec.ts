import { expect, test } from '@playwright/test'
import { spawn } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { hostname, tmpdir, userInfo } from 'os'
import { join } from 'path'
import { startTime } from '../src/server/lock'
import { launch, send, shot } from './helpers'
import { fakeSsh } from './remote'

test('remote target over the stdio transport: chat, disconnect and reconnect, connection errors', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orc-remote-data-'))
  const ssh = fakeSsh(dataDir)
  const c = await launch({ remote: 'fakehost', dataDir, seed: true, chats: [{ id: 'history-1', title: null as unknown as string }], env: ssh.env })
  const { page } = c
  await expect(page.getByText('ssh: fakehost')).toBeVisible()
  await expect(page.getByText('Recorded chat').first()).toBeVisible() // the host's saved chat
  await send(page, 'hello there')
  await expect(page.getByText('Hello from Claude')).toBeVisible()
  await shot(page, 'transport-chat')

  // The link drops: the server dies with it; the first attempt back fails too (no network yet), the next one succeeds
  // and history reloads from the host.
  ssh.failOnce()
  ssh.drop()
  await expect(page.getByText('Disconnected from fakehost')).toBeVisible()
  await expect(page.getByText(/Could not resolve hostname/)).toBeVisible() // shown while it keeps trying, never a dead end
  await expect(page.locator('textarea')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Recorded chat').first()).toBeVisible()
  await page.getByText('Chat about hello').first().click()
  await expect(page.getByText('Hello from Claude')).toHaveCount(0) // the fake SDK persists nothing it streamed
  await c.close()

  const bad = await launch({ remote: 'fakehost', waitFor: 'none', env: fakeSsh(dataDir, { fail: 'ssh: connect to host fakehost port 22: Connection refused' }).env })
  await expect(bad.page.getByText('Could not connect')).toBeVisible()
  await expect(bad.page.getByText(/Connection refused/)).toBeVisible()
  await expect(bad.page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await shot(bad.page, 'transport-error')
  await bad.close()
})

test('remote sign-in: ssh prompts answered in the window, the token reaches only the SDK, hosts without a login', async () => {
  // ssh asks for a password: it shows in the window; a wrong answer fails like ssh does, the right one connects.
  const dataDir = mkdtempSync(join(tmpdir(), 'orc-remote-data-'))
  const c = await launch({ remote: 'fakehost', dataDir, seed: true, waitFor: 'none', env: { ...fakeSsh(dataDir, { password: 'secret' }).env, ORC_OAUTH_TOKEN: 'sk-ant-oat01-test' } })
  const { page } = c
  await expect(page.getByText("fakehost's password:")).toBeVisible()
  await shot(page, 'transport-prompt')
  await page.getByLabel('Answer').fill('wrong')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText(/Permission denied/)).toBeVisible()
  await page.getByRole('button', { name: 'Retry' }).click()
  await page.getByLabel('Answer').fill('secret')
  await page.getByLabel('Answer').press('Enter')
  await expect(page.locator('textarea')).toBeVisible()
  // The stored token travels in hello and lands in the SDK process's environment on the host, nowhere else.
  await send(page, 'hello there')
  await expect(page.getByText('Hello from Claude')).toBeVisible()
  expect(readFileSync(join(c.projectPath, '.token-seen'), 'utf-8')).toBe('sk-ant-oat01-test')
  expect(readFileSync(join(dataDir, 'lock'), 'utf-8')).not.toContain('oat01')
  await c.close()

  // No token and no login on the host: told how to fix it instead of a dead chat.
  const out = await launch({ remote: 'fakehost', dataDir, waitFor: 'none', env: { ...fakeSsh(dataDir, { env: { ORC_FAKE_LOGGED_OUT: '1' } }).env, ORC_OAUTH_TOKEN: '' } })
  await expect(out.page.getByText(/isn't signed in on fakehost/)).toBeVisible()
  await expect(out.page.getByText(/auth login/)).toBeVisible()
  await shot(out.page, 'transport-not-logged-in')
  await out.close()

  // The sign-in palette stores and forgets the token.
  const local = await launch({ env: { ORC_OAUTH_TOKEN: '' } })
  await local.page.keyboard.press('ControlOrMeta+p')
  await local.page.getByText('Remote sign-in…').click()
  await expect(local.page.getByText('Not signed in')).toBeVisible()
  await local.page.getByPlaceholder(/setup-token/).fill('sk-ant-oat01-pasted')
  await local.page.getByText('Save token for remote hosts').click()
  await local.page.keyboard.press('ControlOrMeta+p')
  await local.page.getByText('Remote sign-in…').click()
  await expect(local.page.getByText('Signed in for remote hosts')).toBeVisible()
  await shot(local.page, 'signin')
  await local.page.getByText('Forget token').click()
  await local.page.keyboard.press('ControlOrMeta+p')
  await local.page.getByText('Remote sign-in…').click()
  await expect(local.page.getByText('Not signed in')).toBeVisible()
  await local.close()
})

test('a server left behind by a dropped link is taken over automatically', async () => {
  // The host still runs "our" server from the previous connection (same client host and user): the new one evicts it without asking.
  const dataDir = mkdtempSync(join(tmpdir(), 'orc-remote-data-'))
  const old = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)']) // stands in for the lingering server: alive, holds the lock, never answers
  const startedAt = startTime(old.pid!)
  const me = { host: hostname(), user: userInfo().username }
  writeFileSync(join(dataDir, 'lock'), JSON.stringify({ pid: old.pid, startedAt, ...me, client: me, since: Date.now() - 60_000, kind: 'server' }))
  const c = await launch({ remote: 'fakehost', dataDir, seed: true, waitFor: 'none', env: fakeSsh(dataDir).env })
  await expect(c.page.locator('textarea')).toBeVisible({ timeout: 15_000 }) // never the busy screen
  await expect.poll(() => old.exitCode ?? old.signalCode).not.toBeNull()
  expect(JSON.parse(readFileSync(join(dataDir, 'lock'), 'utf-8')).pid).not.toBe(old.pid)
  await c.close()
})

test('a Windows host is recognised on the first connect and remembered', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orc-remote-data-'))
  const c = await launch({ remote: 'fakehost', dataDir, seed: true, env: fakeSsh(dataDir, { windows: true }).env })
  await expect(c.page.getByText('ssh: fakehost')).toBeVisible()
  expect(JSON.parse(readFileSync(join(c.userData, 'hosts.json'), 'utf-8')).windowsHosts).toEqual(['fakehost'])
  await c.close()
})

test('remote UI: hosts from ~/.ssh/config, the remote folder picker', async () => {
  const home = mkdtempSync(join(tmpdir(), 'orc-home-'))
  mkdirSync(join(home, '.ssh')); mkdirSync(join(home, 'projA'))
  writeFileSync(join(home, '.ssh', 'config'), 'Host devbox\n  HostName 10.0.0.5\nHost *\n  ServerAliveInterval 30\n')
  const local = await launch({ env: { HOME: home, USERPROFILE: home } })
  await local.page.keyboard.press('ControlOrMeta+p')
  await local.page.getByText('Connect to host…').click()
  await expect(local.page.getByText('devbox')).toBeVisible()
  await expect(local.page.getByText('*', { exact: true })).toHaveCount(0)
  await shot(local.page, 'remote-hosts')
  await local.close()

  const dataDir = mkdtempSync(join(tmpdir(), 'orc-remote-data-'))
  const c = await launch({ remote: 'fakehost', dataDir, env: { ...fakeSsh(dataDir).env, HOME: home, USERPROFILE: home } })
  await c.page.getByText('No project', { exact: true }).click()
  await c.page.getByText('Open folder…').click()
  await expect(c.page.getByText('projA')).toBeVisible() // the host's home, not a native dialog
  await c.page.getByText('projA').click()
  await c.page.getByText(/^Use .*projA$/).click()
  await expect(c.page.locator('aside').getByText('projA')).toBeVisible()
  await shot(c.page, 'remote-folders')
  await c.close()
})
