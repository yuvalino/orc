import type { Account, ApprovalMode, AskAnswer, Item, ModelOption, Patch, Project, Session, SessionStatus } from './types'

export interface PushEvents {
  'transcript:patch': { sessionId: string; patch: Patch }
  'session:status': { sessionId: string; status: SessionStatus }
  'sessions:changed': Session[]
  'projects:changed': Project[]
  'menu:new-chat': undefined
  'menu:settings': undefined
  'menu:open-folder': undefined
  'transport:state': TransportState
  'updates:prefs': UpdatePrefs
  'notices:changed': Notice[]
  'notices:open': undefined // Check for updates: show the panel with its result
}

/** How regular Orc updates itself (Settings → General). Orc Offline has no updater; it shows these greyed out. */
export interface UpdatePrefs { auto: boolean; beta: boolean }

/**
 * The notifications panel (the bell): in memory only, the same in every window of an instance. For now, only updates:
 * found (automatic updates off, or a platform Orc can't install on: a link instead), downloading, ready, failed, and a
 * manual check's "up to date".
 */
export type Notice = { id: string } & (
  | { kind: 'update-available'; version: string; url?: string; move?: boolean } // url: get it from the release page (no updater here); move: Orc must move to Applications first (macOS)
  | { kind: 'update-downloading'; version: string; transferred: number; total: number; bytesPerSecond: number }
  | { kind: 'update-ready'; version: string }
  | { kind: 'update-failed'; version?: string; message: string }
  | { kind: 'update-current'; version: string }
)

/** A window's view, kept across an update's restart. */
export interface RestoredView { activeId: string | null; settingsTab: string | null }

/** What a restart would interrupt, across every Orc window (remote hosts' too): chat titles, and how many composers hold unsent text. */
export interface Activity { working: string[]; waiting: string[]; drafts: number }

/** The one-time install of orc-server on a host: downloaded there (regular edition) or sent from this app (offline edition). */
export type InstallPhase = 'downloading' | 'uploading' | 'verifying' | 'unpacking'
/** How this window reaches its engine, and whether that engine is ours to use. */
export interface TransportState {
  kind: 'local' | 'remote'
  host?: string
  phase: 'connecting' | 'starting' | 'busy' | 'ready' | 'disconnected' | 'error' | 'taken-over' | 'prompt' | 'installing'
  holder?: { client: { host: string; user: string }; since: number; kind: 'local' | 'server' } // phase busy
  by?: { host: string; user: string } // phase taken-over
  prompt?: string // phase prompt: what ssh is asking (password, passphrase, 2FA, host key)
  notice?: boolean // phase prompt: nothing to type, ssh is waiting on something else (a security key touch)
  install?: InstallPhase // phase installing: the first connect puts orc-server on the host
  error?: string
  clockOffset: number // server clock minus ours
}

/** The application menu as the in-window menu bar draws it. */
export interface MenuBarMenu { label: string; items: ({ separator: true } | { separator?: undefined; label: string; enabled: boolean; accelerator?: string })[] }

export interface OrcApi {
  platform: string // window chrome differs per OS
  menu: { items(): Promise<MenuBarMenu[]>; run(menu: string, index: number): Promise<void>; shortcuts(map: Record<string, string | undefined>): Promise<void> } // items/run: the application menu, for the in-window menu bar off macOS; shortcuts: the labels its items show (the window handles the keys)
  projects: {
    list(): Promise<Project[]>
    add(path?: string): Promise<Project | null> // no path: the desktop shows its folder dialog (local targets only)
    remove(id: string): Promise<void>
    files(id: string, query: string): Promise<string[]>
    browse(path?: string): Promise<{ path: string; dirs: string[]; parent: string | null }> // the remote folder picker
  }
  sessions: {
    list(): Promise<Session[]>
    create(projectId: string | null): Promise<Session>
    open(id: string): Promise<Item[]>
    send(id: string, text: string): Promise<void>
    interrupt(id: string): Promise<void>
    stopTask(id: string, taskId: string): Promise<void>
    markRead(id: string): Promise<void>
    update(id: string, patch: Partial<Pick<Session, 'title' | 'isPinned' | 'approvalMode' | 'model' | 'effort'>>): Promise<void>
    remove(id: string): Promise<void>
    status(id: string): Promise<SessionStatus>
  }
  answerAsk(askId: string, answer: AskAnswer): Promise<void>
  codecInfo(): Promise<{ models: ModelOption[]; account: Account | null }>
  settings: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }
  instructions: { get(): Promise<{ path: string; text: string | null }>; set(text: string): Promise<void> } // the user's CLAUDE.md on the engine's machine; text null: no file yet
  window: { open(): Promise<void>; quit(): Promise<void>; restored(): Promise<RestoredView | null> } // open: another window on this instance; quit: the whole app; restored: this window's view from before an update's restart
  updates: {
    prefs(): Promise<UpdatePrefs>
    setPrefs(patch: Partial<UpdatePrefs>): Promise<UpdatePrefs> // app-wide, shared by every window and instance
    check(): Promise<void> // Help → Check for updates…: results land in the notifications
    download(): Promise<void> // automatic updates off: fetch the one found
    cancel(): Promise<void>
    restart(): Promise<void> // Restart to update: asks first (a dialog) when it would interrupt something
    pending(): Promise<{ version: string; activity: Activity } | null> // for that dialog
    restartNow(): Promise<void> // the dialog's confirmation
    moveToApplications(): Promise<void> // macOS, run from outside Applications: move there (and relaunch) to be able to update
  }
  notices: { list(): Promise<Notice[]>; dismiss(id: string): Promise<void>; takeOpen(): Promise<boolean> }
  activity: { report(a: Activity): Promise<void>; input(): Promise<void> } // a window's part in "idle": its chats and drafts, and that you used it
  transport: {
    state(): Promise<TransportState>
    takeover(): Promise<void>
    reconnect(): Promise<void>
    hosts(): Promise<string[]> // recent + ~/.ssh/config
    open(host: string): Promise<void> // a new window (instance) for that host
    answer(text: string | null): Promise<void> // reply to a prompt (null cancels)
    signIn(token: string | null): Promise<void> // store (or forget) the token for remote hosts
    signedIn(): Promise<boolean>
  }
  on<K extends keyof PushEvents>(channel: K, cb: (payload: PushEvents[K]) => void): () => void
}

declare global {
  interface Window { orc: OrcApi }
}
