#!/usr/bin/env node
// Records a real Claude run as a replayable fixture for the fake SDK.
// Usage: ORC_LIVE=1 node scripts/record-fixture.mjs <name> "<prompt>" [permissionMode]
import { query } from '@anthropic-ai/claude-agent-sdk'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const [name, prompt, permissionMode = 'default'] = process.argv.slice(2)
if (!process.env.ORC_LIVE || !name || !prompt) { console.error('ORC_LIVE=1 node scripts/record-fixture.mjs <name> "<prompt>" [mode]'); process.exit(1) }

const cwd = mkdtempSync(join(tmpdir(), 'orc-fixture-'))
writeFileSync(join(cwd, 'hello.txt'), 'hello from the fixture project\n')
const out = []

const q = query({ prompt, options: {
  cwd, permissionMode, includePartialMessages: true, maxTurns: 6,
  tools: { type: 'preset', preset: 'claude_code' }, systemPrompt: { type: 'preset', preset: 'claude_code' }, settingSources: ['user'],
  canUseTool: async (toolName, input, o) => {
    out.push({ __ask: { toolName, input, options: { title: o.title, description: o.description, suggestions: o.suggestions, toolUseID: o.toolUseID } } })
    if (toolName === 'AskUserQuestion') return { behavior: 'allow', updatedInput: { ...input, answers: Object.fromEntries(input.questions.map((q) => [q.question, q.options[0].label])) } }
    return { behavior: 'allow', updatedInput: input }
  }
} })
for await (const m of q) { out.push(m); if (m.type === 'result') process.stdout.write(`result: ${m.subtype} (${m.duration_ms}ms)\n`) }
const file = `tests/fixtures/${name}.jsonl`
writeFileSync(file, out.map((l) => JSON.stringify(l)).join('\n') + '\n')
console.log(`wrote ${file} (${out.length} lines)`)
