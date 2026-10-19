import { create } from 'zustand'
import type { Account, ApprovalMode, AskAnswer, Item, ModelOption, Project, Session, SessionStatus } from '@shared/types'
import type { TransportState } from '@shared/api'
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
  models: ModelOption[]
  account: Account | null
  draft: string
  palette: null | 'chats' | 'files' | 'hosts' | 'folders'
  panel: null | { toolUseId: string | null } // Subagents panel: closed, the lists, or one agent's thread
  defaults: Defaults
  transport: TransportState | null // null until the first state arrives

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
  openPalette(mode?: State['palette']): void
  closePalette(): void
  addProject(): void // native folder dialog locally; the folder picker on a remote host
}

const api = () => window.orc

export const useStore = create<State>((set, get) => ({
  projects: [], sessions: [], activeId: null, draftProjectId: null, transcripts: {}, status: {}, models: [], account: null, draft: '', palette: null, panel: null,
  defaults: { approvalMode: 'ask', model: null, effort: null }, transport: null,

  init() {
    const loadModels = () => api().codecInfo().then((i) => { if (i.models.length) { set({ models: i.models, account: i.account }); api().settings.set('models', i.models) } })
    // Everything the engine knows is (re)fetched whenever the transport reports ready: at startup, and after a reconnect or take-over.
    const load = async () => {
      set({ transcripts: {}, status: {}, models: [], account: null })
      api().projects.list().then((projects) => set((s) => ({ projects, draftProjectId: s.draftProjectId ?? projects[0]?.id ?? null }))) // a fresh chat starts in a project when one exists
      Promise.all((['approvalMode', 'model', 'effort'] as const).map((k) => api().settings.get(k))).then(([approvalMode, model, effort]) =>
        set((s) => ({ defaults: { approvalMode: (approvalMode as ApprovalMode) ?? s.defaults.approvalMode, model: (model as string) ?? null, effort: (effort as string) ?? null } })))
      api().settings.get('models').then((m) => set((s) => (s.models.length || !Array.isArray(m) ? s : { models: m }))) // last known list, so the picker works before any process runs
      const sessions = await api().sessions.list()
      set({ sessions })
      // Indicators for chats that were already running (e.g. after a renderer reload); their status is only pushed on change.
      const pairs = await Promise.all(sessions.map(async (x) => [x.id, await api().sessions.status(x.id)] as const))
      const live = pairs.filter(([, st]) => st.state !== 'closed')
      set((s) => ({ status: { ...Object.fromEntries(live), ...s.status } }))
      if (live.length) loadModels()
      const id = get().activeId
      if (id) { set({ activeId: null }); get().select(id) }
    }
    const onTransport = (t: TransportState) => { const was = get().transport?.phase; set({ transport: t }); if (t.phase === 'ready' && was !== 'ready') load() }
    api().on('transport:state', onTransport)
    api().transport.state().then(onTransport) // a state pushed before the page loaded would otherwise be lost
    api().on('projects:changed', (projects) => set((s) => ({ projects, draftProjectId: projects.some((p) => p.id === s.draftProjectId) ? s.draftProjectId : projects[0]?.id ?? null }))) // the drafted-into project may have been removed
    api().on('sessions:changed', (sessions) => {
      set((s) => ({ sessions, activeId: sessions.some((x) => x.id === s.activeId) ? s.activeId : null })) // the open chat may have been deleted
      const id = get().activeId
      if (id && sessions.find((x) => x.id === id)?.unread) api().sessions.markRead(id) // we are looking at it
    })
    api().on('transcript:patch', ({ sessionId, patch }) =>
      set((s) => (s.transcripts[sessionId] ? { transcripts: { ...s.transcripts, [sessionId]: applyPatch(s.transcripts[sessionId], patch) } } : s))) // unloaded chats are fetched whole on select
    api().on('session:status', ({ sessionId, status }) => {
      set((s) => ({ status: { ...s.status, [sessionId]: status } }))
      if (!get().account && status.state !== 'closed' && status.state !== 'starting') loadModels()
    })
    api().on('menu:new-chat', () => get().newChat())
  },

  setDefaults(patch) { Object.entries(patch).forEach(([k, v]) => api().settings.set(k, v)); set((s) => ({ defaults: { ...s.defaults, ...patch } })) },

  async select(id) {
    set((s) => ({ activeId: id, palette: null, panel: s.panel && { toolUseId: null } }))
    api().sessions.markRead(id)
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
  closePalette: () => set({ palette: null }),
  addProject() { if (get().transport?.kind === 'remote') set({ palette: 'folders' }); else api().projects.add().then((p) => p && get().newChat(p.id)) }
}))

export const sessionTitle = (s: Session) => s.title ?? s.autoTitle ?? 'New chat'
export const useActive = () => {
  const { activeId, sessions, projects, draftProjectId } = useStore()
  const session = sessions.find((s) => s.id === activeId) ?? null
  return { session, project: projects.find((p) => p.id === (session?.projectId ?? draftProjectId)) ?? null }
}
