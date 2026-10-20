import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('questions, plans, denials, and asks pending in a background chat', async () => {
  const c = await launch()
  const { page } = c

  await send(page, 'question time')
  await expect(page.getByText('Style')).toBeVisible()
  await shot(page, 'asks-question')
  await page.getByRole('button', { name: /Spaces/ }).click()
  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByText(/^Answered: Spaces/)).toBeVisible()

  await page.getByRole('button', { name: 'New chat' }).click()
  await page.getByText('Ask for approval').click()
  await page.getByText('Auto mode').click()
  await send(page, 'plan something')
  await expect(page.getByText('Review plan')).toBeVisible()
  await shot(page, 'asks-plan')
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByText('Plan approved', { exact: true })).toBeVisible()
  await expect(page.getByText('Auto mode')).toBeVisible() // approving a plan keeps the chat's own mode
  // The approved plan continues into a Write that needs permission; deny it.
  await page.getByRole('button', { name: 'Deny' }).click()
  await expect(page.getByText(/^Denied/)).toBeVisible()
  await expect(page.getByText('Understood, I will not do that.')).toBeVisible()

  // Pending ask in a background chat: badge in the sidebar, card survives switching.
  await page.getByRole('button', { name: 'New chat' }).click()
  await send(page, 'edit a file')
  await expect(page.getByRole('button', { name: 'Deny' })).toBeVisible()
  await page.getByText('Chat about question').first().click()
  await expect(page.locator('[title="Needs your attention"]').first()).toBeVisible()
  await shot(page, 'asks-background-badge')
  await page.locator('aside div.cursor-pointer', { has: page.locator('[title="Needs your attention"]') }).last().click() // the row: hovering it swaps the dot for buttons
  await expect(page.getByRole('button', { name: 'Deny' })).toBeVisible()
  await c.close()
})
