import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('sidebar: arrow cursor, folding sections and projects, new-chat buttons, folded status', async () => {
  const c = await launch({ chats: [{ id: 'a', title: 'Alpha chat' }, { id: 'b', title: 'Beta chat' }] })
  const { page } = c
  const project = page.locator('[role=button][aria-expanded]', { hasText: 'Fixture Project' })
  const recents = page.locator('[role=button][aria-expanded]', { hasText: 'Recents' })
  const alphaUnder = page.locator('[data-pane=sidebar] div.group', { hasText: 'Alpha chat' }).first() // under the project

  // Clickable things keep the arrow cursor, and their text can't be selected.
  expect(await page.locator('[data-pane=sidebar]').getByText('Orc', { exact: true }).evaluate((e) => getComputedStyle(e).userSelect)).toBe('none') // the title too
  for (const el of [page.getByRole('button', { name: 'New chat' }), alphaUnder, project]) {
    expect(await el.evaluate((e) => [getComputedStyle(e).cursor, getComputedStyle(e).userSelect].join())).toBe('default,none')
  }

  // One alignment line, like Codex: the title, New chat, section names, top-level chat names and project folders start together;
  // a project's chats start where its name does.
  const x = await page.locator('[data-pane=sidebar]').evaluate((pane) => {
    const text = (el: Element, t: string) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.textContent!.trim() === t) { const r = document.createRange(); r.selectNodeContents(n); return Math.round(r.getBoundingClientRect().left) } return -1 }
    const left = (el: Element | null | undefined) => Math.round(el!.getBoundingClientRect().left)
    const rows = [...pane.querySelectorAll('div.group')]
    const project = pane.querySelector('[role=button][aria-expanded]:not(:has(svg.lucide-chevron-right))') ?? [...pane.querySelectorAll('[role=button]')].find((e) => e.textContent?.includes('Fixture Project'))!
    return {
      title: text(pane, 'Orc'), logoAfter: left(pane.querySelector('img')) > text(pane, 'Orc'), newChat: left([...pane.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'New chat')?.querySelector('svg')),
      section: text(pane, 'Projects'), recentChat: text(rows.filter((r) => r.textContent?.includes('Alpha chat')).at(-1)!, 'Alpha chat'), folder: left(project.querySelector('svg')),
      projectName: text(project, 'Fixture Project'), nestedChat: text(rows.find((r) => r.textContent?.includes('Alpha chat'))!, 'Alpha chat')
    }
  })
  expect(new Set([x.title, x.newChat, x.section, x.recentChat, x.folder]).size).toBe(1)
  expect(x.logoAfter).toBe(true) // the logo follows the name
  const white = 'rgb(229, 229, 229)', color = (l: typeof project) => l.evaluate((e) => getComputedStyle(e).color)
  expect(await color(project)).toBe(white) // the project, its folder…
  expect(await project.locator('svg').first().evaluate((e) => getComputedStyle(e).color)).toBe(white)
  expect(await color(alphaUnder)).toBe(white) // …and every chat, selected or not, in the same white
  expect(x.nestedChat).toBe(x.projectName)
  expect(await page.locator('[role=button][aria-expanded]', { hasText: 'Projects' }).evaluate((e) => [getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight])).toEqual(['14px', '600']) // section names: larger, bolder

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

  // From a new chat to an existing one, the empty screen fades out as the same element, logo and all (a new one would blink).
  await page.getByRole('button', { name: 'New chat' }).first().click()
  const logo = await page.getByTestId('empty-chat').locator('img').elementHandle()
  await page.getByText('Beta chat').first().click()
  expect(await logo!.evaluate((e) => e.isConnected && !!e.closest('.fade-out'))).toBe(true)

  // Recents and each project have a new-chat button; the project's starts the chat there.
  await recents.hover()
  await recents.getByTitle('New chat').click()
  await expect(page.getByTestId('empty-chat')).toBeVisible()
  await page.getByText('Alpha chat').first().click()
  await project.hover()
  await project.getByTitle('New chat in Fixture Project').click()
  await expect(page.getByTestId('empty-chat')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fixture Project' }).last()).toBeVisible() // the composer's project
  await expect(page.getByTestId('empty-chat')).toContainText(/Building Fixture Project|Fixture Project (has been generous|has big plans|will live in prosperity|will grow larger)|We build for Fixture Project/) // a greeting for the project

  // A running chat's spinner shows on its own row while its parents are open, and on the folded parent otherwise.
  await page.getByText('Alpha chat').first().click()
  await send(page, 'plan something long')
  const working = (l: typeof project) => l.getByTitle('Working')
  await expect(working(alphaUnder)).toBeVisible()
  await expect(page.locator('main .animate-spin')).toHaveCount(0) // spinners are for the sidebar: the conversation shimmers instead
  const status = page.locator('main button .shimmer').first()
  await expect(status).toHaveText(/^(Thinking…|Working for \d+s)$/)
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
