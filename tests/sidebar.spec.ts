import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('sidebar: arrow cursor, folding sections and projects, new-chat buttons, folded status', async () => {
  const c = await launch({ chats: [{ id: 'a', title: 'Alpha chat' }, { id: 'b', title: 'Beta chat' }] })
  const { page } = c
  const project = page.locator('[role=button][aria-expanded]', { hasText: 'Fixture Project' })
  const recents = page.locator('[role=button][aria-expanded]', { hasText: 'Recents' })
  const alphaUnder = page.locator('[data-pane=sidebar] div.group', { hasText: 'Alpha chat' }).first() // under the project

  // Clickable things keep the arrow cursor, and their text can't be selected.
  for (const el of [page.getByRole('button', { name: 'New chat' }), alphaUnder, project]) {
    expect(await el.evaluate((e) => [getComputedStyle(e).cursor, getComputedStyle(e).userSelect].join())).toBe('default,none')
  }

  // A project folds its chats on a click: open folder ↔ closed folder, and the rows slide away under it.
  await expect(project).toHaveAttribute('aria-expanded', 'true')
  await expect(project.locator('svg.lucide-folder-open')).toHaveCount(1)
  await project.click()
  await expect(project).toHaveAttribute('aria-expanded', 'false')
  await expect(project.locator('svg.lucide-folder')).toHaveCount(1)
  const folded = () => alphaUnder.evaluate((e) => e.closest('.grid')!.getBoundingClientRect().height)
  expect(await folded()).toBeGreaterThan(1) // still sliding shut
  await expect.poll(folded).toBeLessThan(1)
  await project.click()
  await expect(project).toHaveAttribute('aria-expanded', 'true')

  // A section folds on its title; its › shows when folded, and only on hover when open, turning as it goes.
  const arrow = recents.locator('svg.lucide-chevron-right')
  await page.mouse.move(700, 300)
  expect(await arrow.evaluate((e) => getComputedStyle(e).opacity)).toBe('0')
  expect(await arrow.evaluate((e) => getComputedStyle(e).transitionDuration)).not.toBe('0s')
  await recents.hover()
  expect(await arrow.evaluate((e) => getComputedStyle(e).opacity)).toBe('1')
  await recents.click()
  await expect(recents).toHaveAttribute('aria-expanded', 'false')
  await page.mouse.move(700, 300)
  expect(await arrow.evaluate((e) => getComputedStyle(e).opacity)).toBe('1')
  await recents.click()

  // Recents and each project have a new-chat button; the project's starts the chat there.
  await recents.hover()
  await recents.getByTitle('New chat').click()
  await expect(page.getByText('Start a conversation')).toBeVisible()
  await page.getByText('Alpha chat').first().click()
  await project.hover()
  await project.getByTitle('New chat in Fixture Project').click()
  await expect(page.getByText('Start a conversation')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fixture Project' }).last()).toBeVisible() // the composer's project

  // A running chat's spinner shows on its own row while its parents are open, and on the folded parent otherwise.
  await page.getByText('Alpha chat').first().click()
  await send(page, 'plan something long')
  const working = (l: typeof project) => l.getByTitle('Working')
  await expect(working(alphaUnder)).toBeVisible()
  await expect(working(project)).toHaveCount(0)
  await project.click()
  await page.mouse.move(700, 300) // hovering a row swaps its status for its buttons
  await expect(working(project)).toBeVisible()
  await recents.click()
  await page.mouse.move(700, 300)
  await expect(working(recents)).toBeVisible()
  await shot(page, 'sidebar-folded')
  await page.keyboard.press('Escape')
  await c.close()
})
