import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('send a prompt, stream a reply, title and recents update', async () => {
  const c = await launch()
  const { page } = c
  await expect(page.getByText('Fixture Project').first()).toBeVisible()
  await send(page, 'hello there')
  await expect(page.getByText('hello there')).toBeVisible()
  await expect(page.getByText('Hello from Claude')).toBeVisible()
  await expect(page.getByText('Chat about hello').first()).toBeVisible() // auto title from fake sessionInfo
  await shot(page, 'chat-reply')

  await send(page, 'hello again')
  await expect(page.getByText('Hello from Claude')).toHaveCount(2)
  await expect(page.locator('textarea')).toBeEnabled()
  await shot(page, 'chat-two-turns')
  await c.close()
})
