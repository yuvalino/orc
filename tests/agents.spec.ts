import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

const openPanel = async (page: import('@playwright/test').Page) => { await page.getByTitle('Subagents').click(); await page.getByText(/working|done/).last().click() }

test('subagents: launch line, dropdown, panel lists and thread; model and effort picker', async () => {
  const c = await launch()
  const { page } = c
  await send(page, 'agents please')
  await expect(page.getByText(/^Worked for/)).toBeVisible()
  await page.getByText(/^Worked for/).click()
  await expect(page.getByText('Read hello and List files started working')).toBeVisible()
  await page.getByTitle('Subagents').click()
  await expect(page.getByText('2 done')).toBeVisible()
  await shot(page, 'agents-dropdown')
  await page.getByText('2 done').click()
  await expect(page.getByText('Active · 0')).toBeVisible()
  await expect(page.getByText('No active subagents')).toBeVisible()
  await expect(page.getByText('Done · 2')).toBeVisible()
  await shot(page, 'agents-panel')
  await page.getByText('Read hello', { exact: true }).click()
  await expect(page.getByText('hello from the fixture project').first()).toBeVisible() // the agent's own report
  await expect(page.getByText('Opus 5.5')).toBeVisible() // model from the agent's frames
  await expect(page.locator('.bg-bubble')).toHaveCount(2) // the main prompt, and the prompt the agent was given
  await shot(page, 'agents-thread')
  await page.getByTitle('Back', { exact: true }).click()
  await expect(page.getByText('Done · 2')).toBeVisible()
  const look = () => page.getByTitle('Subagents', { exact: true }).evaluate((e) => getComputedStyle(e).backgroundColor + getComputedStyle(e).color)
  const open = await look()
  expect(await page.getByTitle('Subagents (middle-click to close)').evaluate((e) => getComputedStyle(e).cursor)).toBe('default') // the tab title is not text to select
  const sliding = page.waitForFunction(() => { const o = document.querySelector('[data-pane=subagents]'); if (!o) return false; const s = getComputedStyle(o), w = o.getBoundingClientRect().width; return w > 1 && w < 329 && s.opacity === '1' }, null, { polling: 'raf' })
  await page.getByTitle('Subagents (middle-click to close)').click({ button: 'middle' }) // middle-click closes the tab, like its X
  await sliding // it slides shut, without fading
  await expect(page.getByText('Done · 2')).toBeHidden()
  const closed = await look()
  expect(closed).toBe(open) // the top-bar button looks the same whether the tab is open or not…
  // The dropdown fades and slides in, and back out before it goes.
  const menu = () => page.locator('.menu-in, .menu-out')
  const opacity = () => menu().evaluate((e) => Number(getComputedStyle(e).opacity))
  await page.getByTitle('Subagents', { exact: true }).click()
  expect(await opacity()).toBeLessThan(1)
  await page.mouse.move(5, 5) // off the button: no hover color
  expect(await look()).not.toBe(closed) // …but is highlighted while its dropdown is open
  await expect.poll(opacity).toBe(1)
  await page.mouse.click(700, 300)
  await expect(page.locator('.menu-out')).toHaveCount(1)
  await expect(menu()).toHaveCount(0)
  expect(await look()).toBe(closed)

  // Model picker: effort popover first, model list behind the model link.
  await expect(page.getByRole('button', { name: /^Opus 4.6 ?High/ })).toBeVisible() // no effort chosen: the level the CLI reports, never "Default"
  await page.getByRole('button', { name: /^Opus 4.6/ }).click() // no model chosen: the one the default stands for
  await expect(page.getByText('Select effort')).toBeVisible()
  await page.locator('input.effort').fill('3')
  await expect(page.getByText('Max', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Opus 4.6', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Select model' })).toBeVisible()
  const list = page.locator('div', { has: page.getByText('Select model', { exact: true }) }).filter({ has: page.getByText('Sonnet 4.6') }).last()
  expect(await list.evaluate((e) => [getComputedStyle(e).whiteSpace, getComputedStyle(e).userSelect].join())).toBe('normal,none') // long descriptions wrap; nothing here selects
  expect(await list.evaluate((e) => [...e.querySelectorAll('button')].every((b) => b.scrollWidth <= b.clientWidth))).toBe(true)
  await shot(page, 'agents-model-list')
  await page.getByText('Sonnet 4.6').click()
  await expect(page.getByRole('button', { name: 'Sonnet 4.6', exact: true })).toBeVisible() // back on the effort view, model link updated
  await expect(page.getByText('Medium', { exact: true }).first()).toBeVisible() // Sonnet has no 'max': effort reset, showing Sonnet's own default
  await expect(page.getByText('Default', { exact: true })).toHaveCount(0)
  await shot(page, 'agents-effort')
  await page.mouse.click(700, 300) // outside the popover
  await expect(page.getByRole('button', { name: /^Sonnet 4.6/ })).toBeVisible()

  // Without a chat the picker edits the defaults for the next one.
  await page.getByRole('button', { name: 'New chat' }).click()
  await page.getByRole('button', { name: /^Opus 4.6/ }).click() // no model chosen: the one the default stands for
  await page.locator('input.effort').fill('2')
  await expect(page.getByText('High', { exact: true }).first()).toBeVisible()
  await page.mouse.click(700, 300)
  await expect(page.getByRole('button', { name: /^Opus 4.6 ?High/ })).toBeVisible()
  await c.close()
})

test('background command: active after the turn, settles by notification, relay turn renders', async () => {
  const c = await launch()
  const { page } = c
  await send(page, 'background please')
  await expect(page.getByText(/^Worked for/).first()).toBeVisible()
  await openPanel(page)
  await expect(page.getByText('Active · 1')).toBeVisible()
  await shot(page, 'background-active')
  await expect(page.getByText('Done · 1')).toBeVisible() // the notification arrives on its own
  await expect(page.locator('[title="Stop (Esc)"]')).toBeVisible() // the CLI's follow-up turn counts as running
  await expect(page.getByText(/^Worked for/)).toHaveCount(2)
  await expect(page.locator('.bg-bubble')).toHaveCount(1) // its relay prompt is not a user message
  await expect(page.locator('textarea')).toBeEnabled()
  await page.getByText('Sleep 4 seconds then print finished', { exact: true }).click() // the panel's row, not the transcript's launch line
  await expect(page.getByText('$ sleep 4 && echo finished')).toBeVisible()
  await shot(page, 'background-done')
  await c.close()
})

test('background command can be stopped', async () => {
  const c = await launch()
  const { page } = c
  await send(page, 'bgstop please')
  await expect(page.getByText(/^Worked for/).first()).toBeVisible()
  await openPanel(page)
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText('Done · 1')).toBeVisible()
  await expect(page.getByText('stopped')).toBeVisible()
  await shot(page, 'background-stopped')
  await c.close()
})

test('a saved chat with subagents reloads the panel and threads', async () => {
  const c = await launch({ chats: [{ id: 'agents-1', title: 'Agents history' }] })
  const { page } = c
  await page.getByText('Agents history').first().click()
  await expect(page.getByText(/The 'Count files' agent found/)).toBeVisible()
  await expect(page.locator('.bg-bubble')).toHaveCount(1)
  await openPanel(page)
  await expect(page.getByText('Done · 3')).toBeVisible()
  await page.getByText('Count files', { exact: true }).click()
  await expect(page.getByText('Opus 5.5')).toBeVisible()
  await expect(page.locator('.bg-bubble')).toHaveCount(2)
  await page.getByText(/^Worked/).last().click()
  await expect(page.getByText(/^Ran ls/)).toBeVisible()
  await shot(page, 'agents-history')
  await c.close()
})
