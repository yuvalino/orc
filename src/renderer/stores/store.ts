import { create } from 'zustand'
import type { Account, ApprovalMode, AskAnswer, Item, ModelOption, Project, Session, SessionStatus } from '@shared/types'
import type { Notice, TransportState } from '@shared/api'
import { applyPatch } from '@shared/types'
import { defaultShortcuts, type ShortcutAction, type Shortcuts } from '../lib/shortcuts'

/** What a new chat starts with; the composer edits these when no chat is open. */
export interface Defaults { approvalMode: ApprovalMode; model: string | null; effort: string | null }

interface State {
  projects: Project[]
  sessions: Session[]
  activeId: string | null
  activeRow: string | null // which sidebar row opened it ('pinned', 'recents', 'project:<id>'): only that one is highlighted
  draftProjectId: string | null
  transcripts: Record<string, Item[]>
  status: Record<string, SessionStatus>
  models: ModelOption[]
  account: Account | null
  draft: string
  palette: null | 'chats' | 'files' | 'hosts' | 'folders' | 'signin'
  panel: null | { toolUseId: string | null } // Subagents panel: closed, the lists, or one agent's thread
  sidebarOpen: boolean
  collapsed: Record<string, boolean> // folded sidebar sections and projects ('pinned', 'projects', 'recents', 'project:<id>'); remembered (localStorage)
  widths: { sidebar: number; panel: number; settings: number } // remembered per browser profile (localStorage)
  settings: null | { tab: SettingsTab; editing?: 'instructions' } // the settings screen covers the window below the title bar
  shortcuts: Shortcuts // remembered per browser profile (localStorage)
  defaults: Defaults
  transport: TransportState | null // null until the first state arrives

  init(): void
  setDefaults(patch: Partial<Defaults>): void
  select(id: string, row?: string): Promise<void>
  newChat(projectId?: string | null): void
  notices: Notice[] // the bell's panel (main process keeps them; see notices.ts)
  noticesOpen: boolean
  setNoticesOpen(open: boolean): void
  send(text: string): Promise<void>
  interrupt(): Promise<void>
  stopTask(taskId: string): Promise<void>
  setPanel(panel: State['panel']): void
  toggleSidebar(): void
  toggleCollapsed(key: string): void
  setWidth(pane: keyof State['widths'], w: number): void
  openSettings(tab?: SettingsTab): void
  closeSettings(): void
  setSettings(s: NonNullable<State['settings']>): void
  setShortcut(action: ShortcutAction, index: number, combo: string): void // a combo moves here from any action that had it
  history: { views: View[]; at: number } // the places this window has been, for back and forward
  go(step: -1 | 1): void // back or forward through history
  fitPanes(): void // shrink the side panes until the conversation fits its composer (window resized, a label grew, a pane opened)
  answer(askId: string, answer: AskAnswer): Promise<void>
  update(id: string, patch: Parameters<Window['orc']['sessions']['update']>[1]): Promise<void>
  setDraft(text: string): void
  openPalette(mode?: State['palette']): void
  closePalette(): void
  addProject(): void // native folder dialog locally; the folder picker on a remote host
}

const api = () => window.orc

export type SettingsTab = 'general' | 'personalization' | 'shortcuts'

/** Where the window is: the open chat (or a new one, in a project), or a settings page. Back and forward step through these. */
export type View = Pick<State, 'activeId' | 'activeRow' | 'draftProjectId' | 'settings'>
const viewOf = (s: State): View => ({ activeId: s.activeId, activeRow: s.activeRow, draftProjectId: s.draftProjectId, settings: s.settings })
const sameView = (a: View | undefined, b: View) => JSON.stringify(a) === JSON.stringify(b)
let restoring = false // going back or forward: the move itself isn't a new place

function loadShortcuts(): Shortcuts {
  const d = defaultShortcuts()
  try { const saved = JSON.parse(localStorage.getItem('orc.shortcuts') ?? '{}'); for (const k of Object.keys(d) as ShortcutAction[]) if (Array.isArray(saved[k])) d[k] = saved[k] } catch { /* defaults */ }
  if (d.search.join() === 'Mod+P,Mod+K') d.search = ['Mod+P'] // the earlier default, saved untouched: Ctrl+K is no longer one
  return d
}
/** The application menu shows each action's first combo beside its item. */
const menuShortcuts = (s: Shortcuts) => window.orc.menu.shortcuts({ newChat: s.newChat[0], newWindow: s.newWindow[0], settings: s.settings[0] }).catch(() => {})

/** Side panes resize between these; the conversation takes the rest. */
export const PANE = { sidebar: { min: 220, max: 440, initial: 292 }, panel: { min: 280, max: 560, initial: 330 }, settings: { min: 220, max: 440, initial: 290 } } as const
/** The composer's side padding: a share of the conversation's width, between these bounds. */
export const COMPOSER_PAD = { min: 16, share: 0.08, max: 100 }
/** The narrowest the conversation may get: the composer's bottom row (mode, model, send) shown in full, plus that padding. */
function minMain(): number {
  const row = document.querySelector<HTMLElement>('[data-composer-row]')
  if (!row) return 360
  const cs = getComputedStyle(row), kids = [...row.children] as HTMLElement[]
  const content = kids.filter((k) => !k.dataset.spacer).reduce((a, k) => a + k.offsetWidth, 0) + (kids.length - 1) * (parseFloat(cs.columnGap) || 0)
  const box = content + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
  return Math.ceil(Math.max(box + 2 * COMPOSER_PAD.min, box / (1 - 2 * COMPOSER_PAD.share))) // whichever padding applies at that width
}
const saveWidths = (w: State['widths']) => { try { localStorage.setItem('orc.widths', JSON.stringify(w)) } catch { /* not persisted */ } }

function loadCollapsed(): Record<string, boolean> {
  try { const c = JSON.parse(localStorage.getItem('orc.collapsed') ?? '{}'); return c && typeof c === 'object' ? c : {} } catch { return {} }
}

function loadWidths(): State['widths'] {
  const clamp = (v: unknown, p: (typeof PANE)[keyof typeof PANE]) => (typeof v === 'number' ? Math.min(p.max, Math.max(p.min, v)) : p.initial)
  let w: Record<string, unknown> = {}
  try { w = JSON.parse(localStorage.getItem('orc.widths') ?? '{}') } catch { /* defaults */ }
  return { sidebar: clamp(w.sidebar, PANE.sidebar), panel: clamp(w.panel, PANE.panel), settings: clamp(w.settings, PANE.settings) }
}

export const useStore = create<State>((set, get) => ({
  projects: [], sessions: [], activeId: null, activeRow: null, draftProjectId: null, transcripts: {}, status: {}, models: [], account: null, draft: '', palette: null, panel: null, sidebarOpen: true, collapsed: loadCollapsed(), widths: loadWidths(), settings: null, shortcuts: loadShortcuts(), history: { views: [{ activeId: null, activeRow: null, draftProjectId: null, settings: null }], at: 0 },
  defaults: { approvalMode: 'ask', model: null, effort: null }, transport: null, notices: [], noticesOpen: false,
  setNoticesOpen(open) { set({ noticesOpen: open }) },

  init() {
    const loadModels = () => api().codecInfo().then((i) => { if (i.models.length) { set({ models: i.models, account: i.account }); api().settings.set('models', i.models) } })
    // Everything the engine knows is (re)fetched whenever the transport reports ready: at startup, and after a reconnect or take-over.
    const load = async () => {
      set({ transcripts: {}, status: {}, models: [], account: null })
      loadModels() // a short-lived process lists the models and their default effort; the cached list below covers the second it takes
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
      const id = get().activeId
      if (id) { set({ activeId: null }); get().select(id) }
      else if (!restored) { // reopened by an update's restart: where this window was
        restored = true
        const v = await api().window.restored()
        if (v?.activeId && sessions.some((x) => x.id === v.activeId)) get().select(v.activeId)
        else if (v?.settingsTab) get().openSettings(v.settingsTab as SettingsTab)
      }
    }
    let restored = false
    const onTransport = (t: TransportState) => { const was = get().transport?.phase; set({ transport: t }); if (t.phase === 'ready' && was !== 'ready') load() }
    api().on('transport:state', onTransport)
    api().transport.state().then((t) => { if (!get().transport) onTransport(t) }) // a state pushed before the page loaded would otherwise be lost; a push that beat this reply is newer
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
    })
    api().on('menu:new-chat', () => get().newChat())
    api().on('menu:settings', () => get().openSettings())
    api().on('menu:open-folder', () => get().addProject())
    api().notices.list().then((notices) => set({ notices }))
    api().on('notices:changed', (notices) => set({ notices }))
    api().on('notices:open', () => set({ noticesOpen: true, sidebarOpen: true, settings: null }))
    menuShortcuts(get().shortcuts)
  },

  setDefaults(patch) { Object.entries(patch).forEach(([k, v]) => api().settings.set(k, v)); set((s) => ({ defaults: { ...s.defaults, ...patch } })) },

  async select(id, row) {
    set((s) => ({ settings: null, activeId: id, activeRow: row ?? null, palette: null, panel: s.panel && { toolUseId: null } }))
    api().sessions.markRead(id)
    if (!get().transcripts[id]) {
      // Each reply is stored in its own microtask so a patch pushed in between can't be overwritten by a stale snapshot.
      const items = await api().sessions.open(id)
      set((s) => ({ transcripts: { ...s.transcripts, [id]: items } }))
      const status = await api().sessions.status(id)
      set((s) => ({ status: { ...s.status, [id]: status } }))
    }
  },

  // A project's own new-chat button passes it; every other way in (sidebar, Recents, menu, shortcut, palette) starts with no project.
  newChat(projectId = null) { set((s) => ({ settings: null, activeId: null, palette: null, panel: s.panel && { toolUseId: null }, draftProjectId: projectId })) },

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
  setPanel: (panel) => { set({ panel }); get().fitPanes() },
  toggleCollapsed(key) {
    const collapsed = { ...get().collapsed, [key]: !get().collapsed[key] }
    set({ collapsed }); try { localStorage.setItem('orc.collapsed', JSON.stringify(collapsed)) } catch { /* not persisted */ }
  },
  toggleSidebar: () => { set((s) => ({ sidebarOpen: !s.sidebarOpen })); get().fitPanes() },
  setWidth(pane, w) {
    const s = get(), other = pane === 'sidebar' ? (s.panel && s.activeId ? s.widths.panel : 0) : pane === 'panel' ? (s.sidebarOpen ? s.widths.sidebar : 0) : 0
    w = Math.max(PANE[pane].min, Math.min(w, innerWidth - other - minMain())) // never so wide the composer's bottom row would overflow (settings: leaves its page the same room)
    if (w === s.widths[pane]) return
    const widths = { ...s.widths, [pane]: w }; set({ widths }); saveWidths(widths)
  },
  openSettings: (tab = 'general') => set({ settings: { tab }, palette: null }),
  closeSettings: () => set({ settings: null }),
  setSettings: (settings) => set({ settings }),
  setShortcut(action, index, combo) {
    const cur = get().shortcuts
    const shortcuts = Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, v.filter((c) => c !== combo)])) as Shortcuts // no other action keeps it
    const list = [...cur[action]]; list[Math.min(index, list.length)] = combo
    shortcuts[action] = [...new Set(list)] // replaces the edited one; a copy elsewhere in this list goes
    set({ shortcuts }); menuShortcuts(shortcuts)
    try { localStorage.setItem('orc.shortcuts', JSON.stringify(shortcuts)) } catch { /* not persisted */ }
  },
  go(step) {
    const { views, at } = get().history
    let i = at + step
    while (views[i]?.activeId && !get().sessions.some((s) => s.id === views[i].activeId)) i += step // a chat deleted since: skip it
    const v = views[i]
    if (!v) return
    restoring = true
    set({ history: { views, at: i } })
    if (v.activeId && v.activeId !== get().activeId) get().select(v.activeId, v.activeRow ?? undefined) // loads its transcript
    set({ ...v, palette: null })
    restoring = false
  },
  fitPanes() {
    const s = get(), panel = !!(s.panel && s.activeId)
    let { sidebar, panel: p } = s.widths, over = (s.sidebarOpen ? sidebar : 0) + (panel ? p : 0) + minMain() - innerWidth
    if (over <= 0) return
    if (panel) { const d = Math.min(over, p - PANE.panel.min); p -= d; over -= d } // the right pane gives way first
    if (s.sidebarOpen && over > 0) sidebar -= Math.min(over, sidebar - PANE.sidebar.min)
    if (sidebar === s.widths.sidebar && p === s.widths.panel) return
    const widths = { ...s.widths, sidebar, panel: p }; set({ widths }); saveWidths(widths)
  },
  async answer(askId, answer) { await api().answerAsk(askId, answer) },
  async update(id, patch) { await api().sessions.update(id, patch) },
  setDraft: (draft) => set({ draft }),
  openPalette: (mode = 'chats') => set({ palette: mode }),
  closePalette: () => set({ palette: null }),
  addProject() { if (get().transport?.kind === 'remote') set({ palette: 'folders' }); else api().projects.add().then((p) => p && get().newChat(p.id)) }
}))

// Each move to another place is a step in history (forward history drops, like a browser's). Only the project a new chat
// drafts into changing (the project list arriving, or another project picked) updates the current step instead.
useStore.subscribe((s, prev) => {
  const v = viewOf(s)
  if (restoring || sameView(viewOf(prev), v)) return
  const { views, at } = s.history
  if (sameView(views[at], v)) return
  const draftOnly = sameView({ ...views[at], draftProjectId: v.draftProjectId }, v)
  const next = draftOnly ? [...views.slice(0, at), v] : [...views.slice(0, at + 1), v].slice(-100)
  useStore.setState({ history: { views: next, at: next.length - 1 } })
})

export const sessionTitle = (s: Session) => s.title ?? s.autoTitle ?? 'New chat'
export const useActive = () => {
  const { activeId, sessions, projects, draftProjectId } = useStore()
  const session = sessions.find((s) => s.id === activeId) ?? null
  return { session, project: projects.find((p) => p.id === (session?.projectId ?? draftProjectId)) ?? null }
}
