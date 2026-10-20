import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('side panes resize within limits, Ctrl+P searches, bypass is orange, replies keep their buttons', async () => {
  const c = await launch()
  const { page } = c
  const sidebar = page.locator('aside').first(), edge = page.getByRole('separator').first()

  await expect(page.getByRole('button', { name: /^Opus 4.6/ })).toBeVisible() // the composer row has its final buttons: they set how wide the panes may get
  // Drag the sidebar's edge: it follows the pointer, then stops at its maximum and minimum.
  const drag = async (by: number) => {
    const b = (await edge.boundingBox())!, x = b.x + b.width / 2, y = b.y + 200
    await expect(async () => { // a move right after startup can go unnoticed: hover again until the edge lights up, then press
      await page.mouse.move(x - 40, y); await page.mouse.move(x, y)
      expect(await edge.evaluate((e) => e.matches(':hover'))).toBe(true)
    }).toPass({ timeout: 5000 })
    await page.mouse.down(); await page.mouse.move(x + by, y, { steps: 4 }); await page.mouse.up()
  }
  await drag(60)
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(292 + 60)
  await drag(1000)
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(440)
  await drag(-1000)
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(220)
  await edge.dblclick()
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(292)

  // Ctrl+B slides the sidebar shut and open again, like the right pane.
  const sliding = (from: number, to: number) => page.waitForFunction(([a, b]) => { const w = document.querySelector('[data-pane=sidebar]')?.getBoundingClientRect().width ?? -1; return w > Math.min(a, b) + 1 && w < Math.max(a, b) - 1 }, [from, to], { polling: 'raf' })
  let s = sliding(292, 0); await page.keyboard.press('Control+b'); await s
  await expect(page.locator('[data-pane=sidebar]')).toHaveCount(0)
  s = sliding(0, 292); await page.keyboard.press('Control+b'); await s
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(292)

  await page.keyboard.press('Control+p')
  await expect(page.getByPlaceholder('Search chats')).toBeVisible()
  await page.getByPlaceholder('Search chats').press('Escape')

  await page.getByRole('button', { name: 'Ask for approval' }).click()
  await page.getByText('Bypass permissions').click()
  const orange = 'rgb(249, 115, 22)'
  expect(await page.getByRole('button', { name: 'Bypass permissions' }).evaluate((e) => getComputedStyle(e).color)).toBe(orange)
  await page.getByRole('button', { name: 'Bypass permissions' }).click()
  expect(await page.getByText('Never ask.', { exact: false }).evaluate((e) => getComputedStyle(e.parentElement!).color)).toBe(orange) // the same orange in the menu
  expect(await page.getByText('Never ask.', { exact: false }).evaluate((e) => getComputedStyle(e).color)).toBe('rgb(136, 136, 136)') // its explanation stays gray like the others
  await page.keyboard.press('Escape'); await page.mouse.click(700, 300)

  // The composer's bottom row (now with its longest mode label) never overflows: dragging stops short, and a narrower window pushes the pane in.
  const fits = () => page.locator('[data-composer-row]').evaluate((r) => r.scrollWidth <= r.clientWidth && r.getBoundingClientRect().right <= document.querySelector('main')!.getBoundingClientRect().right)
  await c.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(500, 400); w.setSize(700, 700) })
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(710)
  await drag(1000)
  const capped = Math.round((await sidebar.boundingBox())!.width)
  expect(capped).toBeLessThan(440)
  expect(await fits()).toBe(true)
  await c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(660, 700))
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBeLessThan(capped)
  expect(await fits()).toBe(true)

  // Button rows: under every message, their space always kept. Only the latest reply's buttons stay; the rest, and every time, show on hover.
  await send(page, 'hello')
  await expect(page.getByText('Hello from Claude')).toBeVisible()
  await expect(page.locator('[title="Stop (Esc)"]')).toHaveCount(0)
  await send(page, 'hello')
  await expect(page.locator('[title="Stop (Esc)"]')).toHaveCount(0) // the second turn is done
  // The prompt just sent scrolled up near the top, the end of the reply before it still in view above.
  const pinnedAt = () => page.locator('.bg-bubble').last().evaluate((b) => Math.round(b.getBoundingClientRect().top - b.closest('.overflow-y-auto')!.getBoundingClientRect().top))
  await expect.poll(async () => Math.abs((await pinnedAt()) - 80)).toBeLessThanOrEqual(4) // settles ~80px from the top
  const rows = page.locator('[data-actions]'), seen = (l: ReturnType<typeof rows.nth>) => l.evaluate((e) => getComputedStyle(e).opacity)
  await expect(rows).toHaveCount(4) // you, reply, you, reply
  for (const h of await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBe(28)
  const [you, earlier, latest] = [rows.nth(2), rows.nth(1), rows.nth(3)]
  await page.mouse.move(5, 5)
  await expect.poll(() => seen(latest.getByTitle('Copy'))).toBe('1') // the latest reply's Copy stays
  await expect.poll(() => seen(latest.locator('span'))).toBe('0') // …its time waits for a hover
  await expect.poll(() => seen(earlier.getByTitle('Copy'))).toBe('0')
  await expect.poll(() => seen(you.getByTitle('Copy'))).toBe('0')
  await latest.locator('xpath=..').hover()
  await expect.poll(() => seen(latest.locator('span'))).toBe('1')
  await expect(latest.locator('span')).toHaveText(/^(\w+day |\d{1,2}\/\d{1,2}\/\d{4} )?\d{2}:\d{2}\s?[AP]M$/) // the fixture's reply carries its recorded timestamp
  await page.locator('.bg-bubble').last().hover() // your message: its row appears, the time on the button's left
  await expect.poll(() => seen(you.getByTitle('Copy'))).toBe('1')
  await expect.poll(() => seen(you.locator('span'))).toBe('1')
  expect(await you.evaluate((e) => e.querySelector('span')!.getBoundingClientRect().right <= e.querySelector('button')!.getBoundingClientRect().left)).toBe(true)
  expect(await page.locator('.bg-bubble').last().evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(26, 67, 163)') // well darker than the accent
  await shot(page, 'layout')
  await c.close()
})
