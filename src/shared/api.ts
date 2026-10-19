import type { Account, ApprovalMode, AskAnswer, Item, ModelOption, Patch, Project, Session, SessionStatus } from './types'

export interface PushEvents {
  'transcript:patch': { sessionId: string; patch: Patch }
  'session:status': { sessionId: string; status: SessionStatus }
  'sessions:changed': Session[]
  'projects:changed': Project[]
  'menu:new-chat': undefined
}

export interface OrcApi {
  projects: {
    list(): Promise<Project[]>
    add(): Promise<Project | null>
    remove(id: string): Promise<void>
    files(id: string, query: string): Promise<string[]>
  }
  sessions: {
    list(): Promise<Session[]>
    create(projectId: string | null): Promise<Session>
    open(id: string): Promise<Item[]>
    send(id: string, text: string): Promise<void>
    interrupt(id: string): Promise<void>
    stopTask(id: string, taskId: string): Promise<void>
    update(id: string, patch: Partial<Pick<Session, 'title' | 'isPinned' | 'approvalMode' | 'model' | 'effort'>>): Promise<void>
    remove(id: string): Promise<void>
    status(id: string): Promise<SessionStatus>
  }
  answerAsk(askId: string, answer: AskAnswer): Promise<void>
  codecInfo(): Promise<{ models: ModelOption[]; account: Account | null }>
  settings: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }
  on<K extends keyof PushEvents>(channel: K, cb: (payload: PushEvents[K]) => void): () => void
}

declare global {
  interface Window { orc: OrcApi }
}
