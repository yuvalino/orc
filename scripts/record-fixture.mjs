#!/usr/bin/env node
// Records a real Claude run as a replayable fixture for the fake SDK.
// Usage: ORC_LIVE=1 node scripts/record-fixture.mjs <name> "<prompt>" [permissionMode]
import { getSessionMessages, query } from '@anthropic-ai/claude-agent-sdk'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const [name, prompt, permissionMode = 'default'] = process.argv.slice(2)
if (!process.env.ORC_LIVE || !name || !prompt) { console.error('ORC_LIVE=1 node scripts/record-fixture.mjs <name> "<prompt>" [mode]'); process.exit(1) }

const cwd = mkdtempSync(join(tmpdir(), 'orc-fixture-'))
writeFileSync(join(cwd, 'hello.txt'), 'hello from the fixture project\n')
const out = []

// Streaming input keeps the process alive past the first result so backgrounded tasks can report back.
let finish
const done = new Promise((r) => (finish = r))
async function* input() { yield { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null }; await done }

const q = query({ prompt: input(), options: {
  cwd, permissionMode, includePartialMessages: true, maxTurns: 6, agentProgressSummaries: true,
  tools: { type: 'preset', preset: 'claude_code' }, allowedTools: ['Grep', 'Glob'], systemPrompt: { type: 'preset', preset: 'claude_code' }, settingSources: ['user'],
  settings: { bashEditDiffEnabled: true },
  canUseTool: async (toolName, input, o) => {
    out.push({ __ask: { toolName, input, options: { title: o.title, description: o.description, suggestions: o.suggestions, toolUseID: o.toolUseID } } })
    if (toolName === 'AskUserQuestion') return { behavior: 'allow', updatedInput: { ...input, answers: Object.fromEntries(input.questions.map((q) => [q.question, q.options[0].label])) } }
    return { behavior: 'allow', updatedInput: input }
  }
} })
const tasks = new Set(); let sessionId
for await (const m of q) {
  out.push(m)
  sessionId ??= m.session_id
  if (m.type === 'system' && m.subtype === 'task_started' && !m.ambient) tasks.add(m.task_id)
  if (m.type === 'system' && m.subtype === 'task_notification') tasks.delete(m.task_id)
  if (m.type === 'result') { process.stdout.write(`result: ${m.subtype} (${m.duration_ms}ms), ${tasks.size} tasks outstanding\n`); if (!tasks.size) { finish(); q.close(); break } }
}
const file = `tests/fixtures/${name}.jsonl`
writeFileSync(file, out.map((l) => JSON.stringify(l)).join('\n') + '\n')
console.log(`wrote ${file} (${out.length} lines)`)
const saved = await getSessionMessages(sessionId, { dir: cwd }).catch(() => [])
console.log(`saved transcript: ${saved.length} rows, ${saved.filter((r) => r.parent_tool_use_id).length} with parent_tool_use_id`)
