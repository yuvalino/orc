import { homedir } from 'os'
import type { ApprovalMode, AskAnswer, Item, Patch, Session, SessionStatus, ToolStatus } from '@shared/types'
import { applyPatch } from '@shared/types'
import type { PushEvents } from '@shared/api'
import type { CodecSession } from './codecs/types'
import { getCodec } from './codecs/registry'
import { projects, sessions, settings } from './store'

const MAX_OPEN = 4
const IDLE_MS = () => (Number(settings.get('idleMinutes')) || 10) * 60_000

interface Entry {
  items: Item[]
  hasTranscript: boolean
  status: SessionStatus
  live: CodecSession | null
  asks: Map<string, { resolve: (a: AskAnswer) => void; toolUseId: string }>
  idleTimer?: ReturnType<typeof setTimeout>
  stopping?: boolean
}

export type Push = <K extends keyof PushEvents>(channel: K, payload: PushEvents[K]) => void

/** Owns every open conversation: one long-lived codec session each, the transcript, and pending asks. */
export class Engine {
  private entries = new Map<string, Entry>()
  constructor(private push: Push) {}

  private session(id: string): Session {
    const s = sessions.find(id)
    if (!s) throw new Error(`Session not found: ${id}`)
    return s
  }
  private cwd(s: Session): string {
    if (!s.projectId) return homedir()
    const p = projects.find(s.projectId)
    if (!p) throw new Error(`Project not found: ${s.projectId}`)
    return p.path
  }

  async open(id: string): Promise<Item[]> {
    let e = this.entries.get(id)
    if (!e) {
      const s = this.session(id)
      const items = await getCodec(s.codec).loadTranscript(id, this.cwd(s))
      e = { items, hasTranscript: items.length > 0, status: { state: 'closed' }, live: null, asks: new Map() }
      this.entries.set(id, e)
      if (e.items.length && !s.autoTitle) void this.refreshTitle(id)
    }
    return e.items
  }

  status(id: string): SessionStatus { return this.entries.get(id)?.status ?? { state: 'closed' } }

  async send(id: string, text: string): Promise<void> {
    const s = this.session(id), e = this.entries.get(id) ?? (await this.open(id), this.entries.get(id)!)
    const uuid = crypto.randomUUID()
    this.apply(id, e, { op: 'upsert', item: { kind: 'user', id: uuid, text } })
    if (!e.live) {
      try { await this.start(s, e) } catch (err) {
        this.apply(id, e, { op: 'upsert', item: { kind: 'note', id: crypto.randomUUID(), level: 'error', text: `Could not start ${s.codec}: ${err instanceof Error ? err.message : err}` } })
        this.setStatus(id, e, { state: 'closed' })
        return
      }
    }
    this.setStatus(id, e, { state: 'running' })
    this.touch(id)
    e.live!.send(text, uuid)
  }

  private async start(s: Session, e: Entry): Promise<void> {
    const open = [...this.entries].filter(([, x]) => x.live)
    if (open.length >= MAX_OPEN) {
      const victim = open.filter(([, x]) => x.status.state === 'idle' && !x.status.tasks).sort((a, b) => this.session(a[0]).lastActivityAt - this.session(b[0]).lastActivityAt)[0]
      if (victim) this.close(victim[0])
    }
    this.setStatus(s.id, e, { state: 'starting' })
    e.live = await getCodec(s.codec).open(
      { sessionId: s.id, cwd: this.cwd(s), resume: e.hasTranscript, approvalMode: s.approvalMode, model: s.model ?? undefined, effort: s.effort ?? undefined },
      {
        patch: (p) => this.apply(s.id, e, p),
        status: (st) => this.setStatus(s.id, e, st),
        ask: (ask, signal) => new Promise<AskAnswer>((resolve) => {
          e.asks.set(ask.id, { resolve, toolUseId: ask.toolUseId })
          this.setTool(s.id, e, ask.toolUseId, 'awaiting_approval')
          this.apply(s.id, e, { op: 'upsert', item: { kind: 'ask', id: ask.id, ask } })
          this.setStatus(s.id, e, { state: 'requires_action' })
          signal.addEventListener('abort', () => {
            if (!e.asks.delete(ask.id)) return
            this.apply(s.id, e, { op: 'update', id: ask.id, partial: { cancelled: true } })
            this.setTool(s.id, e, ask.toolUseId, 'interrupted')
            resolve({ type: 'permission', decision: 'deny', message: 'Interrupted' })
          })
        })
      }
    )
  }

  answerAsk(askId: string, answer: AskAnswer): void {
    for (const [id, e] of this.entries) {
      const pending = e.asks.get(askId)
      if (!pending) continue
      e.asks.delete(askId)
      pending.resolve(answer)
      const denied = (answer.type === 'permission' && answer.decision === 'deny') || (answer.type === 'plan' && answer.decision === 'reject')
      this.apply(id, e, { op: 'update', id: askId, partial: { answer } })
      this.setTool(id, e, pending.toolUseId, denied ? 'denied' : 'running')
      if (answer.type === 'plan' && !denied) this.setApprovalMode(id, answer.decision === 'approve-edits' ? 'accept-edits' : 'ask', false)
      if (e.asks.size === 0) this.setStatus(id, e, { state: 'running' })
      return
    }
  }

  async interrupt(id: string): Promise<void> {
    const e = this.entries.get(id)
    if (e?.live) { e.stopping = true; await e.live.interrupt() }
  }

  async setApprovalMode(id: string, mode: ApprovalMode, propagate = true): Promise<void> {
    sessions.update(id, { approvalMode: mode })
    this.push('sessions:changed', sessions.list())
    if (propagate) await this.entries.get(id)?.live?.setApprovalMode(mode)
  }

  async setModel(id: string, model: string | null): Promise<void> {
    sessions.update(id, { model })
    this.push('sessions:changed', sessions.list())
    await this.entries.get(id)?.live?.setModel(model ?? undefined)
  }

  async setEffort(id: string, effort: string | null): Promise<void> {
    sessions.update(id, { effort })
    this.push('sessions:changed', sessions.list())
    await this.entries.get(id)?.live?.setEffort(effort ?? undefined)
  }

  async stopTask(id: string, taskId: string): Promise<void> { await this.entries.get(id)?.live?.stopTask(taskId) }

  async rename(id: string, title: string): Promise<void> {
    const s = sessions.update(id, { title })!
    this.push('sessions:changed', sessions.list())
    await getCodec(s.codec).rename(id, this.cwd(s), title)
  }

  async remove(id: string): Promise<void> {
    this.close(id)
    const s = this.session(id)
    sessions.remove(id)
    this.entries.delete(id)
    this.push('sessions:changed', sessions.list())
    await getCodec(s.codec).remove(id, this.cwd(s))
  }

  async info() {
    const live = [...this.entries.values()].find((e) => e.live)
    return live?.live ? live.live.info() : { models: [], account: null }
  }

  close(id: string): void {
    const e = this.entries.get(id)
    if (!e?.live) return
    for (const [, a] of e.asks) a.resolve({ type: 'permission', decision: 'deny', message: 'Session closed' })
    e.asks.clear()
    clearTimeout(e.idleTimer)
    e.live.close()
    e.live = null
    this.setStatus(id, e, { state: 'closed' })
  }

  closeAll(): void { for (const id of this.entries.keys()) this.close(id) }

  /** Fill in titles for chats whose transcript the codec already has (e.g. created before a restart). */
  hydrateTitles(): void { for (const s of sessions.list()) if (!s.title && !s.autoTitle) void this.refreshTitle(s.id) }

  private apply(id: string, e: Entry, p: Patch): void {
    if (p.op === 'upsert' && p.item.kind === 'turn_end') {
      if (e.stopping) { p = { op: 'upsert', item: { ...p.item, stopped: true } }; e.stopping = false }
      e.hasTranscript = true
      this.touch(id)
      void this.refreshTitle(id)
    }
    e.items = applyPatch(e.items, p)
    this.push('transcript:patch', { sessionId: id, patch: p })
  }

  private setTool(id: string, e: Entry, toolUseId: string, status: ToolStatus): void {
    const t = e.items.find((i) => i.kind === 'tool' && i.toolUseId === toolUseId)
    if (t) this.apply(id, e, { op: 'update', id: t.id, partial: { status } })
  }

  private setStatus(id: string, e: Entry, st: Partial<SessionStatus>): void {
    e.status = { ...e.status, ...st }
    if ('rateLimit' in st && !st.rateLimit) delete e.status.rateLimit
    if (st.state === 'closed') { e.live = null; e.status.tasks = 0 }
    clearTimeout(e.idleTimer)
    if (e.status.state === 'idle' && !e.status.tasks) e.idleTimer = setTimeout(() => this.close(id), IDLE_MS()) // background work keeps the process alive
    this.push('session:status', { sessionId: id, status: e.status })
  }

  private touch(id: string): void {
    sessions.update(id, { lastActivityAt: Date.now() })
    this.push('sessions:changed', sessions.list())
  }

  private async refreshTitle(id: string): Promise<void> {
    const s = sessions.find(id)
    if (!s) return
    const info = await getCodec(s.codec).sessionInfo(id, this.cwd(s))
    if (info?.title && info.title !== s.autoTitle) {
      sessions.update(id, { autoTitle: info.title })
      this.push('sessions:changed', sessions.list())
    }
  }
}
