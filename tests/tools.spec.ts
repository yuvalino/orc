import { expect, test } from '@playwright/test'
import { launch, send, shot } from './helpers'

test('tool calls collapse under "Worked for", edits ask for permission', async () => {
  const c = await launch({ chats: [{ id: 'tools-1', title: 'Tool history' }] })
  const { page } = c
  await page.getByText('Tool history').first().click() // saved transcript: task checklist, Edit patch, Grep files, Bash diff, MCP name
  await page.getByText(/^Worked/).click()
  await expect(page.getByText('Task #1 → in_progress')).toBeVisible()
  await expect(page.getByText('Searched line · 2 files')).toBeVisible()
  await expect(page.getByText('guide (claude_ai_Claude_Docs)')).toBeVisible()
  await page.getByText(/^Edited .*notes\.md/).click()
  await expect(page.getByText('-line two')).toBeVisible()
  await page.getByText(/^Ran sed/).click()
  await expect(page.getByText('+line 3')).toBeVisible()
  await shot(page, 'tools-history')
  await page.getByText('New chat', { exact: true }).first().click()
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
