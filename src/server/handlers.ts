import { readdirSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, relative } from 'path'
import type { OrcApi } from '@shared/api'
import type { ApprovalMode } from '@shared/types'
import { DEFAULT_CODEC } from './codecs/registry'
import type { Engine, Push } from './engine'
import { projects, sessions, settings } from './store'

/** The engine's half of OrcApi: everything but transport (desktop-side) and the push channel. A path is required for add — the native folder dialog lives in the desktop shell. */
export type Handlers = Omit<OrcApi, 'on' | 'transport' | 'projects'> & { projects: Omit<OrcApi['projects'], 'add'> & { add(path: string): Promise<OrcApi['projects'] extends { add(...a: never[]): Promise<infer R> } ? R : never> } }

export function createHandlers(engine: Engine, push: Push): Handlers {
  return {
    projects: {
      list: async () => projects.list(),
      add: async (path) => { const p = projects.add(path); push('projects:changed', projects.list()); return p },
      remove: async (id) => {
        for (const s of sessions.list()) if (s.projectId === id) await engine.remove(s.id) // chats can't run without their folder
        projects.remove(id); push('projects:changed', projects.list())
      },
      files: async (id, query) => { const p = projects.find(id); return p ? listFiles(p.path, query.toLowerCase()) : [] },
      browse: async (path) => { // directories only, dotfiles hidden: the remote folder picker
        const at = path ?? homedir()
        const dirs = readdirSync(at, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort()
        return { path: at, dirs, parent: dirname(at) === at ? null : dirname(at) }
      }
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
}

/** Flatten to the dotted method names both transports use (`sessions.send`, `asks.answer`, `codec.info`…). */
export function methodTable(h: object): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const out: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  const walk = (obj: object, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'function') out[`${prefix}${k}`] = v as (...args: unknown[]) => Promise<unknown>
      else walk(v, `${prefix}${k}.`)
    }
  }
  const { answerAsk, codecInfo, ...rest } = h as Handlers
  walk({ ...rest, asks: { answer: answerAsk }, codec: { info: codecInfo } }, '')
  return out
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
