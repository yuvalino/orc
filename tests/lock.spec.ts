import { expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'fs'
import { hostname, tmpdir } from 'os'
import { join } from 'path'
import { launch, send, shot } from './helpers'

test('one engine per data dir: busy screen, take-over, stale lock, single instance', async () => {
  const a = await launch()
  await send(a.page, 'hello there')
  await expect(a.page.getByText('Hello from Claude')).toBeVisible()

  // A second instance on the same data dir does not start an engine; it names the holder.
  const b = await launch({ dataDir: a.dataDir, waitFor: 'none' })
  await expect(b.page.getByText('orc is already running for this folder')).toBeVisible()
  await expect(b.page.getByText(/^Controlled by \S+@\S+ since/)).toBeVisible()
  await shot(b.page, 'lock-busy')

  // Take over: the holder is told who evicted it, the taker gets the engine and the same chats.
  await b.page.getByRole('button', { name: 'Take over' }).click()
  await expect(b.page.locator('textarea')).toBeVisible()
  await expect(b.page.getByText('Chat about hello').first()).toBeVisible()
  await expect(a.page.getByText(/^Taken over by \S+@\S+/)).toBeVisible()
  await shot(a.page, 'lock-taken-over')
  await expect(a.page.getByRole('button', { name: 'Take back' })).toBeVisible()
  await b.close()

  // Same userData again → Electron's single-instance lock: the new process exits, the first one is told.
  await expect(launch({ dataDir: a.dataDir, userData: a.userData, waitFor: 'none' })).rejects.toThrow()
  expect(await a.app.evaluate(() => (globalThis as unknown as { orcSecondInstances(): number }).orcSecondInstances())).toBe(1)
  await a.close()

  // A stale lock (dead pid) is ignored.
  const stale = mkdtempSync(join(tmpdir(), 'orc-stale-'))
  writeFileSync(join(stale, 'lock'), JSON.stringify({ pid: 999999, startedAt: 'never', host: hostname(), user: 'x', client: { host: 'h', user: 'x' }, since: 1, kind: 'local' }))
  const d = await launch({ dataDir: stale })
  await expect(d.page.locator('textarea')).toBeVisible()
  await d.close()
})
