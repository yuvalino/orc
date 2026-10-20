import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('empty shell matches the Codex layout', async () => {
  const c = await launch({ project: false, settings: { models: [{ value: 'default', displayName: 'Default (recommended)', effortLevels: ['low', 'medium', 'high'] }] } })
  const { page } = c
  await expect(page.getByTestId('empty-chat')).toBeVisible()
  const empty = page.getByTestId('empty-chat')
  await expect(empty).toContainText(/Layin' the foundation|Let's build|New construction|Clocked in|Have a job for me\?|What's the story\?|Let's get to work|Bring on the scaffolding/) // no project: one of the general greetings
  expect(await empty.evaluate((e) => getComputedStyle(e).userSelect)).toBe('none')
  expect(await empty.evaluate((e) => Math.max(...[...e.querySelectorAll('div')].map((d) => parseFloat(getComputedStyle(d).fontSize))))).toBeGreaterThanOrEqual(28)
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
