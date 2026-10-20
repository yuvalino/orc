import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { launch, shot } from './helpers'

test('settings: cog menu, tabs and search, CLAUDE.md editor, recorded shortcuts', async () => {
  const c = await launch()
  const { page } = c
  const claudeMd = join(c.dataDir, 'claude', 'CLAUDE.md')

  // The cog at the bottom of the sidebar opens a drop-up; Settings opens on Personalization with its search focused.
  const edge = (await page.getByRole('separator').first().boundingBox())! // narrowest sidebar, so the menu crosses its edge
  await page.mouse.move(edge.x + 3, edge.y + 200); await page.mouse.down(); await page.mouse.move(edge.x - 300, edge.y + 200, { steps: 4 }); await page.mouse.up()
  await page.getByTitle('Settings', { exact: true }).click()
  const menu = page.locator('.menu-in.from-bottom')
  expect(await menu.evaluate((e) => Number(getComputedStyle(e).opacity))).toBeLessThan(1) // fading in
  await expect.poll(() => menu.evaluate((e) => getComputedStyle(e).opacity)).toBe('1')
  const cog = (await page.getByTitle('Settings', { exact: true }).boundingBox())!, menuBox = (await menu.boundingBox())!
  expect(menuBox.x).toBeGreaterThanOrEqual(cog.x + cog.width) // beside the cog, to its right…
  expect(Math.abs(menuBox.y + menuBox.height - (cog.y + cog.height))).toBeLessThan(2) // …bottoms aligned
  const paneRight = (await page.locator('[data-pane=sidebar]').boundingBox())!, right = menuBox.x + menuBox.width
  expect(right).toBeGreaterThan(paneRight.x + paneRight.width) // it reaches past the sidebar's edge…
  expect(await menu.evaluate((m, [x, y]) => m.contains(document.elementFromPoint(x, y)), [right - 4, menuBox.y + menuBox.height / 2])).toBe(true) // …and isn't cut off there
  expect(await page.getByRole('button', { name: /^Settings/ }).last().evaluate((b) => b.getBoundingClientRect().height)).toBeLessThan(40) // its shortcut sits on the same line
  await shot(page, 'settings-menu')
  await page.getByRole('button', { name: /^Settings/ }).last().click()
  await expect(page.getByRole('heading', { name: 'Personalization' })).toBeVisible()
  await expect(page.getByLabel('Search settings')).toBeFocused()
  const selects = (l: ReturnType<typeof page.getByText>) => l.evaluate((e) => getComputedStyle(e).userSelect)
  expect(await selects(page.getByRole('heading', { name: 'Settings' }))).toBe('none') // titles aren't text to select…
  expect(await selects(page.getByRole('heading', { name: 'Personalization' }))).toBe('none')
  expect(await selects(page.getByLabel('Search settings'))).not.toBe('none') // …text boxes are
  await expect(page.getByRole('button', { name: 'General' })).toBeDisabled()
  const nav = page.locator('nav').filter({ hasText: 'Settings' }), bg = (l: typeof nav) => l.evaluate((e) => getComputedStyle(e).backgroundColor)
  expect(await bg(page.getByLabel('Search settings').locator('xpath=..'))).not.toBe(await bg(nav)) // the search box stands out from its pane

  // Its left pane resizes like the main sidebar.
  const navEdge = (await page.getByRole('separator').first().boundingBox())!
  await page.mouse.move(navEdge.x + 3, navEdge.y + 300); await page.mouse.down(); await page.mouse.move(navEdge.x + 63, navEdge.y + 300, { steps: 4 }); await page.mouse.up()
  await expect.poll(async () => Math.round((await nav.boundingBox())!.width)).toBe(350)
  await shot(page, 'settings-personalization')

  await page.getByLabel('Search settings').fill('key')
  await expect(page.getByRole('button', { name: 'Personalization' })).toHaveCount(0)
  await page.getByLabel('Search settings').fill('')

  // The instructions editor: Save waits for a change; Back drops it; Save creates the file.
  await page.getByText('Claude Code instructions').click()
  const box = page.getByLabel('Claude Code instructions')
  await expect(box).toHaveAttribute('placeholder', 'Add your custom instructions...')
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
  await box.fill('Always answer in haiku.')
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()
  await shot(page, 'settings-instructions')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  expect(existsSync(claudeMd)).toBe(false)
  await page.getByText('Claude Code instructions').click()
  await expect(box).toHaveValue('')
  await box.fill('Always answer in haiku.')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: 'Personalization' })).toBeVisible()
  expect(readFileSync(claudeMd, 'utf-8')).toBe('Always answer in haiku.')
  await page.getByText('Claude Code instructions').click()
  await expect(box).toHaveValue('Always answer in haiku.')
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Keyboard shortcuts: search, then record a new combo for New chat.
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()
  await page.getByLabel('Search shortcuts').fill('sidebar')
  await expect(page.getByText('Toggle sidebar')).toBeVisible()
  await expect(page.getByText('New chat', { exact: true })).toHaveCount(0)
  await page.getByLabel('Search shortcuts').fill('')
  await page.getByTitle('Change shortcut for New chat').click()
  await expect(page.getByPlaceholder('Press shortcut')).toBeFocused()
  await page.keyboard.press('Shift') // a modifier alone doesn't count
  await expect(page.getByPlaceholder('Press shortcut')).toBeVisible()
  await page.keyboard.press('Control+Shift+J')
  await expect(page.getByText('Ctrl+Shift+J')).toBeVisible()
  await expect(page.getByText('Ctrl+N', { exact: true })).toHaveCount(0)
  await shot(page, 'settings-shortcuts')

  // Esc leaves settings; the recorded combo works, and Ctrl+, comes back.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toHaveCount(0)
  await page.keyboard.press('Control+,')
  await expect(page.getByRole('heading', { name: 'Personalization' })).toBeVisible()
  await page.keyboard.press('Control+Shift+J')
  await expect(page.getByTestId('empty-chat')).toBeVisible()
  await c.close()
})
