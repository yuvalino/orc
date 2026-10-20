import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('timeline: a tick per prompt, white while on screen, a wave and a preview on hover, a click to jump', async () => {
  const c = await launch()
  const { page } = c
  for (const [i, p] of ['hello', 'story please', 'hello again', 'story more', 'heading please'].entries()) {
    await send(page, p)
    await expect(page.locator('.md')).toHaveCount(i + 1) // its reply arrived…
    await expect(page.locator('[title="Stop (Esc)"]')).toHaveCount(0) // …and the turn is over
    await expect(page.getByTestId('timeline')).toHaveCount(i + 1 >= 4 ? 1 : 0) // from the 4th prompt on
  }
  const tl = page.getByTestId('timeline'), ticks = tl.locator('button')
  await expect(ticks).toHaveCount(5)
  await expect(ticks.first()).toHaveAttribute('aria-label', 'hello')
  const tops = await ticks.evaluateAll((ts) => ts.map((e) => e.getBoundingClientRect().top))
  expect(tops.slice(1).map((t, i) => Math.round(t - tops[i]))).toEqual([10, 10, 10, 10]) // ChatGPT's spacing
  // The turn on screen now is the last: its tick is white, the first one's (scrolled away) gray.
  await expect(ticks.last()).toHaveAttribute('data-seen', 'true')
  await expect(ticks.first()).not.toHaveAttribute('data-seen')
  const rest = () => ticks.evaluateAll((ts) => ts.map((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height), getComputedStyle(e).backgroundColor]))
  await expect.poll(async () => (await rest())[0]).toEqual([6, 2, 'rgb(70, 70, 70)']) // ChatGPT's: 6×2px, dark gray off screen…
  await expect.poll(async () => (await rest()).at(-1)![2]).toBe('rgb(163, 163, 163)') // …light gray on screen (after its quick fade)

  // Hovering swells the hovered tick and its neighbors (3 each way) into a wave, turns only it white, and previews its prompt and reply.
  const look = () => ticks.evaluateAll((ts) => ts.map((e) => [Math.round(e.getBoundingClientRect().width), getComputedStyle(e).backgroundColor]))
  const b = (await ticks.first().boundingBox())!
  await expect(async () => { // hover (again, if the view was still settling under the mouse) until the wave is in place
    await page.mouse.move(b.x + 4, b.y + 2); await page.mouse.move(b.x + 4, b.y + 1)
    await page.waitForTimeout(200) // its quick transitions finish
    expect((await look()).map(([w]) => w)).toEqual([26, 20, 14, 10, 6]) // tapering away from the hovered tick; the 4th away stays at rest
  }).toPass({ timeout: 5000 })
  const colors = (await look()).map(([, c]) => c)
  expect(colors[0]).toBe('rgb(255, 255, 255)')
  expect(colors.slice(1).every((c) => c === 'rgb(70, 70, 70)')).toBe(true)
  expect(colors.slice(1).every((c) => c !== colors[0])).toBe(true) // only the hovered tick is white, even the on-screen ones go gray
  expect(await ticks.first().evaluate((e) => getComputedStyle(e).transitionDuration)).toBe('0.12s')
  const tip = page.getByRole('tooltip')
  await expect(tip).toContainText('hello')
  await expect(tip).toContainText('Hello from Claude')
  await shot(page, 'timeline-hover')

  // A reply's heading and bold text preview in the same gray as the rest of it; the prompt stays white.
  const last = (await ticks.last().boundingBox())!
  await page.mouse.move(last.x + 4, last.y + 1)
  await expect(tip).toContainText('A big title')
  const [prompt, title, bold, body] = await tip.evaluate((t) => [t.firstElementChild!, t.querySelector('h2')!, t.querySelector('strong')!, t.querySelector('p')!].map((e) => getComputedStyle(e).color))
  expect(prompt).toBe('rgb(229, 229, 229)')
  expect([title, bold]).toEqual([body, body])

  // Not while the Subagents pane is open.
  await page.mouse.move(700, 300)
  await page.getByTitle('Subagents', { exact: true }).click()
  await page.getByText('No subagents yet').click()
  await expect(page.getByTitle('Subagents (middle-click to close)')).toBeVisible()
  await expect(tl).toHaveCount(0)
  await page.getByTitle('Close', { exact: true }).click()
  await expect(tl).toBeVisible()

  // A click on the timeline jumps to the hovered prompt's turn: near its tick, not only on the 2px line.
  const first = (await ticks.first().boundingBox())!
  await page.mouse.move(first.x + 12, first.y + 3)
  await expect(tip).toContainText('hello')
  await page.mouse.down(); await page.mouse.up()
  await expect(ticks.first()).toHaveAttribute('data-seen', 'true')
  await page.mouse.move(700, 300)
  await expect(tip).toHaveCount(0)
  await c.close()
})
