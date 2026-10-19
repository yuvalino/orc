import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export interface Ctx { app: ElectronApplication; page: Page; dataDir: string; userData: string; projectPath: string; close(): Promise<void> }

/**
 * Launch orc against the fake SDK with an optional seeded project and chats. Every instance gets its own userData
 * (Electron's single-instance lock is keyed on it); `dataDir` can be shared to exercise the engine lock.
 */
export async function launch(opts: { project?: boolean; chats?: { id: string; title: string; pinned?: boolean }[]; settings?: Record<string, unknown>; live?: boolean; dataDir?: string; userData?: string; waitFor?: 'composer' | 'none'; seed?: boolean; remote?: string; env?: Record<string, string> } = {}): Promise<Ctx> {
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'orc-'))
  const userData = opts.userData ?? mkdtempSync(join(tmpdir(), 'orc-ud-'))
  const projectPath = mkdtempSync(join(tmpdir(), 'orc-project-'))
  writeFileSync(join(projectPath, 'hello.txt'), 'hello from the fixture project\n')
  if (opts.settings) writeFileSync(join(dataDir, 'settings.json'), JSON.stringify(opts.settings))
  if (opts.project !== false && (opts.seed ?? !opts.dataDir)) {
    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify([{ id: 'p1', path: projectPath, name: 'Fixture Project', isPinned: false, createdAt: 1 }]))
    writeFileSync(join(dataDir, 'sessions.json'), JSON.stringify((opts.chats ?? []).map((c, i) => ({
      id: c.id, projectId: 'p1', codec: 'claude', title: c.title, autoTitle: null, isPinned: !!c.pinned, createdAt: i, lastActivityAt: i, approvalMode: 'ask', model: null
    }))))
  }
  mkdirSync(join(__dirname, 'screenshots'), { recursive: true })
  const app = await electron.launch({
    args: [join(__dirname, '../out/main/index.js'), ...(opts.remote ? ['--remote', opts.remote] : [])],
    env: { ...process.env, ORC_DATA_DIR: dataDir, ORC_USER_DATA_DIR: userData, ...(opts.live ? {} : { ORC_FAKE_SDK: join(__dirname, 'fixtures') }), ...opts.env }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  if (opts.waitFor !== 'none') await expect(page.locator('textarea')).toBeVisible()
  return { app, page, dataDir, userData, projectPath, close: async () => { await app.close(); if (!opts.dataDir) rmSync(dataDir, { recursive: true, force: true }); rmSync(userData, { recursive: true, force: true }); rmSync(projectPath, { recursive: true, force: true }) } }
}

export const shot = (page: Page, name: string) => page.screenshot({ path: join(__dirname, 'screenshots', `${name}.png`) })

export async function send(page: Page, text: string) {
  await page.locator('textarea').fill(text)
  await page.locator('textarea').press('Enter')
}
