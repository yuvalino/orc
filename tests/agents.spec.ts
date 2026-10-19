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
  await page.getByTitle('Back').click()
  await expect(page.getByText('Done · 2')).toBeVisible()

  // Model picker: effort popover first, model list behind the model link.
  await page.getByRole('button', { name: /^Default/ }).click()
  await expect(page.getByText('Select effort')).toBeVisible()
  await page.locator('input.effort').fill('3')
  await expect(page.getByText('Max', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Default', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Select model' })).toBeVisible()
  await shot(page, 'agents-model-list')
  await page.getByText('Sonnet 4.6').click()
  await expect(page.getByRole('button', { name: 'Sonnet 4.6', exact: true })).toBeVisible() // back on the effort view, model link updated
  await expect(page.getByText('Default', { exact: true }).first()).toBeVisible() // Sonnet has no 'max': effort reset
  await shot(page, 'agents-effort')
  await page.mouse.click(700, 300) // outside the popover
  await expect(page.getByRole('button', { name: /^Sonnet 4.6/ })).toBeVisible()

  // Without a chat the picker edits the defaults for the next one.
  await page.getByRole('button', { name: 'New chat' }).click()
  await page.getByRole('button', { name: /^Default/ }).click()
  await page.locator('input.effort').fill('2')
  await expect(page.getByText('High', { exact: true }).first()).toBeVisible()
  await page.mouse.click(700, 300)
  await expect(page.getByRole('button', { name: /^Default High/ })).toBeVisible()
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
  await expect(page.getByText(/^Worked for/)).toHaveCount(2) // the CLI's follow-up turn
  await expect(page.locator('.bg-bubble')).toHaveCount(1) // its relay prompt is not a user message
  await expect(page.locator('textarea')).toBeEnabled()
  await page.getByText('Sleep 4 seconds then print finished').click()
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
