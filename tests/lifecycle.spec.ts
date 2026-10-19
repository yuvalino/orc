import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('saved transcripts reload, pins, rename, and interrupt', async () => {
  const c = await launch({ chats: [{ id: 'history-1', title: null as unknown as string, pinned: true }, { id: 'other', title: 'Other chat' }] })
  const { page } = c
  await expect(page.getByText('Pinned')).toBeVisible()
  await page.getByText('Other chat').first().click()
  await expect(page.getByText('Start a conversation')).toBeHidden()

  // Rename edits the title in place.
  const row = page.locator('div.group', { hasText: 'Other chat' }).first()
  await row.hover()
  await row.getByTitle('Chat menu').click()
  await page.getByText('Rename').click()
  await page.getByLabel('Chat title').fill('Renamed chat')
  await page.getByLabel('Chat title').press('Enter')
  await expect(page.getByText('Renamed chat').first()).toBeVisible()
  await expect(page.getByText('Other chat')).toHaveCount(0)

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
  await page.keyboard.press('Meta+k')
  await expect(page.getByPlaceholder('Search chats')).toBeVisible()
  await page.getByPlaceholder('Search chats').click() // the window isn't focused under the test runner, so autofocus doesn't apply
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('Search chats')).toBeHidden()
  await expect(page.locator('[title="Stop (Esc)"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Stopped')).toBeVisible()
  await expect(page.locator('textarea')).toBeEnabled()
  await shot(page, 'lifecycle-stopped')
  await c.close()
})
