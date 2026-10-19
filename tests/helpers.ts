import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export interface Ctx { app: ElectronApplication; page: Page; dataDir: string; projectPath: string; close(): Promise<void> }

/** Launch orc against the fake SDK with an optional seeded project and chats. */
export async function launch(opts: { project?: boolean; chats?: { id: string; title: string; pinned?: boolean }[]; live?: boolean } = {}): Promise<Ctx> {
  const dataDir = mkdtempSync(join(tmpdir(), 'orc-'))
  const projectPath = mkdtempSync(join(tmpdir(), 'orc-project-'))
  writeFileSync(join(projectPath, 'hello.txt'), 'hello from the fixture project\n')
  if (opts.project !== false) {
    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify([{ id: 'p1', path: projectPath, name: 'Fixture Project', isPinned: false, createdAt: 1 }]))
    writeFileSync(join(dataDir, 'sessions.json'), JSON.stringify((opts.chats ?? []).map((c, i) => ({
      id: c.id, projectId: 'p1', codec: 'claude', title: c.title, autoTitle: null, isPinned: !!c.pinned, createdAt: i, lastActivityAt: i, approvalMode: 'ask', model: null
    }))))
  }
  mkdirSync(join(__dirname, 'screenshots'), { recursive: true })
  const app = await electron.launch({
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, ORC_DATA_DIR: dataDir, ...(opts.live ? {} : { ORC_FAKE_SDK: join(__dirname, 'fixtures') }) }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('textarea')).toBeVisible()
  return { app, page, dataDir, projectPath, close: async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); rmSync(projectPath, { recursive: true, force: true }) } }
}

export const shot = (page: Page, name: string) => page.screenshot({ path: join(__dirname, 'screenshots', `${name}.png`) })

export async function send(page: Page, text: string) {
  await page.locator('textarea').fill(text)
  await page.locator('textarea').press('Enter')
}
