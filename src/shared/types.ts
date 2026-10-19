export interface Project {
  id: string
  path: string
  name: string | null
  isPinned: boolean
  createdAt: number
}

/** App-level approval vocabulary; each codec maps it to its own permission model. */
export type ApprovalMode = 'read-only' | 'ask' | 'auto' | 'accept-edits' | 'full-access'

export interface Session {
  id: string
  projectId: string | null // null: no linked project, runs in the home folder
  codec: string
  title: string | null
  autoTitle: string | null
  isPinned: boolean
  createdAt: number
  lastActivityAt: number
  approvalMode: ApprovalMode
  model: string | null
  effort?: string | null
}

export type RuntimeState = 'closed' | 'starting' | 'idle' | 'running' | 'requires_action'

export interface SessionStatus {
  state: RuntimeState
  model?: string
  tasks?: number // live subagents / background commands, which can outlast a turn
  rateLimit?: { status: 'allowed_warning' | 'rejected'; utilization?: number; resetsAt?: number }
}

export type ToolStatus = 'running' | 'awaiting_approval' | 'done' | 'error' | 'denied' | 'interrupted'

/** A subagent or background command spawned by a tool call; tracked by the codec's task events. */
export interface TaskInfo {
  id: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  background: boolean
  startedAt: number
  endedAt?: number
  summary?: string // live one-liner while running, outcome when done
  model?: string
}

export interface Question {
  question: string
  header?: string
  options: { label: string; description?: string }[]
  multiSelect?: boolean
}

export type Ask =
  | { type: 'permission'; id: string; toolUseId: string; toolName: string; input: unknown; title?: string; description?: string; canAlwaysAllow: boolean }
  | { type: 'question'; id: string; toolUseId: string; questions: Question[] }
  | { type: 'plan'; id: string; toolUseId: string; plan: string }

export type AskAnswer =
  | { type: 'permission'; decision: 'allow' | 'always' | 'deny'; message?: string }
  | { type: 'question'; answers: Record<string, string> }
  | { type: 'plan'; decision: 'approve' | 'approve-edits' | 'reject'; feedback?: string }

export type Item =
  | { kind: 'user'; id: string; text: string; parent?: string | null } // parent: the prompt a tool call gave its subagent
  | { kind: 'text'; id: string; text: string; streaming: boolean; parent: string | null }
  | { kind: 'thinking'; id: string; text: string; streaming: boolean; parent: string | null }
  | { kind: 'tool'; id: string; toolUseId: string; name: string; input: unknown; status: ToolStatus; parent: string | null; result?: { text: string; isError: boolean; data?: unknown }; task?: TaskInfo }
  | { kind: 'ask'; id: string; ask: Ask; answer?: AskAnswer; cancelled?: true }
  | { kind: 'note'; id: string; level: 'info' | 'error'; text: string }
  | { kind: 'turn_end'; id: string; durationMs: number; isError: boolean; stopped?: boolean }

export type Patch =
  | { op: 'reset'; items: Item[] }
  | { op: 'upsert'; item: Item }
  | { op: 'append'; id: string; text: string }
  | { op: 'update'; id: string; partial: Record<string, unknown> }

export function applyPatch(items: Item[], p: Patch): Item[] {
  switch (p.op) {
    case 'reset': return p.items
    case 'upsert': {
      const i = items.findIndex((x) => x.id === p.item.id)
      if (i < 0) return [...items, p.item]
      const next = items.slice(); next[i] = p.item; return next
    }
    case 'append': return items.map((x) => (x.id === p.id && 'text' in x ? { ...x, text: x.text + p.text } : x))
    case 'update': return items.map((x) => (x.id === p.id ? ({ ...x, ...p.partial } as Item) : x))
  }
}

export interface ModelOption { value: string; displayName: string; description?: string; effortLevels?: string[] }
export interface Account { email?: string; subscriptionType?: string }
