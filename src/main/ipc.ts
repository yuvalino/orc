import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readdirSync } from 'fs'
import { join, relative } from 'path'
import type { OrcApi, PushEvents } from '@shared/api'
import type { ApprovalMode } from '@shared/types'
import { Engine } from './engine'
import { DEFAULT_CODEC } from './codecs/registry'
import { projects, sessions, settings } from './store'

export const push = <K extends keyof PushEvents>(channel: K, payload: PushEvents[K]) =>
  BrowserWindow.getAllWindows().forEach((w) => !w.isDestroyed() && w.webContents.send(channel, payload))

export const engine = new Engine(push)

type Handlers = { [K in keyof OrcApi as OrcApi[K] extends Function ? never : K]: OrcApi[K] } & Pick<OrcApi, 'answerAsk' | 'codecInfo'>

const handlers: Handlers = {
  projects: {
    list: async () => projects.list(),
    add: async () => {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      const p = projects.add(r.filePaths[0])
      push('projects:changed', projects.list())
      return p
    },
    remove: async (id) => {
      for (const s of sessions.list()) if (s.projectId === id) await engine.remove(s.id) // chats can't run without their folder
      projects.remove(id); push('projects:changed', projects.list())
    },
    files: async (id, query) => { const p = projects.find(id); return p ? listFiles(p.path, query.toLowerCase()) : [] }
  },
  sessions: {
    list: async () => sessions.list(),
    create: async (projectId) => {
      const s = sessions.create(projectId, DEFAULT_CODEC, { approvalMode: (settings.get('approvalMode') as ApprovalMode) ?? 'ask', model: (settings.get('model') as string) ?? null, effort: (settings.get('effort') as string) ?? null })
      push('sessions:changed', sessions.list())
      return s
    },
    open: (id) => engine.open(id),
    send: (id, text) => engine.send(id, text),
    interrupt: (id) => engine.interrupt(id),
    stopTask: (id, taskId) => engine.stopTask(id, taskId),
    update: async (id, patch) => {
      if (patch.title !== undefined) await engine.rename(id, patch.title ?? '')
      if (patch.approvalMode) await engine.setApprovalMode(id, patch.approvalMode)
      if (patch.model !== undefined) await engine.setModel(id, patch.model)
      if (patch.effort !== undefined) await engine.setEffort(id, patch.effort)
      if (patch.isPinned !== undefined) { sessions.update(id, { isPinned: patch.isPinned }); push('sessions:changed', sessions.list()) }
    },
    remove: (id) => engine.remove(id),
    status: async (id) => engine.status(id)
  },
  answerAsk: async (askId, answer) => engine.answerAsk(askId, answer),
  codecInfo: () => engine.info(),
  settings: { get: async (k) => settings.get(k), set: async (k, v) => settings.set(k, v) }
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'target'])

/** Relative paths under root matching the query (substring), bounded so a huge tree stays fast. */
function listFiles(root: string, query: string, limit = 60): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    if (out.length >= limit || depth > 6) return
    let entries: import('fs').Dirent[] = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= limit) return
      if (e.name.startsWith('.') && e.name !== '.claude') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(full, depth + 1) }
      else { const rel = relative(root, full); if (rel.toLowerCase().includes(query)) out.push(rel) }
    }
  }
  walk(root, 0)
  return out
}

export function registerIpc(): void {
  const walk = (obj: object, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'function') ipcMain.handle(`${prefix}${k}`, (_e, ...args) => (v as (...a: unknown[]) => unknown)(...args))
      else walk(v, `${prefix}${k}.`)
    }
  }
  walk({ ...handlers, asks: { answer: handlers.answerAsk }, codec: { info: handlers.codecInfo } }, '')
  engine.hydrateTitles()
}
