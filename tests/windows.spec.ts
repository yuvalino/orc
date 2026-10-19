import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('two windows on one instance share chats, asks and unread', async () => {
  const c = await launch()
  const w1 = c.page
  await c.app.evaluate(() => (globalThis as unknown as { orcNewWindow(): void }).orcNewWindow())
  const w2 = await c.app.waitForEvent('window')
  await w2.waitForLoadState('domcontentloaded')
  await expect(w2.locator('textarea')).toBeVisible()

  // An ask raised in window 1 can be answered from window 2; both see the outcome.
  await send(w1, 'edit a file')
  await expect(w1.getByRole('button', { name: 'Allow', exact: true })).toBeVisible()
  const row = w2.locator('aside div.cursor-pointer', { hasText: 'New chat' }).first() // untitled until its first turn ends
  await expect(row).toBeVisible()
  await row.click()
  await expect(w2.getByRole('button', { name: 'Allow', exact: true })).toBeVisible()
  await shot(w2, 'windows-ask')
  await w2.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(w1.getByText('Allowed', { exact: true })).toBeVisible()
  await expect(w2.getByText('Allowed', { exact: true })).toBeVisible()

  // A chat that finishes while no window shows it gets a dot everywhere; reading it in one window clears it in the other.
  await w1.getByRole('button', { name: 'New chat' }).click()
  await w2.getByRole('button', { name: 'New chat' }).click()
  await send(w1, 'background please')
  await expect(w1.getByText(/^Worked for/).first()).toBeVisible()
  await w1.getByRole('button', { name: 'New chat' }).click() // leave before the relay turn finishes
  const dot = (w: typeof w1) => w.locator('aside div.cursor-pointer', { hasText: 'Chat about background' }).locator('[title="Finished"]')
  await expect(dot(w1).first()).toBeVisible()
  await expect(dot(w2).first()).toBeVisible()
  await shot(w1, 'windows-unread')
  await w2.locator('aside').getByText('Chat about background').first().click()
  await expect(dot(w2)).toHaveCount(0)
  await expect(dot(w1)).toHaveCount(0)
  await c.close()
})
