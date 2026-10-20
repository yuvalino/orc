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
  await expect(page.getByTestId('chat-header').getByTitle('Fixture Project')).toBeVisible() // a project chat: its folder, named on hover
  await shot(page, 'chat-reply')

  await send(page, 'hello again')
  await expect(page.getByText('Hello from Claude')).toHaveCount(2)
  await expect(page.locator('textarea')).toBeEnabled()
  await shot(page, 'chat-two-turns')
  await c.close()
})

test('a streaming reply fades in word by word, with no cursor, then settles into plain text', async () => {
  const c = await launch()
  const { page } = c
  await send(page, 'story please') // story.jsonl streams a few sentences, two words at a time
  const words = page.locator('.stream-word')
  await expect(words.nth(10)).toBeAttached()
  await expect(page.locator('.caret')).toHaveCount(0)
  // Mid-stream the newest words are still faint while the first are fully in: several are fading at once.
  const opacities = await words.evaluateAll((ws) => ws.map((w) => parseFloat(getComputedStyle(w).opacity)))
  expect(opacities[0]).toBeGreaterThan(opacities.at(-1)!)
  await expect(page.getByText('Mina bought it on a cloudless afternoon', { exact: false })).toBeVisible()
  await expect(words).toHaveCount(0) // settled: plain Markdown again
  await expect(page.getByText('Mina bought it on a cloudless afternoon, just because she liked the color.')).toBeVisible()
  await c.close()
})

test("the view doesn't chase a reply: a floating button shows there's more below, typing while it streams, then an arrow", async () => {
  const c = await launch()
  const { page } = c
  await c.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(500, 280); w.setSize(1000, 340) }) // a short view: the story runs well past it
  await send(page, 'story please')
  const more = page.getByTestId('more-below'), view = page.locator('main .overflow-y-auto').first()
  await expect(more).toHaveAttribute('data-typing', 'true') // still writing, out of sight: bouncing dots
  await expect(more.locator('.typing-dot')).toHaveCount(3)
  const at = await view.evaluate((e) => e.scrollTop)
  await expect(more).not.toHaveAttribute('data-typing') // done: an arrow…
  expect(await view.evaluate((e) => e.scrollTop)).toBe(at) // …and the view stayed where it was
  expect(await more.evaluate((e) => getComputedStyle(e).backgroundColor)).toMatch(/\/ 0\.8\)$|, 0\.8\)$/) // translucent (80%), not see-through
  await more.click()
  await expect(more).toHaveCount(0) // at the end: nothing more below
  expect(await view.evaluate((e) => Math.round(e.scrollHeight - e.scrollTop - e.clientHeight))).toBeLessThanOrEqual(24)
  await view.evaluate((e) => e.scrollTo({ top: 0 })) // back up: it was seen, so no button
  await page.waitForTimeout(300)
  await expect(more).toHaveCount(0)

  // A short follow-up scrolls up to the top with room for its reply; that room isn't news, so the button never flashes.
  await page.evaluate(() => { const w = window as unknown as { flashed: boolean }; w.flashed = false; const tick = () => { if (document.querySelector('[data-testid=more-below]')) w.flashed = true; requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  await send(page, 'hello')
  await expect(page.getByText('Hello from Claude')).toBeVisible()
  await expect(page.locator('[title="Stop (Esc)"]')).toHaveCount(0)
  await page.waitForTimeout(400)
  expect(await page.evaluate(() => (window as unknown as { flashed: boolean }).flashed)).toBe(false)
  await c.close()
})
