import { homedir } from 'os'
import type { ApprovalMode, Ask, AskAnswer, Item, Patch, RuntimeState, Session, SessionStatus, ToolStatus } from '@shared/types'
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
  asks: Map<string, { resolve: (a: AskAnswer) => void; ask: Ask }>
  idleTimer?: ReturnType<typeof setTimeout>
  stopping?: boolean
  gen: number // which codec process the sink callbacks belong to; a late 'closed' from an old one is ignored
  resumeState?: RuntimeState // the state an ask interrupted, restored once every ask is answered
}

export type Push = <K extends keyof PushEvents>(channel: K, payload: PushEvents[K]) => void

/** Owns every open conversation: one long-lived codec session each, the transcript, and pending asks. */
export class Engine {
  private entries = new Map<string, Entry>()
  private opening = new Map<string, Promise<Item[]>>() // in-flight transcript loads, so two opens share one entry
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
    const e = this.entries.get(id)
    if (e) return e.items
    let p = this.opening.get(id)
    if (!p) {
      p = (async () => {
        const s = this.session(id)
        const items = await getCodec(s.codec).loadTranscript(id, this.cwd(s))
        this.entries.set(id, { items, hasTranscript: items.length > 0, status: { state: 'closed' }, live: null, asks: new Map(), gen: 0 })
        if (items.length && !s.autoTitle) void this.refreshTitle(id)
        return items
      })()
      this.opening.set(id, p)
      p.finally(() => this.opening.delete(id)).catch(() => {})
    }
    return p
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
    this.setStatus(id, e, { state: 'running' }) // kept as requires_action while an ask is pending; see setStatus
    this.touch(id)
    e.live!.send(text, uuid)
    e.hasTranscript = true // the CLI persists the session on the first prompt; a restart must resume it, not reuse the id
  }

  private async start(s: Session, e: Entry): Promise<void> {
    const open = [...this.entries].filter(([, x]) => x.live)
    if (open.length >= MAX_OPEN) {
      const victim = open.filter(([, x]) => x.status.state === 'idle' && !x.status.tasks).sort((a, b) => this.session(a[0]).lastActivityAt - this.session(b[0]).lastActivityAt)[0]
      if (victim) this.close(victim[0])
    }
    this.setStatus(s.id, e, { state: 'starting' })
    const gen = ++e.gen
    e.live = await getCodec(s.codec).open(
      { sessionId: s.id, cwd: this.cwd(s), resume: e.hasTranscript, approvalMode: s.approvalMode, model: s.model ?? undefined, effort: s.effort ?? undefined },
      {
        patch: (p) => { if (gen === e.gen) this.apply(s.id, e, p) },
        status: (st) => { if (gen === e.gen) this.setStatus(s.id, e, st) },
        ask: (ask, signal) => new Promise<AskAnswer>((resolve) => {
          if (gen !== e.gen) return resolve({ type: 'permission', decision: 'deny', message: 'Session closed' })
          e.asks.set(ask.id, { resolve, ask })
          this.setTool(s.id, e, ask.toolUseId, 'awaiting_approval')
          this.apply(s.id, e, { op: 'upsert', item: { kind: 'ask', id: ask.id, ask } })
          if (e.status.state !== 'requires_action') e.resumeState = e.status.state
          this.setStatus(s.id, e, { state: 'requires_action' })
          signal.addEventListener('abort', () => {
            if (!e.asks.delete(ask.id)) return
            this.apply(s.id, e, { op: 'update', id: ask.id, partial: { cancelled: true } })
            this.setTool(s.id, e, ask.toolUseId, 'interrupted')
            resolve({ type: 'permission', decision: 'deny', message: 'Interrupted' })
            if (e.asks.size === 0) this.resume(s.id, e)
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
      this.setTool(id, e, pending.ask.toolUseId, denied ? 'denied' : 'running')
      // The codec switched mode on the user's behalf; keep the session in step so the composer says so and asks stop.
      // Re-sending the mode the CLI already switched to is idempotent and keeps the codec's own record of it current.
      if (answer.type === 'plan' && !denied) { // plain approve only leaves plan mode; the mode the chat had before stays
        if (answer.decision === 'approve-edits') this.setApprovalMode(id, 'accept-edits')
        else if (this.session(id).approvalMode === 'read-only') this.setApprovalMode(id, 'ask')
      }
      if (answer.type === 'permission' && answer.decision === 'always' && pending.ask.type === 'permission' && pending.ask.alwaysMode) this.setApprovalMode(id, pending.ask.alwaysMode)
      if (e.asks.size === 0) this.resume(id, e)
      return
    }
  }

  /** Every ask answered: back to whatever the asks interrupted. */
  private resume(id: string, e: Entry): void {
    const state = e.live ? e.resumeState ?? 'running' : 'closed'
    e.resumeState = undefined
    this.setStatus(id, e, { state })
  }

  async interrupt(id: string): Promise<void> {
    const e = this.entries.get(id)
    if (e?.live && e.status.state === 'running') { e.stopping = true; await e.live.interrupt() }
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

  /** Unread lives on the session so every window agrees and it survives an idle close; the window showing a chat clears it. */
  markRead(id: string): void { if (sessions.find(id)?.unread) { sessions.update(id, { unread: false }); this.push('sessions:changed', sessions.list()) } }

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
    clearTimeout(e.idleTimer)
    e.live.close()
    e.live = null
    this.setStatus(id, e, { state: 'closed' }) // settles pending asks and tools
  }

  closeAll(): void { this.shuttingDown = true; for (const id of this.entries.keys()) this.close(id); this.shuttingDown = false }
  private shuttingDown = false // our own shutdown must not dot every chat that happened to be running

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

  /** The process is gone: nothing still marked running will ever finish, and no ask can be answered. */
  private settle(id: string, e: Entry): void {
    for (const [askId, a] of e.asks) {
      a.resolve({ type: 'permission', decision: 'deny', message: 'Session closed' })
      this.apply(id, e, { op: 'update', id: askId, partial: { cancelled: true } })
    }
    e.asks.clear(); e.resumeState = undefined; e.stopping = false
    for (const i of e.items) {
      if ('streaming' in i && i.streaming) this.apply(id, e, { op: 'update', id: i.id, partial: { streaming: false } })
      if (i.kind !== 'tool' || (i.status !== 'running' && i.status !== 'awaiting_approval')) continue
      this.apply(id, e, { op: 'update', id: i.id, partial: { status: 'interrupted', ...(i.task?.status === 'running' ? { task: { ...i.task, status: 'stopped', endedAt: Date.now() } } : {}) } })
    }
  }

  private setTool(id: string, e: Entry, toolUseId: string, status: ToolStatus): void {
    const t = e.items.find((i) => i.kind === 'tool' && i.toolUseId === toolUseId)
    if (t) this.apply(id, e, { op: 'update', id: t.id, partial: { status } })
  }

  private setStatus(id: string, e: Entry, st: Partial<SessionStatus>): void {
    if (e.asks.size && (st.state === 'running' || st.state === 'idle')) { e.resumeState = st.state; st = { ...st, state: 'requires_action' } } // an unanswered ask keeps the "needs you" signal
    const finished = e.status.state === 'running' && (st.state === 'idle' || (st.state === 'closed' && !this.shuttingDown))
    e.status = { ...e.status, ...st }
    if (finished) { sessions.update(id, { unread: true }); this.push('sessions:changed', sessions.list()) } // a window that shows this chat marks it read at once
    if ('rateLimit' in st && !st.rateLimit) delete e.status.rateLimit
    if (st.state === 'closed') { e.live = null; e.status.tasks = 0; this.settle(id, e) }
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
