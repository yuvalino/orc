import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('empty shell matches the Codex layout', async () => {
  const c = await launch({ project: false, settings: { models: [{ value: 'default', displayName: 'Default (recommended)', effortLevels: ['low', 'medium', 'high'] }] } })
  const { page } = c
  await expect(page.getByText('Start a conversation')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Opus 4.6 ?High/ })).toBeVisible() // before any chat runs: the model the default stands for, and its real effort
  await expect(page.getByText('No projects yet')).toBeVisible()
  await expect(page.getByText('New chat')).toBeVisible()
  await expect(page.getByText('No project', { exact: true })).toBeVisible()
  await send(page, 'hello without a project')
  await expect(page.getByText('Hello from Claude')).toBeVisible()
  await expect(page.getByText('~', { exact: true })).toBeHidden()
  await expect(page.locator('textarea')).toHaveAttribute('placeholder', 'Work with orc')
  await expect(page.getByText('Ask for approval')).toBeVisible()
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(30, 30, 30)')
  await shot(page, 'shell-empty')
  await c.close()
})
