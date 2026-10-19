import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { Item, Patch, SessionStatus, TaskInfo } from '@shared/types'

/** Per-session reducer state: maps streaming blocks and tool ids to transcript item ids. */
export interface ReduceState {
  msgId: Record<string, string> // current streaming message per parent ('' = main thread)
  frames: Record<string, number>
  json: Record<string, string>
  toolItems: Record<string, string> // tool_use id → item id
  tasks: Record<string, TaskInfo> // keyed by tool item id; task events only carry a patch, so the whole object is kept here
  taskItems: Record<string, string> // task_id → tool item id
  shellTasks: Set<string> // task ids of backgrounded commands, whose output lives in a file
  times: Record<string, number> // saved history only: a tool_use's timestamp, and `<toolUseId>:end` for its subagent's last row
  turnStart: number
  lastError?: string
}

export const newReduceState = (): ReduceState => ({ msgId: {}, frames: {}, json: {}, toolItems: {}, tasks: {}, taskItems: {}, shellTasks: new Set(), times: {}, turnStart: Date.now() })

type Block = { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }
type Out = { patches: Patch[]; status?: Partial<SessionStatus>; readOutput?: { id: string; path: string } } // readOutput: a finished command's output file, for the codec to load into the tool result

const textOf = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b?.type === 'text' ? b.text : '')).join('') : ''

function blockItem(st: ReduceState, id: string, b: Block, parent: string | null, streaming: boolean): Item | null {
  switch (b.type) {
    case 'text': return { kind: 'text', id, text: b.text ?? '', streaming, parent }
    case 'thinking': return { kind: 'thinking', id, text: b.thinking ?? '', streaming, parent }
    case 'tool_use':
      st.toolItems[b.id!] = id
      return { kind: 'tool', id, toolUseId: b.id!, name: b.name ?? '?', input: b.input ?? {}, status: 'running', parent }
    default: return null
  }
}

/** Merge a task change into the tool item that spawned it. */
function setTask(st: ReduceState, patches: Patch[], id: string | undefined, partial: Partial<TaskInfo>): void {
  if (!id) return
  const task = { ...(st.tasks[id] ?? { id: '', status: 'running', background: false, startedAt: Date.now() }), ...partial } as TaskInfo
  st.tasks[id] = task
  if (task.id) st.taskItems[task.id] = id
  patches.push({ op: 'update', id, partial: { task } })
}

const TASK_END = { completed: 'done', failed: 'error', stopped: 'interrupted' } as const

/** Pure: raw SDK message → transcript patches and status changes. Used for live streams and saved history alike. */
export function reduce(st: ReduceState, msg: SDKMessage): Out {
  const patches: Patch[] = []
  const m = msg as Record<string, any>
  const parent: string | null = m.parent_tool_use_id ?? null

  switch (msg.type) {
    case 'stream_event': {
      const e = m.event, key = parent ?? ''
      if (e.type === 'message_start') { st.msgId[key] = e.message.id; if (!parent) return { patches, status: { state: 'running' } } } // the CLI starts turns on its own when background work finishes
      const id = `${st.msgId[key]}:${e.index}`
      if (e.type === 'content_block_start') {
        const item = blockItem(st, id, e.content_block, parent, true)
        if (item) patches.push({ op: 'upsert', item })
        if (e.content_block.type === 'tool_use') st.json[id] = ''
      } else if (e.type === 'content_block_delta') {
        const d = e.delta
        if (d.type === 'text_delta') patches.push({ op: 'append', id, text: d.text })
        else if (d.type === 'thinking_delta') patches.push({ op: 'append', id, text: d.thinking })
        else if (d.type === 'input_json_delta') st.json[id] = (st.json[id] ?? '') + d.partial_json
      } else if (e.type === 'content_block_stop') {
        if (id in st.json) {
          try { patches.push({ op: 'update', id, partial: { input: JSON.parse(st.json[id] || '{}') } }) } catch { /* partial json */ }
          delete st.json[id]
        } else patches.push({ op: 'update', id, partial: { streaming: false } })
      }
      break
    }
    case 'assistant': {
      const am = m.message, mid: string = am?.id ?? m.uuid
      const blocks: Block[] = Array.isArray(am?.content) ? am.content : []
      if (m.error) { st.lastError = textOf(blocks) || String(m.error); patches.push({ op: 'upsert', item: { kind: 'note', id: `${m.uuid}:err`, level: 'error', text: st.lastError } }); break }
      // Live: one frame per completed block, consecutive frames share message.id. History: all blocks in one frame.
      const base = blocks.length === 1 ? (st.frames[mid] = (st.frames[mid] ?? 0) + 1) - 1 : 0
      blocks.forEach((b, i) => {
        const item = blockItem(st, `${mid}:${base + i}`, b, parent, false)
        if (item) patches.push({ op: 'upsert', item })
        if (b.type === 'tool_use' && m.timestamp) st.times[b.id!] = Date.parse(m.timestamp)
      })
      if (parent && m.timestamp) st.times[`${parent}:end`] = Date.parse(m.timestamp)
      if (parent && am?.model && st.toolItems[parent] && !st.tasks[st.toolItems[parent]]?.model) setTask(st, patches, st.toolItems[parent], { model: am.model })
      break
    }
    case 'user': {
      if (m.isReplay) break
      const c = m.message?.content, tur = m.tool_use_result
      const results: any[] = Array.isArray(c) ? c.filter((b) => b?.type === 'tool_result') : []
      for (const r of results) {
        const id = st.toolItems[r.tool_use_id]
        if (!id) continue
        const text = textOf(tur?.content) || textOf(r.content) // an agent's own report beats the hand-back wrapper the model sees
        const launched = tur?.backgroundTaskId || tur?.status === 'async_launched' // placeholder result: the real outcome arrives as a task_notification
        if (launched) setTask(st, patches, id, { id: tur.backgroundTaskId ?? tur.agentId, background: true })
        else patches.push({ op: 'update', id, partial: { status: r.is_error ? 'error' : 'done', result: { text, isError: !!r.is_error, data: tur } } })
      }
      const text = textOf(c)
      if (results.length || !text || m.isSynthetic) break
      // The CLI's own relay prompts (saved rows lose the isSynthetic flag) only mark where a follow-up turn begins.
      if (/^<(task-notification|system-reminder)\b/.test(text)) patches.push({ op: 'upsert', item: { kind: 'turn_end', id: m.uuid ?? crypto.randomUUID(), durationMs: 0, isError: false } })
      else patches.push({ op: 'upsert', item: { kind: 'user', id: m.uuid ?? crypto.randomUUID(), text, parent } }) // with parent: the prompt a subagent was given
      break
    }
    case 'result': {
      const isError = !!m.is_error || m.subtype !== 'success'
      const text: string = m.result || (m.errors ?? []).join('\n') || m.subtype
      // The assistant error frame already showed this text; don't print it twice.
      if (isError && !(st.lastError && text.includes(st.lastError))) patches.push({ op: 'upsert', item: { kind: 'note', id: `${m.uuid}:err`, level: 'error', text } })
      patches.push({ op: 'upsert', item: { kind: 'turn_end', id: m.uuid, durationMs: m.duration_ms ?? Date.now() - st.turnStart, isError } })
      st.turnStart = Date.now(); st.lastError = undefined
      return { patches, status: { state: 'idle' } }
    }
    case 'system':
      switch (m.subtype) {
        case 'init': return { patches, status: { model: m.model } }
        case 'session_state_changed': return { patches, status: { state: m.state } }
        case 'compact_boundary': patches.push({ op: 'upsert', item: { kind: 'note', id: m.uuid, level: 'info', text: 'Context compacted' } }); break
        case 'task_started':
          if (m.skip_transcript) break
          if (m.task_type === 'local_bash') st.shellTasks.add(m.task_id)
          setTask(st, patches, st.toolItems[m.tool_use_id], { id: m.task_id, status: 'running', background: !!m.is_backgrounded, startedAt: Date.now() })
          break
        case 'task_progress': setTask(st, patches, st.toolItems[m.tool_use_id], { summary: m.summary ?? m.description }); break
        case 'task_notification': {
          const id = st.taskItems[m.task_id] ?? (m.tool_use_id && st.toolItems[m.tool_use_id])
          if (!id) break
          const status = (m.status in TASK_END ? m.status : 'failed') as keyof typeof TASK_END
          const endedAt = Date.now(), dur = m.usage?.duration_ms
          setTask(st, patches, id, { status, endedAt, summary: m.summary, ...(dur ? { startedAt: endedAt - dur } : {}) })
          if (!st.tasks[id].background) break
          patches.push({ op: 'update', id, partial: { status: TASK_END[status], result: { text: m.summary ?? '', isError: status !== 'completed' } } })
          if (st.shellTasks.has(m.task_id) && m.output_file) return { patches, readOutput: { id, path: m.output_file } }
          break
        }
        case 'background_tasks_changed': return { patches, status: { tasks: (m.tasks as { ambient?: boolean }[]).filter((t) => !t.ambient).length } }
      }
      break
    case 'rate_limit_event': {
      const r = m.rate_limit_info
      return { patches, status: { rateLimit: r.status === 'allowed' ? undefined : { status: r.status, utilization: r.utilization, resetsAt: r.resetsAt } } }
    }
  }
  return { patches }
}
