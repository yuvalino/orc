import { expect, test } from '@playwright/test'
import { launch, shot } from './helpers'

test('menu bar switches menus on hover; back and forward step through chats and settings', async () => {
  const c = await launch({ chats: [{ id: 'a', title: 'Alpha chat' }, { id: 'b', title: 'Beta chat' }] })
  const { page } = c
  const menu = (name: string) => page.getByRole('menu', { name })
  const bar = (name: string) => page.locator('nav').getByRole('button', { name, exact: true })

  // Open one menu, then just move across: the next one opens. ←/→ move too; Esc closes.
  await bar('File').click()
  await expect(menu('File')).toBeVisible()
  const items = (name: string) => menu(name).locator('[role=menuitem], [role=separator]').evaluateAll((els) => els.map((e) => e.getAttribute('role') === 'separator' ? '—' : (e.textContent ?? '').replace(/Ctrl.*$/, '').trim()))
  expect(await items('File')).toEqual(['New Window', 'New Chat', '—', 'Open Folder…', '—', 'Close', '—', 'Quit'])
  await bar('Edit').hover()
  await expect(menu('Edit')).toBeVisible()
  await expect(menu('File')).toHaveCount(0)
  await expect(menu('Edit').getByRole('menuitem', { name: /Copy/ })).toContainText('Ctrl+C')
  expect((await items('Edit')).slice(-2)).toEqual(['—', 'Settings…']) // Settings… ends Edit, in its own section
  await expect(menu('Edit').getByRole('menuitem', { name: /Settings…/ })).toContainText('Ctrl+,')
  await shot(page, 'menubar-edit')
  await page.keyboard.press('ArrowRight')
  await expect(menu('View')).toBeVisible()
  await page.keyboard.press('ArrowRight') // no Window menu: View is followed by Help
  await expect(menu('Help')).toBeVisible()
  expect((await items('Help')).slice(-2)).toEqual(['—', 'About Orc'])
  expect(await page.locator('nav').first().getByRole('button').allTextContents()).toEqual(['File', 'Edit', 'View', 'Help'])

  // Help → About Orc: its own floating window, frameless and dark, centered content with the version and links.
  const [win] = await Promise.all([c.app.waitForEvent('window'), menu('Help').getByRole('menuitem', { name: 'About Orc' }).click()])
  await expect(win.getByText('Powered by Electron.')).toBeVisible()
  await expect(win.locator('body')).toContainText(/Version \d+\.\d+\.\d+/)
  await expect(win.getByText('Created by Yuvalino')).toBeVisible()
  await expect(win.getByRole('link', { name: 'yuvalino.com' })).toHaveAttribute('href', 'https://yuvalino.com')
  await expect(win.getByRole('link', { name: '@jachashx on X' })).toHaveAttribute('href', 'https://x.com/jachashx')
  await expect(win.locator('.drag').first()).toContainText('About Orc') // its title bar, with the small logo
  await expect(win.locator('.drag img')).toHaveCount(1)
  expect(await win.locator('#root > div').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(48, 48, 48)')
  expect(await c.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'About Orc')!; return [w.isResizable(), !!w.getParentWindow()] })).toEqual([false, true]) // a fixed dialog over this window
  expect(await c.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'About Orc')!, a = w.getBounds(), p = w.getParentWindow()!.getBounds(); return Math.max(Math.abs(a.x + a.width / 2 - (p.x + p.width / 2)), Math.abs(a.y + a.height / 2 - (p.y + p.height / 2))) })).toBeLessThan(2) // centered on it
  await win.screenshot({ path: 'tests/screenshots/about.png' })
  await Promise.all([win.waitForEvent('close'), win.keyboard.press('Escape').catch(() => {})]) // Esc closes it (the press may outlive the page)
  await bar('View').click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await bar('View').hover() // closed: hovering alone opens nothing
  await expect(page.getByRole('menu')).toHaveCount(0)

  // An item runs in the main process: Edit → Settings… opens settings.
  await bar('Edit').click()
  await menu('Edit').getByRole('menuitem', { name: /Settings…/ }).click()
  await expect(page.getByRole('heading', { name: 'Personalization' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Back and forward: chat → chat → settings → another settings tab, and back again.
  const back = page.getByTitle(/^Back/), forward = page.getByTitle(/^Forward/)
  const header = () => page.locator('main').first()
  await page.getByText('Alpha chat').first().click()
  await page.getByText('Beta chat').first().click()
  await page.keyboard.press('Control+,')
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()
  await expect(forward).toBeDisabled()
  await back.click()
  await expect(page.getByRole('heading', { name: 'Personalization' })).toBeVisible()
  await back.click()
  await expect(header()).toContainText('Beta chat')
  await back.click()
  await expect(header()).toContainText('Alpha chat')
  await forward.click()
  await expect(header()).toContainText('Beta chat')
  await page.keyboard.press('Control+]')
  await expect(page.getByRole('heading', { name: 'Personalization' })).toBeVisible()
  await page.keyboard.press('Control+[')
  await expect(header()).toContainText('Beta chat')

  // Going somewhere new drops the forward steps, like a browser.
  await page.getByText('Alpha chat').first().click()
  await expect(forward).toBeDisabled()
  await c.close()
})
