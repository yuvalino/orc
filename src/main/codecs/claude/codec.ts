import type { EffortLevel, PermissionMode, PermissionResult, PermissionUpdate, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ApprovalMode, Ask, AskAnswer, Item } from '@shared/types'
import { applyPatch } from '@shared/types'
import type { Codec, CodecSession, OpenParams, Sink } from '../types'
import { newReduceState, reduce } from './reduce'
import { loadSdk } from './sdk'

const MODES: Record<ApprovalMode, PermissionMode> = { 'read-only': 'plan', ask: 'default', auto: 'auto', 'accept-edits': 'acceptEdits', 'full-access': 'bypassPermissions' }

/** The SDK's bundled binary can't be spawned from inside app.asar; point it at the asarUnpack'ed copy when packaged. */
function bundledBinary(): string | undefined {
  if (!app.isPackaged) return undefined
  const bin = join(process.resourcesPath, 'app.asar.unpacked/node_modules/@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}/claude`)
  return existsSync(bin) ? bin : undefined
}

/** Unbounded async queue: the SDK's streaming-input iterable, fed one user message per send(). */
function inputQueue<T>() {
  const buf: T[] = []; let wake: (() => void) | null = null; let done = false
  const iter: AsyncIterable<T> = { async *[Symbol.asyncIterator]() {
    while (!done) {
      if (buf.length) yield buf.shift()!
      else await new Promise<void>((r) => (wake = r))
    }
  } }
  return { iter, push: (t: T) => { buf.push(t); wake?.(); wake = null }, end: () => { done = true; wake?.() } }
}

function toAsk(toolName: string, input: Record<string, unknown>, opts: { title?: string; description?: string; suggestions?: PermissionUpdate[]; suppressAlwaysAllowRule?: boolean; toolUseID: string }): Ask {
  const id = crypto.randomUUID(), toolUseId = opts.toolUseID
  if (toolName === 'AskUserQuestion') return { type: 'question', id, toolUseId, questions: input.questions as Ask extends { questions: infer Q } ? Q : never }
  if (toolName === 'ExitPlanMode') return { type: 'plan', id, toolUseId, plan: String(input.plan ?? '') }
  return { type: 'permission', id, toolUseId, toolName, input, title: opts.title, description: opts.description, canAlwaysAllow: !!opts.suggestions?.length && !opts.suppressAlwaysAllowRule }
}

function toResult(answer: AskAnswer, input: Record<string, unknown>, suggestions: PermissionUpdate[] = []): PermissionResult {
  switch (answer.type) {
    case 'permission':
      if (answer.decision === 'deny') return { behavior: 'deny', message: answer.message ?? 'User declined', decisionClassification: 'user_reject' }
      if (answer.decision === 'always') // "Always" is scoped to this session on purpose: never write the project's settings files.
        return { behavior: 'allow', updatedInput: input, decisionClassification: 'user_permanent', updatedPermissions: suggestions.map((s) => ({ ...s, destination: 'session' as const })) }
      return { behavior: 'allow', updatedInput: input, decisionClassification: 'user_temporary' }
    case 'question': return { behavior: 'allow', updatedInput: { ...input, answers: answer.answers } }
    case 'plan':
      if (answer.decision === 'reject') return { behavior: 'deny', message: answer.feedback ?? 'Plan rejected' }
      return { behavior: 'allow', updatedInput: input, updatedPermissions: [{ type: 'setMode', mode: answer.decision === 'approve-edits' ? 'acceptEdits' : 'default', destination: 'session' }] }
  }
}

export class ClaudeCodec implements Codec {
  readonly id = 'claude'
  readonly displayName = 'Claude Code'

  async open(p: OpenParams, sink: Sink): Promise<CodecSession> {
    const sdk = await loadSdk()
    const input = inputQueue<SDKUserMessage>()
    const st = newReduceState()
    const q: Query = sdk.query({ prompt: input.iter, options: {
      cwd: p.cwd,
      ...(p.resume ? { resume: p.sessionId } : { sessionId: p.sessionId }),
      permissionMode: MODES[p.approvalMode],
      allowDangerouslySkipPermissions: p.approvalMode === 'full-access',
      model: p.model,
      effort: p.effort as EffortLevel | undefined,
      includePartialMessages: true,
      agentProgressSummaries: true, // task_progress carries a one-line status for each subagent
      tools: { type: 'preset', preset: 'claude_code' },
      allowedTools: ['Grep', 'Glob', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'], // search and checklist tools are omitted unless listed; all side-effect free
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project', 'local'],
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: `orc/${app.getVersion()}` },
      pathToClaudeCodeExecutable: bundledBinary(),
      perTaskStopAffordance: true,
      settings: { bashEditDiffEnabled: true }, // Bash results carry a diff of the files the command changed
      canUseTool: async (toolName, toolInput, opts) => toResult(await sink.ask(toAsk(toolName, toolInput, opts), opts.signal), toolInput, opts.suggestions)
    } })

    ;(async () => {
      try {
        for await (const msg of q as AsyncIterable<SDKMessage>) {
          const out = reduce(st, msg)
          out.patches.forEach((patch) => sink.patch(patch))
          if (out.status) sink.status(out.status)
        }
      } catch (e) {
        sink.patch({ op: 'upsert', item: { kind: 'note', id: crypto.randomUUID(), level: 'error', text: e instanceof Error ? e.message : String(e) } })
      } finally { sink.status({ state: 'closed' }) }
    })()

    return {
      send: (text, uuid) => input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, uuid: uuid as SDKUserMessage['uuid'] }),
      interrupt: async () => { await q.interrupt() },
      stopTask: (id) => q.stopTask(id),
      setApprovalMode: (m) => q.setPermissionMode(MODES[m]),
      setModel: (m) => q.setModel(m),
      setEffort: (e) => q.applyFlagSettings({ effortLevel: (e as EffortLevel | undefined) ?? null }),
      info: async () => { const r = await q.initializationResult(); return { models: r.models.map(({ value, displayName, description, supportedEffortLevels }) => ({ value, displayName, description, effortLevels: supportedEffortLevels })), account: r.account ?? null } },
      close: () => { input.end(); q.close() }
    }
  }

  async loadTranscript(sessionId: string, cwd: string): Promise<Item[]> {
    const sdk = await loadSdk(), st = newReduceState()
    let items: Item[] = []
    const agentIds: Record<string, string> = {} // spawning tool_use id → agent id
    const feed = (ms: unknown[]) => { for (const m of ms) for (const patch of reduce(st, m as SDKMessage).patches) items = applyPatch(items, patch) }
    try {
      feed(await sdk.getSessionMessages(sessionId, { dir: cwd }))
      for (const agentId of await sdk.listSubagents(sessionId, { dir: cwd })) {
        const ms = await sdk.getSubagentMessages(sessionId, agentId, { dir: cwd }) // rows carry parent_tool_use_id
        if (ms[0]?.parent_tool_use_id) agentIds[ms[0].parent_tool_use_id] = agentId
        feed(ms)
      }
    } catch { /* no transcript yet */ }
    // Saved rows carry no task events or tool_use_result, so tasks are rebuilt from the tool itself; a tool with no result was cut off when the process died.
    return items.map((i) => {
      if (i.kind !== 'tool') return i
      const bg = /^Command running in background with ID: (\w+)/.exec(i.result?.text ?? '')
      if (i.name === 'Agent' || i.name === 'Task' || bg) {
        const done = i.status === 'done', startedAt = st.times[i.toolUseId] ?? 0, endedAt = st.times[`${i.toolUseId}:end`] ?? (done ? startedAt : undefined)
        return { ...i, status: done ? 'done' : 'interrupted', task: { ...i.task, id: bg?.[1] ?? agentIds[i.toolUseId] ?? i.toolUseId, status: done ? 'completed' : i.status === 'error' ? 'failed' : 'stopped', background: !!bg || i.result?.text?.startsWith('Async agent') === true, startedAt, endedAt, model: i.task?.model } }
      }
      return i.status === 'running' ? { ...i, status: 'interrupted' } : i
    })
  }

  async sessionInfo(sessionId: string, cwd: string) {
    const info = await (await loadSdk()).getSessionInfo(sessionId, { dir: cwd }).catch(() => undefined)
    return info && { title: info.customTitle || info.summary }
  }
  async rename(sessionId: string, cwd: string, title: string) { await (await loadSdk()).renameSession(sessionId, title, { dir: cwd }).catch(() => {}) }
  async remove(sessionId: string, cwd: string) { await (await loadSdk()).deleteSession(sessionId, { dir: cwd }).catch(() => {}) }
}
