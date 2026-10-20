import type { Account, ApprovalMode, Ask, AskAnswer, Item, ModelOption, Patch, SessionStatus } from '@shared/types'

export interface Sink {
  patch(p: Patch): void
  status(s: Partial<SessionStatus>): void
  ask(a: Ask, signal: AbortSignal): Promise<AskAnswer>
}

export interface OpenParams {
  sessionId: string
  cwd: string
  resume: boolean
  approvalMode: ApprovalMode
  model?: string
  effort?: string
}

export interface CodecSession {
  send(text: string, uuid: string): void
  interrupt(): Promise<void>
  stopTask(taskId: string): Promise<void>
  setApprovalMode(mode: ApprovalMode): Promise<void>
  setModel(model?: string): Promise<void>
  setEffort(effort?: string): Promise<void>
  close(): void
}

/** A backend ("codec") turns an agent SDK into transcript patches and asks. */
export interface Codec {
  readonly id: string
  readonly displayName: string
  open(params: OpenParams, sink: Sink): Promise<CodecSession>
  info(cwd: string): Promise<{ models: ModelOption[]; account: Account | null }> // from a short-lived process that never sends a prompt
  loadTranscript(sessionId: string, cwd: string): Promise<Item[]>
  sessionInfo(sessionId: string, cwd: string): Promise<{ title?: string } | undefined>
  rename(sessionId: string, cwd: string, title: string): Promise<void>
  remove(sessionId: string, cwd: string): Promise<void>
}
