import { expect, test, type Page } from '@playwright/test'
import { execFileSync, spawn } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { launch, shot } from './helpers'

/**
 * A fake update feed (electron-updater's generic provider): the channel file for this platform naming `version`, and its
 * "installer", streamed slowly enough to watch and cancel. `failChecks`: that many checks fail first (HTTP 500).
 */
async function feed(o: { version?: string; failChecks?: number } = {}): Promise<{ url: string; server: Server; hits: () => number }> {
  const version = o.version ?? '0.99.0', payload = randomBytes(2_500_000), name = `Orc-${version}-update.bin`
  const sha512 = createHash('sha512').update(payload).digest('base64')
  const yml = `version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${payload.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '2026-10-21T00:00:00.000Z'\n`
  const channel = { win32: 'latest.yml', darwin: 'latest-mac.yml', linux: 'latest-linux.yml' }[process.platform as 'win32']
  let hits = 0, fails = o.failChecks ?? 0
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname // electron-updater adds ?noCache=…
    if (path.endsWith(channel)) { if (fails > 0) { fails--; res.statusCode = 500; return res.end('down') } return res.end(yml) }
    if (!path.endsWith(name)) { res.statusCode = 404; return res.end() }
    hits++
    res.writeHead(200, { 'Content-Length': payload.length, 'Content-Type': 'application/octet-stream' })
    let at = 0
    const next = () => { if (res.destroyed) return; if (at >= payload.length) return res.end(); res.write(payload.subarray(at, at += 64 * 1024)); setTimeout(next, 100) } // ~4 s in all
    next()
  }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, server, hits: () => hits }
}

const tmp = (name: string) => mkdtempSync(join(tmpdir(), `orc-${name}-`))
const env = (url: string, installed: string, extra: Record<string, string> = {}) => ({
  ORC_UPDATE_FEED: url, ORC_UPDATE_FIRST_CHECK_MS: '300', ORC_UPDATE_INSTALLED: installed,
  ...(process.platform === 'linux' ? { APPIMAGE: join(tmp('appimage'), 'Orc.AppImage') } : {}), // electron-updater only updates an AppImage
  ...extra
})
/** A userData dir with update prefs already saved. */
const withPrefs = (prefs: object) => { const d = tmp('ud'); writeFileSync(join(d, 'updates.json'), JSON.stringify(prefs)); return d }
const bell = (page: Page) => page.getByRole('button', { name: 'Notifications' })
const panel = (page: Page) => page.getByRole('dialog', { name: 'Notifications' })
const read = (file: string) => JSON.parse(readFileSync(file, 'utf-8'))

test('updates: found and downloaded automatically, cancel, check again, ready, restart asks first when it would interrupt', async () => {
  const f = await feed(), installed = join(tmp('installed'), 'installed.json')
  const c = await launch({ env: env(f.url, installed) })
  const { page } = c

  // Found on the first check and downloading at once: the bell gets its dot; the card shows progress and Cancel.
  await expect(page.getByTestId('notices-dot')).toBeVisible({ timeout: 10_000 })
  await bell(page).click()
  const downloading = panel(page).getByTestId('notice-update-downloading')
  await expect(downloading).toContainText('Downloading Orc 0.99.0')
  await expect(downloading.getByRole('progressbar')).toBeAttached() // at 0% it has no width yet
  await expect(downloading).toContainText(/MB of/)
  await shot(page, 'notifications-downloading')
  await downloading.getByRole('button', { name: 'Cancel' }).click()
  await expect(panel(page)).toContainText('No notifications')
  await expect(page.getByTestId('notices-dot')).toHaveCount(0)

  // Check for updates in Settings gets it again; Settings stays and shows how it goes, then offers Restart to update.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+,')
  await page.getByRole('button', { name: 'Check for updates' }).click()
  await expect(page.getByTestId('update-status')).toContainText(/Checking for updates|Downloading Orc 0.99.0/)
  await expect(page.getByTestId('update-status')).toHaveText('Orc 0.99.0 is ready to install', { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible() // still in Settings
  expect(f.hits()).toBe(2)
  await page.keyboard.press('Escape')
  await bell(page).click()
  const ready = panel(page).getByTestId('notice-update-ready')
  await expect(ready).toContainText('Orc 0.99.0 is ready to install')
  await expect(ready.getByRole('button', { name: 'Dismiss' })).toHaveCount(0) // it stays until you restart
  await shot(page, 'notifications-ready')

  // Unsent text would be lost: Restart to update asks first, in its own dialog window.
  await page.keyboard.press('Escape')
  await page.locator('textarea').fill('half a thought')
  await bell(page).click()
  const dialog = c.app.waitForEvent('window')
  await panel(page).getByRole('button', { name: 'Restart to update' }).click()
  const d = await dialog
  await expect(d.getByText('Restart to update to Orc 0.99.0?')).toBeVisible()
  await expect(d.getByText('Unsent text in 1 chat')).toBeVisible()
  await d.screenshot({ path: join(__dirname, 'screenshots', 'restart-dialog.png') })
  await d.getByRole('button', { name: 'Restart and update' }).click()
  await expect.poll(() => existsSync(installed)).toBe(true)
  expect(read(installed)).toEqual({ version: '0.99.0', restart: true })
  await c.close()
  f.server.close()
})

test('updates: installed by themselves after a stretch of idle time, never while something would be interrupted', async () => {
  const f = await feed(), installed = join(tmp('installed'), 'installed.json')
  const c = await launch({ env: env(f.url, installed, { ORC_UPDATE_IDLE_MS: '2500' }) })
  const { page } = c
  await page.locator('textarea').fill('still typing') // a draft: not idle
  await bell(page).click()
  await expect(panel(page).getByTestId('notice-update-ready')).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(5000)
  expect(existsSync(installed)).toBe(false)
  await page.locator('textarea').fill('') // nothing left to lose: after the idle stretch it installs
  await expect.poll(() => existsSync(installed), { timeout: 15_000 }).toBe(true)
  expect(read(installed)).toEqual({ version: '0.99.0', restart: true })
  await c.close()
  f.server.close()
})

test('updates: with automatic updates off, a found update waits for Download', async () => {
  const f = await feed(), installed = join(tmp('installed'), 'installed.json')
  const c = await launch({ userData: withPrefs({ auto: false }), env: env(f.url, installed) })
  const { page } = c
  await page.waitForTimeout(1500) // the first check has run: found, but nothing downloads
  expect(f.hits()).toBe(0)
  await expect(page.getByTestId('notices-dot')).toHaveCount(0)
  await bell(page).click()
  const available = panel(page).getByTestId('notice-update-available')
  await expect(available).toContainText('Orc 0.99.0 is available')
  await available.getByRole('button', { name: 'Download' }).click()
  await expect(panel(page).getByTestId('notice-update-ready')).toBeVisible({ timeout: 15_000 })
  await c.close()
  f.server.close()
})

test('updates: Help → Check for Updates… opens the panel; a failed check offers Retry; up to date says so', async () => {
  const f = await feed({ version: '0.1.0', failChecks: 2 }), installed = join(tmp('installed'), 'installed.json') // the automatic check and the first manual one fail
  const c = await launch({ env: env(f.url, installed) })
  const { page } = c
  await page.waitForTimeout(1500) // the automatic check failed quietly: no card
  await bell(page).click()
  await expect(panel(page)).toContainText('No notifications')
  await page.keyboard.press('Escape')
  await page.locator('nav').getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('menu', { name: 'Help' }).getByRole('menuitem', { name: /Check for Updates/ }).click()
  const failed = panel(page).getByTestId('notice-update-failed')
  await expect(failed).toContainText("Couldn't check for updates")
  await failed.getByRole('button', { name: 'Retry' }).click()
  const current = panel(page).getByTestId('notice-update-current')
  await expect(current).toContainText('Orc is up to date') // 0.1.0 is older than this build
  await current.getByRole('button', { name: 'Dismiss' }).click()
  await expect(panel(page)).toContainText('No notifications')
  await c.close()
  f.server.close()
})

test('updates: with automatic updates off, a found beta goes away when betas are turned off', async () => {
  const f = await feed({ version: '0.99.0-beta.1' }), installed = join(tmp('installed'), 'installed.json')
  const c = await launch({ userData: withPrefs({ auto: false, beta: true }), env: env(f.url, installed) })
  const { page } = c
  await bell(page).click()
  await expect(panel(page).getByTestId('notice-update-available')).toContainText('Orc 0.99.0 beta 1 is available')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+,')
  await page.getByRole('switch', { name: 'Receive beta updates' }).click()
  await expect(page.getByTestId('update-status')).toHaveCount(0)
  expect(f.hits()).toBe(0)
  await c.close()
  f.server.close()
})

test("updates: where Orc can't install (an unsigned Mac, not an AppImage), the card links to the release instead", async () => {
  const f = await feed(), installed = join(tmp('installed'), 'installed.json')
  const c = await launch({ env: env(f.url, installed, { ORC_UPDATE_CAN_INSTALL: '0' }) })
  const { page } = c
  await page.waitForTimeout(1500)
  expect(f.hits()).toBe(0) // nothing downloaded
  await bell(page).click()
  const available = panel(page).getByTestId('notice-update-available')
  await expect(available).toContainText('Orc 0.99.0 is available')
  await expect(available.getByRole('link', { name: 'Get it' })).toHaveAttribute('href', 'https://github.com/yuvalino/orc/releases/tag/v0.99.0')
  await c.close()
  f.server.close()
})

test('updates: turning beta updates off drops a beta that was ready, and it never installs', async () => {
  const f = await feed({ version: '0.99.0-beta.1' }), installed = join(tmp('installed'), 'installed.json')
  const c = await launch({ userData: withPrefs({ auto: true, beta: true }), env: env(f.url, installed, { ORC_UPDATE_IDLE_MS: '2000' }) })
  const { page } = c
  await page.locator('textarea').fill('busy') // keeps it from installing while we look
  await bell(page).click()
  await expect(panel(page).getByTestId('notice-update-ready')).toContainText('Orc 0.99.0 beta 1 is ready to install', { timeout: 15_000 })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+,')
  await expect(page.getByTestId('update-status')).toHaveText('Orc 0.99.0 beta 1 is ready to install') // named as people read it, here too
  await page.getByRole('switch', { name: 'Receive beta updates' }).click()
  await expect(page.getByTestId('update-status')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.locator('textarea').fill('') // idle now, and nothing to install
  await page.waitForTimeout(5000)
  expect(existsSync(installed)).toBe(false)
  await bell(page).click()
  await expect(panel(page)).toContainText('No notifications')

  // Betas back on: the dropped beta is offered again.
  await page.keyboard.press('Escape')
  await page.locator('textarea').fill('busy again')
  await page.keyboard.press('Control+,')
  await page.getByRole('switch', { name: 'Receive beta updates' }).click()
  await expect(page.getByTestId('update-status')).toHaveText('Orc 0.99.0 beta 1 is ready to install', { timeout: 15_000 })
  await c.close()
  f.server.close()
})

test('updates: settings changed by another Orc process (a remote host window) reach the updater', async () => {
  const f = await feed({ version: '0.99.0-beta.1' }), installed = join(tmp('installed'), 'installed.json'), userData = withPrefs({ auto: true, beta: true })
  const c = await launch({ userData, env: env(f.url, installed, { ORC_UPDATE_IDLE_MS: '2000' }) })
  const { page } = c
  await page.locator('textarea').fill('busy')
  await bell(page).click()
  await expect(panel(page).getByTestId('notice-update-ready')).toBeVisible({ timeout: 15_000 })
  writeFileSync(join(userData, 'updates.json'), JSON.stringify({ auto: true, beta: false })) // as another process saves it: this one isn't told
  await page.keyboard.press('Escape')
  await page.locator('textarea').fill('')
  await page.waitForTimeout(5000) // idle long enough to install, but betas are off now: the beta is dropped instead
  expect(existsSync(installed)).toBe(false)
  await bell(page).click()
  await expect(panel(page)).toContainText('No notifications')
  await c.close()
  f.server.close()
})

test('updates: when installing fails, the card says so; when quitting, Orc still quits', async () => {
  const f = await feed(), installed = join(tmp('installed'), 'installed.json')
  const c = await launch({ env: env(f.url, installed, { ORC_UPDATE_INSTALL_FAILS: '1' }) })
  const { page } = c
  await bell(page).click()
  await expect(panel(page).getByTestId('notice-update-ready')).toBeVisible({ timeout: 15_000 })
  await panel(page).getByRole('button', { name: 'Restart to update' }).click()
  await expect(panel(page).getByTestId('notice-update-failed')).toContainText("Couldn't install Orc 0.99.0: the installer could not start")
  await panel(page).getByRole('button', { name: 'Retry' }).click() // a fresh check finds it again
  await expect(panel(page).getByTestId('notice-update-ready')).toBeVisible({ timeout: 15_000 })
  const exited = new Promise((r) => c.app.process().once('exit', r))
  await c.app.evaluate(({ app }) => app.quit()).catch(() => {}) // install on quit fails too: the quit goes ahead
  await exited
  expect(existsSync(installed)).toBe(false)
  f.server.close()
})

test('updates: another Orc asking to check (a remote host window, or a second launch) checks in the running one', async () => {
  const f = await feed({ version: '0.1.0' }), installed = join(tmp('installed'), 'installed.json')
  const userData = tmp('ud'), dataDir = tmp('data')
  const c = await launch({ userData, dataDir, seed: true, env: env(f.url, installed, { ORC_UPDATE_FIRST_CHECK_MS: '600000' }) })
  const { page } = c
  execFileSync(require('electron') as unknown as string, [join(__dirname, '../out/main/index.js'), '--check-updates'], { env: { ...process.env, ORC_USER_DATA_DIR: userData, ORC_DATA_DIR: dataDir, ORC_BACKGROUND: '1' }, timeout: 20_000 }) // loses the single-instance lock, hands over, quits
  await expect(panel(page).getByTestId('notice-update-current')).toBeVisible({ timeout: 10_000 })
  await c.close()
  f.server.close()
})

test('updates: Orc started just to check (from a remote host window) shows the result in its new window', async () => {
  const f = await feed({ version: '0.1.0' }), installed = join(tmp('installed'), 'installed.json')
  const c = await launch({ args: ['--check-updates'], env: env(f.url, installed, { ORC_UPDATE_FIRST_CHECK_MS: '600000' }) })
  await expect(panel(c.page).getByTestId('notice-update-current')).toBeVisible({ timeout: 10_000 })
  await c.close()
  f.server.close()
})

test('updates: other Orc processes (remote hosts) count for idle and the dialog, are closed before installing, and reopen', async () => {
  const f = await feed(), installed = join(tmp('installed'), 'installed.json'), userData = tmp('ud')
  const c = await launch({ userData, env: env(f.url, installed) })
  const { page } = c
  // A stand-in for a remote host's Orc process: it publishes a working chat, and never answers a request to quit.
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'])
  const activity = join(userData, 'activity')
  mkdirSync(activity, { recursive: true })
  const publish = () => writeFileSync(join(activity, `${other.pid}.json`), JSON.stringify({ pid: other.pid, host: 'fakehost', working: ['Refactor on fakehost'], waiting: [], drafts: 0, lastInput: 0, at: Date.now() }))
  publish()
  const keepAlive = setInterval(publish, 2000)
  await bell(page).click()
  await expect(panel(page).getByTestId('notice-update-ready')).toBeVisible({ timeout: 15_000 })
  const dialog = c.app.waitForEvent('window')
  await panel(page).getByRole('button', { name: 'Restart to update' }).click()
  const d = await dialog
  await expect(d.getByText('Refactor on fakehost is working')).toBeVisible()
  clearInterval(keepAlive)
  await d.getByRole('button', { name: 'Restart and update' }).click()
  await expect.poll(() => existsSync(installed), { timeout: 20_000 }).toBe(true) // after asking it to quit, then ending it
  await expect.poll(() => other.exitCode ?? other.signalCode).not.toBeNull()
  expect(read(join(userData, 'hosts.json')).reopen).toEqual(['fakehost'])
  await c.close()
  f.server.close()
})

test("updates: after an update's restart the same windows come back on the same chats and settings", async () => {
  const f = await feed(), installed = join(tmp('installed'), 'installed.json'), userData = tmp('ud'), dataDir = tmp('data')
  const chats = [{ id: 'a', title: 'Alpha chat' }, { id: 'b', title: 'Beta chat' }]
  const c = await launch({ userData, dataDir, seed: true, chats, env: env(f.url, installed) })
  await c.page.getByText('Alpha chat').first().click()
  const second = c.app.waitForEvent('window')
  await c.app.evaluate(() => (globalThis as unknown as { orcNewWindow(): void }).orcNewWindow())
  const w2 = await second
  await expect(w2.locator('textarea')).toBeVisible()
  await w2.keyboard.press('Control+,')
  await w2.getByRole('button', { name: 'Keyboard shortcuts' }).click()
  await bell(c.page).click()
  await expect(panel(c.page).getByTestId('notice-update-ready')).toBeVisible({ timeout: 15_000 })
  await panel(c.page).getByRole('button', { name: 'Restart to update' }).click()
  await expect.poll(() => existsSync(installed)).toBe(true)
  await c.app.close() // not c.close(): that deletes userData, where the windows were saved

  // Launched again (as after the update): two windows, as they were.
  const again = await launch({ userData, dataDir, waitFor: 'none' })
  await expect.poll(() => again.app.windows().length).toBe(2)
  const headings = async () => (await Promise.all(again.app.windows().map((w) => w.locator('h1, h2, header, main').allInnerTexts()))).map((t) => t.join(' '))
  await expect.poll(async () => (await headings()).some((t) => t.includes('Keyboard shortcuts'))).toBe(true)
  await expect.poll(async () => (await Promise.all(again.app.windows().map((w) => w.locator('main').first().innerText().catch(() => '')))).some((t) => t.includes('Alpha chat'))).toBe(true)
  expect(read(join(userData, 'shell.json')).restore).toBeUndefined() // used up
  await again.close()
  f.server.close()
})

test('updates: quitting with an update ready installs it on the way out, without restarting', async () => {
  const f = await feed(), installed = join(tmp('installed'), 'installed.json')
  const c = await launch({ env: env(f.url, installed) })
  await bell(c.page).click()
  await expect(panel(c.page).getByTestId('notice-update-ready')).toBeVisible({ timeout: 15_000 })
  await c.app.evaluate(({ app }) => app.quit()).catch(() => {}) // the app goes away mid-call
  await expect.poll(() => existsSync(installed)).toBe(true)
  expect(read(installed)).toEqual({ version: '0.99.0', restart: false })
  f.server.close()
})

test('Orc Offline: the update controls are there but off, and its build has no update code', async () => {
  test.setTimeout(120_000)
  const root = join(__dirname, '..'), out = join(root, 'out-offline')
  execFileSync(process.execPath, [join(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build', '--outDir', 'out-offline'], { cwd: root, env: { ...process.env, ORC_OFFLINE: '1' }, stdio: 'ignore' })
  const walk = (d: string): string[] => readdirSync(d).flatMap((e) => statSync(join(d, e)).isDirectory() ? walk(join(d, e)) : [join(d, e)])
  for (const file of walk(out).filter((x) => /\.(js|html)$/.test(x))) expect(readFileSync(file, 'utf-8'), file).not.toMatch(/quitAndInstall|autoInstallOnAppQuit|releases\.atom/)

  const c = await launch({ out: 'out-offline', env: { ORC_UPDATE_FEED: 'http://127.0.0.1:9/', ORC_UPDATE_FIRST_CHECK_MS: '100' } }) // pointed at a feed even: nothing there checks
  const { page } = c
  await page.locator('nav').getByRole('button', { name: 'Help', exact: true }).click()
  await expect(page.getByRole('menu', { name: 'Help' }).getByRole('menuitem', { name: /Check for Updates/ })).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+,')
  await expect(page.getByText("Orc Offline doesn't download updates")).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Automatic updates' })).toBeDisabled()
  await expect(page.getByRole('switch', { name: 'Receive beta updates' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Check for updates' })).toBeDisabled()
  await expect(page.getByText(/^Orc \d+\.\d+\.\d+ \(Offline\)$/)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await bell(page).click()
  await expect(panel(page)).toContainText('No notifications')
  await c.close()
})
