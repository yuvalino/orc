import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { Project, Session } from '@shared/types'

/** Electron's userData path for an app named "orc", computed without Electron so a headless server lands on the same files. */
export function defaultDataDir(): string {
  const h = homedir()
  if (process.platform === 'darwin') return join(h, 'Library', 'Application Support', 'orc')
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(h, 'AppData', 'Roaming'), 'orc')
  return join(process.env.XDG_CONFIG_HOME ?? join(h, '.config'), 'orc')
}
let dir = process.env.ORC_DATA_DIR || defaultDataDir()
export const dataDir = (): string => dir
export const setDataDir = (d: string): void => { dir = d }

/** A JSON file read once and written atomically. */
export class JsonFile<T> {
  private cache: T | undefined
  constructor(private file: () => string, private empty: T) {}
  read(): T {
    if (this.cache !== undefined) return this.cache
    try { this.cache = JSON.parse(readFileSync(this.file(), 'utf-8')) as T } catch { this.cache = this.empty }
    return this.cache
  }
  write(data: T): void {
    this.cache = data
    const path = this.file()
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path + '.tmp', JSON.stringify(data, null, 2))
    renameSync(path + '.tmp', path)
  }
}

const projectsFile = new JsonFile<Project[]>(() => join(dataDir(), 'projects.json'), [])
const sessionsFile = new JsonFile<Session[]>(() => join(dataDir(), 'sessions.json'), [])
const settingsFile = new JsonFile<Record<string, unknown>>(() => join(dataDir(), 'settings.json'), {})

export const projects = {
  list: () => projectsFile.read(),
  add(path: string): Project {
    const existing = projectsFile.read().find((p) => p.path === path)
    if (existing) return existing
    if (!existsSync(path)) throw new Error(`Directory does not exist: ${path}`)
    const p: Project = { id: crypto.randomUUID(), path, name: null, isPinned: false, createdAt: Date.now() }
    projectsFile.write([...projectsFile.read(), p])
    return p
  },
  find: (id: string) => projectsFile.read().find((p) => p.id === id),
  remove: (id: string) => projectsFile.write(projectsFile.read().filter((p) => p.id !== id))
}

export const sessions = {
  list: () => sessionsFile.read(),
  find: (id: string) => sessionsFile.read().find((s) => s.id === id),
  create(projectId: string | null, codec: string, defaults: Pick<Session, 'approvalMode' | 'model' | 'effort'>): Session {
    const now = Date.now()
    const s: Session = { id: crypto.randomUUID(), projectId, codec, title: null, autoTitle: null, isPinned: false, createdAt: now, lastActivityAt: now, ...defaults }
    sessionsFile.write([...sessionsFile.read(), s])
    return s
  },
  update(id: string, patch: Partial<Session>): Session | undefined {
    let out: Session | undefined
    sessionsFile.write(sessionsFile.read().map((s) => (s.id === id ? (out = { ...s, ...patch }) : s)))
    return out
  },
  remove: (id: string) => sessionsFile.write(sessionsFile.read().filter((s) => s.id !== id))
}

export const settings = {
  get: (key: string) => settingsFile.read()[key],
  set: (key: string, value: unknown) => settingsFile.write({ ...settingsFile.read(), [key]: value })
}
