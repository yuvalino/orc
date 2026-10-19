import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { SdkModule } from '../claude/sdk'

/**
 * Scripted stand-in for the SDK, driven by recorded fixtures (see scripts/record-fixture.mjs).
 * Each user prompt selects `<dir>/<first-word>.jsonl`; a `{"__ask": …}` line replays a canUseTool call,
 * a `{"__sleep": ms}` line pauses (and ends the script early if a task was stopped meanwhile).
 */
export function createFakeSdk(dir: string): SdkModule {
  const titles: Record<string, string> = {}
  const lines = (name: string): any[] => {
    const f = join(dir, `${name}.jsonl`)
    return existsSync(f) ? readFileSync(f, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const query: SdkModule['query'] = ({ prompt, options = {} }) => {
    const sessionId = (options.resume ?? options.sessionId ?? 'fake') as string
    const out: SDKMessage[] = []; let wake: (() => void) | null = null; let closed = false; let interrupted = false; let stopped = false
    const emit = (m: any) => { out.push({ ...m, session_id: sessionId }); wake?.(); wake = null }
    const result = (extra = {}) => emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 42, uuid: crypto.randomUUID(), ...extra })

    const play = async (text: string) => {
      const name = text.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9-]/g, '')
      titles[sessionId] = `Chat about ${name}`
      let script = lines(name)
      if (!script.length) script = [{ type: 'assistant', uuid: crypto.randomUUID(), parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'text', text: `No fixture named ${name}` }] } }, { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, uuid: crypto.randomUUID() }]
      for (let i = 0; i < script.length; i++) {
        if (closed) return
        if (interrupted) { interrupted = false; result({ stop_reason: 'interrupted' }); emit({ type: 'system', subtype: 'session_state_changed', state: 'idle', uuid: crypto.randomUUID() }); return }
        const l = script[i]
        if (l.__ask) {
          const { toolName, input, options: o } = l.__ask
          const ac = new AbortController()
          const r = await options.canUseTool!(toolName, input, { ...o, signal: ac.signal })
          if (r?.behavior === 'deny') {
            emit({ type: 'user', uuid: crypto.randomUUID(), parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: o.toolUseID, is_error: true, content: r.message }] } })
            emit({ type: 'assistant', uuid: crypto.randomUUID(), parent_tool_use_id: null, message: { id: 'deny', content: [{ type: 'text', text: 'Understood, I will not do that.' }] } })
            while (i + 1 < script.length && script[i + 1].type !== 'result') i++
          }
          continue
        }
        if (l.__sleep) { await sleep(l.__sleep); if (stopped) return; continue }
        emit(l)
        if (l.type === 'stream_event') await sleep(15)
      }
    }

    ;(async () => {
      if (typeof prompt === 'string') await play(prompt)
      else for await (const m of prompt as AsyncIterable<SDKUserMessage>) { if (closed) break; await play(String(m.message.content)) }
    })()

    const q = {
      async *[Symbol.asyncIterator]() {
        while (!closed) {
          if (out.length) yield out.shift()!
          else await new Promise<void>((r) => (wake = r))
        }
      },
      interrupt: async () => { interrupted = true },
      stopTask: async (taskId: string) => {
        stopped = true
        emit({ type: 'system', subtype: 'task_notification', task_id: taskId, status: 'stopped', summary: 'Stopped by user', uuid: crypto.randomUUID() })
        emit({ type: 'system', subtype: 'background_tasks_changed', tasks: [], uuid: crypto.randomUUID() })
      },
      close: () => { closed = true; wake?.() },
      setPermissionMode: async () => {}, setModel: async () => {}, applyFlagSettings: async () => {},
      initializationResult: async () => ({ models: [
        { value: 'default', displayName: 'Default (recommended)', description: 'Opus 4.6 · Best for everyday tasks', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
        { value: 'opus', displayName: 'Opus 4.6', description: 'Most capable', supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
        { value: 'sonnet', displayName: 'Sonnet 4.6', description: 'Fast', supportedEffortLevels: ['low', 'medium', 'high'] }
      ], account: { email: 'test@example.com', subscriptionType: 'max' } })
    }
    return q as unknown as ReturnType<SdkModule['query']>
  }

  return {
    query,
    getSessionMessages: async (id) => lines(`sessions/${id}`),
    listSubagents: async () => [],
    getSubagentMessages: async () => [],
    getSessionInfo: async (id) => (titles[id] || existsSync(join(dir, `sessions/${id}.jsonl`)) ? { sessionId: id, summary: titles[id] ?? 'Recorded chat', lastModified: 0 } : undefined),
    renameSession: async () => {},
    deleteSession: async () => {}
  }
}
