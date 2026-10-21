import { expect, test } from '@playwright/test'
import { launch } from './helpers'

test("new chat: only a project's own button starts it in that project; every other way in starts with no project", async () => {
  const c = await launch({ chats: [{ id: 'a', title: 'Alpha chat' }] })
  const { page } = c
  const target = page.getByTestId('project-picker') // the composer's project
  const project = page.locator('[role=button][aria-expanded]', { hasText: 'Fixture Project' })
  const recents = page.locator('[role=button][aria-expanded]', { hasText: 'Recents' })
  const inProject = async () => {
    await project.hover()
    await project.getByTitle('New chat in Fixture Project').click()
    await expect(target).toHaveText('Fixture Project')
  }

  // Each global way in, straight after a project's new chat: the draft switches to no project.
  const globals: [string, () => Promise<void>][] = [
    ['the sidebar button', () => page.locator('[data-pane=sidebar] button', { hasText: 'New chat' }).first().click()],
    ['Recents', async () => { await recents.hover(); await recents.getByTitle('New chat').click() }],
    ['the shortcut', () => page.keyboard.press('ControlOrMeta+n')],
    ['the palette', async () => { await page.keyboard.press('ControlOrMeta+p'); await page.getByText('New chat', { exact: true }).last().click() }]
  ]
  for (const [way, go] of globals) {
    await inProject()
    await go()
    await expect(target, way).toHaveText('No project')
  }

  // From an open chat too, and back: the project's button retargets the draft to it.
  await page.getByText('Alpha chat').first().click()
  await page.keyboard.press('ControlOrMeta+n')
  await expect(target).toHaveText('No project')
  await inProject()
  await c.close()
})
