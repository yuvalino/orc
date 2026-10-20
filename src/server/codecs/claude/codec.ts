import type { EffortLevel, PermissionMode, PermissionResult, PermissionUpdate, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { readFile } from 'fs/promises'
import type { ApprovalMode, Ask, AskAnswer, Item, ModelOption } from '@shared/types'
import { applyPatch } from '@shared/types'
import type { Codec, CodecSession, OpenParams, Sink } from '../types'
import { newReduceState, reduce } from './reduce'
import { loadSdk } from './sdk'

const MODES: Record<ApprovalMode, PermissionMode> = { 'read-only': 'plan', ask: 'default', auto: 'auto', 'accept-edits': 'acceptEdits', 'full-access': 'bypassPermissions' }

/** Set once by whoever hosts the engine (desktop shell or orc-server): where the `claude` binary is when the SDK can't find its own, and what to call ourselves. */
const cfg: { binaryPath?: string; version: string; env?: Record<string, string> } = { version: '0.0.0' } // env: extra variables for the SDK process only (a forwarded token)
export const configureClaude = (c: Partial<typeof cfg>): void => { Object.assign(cfg, c) }
export const claudeBinary = (): string | undefined => cfg.binaryPath

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
  const setMode = opts.suggestions?.find((s) => s.type === 'setMode')?.mode
  const alwaysMode = setMode && (Object.keys(MODES) as ApprovalMode[]).find((k) => MODES[k] === setMode)
  return { type: 'permission', id, toolUseId, toolName, input, title: opts.title, description: opts.description, canAlwaysAllow: !!opts.suggestions?.length && !opts.suppressAlwaysAllowRule, alwaysMode }
}

function toResult(answer: AskAnswer, input: Record<string, unknown>, suggestions: PermissionUpdate[], mode: ApprovalMode): PermissionResult {
  switch (answer.type) {
    case 'permission':
      if (answer.decision === 'deny') return { behavior: 'deny', message: answer.message ?? 'User declined', decisionClassification: 'user_reject' }
      if (answer.decision === 'always') // "Always" is scoped to this session on purpose: never write the project's settings files.
        return { behavior: 'allow', updatedInput: input, decisionClassification: 'user_permanent', updatedPermissions: suggestions.map((s) => ({ ...s, destination: 'session' as const })) }
      return { behavior: 'allow', updatedInput: input, decisionClassification: 'user_temporary' }
    case 'question': return { behavior: 'allow', updatedInput: { ...input, answers: answer.answers } }
    case 'plan':
      if (answer.decision === 'reject') return { behavior: 'deny', message: answer.feedback ?? 'Plan rejected' }
      return { behavior: 'allow', updatedInput: input, updatedPermissions: [{ type: 'setMode', mode: answer.decision === 'approve-edits' ? 'acceptEdits' : MODES[mode === 'read-only' ? 'ask' : mode], destination: 'session' }] } // plain approve keeps the chat's own mode
  }
}

/** The effort the CLI will send next: settings, the model's own default, org caps. getSettings is on the query object but not in its types. */
const appliedEffort = async (q: Query) => (await (q as Query & { getSettings(): Promise<{ applied?: { effort?: string | null } }> }).getSettings()).applied?.effort ?? null

export class ClaudeCodec implements Codec {
  readonly id = 'claude'
  readonly displayName = 'Claude Code'

  /** The model list, and each model's default effort found by switching an idle process through them (no prompt, no API call). */
  async info(cwd: string) {
    const sdk = await loadSdk()
    const q: Query = sdk.query({ prompt: inputQueue<SDKUserMessage>().iter, options: { cwd, settingSources: ['user', 'project', 'local'], env: { ...process.env, ...cfg.env, CLAUDE_AGENT_SDK_CLIENT_APP: `orc/${cfg.version}` }, pathToClaudeCodeExecutable: cfg.binaryPath } })
    try {
      const r = await q.initializationResult()
      const models = r.models.map(({ value, displayName, description, supportedEffortLevels }) => ({ value, displayName, description, effortLevels: supportedEffortLevels } as ModelOption))
      for (const m of models) {
        if (!m.effortLevels?.length || m.value.startsWith('claude-')) continue // the picker offers aliases only
        if (m.value !== 'default') await q.setModel(m.value)
        m.defaultEffort = (await appliedEffort(q).catch(() => null)) ?? undefined
      }
      return { models, account: r.account ?? null }
    } finally { q.close() }
  }

  async open(p: OpenParams, sink: Sink): Promise<CodecSession> {
    const sdk = await loadSdk()
    const input = inputQueue<SDKUserMessage>()
    const st = newReduceState()
    let mode = p.approvalMode
    const q: Query = sdk.query({ prompt: input.iter, options: {
      cwd: p.cwd,
      ...(p.resume ? { resume: p.sessionId } : { sessionId: p.sessionId }),
      permissionMode: MODES[p.approvalMode],
      allowDangerouslySkipPermissions: true, // only permits bypass mode; the mode itself is set above and can be switched to it later
      model: p.model,
      effort: p.effort as EffortLevel | undefined,
      includePartialMessages: true,
      agentProgressSummaries: true, // task_progress carries a one-line status for each subagent
      tools: { type: 'preset', preset: 'claude_code' },
      allowedTools: ['Grep', 'Glob', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'], // search and checklist tools are omitted unless listed; all side-effect free
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project', 'local'],
      env: { ...process.env, ...cfg.env, CLAUDE_AGENT_SDK_CLIENT_APP: `orc/${cfg.version}` },
      pathToClaudeCodeExecutable: cfg.binaryPath,
      perTaskStopAffordance: true,
      settings: { bashEditDiffEnabled: true }, // Bash results carry a diff of the files the command changed
      canUseTool: async (toolName, toolInput, opts) => toResult(await sink.ask(toAsk(toolName, toolInput, opts), opts.signal), toolInput, opts.suggestions ?? [], mode)
    } })

    const applied = () => appliedEffort(q).then((effort) => sink.status({ effort })).catch(() => {})
    q.initializationResult().then(applied, () => {})

    ;(async () => {
      try {
        for await (const msg of q as AsyncIterable<SDKMessage>) {
          const out = reduce(st, msg)
          out.patches.forEach((patch) => sink.patch(patch))
          if (out.status) sink.status(out.status)
          if (out.readOutput) { // a finished background command: its output is on disk, the notification only summarised it
            const text = await readFile(out.readOutput.path, 'utf-8').catch(() => '')
            if (text) sink.patch({ op: 'update', id: out.readOutput.id, partial: { result: { text: text.slice(-64_000), isError: false } } })
          }
        }
      } catch (e) {
        sink.patch({ op: 'upsert', item: { kind: 'note', id: crypto.randomUUID(), level: 'error', text: e instanceof Error ? e.message : String(e) } })
      } finally { sink.status({ state: 'closed' }) }
    })()

    return {
      send: (text, uuid) => input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, uuid: uuid as SDKUserMessage['uuid'] }),
      interrupt: async () => { await q.interrupt() },
      stopTask: (id) => q.stopTask(id),
      setApprovalMode: (m) => { mode = m; return q.setPermissionMode(MODES[m]) },
      setModel: async (m) => { await q.setModel(m); await applied() },
      setEffort: async (e) => { await q.applyFlagSettings({ effortLevel: (e as EffortLevel | undefined) ?? null }); await applied() },
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
    return Promise.all(items.map(async (i) => {
      if (i.kind !== 'tool') return i
      const bg = /^Command running in background with ID: (\w+)\. Output is being written to: (\S+?)\.?(\s|$)/.exec(i.result?.text ?? '')
      if (i.name === 'Agent' || i.name === 'Task' || bg) {
        const placeholder = !!bg || i.result?.text?.startsWith('Async agent') === true // the launch acknowledgement, not an outcome
        const done = i.status === 'done' && !(placeholder && !i.task?.status), startedAt = st.times[i.toolUseId] ?? 0, endedAt = st.times[`${i.toolUseId}:end`] ?? (done ? startedAt : undefined)
        const status = done ? 'done' : i.status === 'error' ? 'error' : 'interrupted'
        const text = bg ? await readFile(bg[2], 'utf-8').catch(() => '') : '' // the command's output file, still on disk
        return { ...i, status, result: text && i.result ? { ...i.result, text: text.slice(-64_000) } : i.result, task: { ...i.task, id: bg?.[1] ?? agentIds[i.toolUseId] ?? i.toolUseId, status: done ? 'completed' : status === 'error' ? 'failed' : 'stopped', background: placeholder, startedAt, endedAt, ...(i.task?.status && i.task.status !== 'running' ? { status: i.task.status } : {}) } }
      }
      return i.status === 'running' ? { ...i, status: 'interrupted' } : i
    }))
  }

  async sessionInfo(sessionId: string, cwd: string) {
    const info = await (await loadSdk()).getSessionInfo(sessionId, { dir: cwd }).catch(() => undefined)
    return info && { title: info.customTitle || info.summary }
  }
  async rename(sessionId: string, cwd: string, title: string) { await (await loadSdk()).renameSession(sessionId, title, { dir: cwd }).catch(() => {}) }
  async remove(sessionId: string, cwd: string) { await (await loadSdk()).deleteSession(sessionId, { dir: cwd }).catch(() => {}) }
}
