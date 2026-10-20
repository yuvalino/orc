import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('saved transcripts reload, pins, rename, and interrupt', async () => {
  const c = await launch({ chats: [{ id: 'history-1', title: null as unknown as string, pinned: true }, { id: 'other', title: 'Other chat' }] })
  const { page } = c
  await expect(page.getByText('Pinned')).toBeVisible()
  await page.getByText('Other chat').first().click()
  await expect(page.getByTestId('empty-chat')).toBeHidden()

  // Rename edits the title in place.
  const row = page.locator('div.group', { hasText: 'Other chat' }).first()
  await row.click({ button: 'right' })
  await page.getByText('Rename').click()
  await page.getByLabel('Chat title').fill('Renamed chat')
  await page.getByLabel('Chat title').press('Enter')
  await expect(page.getByText('Renamed chat').first()).toBeVisible()
  await expect(page.getByText('Other chat')).toHaveCount(0)

  // The same menu pins and unpins.
  const count = await page.getByText('Renamed chat').count()
  await page.locator('div.group', { hasText: 'Renamed chat' }).first().click({ button: 'right' })
  await expect(page.getByRole('menu').getByRole('separator')).toHaveCount(1) // Rename and Pin, then Permanently delete
  await expect(page.getByRole('menu').locator('button svg')).toHaveCount(3) // each with its icon
  await page.getByRole('menu').getByText('Pin', { exact: true }).click()
  await expect(page.getByText('Renamed chat')).toHaveCount(count + 1) // also under Pinned

  // Listed twice, it's highlighted only where it was clicked.
  const lit = page.locator('div.group.bg-bg-active', { hasText: 'Renamed chat' })
  await page.locator('div.group', { hasText: 'Renamed chat' }).last().click()
  await expect(lit).toHaveCount(1)
  expect(await lit.evaluate((e) => e === [...document.querySelectorAll('div.group')].filter((d) => d.textContent?.includes('Renamed chat')).at(-1))).toBe(true)
  await page.locator('div.group', { hasText: 'Renamed chat' }).first().click()
  await expect(lit).toHaveCount(1)

  await page.locator('div.group', { hasText: 'Renamed chat' }).first().click({ button: 'right' })
  await page.getByRole('menu').getByText('Unpin', { exact: true }).click()
  await expect(page.getByText('Renamed chat')).toHaveCount(count)

  // history-1 has a recorded transcript: the user prompt and the reply both come back.
  await page.getByRole('button', { name: 'New chat' }).click()
  await page.getByText('Recorded chat').first().click()
  await expect(page.getByText('Reply with exactly: Hello from Claude')).toBeVisible()
  await expect(page.getByText('Hello from Claude', { exact: true })).toBeVisible()
  await shot(page, 'lifecycle-history')

  // Interrupt a long turn; Esc first closes the palette, then stops.
  await page.getByText('Renamed chat').first().click()
  await send(page, 'plan something long')
  await expect(page.locator('[title="Stop (Esc)"]')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+p')
  await expect(page.getByPlaceholder('Search chats')).toBeVisible()
  await page.getByPlaceholder('Search chats').click() // the window isn't focused under the test runner, so autofocus doesn't apply
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('Search chats')).toBeHidden()
  await expect(page.locator('[title="Stop (Esc)"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Stopped')).toBeVisible()
  await expect(page.locator('textarea')).toBeEnabled()
  await shot(page, 'lifecycle-stopped')

  // Deleting the open chat returns to a fresh composer; removing a project takes its chats with it.
  page.on('dialog', (d) => d.accept())
  const renamed = page.locator('div.group', { hasText: 'Renamed chat' }).first()
  await renamed.click({ button: 'right' }); await page.getByText('Delete').click()
  await expect(page.getByTestId('empty-chat')).toBeVisible()
  await expect(page.getByText('Renamed chat')).toHaveCount(0)
  const proj = page.locator('div.group', { hasText: 'Fixture Project' }).first()
  await proj.click({ button: 'right' }); await page.getByText('Remove project').click()
  await expect(page.getByText('No projects yet')).toBeVisible()
  await expect(page.getByText('Recorded chat')).toHaveCount(0)
  await c.close()
})
