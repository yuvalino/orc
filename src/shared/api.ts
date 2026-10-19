import type { Account, ApprovalMode, AskAnswer, Item, ModelOption, Patch, Project, Session, SessionStatus } from './types'

export interface PushEvents {
  'transcript:patch': { sessionId: string; patch: Patch }
  'session:status': { sessionId: string; status: SessionStatus }
  'sessions:changed': Session[]
  'projects:changed': Project[]
  'menu:new-chat': undefined
  'transport:state': TransportState
}

/** How this window reaches its engine, and whether that engine is ours to use. */
export interface TransportState {
  kind: 'local' | 'remote'
  host?: string
  phase: 'connecting' | 'starting' | 'busy' | 'ready' | 'disconnected' | 'error' | 'taken-over' | 'prompt' | 'installing'
  holder?: { client: { host: string; user: string }; since: number; kind: 'local' | 'server' } // phase busy
  by?: { host: string; user: string } // phase taken-over
  prompt?: string // phase prompt: what ssh is asking (password, passphrase, 2FA, host key)
  notice?: boolean // phase prompt: nothing to type, ssh is waiting on something else (a security key touch)
  install?: 'downloading' | 'verifying' | 'unpacking' // phase installing: the first connect puts orc-server on the host
  error?: string
  clockOffset: number // server clock minus ours
}

export interface OrcApi {
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
