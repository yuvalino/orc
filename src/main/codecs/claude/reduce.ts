import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { Item, Patch, SessionStatus } from '@shared/types'

/** Per-session reducer state: maps streaming blocks and tool ids to transcript item ids. */
export interface ReduceState {
  msgId: string
  frames: Record<string, number>
  json: Record<string, string>
  toolItems: Record<string, string>
  turnStart: number
  lastError?: string
}

export const newReduceState = (): ReduceState => ({ msgId: '', frames: {}, json: {}, toolItems: {}, turnStart: Date.now() })

type Block = { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }
type Out = { patches: Patch[]; status?: Partial<SessionStatus> }

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

/** Pure: raw SDK message → transcript patches and status changes. Used for live streams and saved history alike. */
export function reduce(st: ReduceState, msg: SDKMessage): Out {
  const patches: Patch[] = []
  const m = msg as Record<string, any>

  switch (msg.type) {
    case 'stream_event': {
      const e = m.event, parent = m.parent_tool_use_id ?? null
      if (e.type === 'message_start') st.msgId = e.message.id
      const id = `${st.msgId}:${e.index}`
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
      const am = m.message, mid: string = am?.id ?? m.uuid, parent = m.parent_tool_use_id ?? null
      const blocks: Block[] = Array.isArray(am?.content) ? am.content : []
      if (m.error) { st.lastError = textOf(blocks) || String(m.error); patches.push({ op: 'upsert', item: { kind: 'note', id: `${m.uuid}:err`, level: 'error', text: st.lastError } }); break }
      // Live: one frame per completed block, consecutive frames share message.id. History: all blocks in one frame.
      const base = blocks.length === 1 ? (st.frames[mid] = (st.frames[mid] ?? 0) + 1) - 1 : 0
      blocks.forEach((b, i) => {
        const item = blockItem(st, `${mid}:${base + i}`, b, parent, false)
        if (item) patches.push({ op: 'upsert', item })
      })
      break
    }
    case 'user': {
      if (m.isReplay) break
      const c = m.message?.content
      const results: any[] = Array.isArray(c) ? c.filter((b) => b?.type === 'tool_result') : []
      for (const r of results) {
        const id = st.toolItems[r.tool_use_id]
        if (!id) continue
        const text = textOf(r.content)
        patches.push({ op: 'update', id, partial: { status: r.is_error ? 'error' : 'done', result: { text, isError: !!r.is_error, data: m.tool_use_result } } })
      }
      const text = textOf(c)
      if (!results.length && text && !m.isSynthetic) patches.push({ op: 'upsert', item: { kind: 'user', id: m.uuid ?? crypto.randomUUID(), text } })
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
      if (m.subtype === 'init') return { patches, status: { model: m.model } }
      if (m.subtype === 'session_state_changed') return { patches, status: { state: m.state } }
      if (m.subtype === 'compact_boundary') patches.push({ op: 'upsert', item: { kind: 'note', id: m.uuid, level: 'info', text: 'Context compacted' } })
      break
    case 'rate_limit_event': {
      const r = m.rate_limit_info
      return { patches, status: { rateLimit: r.status === 'allowed' ? undefined : { status: r.status, utilization: r.utilization, resetsAt: r.resetsAt } } }
    }
  }
  return { patches }
}
