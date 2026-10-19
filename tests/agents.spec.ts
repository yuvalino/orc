import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

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
  await page.getByTitle('Reset to default').click()
  await expect(page.getByText('Default', { exact: true }).first()).toBeVisible()
  await shot(page, 'agents-effort')
  await page.mouse.click(700, 300) // outside the popover
  await expect(page.getByRole('button', { name: /^Sonnet 4.6/ })).toBeVisible()
  await c.close()
})

test('background command stays active after the turn, settles via notification, can be stopped', async () => {
  const c = await launch()
  const { page } = c
  await send(page, 'background please')
  await expect(page.getByText(/^Worked for/).first()).toBeVisible()
  await page.getByTitle('Subagents').click()
  await page.getByText('1 working').click()
  await expect(page.getByText('Active · 1')).toBeVisible()
  await expect(page.getByText('Working · background')).toBeVisible()
  await shot(page, 'background-active')
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText('Done · 1')).toBeVisible()
  await expect(page.getByText('stopped')).toBeVisible()
  await page.getByText('Sleep 4 seconds then print finished').click()
  await expect(page.getByText('$ sleep 4 && echo finished')).toBeVisible()
  await shot(page, 'background-stopped')
  await c.close()
})
