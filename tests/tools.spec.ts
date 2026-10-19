import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('tool calls collapse under "Worked for", edits ask for permission', async () => {
  const c = await launch()
  const { page } = c
  await send(page, 'read hello.txt')
  const worked = page.getByText(/^Worked for/)
  await expect(worked).toBeVisible()
  await worked.click()
  await expect(page.getByText(/^Read .*hello\.txt/)).toBeVisible()
  await shot(page, 'tools-read')

  await send(page, 'edit a file')
  await expect(page.getByText('notes.md').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Allow always' })).toBeVisible()
  await shot(page, 'tools-permission')
  await page.getByRole('button', { name: 'Allow', exact: true }).click()
  await expect(page.getByText('Allowed', { exact: true })).toBeVisible()
  await expect(page.getByText(/^Wrote .*notes\.md/)).toBeVisible()
  await expect(page.getByText('Done', { exact: true })).toBeVisible()
  await shot(page, 'tools-after-allow')
  await c.close()
})
