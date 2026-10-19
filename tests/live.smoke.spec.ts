import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

// Real Claude, real quota. Run with: ORC_LIVE=1 npx playwright test live
test.skip(!process.env.ORC_LIVE, 'set ORC_LIVE=1 to run against real Claude')

test('real Claude replies and the account shows up', async () => {
  const c = await launch({ live: true })
  const { page } = c
  await send(page, 'Reply with the single word OK and nothing else.')
  await expect(page.getByText(/^OK/)).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('aside [title*="@"]')).toBeVisible()
  await shot(page, 'live-smoke')
  await c.close()
})
