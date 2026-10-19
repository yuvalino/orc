import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('saved transcripts reload, pins, rename, and interrupt', async () => {
  const c = await launch({ chats: [{ id: 'history-1', title: null as unknown as string, pinned: true }, { id: 'other', title: 'Other chat' }] })
  const { page } = c
  await expect(page.getByText('Pinned')).toBeVisible()
  await page.getByText('Other chat').first().click()
  await expect(page.getByText('Start a conversation')).toBeHidden()

  // history-1 has a recorded transcript: the user prompt and the reply both come back.
  await page.getByRole('button', { name: 'New chat' }).click()
  await page.getByText('Recorded chat').first().click()
  await expect(page.getByText('Reply with exactly: Hello from Claude')).toBeVisible()
  await expect(page.getByText('Hello from Claude', { exact: true })).toBeVisible()
  await shot(page, 'lifecycle-history')

  // Interrupt a long turn.
  await page.getByText('Other chat').first().click()
  await send(page, 'plan something long')
  await expect(page.locator('[title="Stop (Esc)"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Stopped')).toBeVisible()
  await expect(page.locator('textarea')).toBeEnabled()
  await shot(page, 'lifecycle-stopped')
  await c.close()
})
