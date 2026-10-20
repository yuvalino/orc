import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('side panes resize within limits, Ctrl+P searches, bypass is orange, replies keep their buttons', async () => {
  const c = await launch()
  const { page } = c
  const sidebar = page.locator('aside').first(), edge = page.getByRole('separator').first()

  await expect(page.getByRole('button', { name: /^Opus 4.6/ })).toBeVisible() // the composer row has its final buttons: they set how wide the panes may get
  // Drag the sidebar's edge: it follows the pointer, then stops at its maximum and minimum.
  const drag = async (by: number) => { const b = (await edge.boundingBox())!, x = b.x + b.width / 2, y = b.y + 200; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + by, y, { steps: 4 }); await page.mouse.up() }
  await drag(60)
  expect(Math.round((await sidebar.boundingBox())!.width)).toBe(292 + 60)
  await drag(1000)
  expect(Math.round((await sidebar.boundingBox())!.width)).toBe(440)
  await drag(-1000)
  expect(Math.round((await sidebar.boundingBox())!.width)).toBe(220)
  await edge.dblclick()
  expect(Math.round((await sidebar.boundingBox())!.width)).toBe(292)

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

  await send(page, 'hello')
  await expect(page.getByText('Hello from Claude')).toBeVisible()
  await page.mouse.move(5, 5) // nothing hovered: the Copy button still shows
  await expect(page.getByTitle('Copy')).toBeVisible()
  await page.getByText('Hello from Claude').hover()
  await expect(page.getByText(/^(\w+day |\d{1,2}\/\d{1,2}\/\d{4} )?\d{2}:\d{2}\s?[AP]M$/)).toBeVisible() // the fixture's reply carries its recorded timestamp
  await shot(page, 'layout')
  await c.close()
})
