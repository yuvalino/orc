import { create } from 'zustand'
import type { Account, ApprovalMode, AskAnswer, Item, ModelOption, Project, Session, SessionStatus } from '@shared/types'
import { applyPatch } from '@shared/types'

/** What a new chat starts with; the composer edits these when no chat is open. */
export interface Defaults { approvalMode: ApprovalMode; model: string | null; effort: string | null }

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
  panel: null | { toolUseId: string | null } // Subagents panel: closed, the lists, or one agent's thread
  defaults: Defaults

  init(): void
  setDefaults(patch: Partial<Defaults>): void
  select(id: string): Promise<void>
  newChat(projectId?: string | null): void
  send(text: string): Promise<void>
  interrupt(): Promise<void>
  stopTask(taskId: string): Promise<void>
  setPanel(panel: State['panel']): void
  answer(askId: string, answer: AskAnswer): Promise<void>
  update(id: string, patch: Parameters<Window['orc']['sessions']['update']>[1]): Promise<void>
  setDraft(text: string): void
  openPalette(mode?: 'chats' | 'files'): void
  closePalette(): void
}

const api = () => window.orc

export const useStore = create<State>((set, get) => ({
  projects: [], sessions: [], activeId: null, draftProjectId: null, transcripts: {}, status: {}, unread: {}, models: [], account: null, draft: '', palette: null, panel: null,
  defaults: { approvalMode: 'ask', model: null, effort: null },

  init() {
    api().projects.list().then((projects) => set((s) => ({ projects, draftProjectId: s.draftProjectId ?? projects[0]?.id ?? null }))) // a fresh chat starts in a project when one exists
    Promise.all((['approvalMode', 'model', 'effort'] as const).map((k) => api().settings.get(k))).then(([approvalMode, model, effort]) =>
      set((s) => ({ defaults: { approvalMode: (approvalMode as ApprovalMode) ?? s.defaults.approvalMode, model: (model as string) ?? null, effort: (effort as string) ?? null } })))
    api().sessions.list().then(async (sessions) => {
      set({ sessions })
      // Indicators for chats that were already running (e.g. after a renderer reload); their status is only pushed on change.
      const pairs = await Promise.all(sessions.map(async (x) => [x.id, await api().sessions.status(x.id)] as const))
      set((s) => ({ status: { ...Object.fromEntries(pairs.filter(([, st]) => st.state !== 'closed')), ...s.status } }))
    })
    api().on('projects:changed', (projects) => set((s) => ({ projects, draftProjectId: projects.some((p) => p.id === s.draftProjectId) ? s.draftProjectId : projects[0]?.id ?? null }))) // the drafted-into project may have been removed
    api().on('sessions:changed', (sessions) => set((s) => ({ sessions, activeId: sessions.some((x) => x.id === s.activeId) ? s.activeId : null }))) // the open chat may have been deleted
    api().on('transcript:patch', ({ sessionId, patch }) =>
      set((s) => (s.transcripts[sessionId] ? { transcripts: { ...s.transcripts, [sessionId]: applyPatch(s.transcripts[sessionId], patch) } } : s))) // unloaded chats are fetched whole on select
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

  setDefaults(patch) { Object.entries(patch).forEach(([k, v]) => api().settings.set(k, v)); set((s) => ({ defaults: { ...s.defaults, ...patch } })) },

  async select(id) {
    set((s) => { const unread = { ...s.unread }; delete unread[id]; return { activeId: id, unread, palette: null, panel: s.panel && { toolUseId: null } } })
    if (!get().transcripts[id]) {
      // Each reply is stored in its own microtask so a patch pushed in between can't be overwritten by a stale snapshot.
      const items = await api().sessions.open(id)
      set((s) => ({ transcripts: { ...s.transcripts, [id]: items } }))
      const status = await api().sessions.status(id)
      set((s) => ({ status: { ...s.status, [id]: status } }))
    }
  },

  // undefined keeps the current project choice; null means "no project" (home folder).
  newChat(projectId) { set((s) => ({ activeId: null, palette: null, panel: s.panel && { toolUseId: null }, draftProjectId: projectId === undefined ? s.draftProjectId : projectId })) },

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
  async stopTask(taskId) { const id = get().activeId; if (id) await api().sessions.stopTask(id, taskId) },
  setPanel: (panel) => set({ panel }),
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
