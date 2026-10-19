import { create } from 'zustand'
import type { Account, AskAnswer, Item, ModelOption, Project, Session, SessionStatus } from '@shared/types'
import { applyPatch } from '@shared/types'

interface State {
  projects: Project[]
  sessions: Session[]
  activeId: string | null
  draftProjectId: string | null
  transcripts: Record<string, Item[]>
  status: Record<string, SessionStatus>
  unread: Record<string, true>
  models: ModelOption[]
  account: Account | null
  draft: string
  palette: null | 'chats' | 'files'

  init(): void
  select(id: string): Promise<void>
  newChat(projectId?: string | null): void
  send(text: string): Promise<void>
  interrupt(): Promise<void>
  answer(askId: string, answer: AskAnswer): Promise<void>
  update(id: string, patch: Parameters<Window['orc']['sessions']['update']>[1]): Promise<void>
  setDraft(text: string): void
  openPalette(mode?: 'chats' | 'files'): void
  closePalette(): void
}

const api = () => window.orc

export const useStore = create<State>((set, get) => ({
  projects: [], sessions: [], activeId: null, draftProjectId: null, transcripts: {}, status: {}, unread: {}, models: [], account: null, draft: '', palette: null,

  init() {
    api().projects.list().then((projects) => set({ projects }))
    api().sessions.list().then((sessions) => set({ sessions }))
    api().on('projects:changed', (projects) => set({ projects }))
    api().on('sessions:changed', (sessions) => set({ sessions }))
    api().on('transcript:patch', ({ sessionId, patch }) =>
      set((s) => ({ transcripts: { ...s.transcripts, [sessionId]: applyPatch(s.transcripts[sessionId] ?? [], patch) } })))
    api().on('session:status', ({ sessionId, status }) => {
      set((s) => {
        const was = s.status[sessionId]?.state
        const finished = was === 'running' && (status.state === 'idle' || status.state === 'closed') && s.activeId !== sessionId
        return { status: { ...s.status, [sessionId]: status }, unread: finished ? { ...s.unread, [sessionId]: true } : s.unread }
      })
      if (!get().models.length && status.state !== 'closed' && status.state !== 'starting') api().codecInfo().then((i) => set({ models: i.models, account: i.account }))
    })
    api().on('menu:new-chat', () => get().newChat())
  },

  async select(id) {
    set((s) => { const unread = { ...s.unread }; delete unread[id]; return { activeId: id, unread, palette: null } })
    if (!get().transcripts[id]) {
      const [items, status] = await Promise.all([api().sessions.open(id), api().sessions.status(id)])
      set((s) => ({ transcripts: { ...s.transcripts, [id]: items }, status: { ...s.status, [id]: status } }))
    }
  },

  // undefined keeps the current project choice; null means "no project" (home folder).
  newChat(projectId) { set((s) => ({ activeId: null, palette: null, draftProjectId: projectId === undefined ? s.draftProjectId : projectId })) },

  async send(text) {
    let id = get().activeId
    if (!id) {
      const session = await api().sessions.create(get().draftProjectId)
      id = session.id
      set((s) => ({ activeId: id, transcripts: { ...s.transcripts, [id!]: [] } }))
    }
    await api().sessions.send(id, text)
  },

  async interrupt() { const id = get().activeId; if (id) await api().sessions.interrupt(id) },
  async answer(askId, answer) { await api().answerAsk(askId, answer) },
  async update(id, patch) { await api().sessions.update(id, patch) },
  setDraft: (draft) => set({ draft }),
  openPalette: (mode = 'chats') => set({ palette: mode }),
  closePalette: () => set({ palette: null })
}))

export const sessionTitle = (s: Session) => s.title ?? s.autoTitle ?? 'New chat'
export const useActive = () => {
  const { activeId, sessions, projects, draftProjectId } = useStore()
  const session = sessions.find((s) => s.id === activeId) ?? null
  return { session, project: projects.find((p) => p.id === (session?.projectId ?? draftProjectId)) ?? null }
}
