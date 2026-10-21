import { expect, test, type Page } from '@playwright/test'
import { createHash, randomBytes } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { launch, shot } from './helpers'

/**
 * A fake update feed (electron-updater's generic provider): the channel file for this platform naming Orc 0.99.0, and
 * its "installer", streamed slowly enough to watch and cancel.
 */
async function feed(): Promise<{ url: string; server: Server; hits: () => number }> {
  const payload = randomBytes(2_500_000), name = 'Orc-0.99.0-update.bin'
  const sha512 = createHash('sha512').update(payload).digest('base64')
  const yml = `version: 0.99.0\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${payload.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '2026-10-21T00:00:00.000Z'\n`
  const channel = { win32: 'latest.yml', darwin: 'latest-mac.yml', linux: 'latest-linux.yml' }[process.platform as 'win32']
  let hits = 0
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname // electron-updater adds ?noCache=…
    if (path.endsWith(channel)) return res.end(yml)
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

const env = (url: string, installed: string, extra: Record<string, string> = {}) => ({
  ORC_UPDATE_FEED: url, ORC_UPDATE_FIRST_CHECK_MS: '300', ORC_UPDATE_INSTALLED: installed,
  ...(process.platform === 'linux' ? { APPIMAGE: join(mkdtempSync(join(tmpdir(), 'orc-appimage-')), 'Orc.AppImage') } : {}), // electron-updater only updates an AppImage
  ...extra
})
const bell = (page: Page) => page.getByRole('button', { name: 'Notifications' })
const panel = (page: Page) => page.getByRole('dialog', { name: 'Notifications' })

test('updates: found and downloaded automatically, cancel, check again, ready, restart asks first when it would interrupt', async () => {
  const f = await feed(), installed = join(mkdtempSync(join(tmpdir(), 'orc-installed-')), 'installed.json')
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

  // Check for updates (Settings → General) gets it again, opens the panel, and it finishes: Restart to update stays there.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+,')
  await page.getByRole('button', { name: 'Check for updates' }).click()
  await expect(panel(page)).toBeVisible()
  const ready = panel(page).getByTestId('notice-update-ready')
  await expect(ready).toContainText('Orc 0.99.0 is ready to install', { timeout: 15_000 })
  expect(f.hits()).toBe(2)
  await expect(ready.getByRole('button', { name: 'Dismiss' })).toHaveCount(0) // it stays until you restart
  await shot(page, 'notifications-ready')

  // Unsent text would be lost: Restart to update asks first, in its own dialog window; Later keeps the update.
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
  expect(JSON.parse(readFileSync(installed, 'utf-8'))).toEqual({ version: '0.99.0' })
  await c.close()
  f.server.close()
})

test('updates: installed by themselves after a stretch of idle time, never while something would be interrupted', async () => {
  const f = await feed(), installed = join(mkdtempSync(join(tmpdir(), 'orc-installed-')), 'installed.json')
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
  await c.close()
  f.server.close()
})

test('updates: with automatic updates off, a found update waits for Download', async () => {
  const f = await feed(), installed = join(mkdtempSync(join(tmpdir(), 'orc-installed-')), 'installed.json')
  const userData = mkdtempSync(join(tmpdir(), 'orc-ud-'))
  writeFileSync(join(userData, 'updates.json'), JSON.stringify({ auto: false }))
  const c = await launch({ userData, env: env(f.url, installed) })
  const { page } = c
  await expect(page.getByTestId('notices-dot')).toHaveCount(0)
  await page.waitForTimeout(1500) // the first check has run: found, but nothing downloads
  expect(f.hits()).toBe(0)
  await bell(page).click()
  const available = panel(page).getByTestId('notice-update-available')
  await expect(available).toContainText('Orc 0.99.0 is available')
  await available.getByRole('button', { name: 'Download' }).click()
  await expect(panel(page).getByTestId('notice-update-ready')).toBeVisible({ timeout: 15_000 })
  await c.close()
  f.server.close()
})
