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
  await expect(menu('File').getByRole('menuitem', { name: /Settings…/ })).toContainText('Ctrl+,')
  await bar('Edit').hover()
  await expect(menu('Edit')).toBeVisible()
  await expect(menu('File')).toHaveCount(0)
  await expect(menu('Edit').getByRole('menuitem', { name: /Copy/ })).toContainText('Ctrl+C')
  await shot(page, 'menubar-edit')
  await page.keyboard.press('ArrowRight')
  await expect(menu('View')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await bar('View').hover() // closed: hovering alone opens nothing
  await expect(page.getByRole('menu')).toHaveCount(0)

  // An item runs in the main process: File → Settings… opens settings.
  await bar('File').click()
  await menu('File').getByRole('menuitem', { name: /Settings…/ }).click()
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
