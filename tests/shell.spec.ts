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
  await expect(page.getByText('New session')).toHaveCount(0) // a new chat has no header bar
  await expect(page.getByTestId('header-shade')).toHaveCount(0)
  await expect(page.getByTitle('Subagents', { exact: true })).toHaveCount(0)
  const greetingAt = () => page.getByTestId('empty-chat').locator('.logo-glow').first().evaluate((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)] })
  const before = await greetingAt()
  await send(page, 'hello without a project')
  await expect(page.locator('.fade-out[data-testid=empty-chat]')).toHaveCount(1) // fading out over the first turn…
  expect(await greetingAt()).toEqual(before) // …right where it was, though the header and project bar came and went
  await expect(page.getByTitle('Subagents', { exact: true })).toBeVisible() // the open chat has one
  const shade = page.getByTestId('header-shade') // under its line, the conversation fades into the background color
  expect(await shade.evaluate((e) => getComputedStyle(e).backgroundImage)).toMatch(/^linear-gradient\(rgb\(30, 30, 30\), rgba\(0, 0, 0, 0\)\)$/)
  expect(await page.getByTestId('chat-header').evaluate((e) => getComputedStyle(e).borderBottomWidth)).toBe('1px') // the line stays; the fade is beneath it
  const edge = (await page.getByRole('separator').first().boundingBox())!, top = (await shade.boundingBox())!.y + 3
  expect(await shade.evaluate((e, [x, y]) => { e.style.pointerEvents = 'auto'; const hit = document.elementFromPoint(x, y); e.style.pointerEvents = ''; return !!hit?.closest('[role=separator]') }, [edge.x + edge.width / 2, top])).toBe(true) // the sidebar's edge stays above the fade
  expect(await page.locator('main span.truncate').first().evaluate((e) => getComputedStyle(e).userSelect)).toBe('none') // its title isn't text to select
  await expect(page.getByText('Hello from Claude')).toBeVisible()
  await expect(page.getByText('~', { exact: true })).toBeHidden()
  await expect(page.locator('textarea')).toHaveAttribute('placeholder', 'Work with Orc')
  await expect(page.getByText('Ask for approval')).toBeVisible()
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(30, 30, 30)')
  await shot(page, 'shell-empty')
  await c.close()
})
