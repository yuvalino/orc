import { useState } from 'react'
import type { Ask, AskAnswer, Item } from '@shared/types'
import { Markdown } from './Markdown'
import { useStore } from '../stores/store'

type AskItem = Extract<Item, { kind: 'ask' }>

export function AskCard({ item }: { item: AskItem }) {
  const answer = useStore((s) => s.answer)
  const reply = (a: AskAnswer) => answer(item.id, a)
  if (item.cancelled) return <Done>Request cancelled</Done>
  if (item.answer) return <Done>{summarize(item.ask, item.answer)}</Done>
  return (
    <div className="my-2 rounded-xl border border-line bg-bg-sidebar p-4">
      {item.ask.type === 'permission' && <Permission ask={item.ask} reply={reply} />}
      {item.ask.type === 'question' && <Question ask={item.ask} reply={reply} />}
      {item.ask.type === 'plan' && <Plan ask={item.ask} reply={reply} />}
    </div>
  )
}

const Done = ({ children }: { children: React.ReactNode }) => <div className="my-1 text-[12.5px] text-fg-3">{children}</div>
const Btn = ({ primary, danger, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean }) => (
  <button {...rest} className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-40 ${primary ? 'bg-accent text-white hover:brightness-110' : danger ? 'border border-bad/50 text-bad hover:bg-bad/10' : 'border border-line hover:bg-bg-hover'}`}>{children}</button>
)

function summarize(ask: Ask, a: AskAnswer): string {
  if (a.type === 'permission') return a.decision === 'deny' ? `Denied ${ask.type === 'permission' ? ask.toolName : ''}` : a.decision === 'always' ? 'Allowed (always for this session)' : 'Allowed'
  if (a.type === 'question') return `Answered: ${Object.values(a.answers).join(', ')}`
  return a.decision === 'reject' ? 'Plan rejected' : a.decision === 'approve-edits' ? 'Plan approved · auto-accepting edits' : 'Plan approved'
}

function Permission({ ask, reply }: { ask: Extract<Ask, { type: 'permission' }>; reply: (a: AskAnswer) => void }) {
  const input = ask.input as Record<string, unknown>
  const preview = ['command', 'file_path', 'pattern', 'url', 'content', 'new_string'].filter((k) => typeof input[k] === 'string').map((k) => String(input[k])).join('\n\n') || JSON.stringify(input, null, 2)
  return (
    <>
      <div className="font-semibold">{ask.title ?? `Allow ${ask.toolName}?`}</div>
      {ask.description && <div className="mt-0.5 text-[13px] text-fg-2">{ask.description}</div>}
      <pre className="my-3 max-h-48 overflow-auto rounded-lg bg-bg p-3 font-mono text-[12px] text-fg-2 whitespace-pre-wrap">{preview}</pre>
      <div className="flex justify-end gap-2">
        <Btn danger onClick={() => reply({ type: 'permission', decision: 'deny' })}>Deny</Btn>
        <Btn onClick={() => reply({ type: 'permission', decision: 'allow' })}>Allow</Btn>
        {ask.canAlwaysAllow && <Btn primary onClick={() => reply({ type: 'permission', decision: 'always' })}>Allow always</Btn>}
      </div>
    </>
  )
}

function Question({ ask, reply }: { ask: Extract<Ask, { type: 'question' }>; reply: (a: AskAnswer) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})
  const toggle = (q: string, label: string, multi?: boolean) =>
    setPicked((p) => ({ ...p, [q]: multi ? (p[q]?.includes(label) ? p[q].filter((l) => l !== label) : [...(p[q] ?? []), label]) : [label] }))
  const answers = Object.fromEntries(ask.questions.map((q) => [q.question, other[q.question]?.trim() || (picked[q.question] ?? []).join(', ')]))
  const complete = ask.questions.every((q) => answers[q.question])
  return (
    <>
      {ask.questions.map((q) => (
        <div key={q.question} className="mb-3">
          {q.header && <div className="text-[11px] font-medium uppercase tracking-wide text-fg-3">{q.header}</div>}
          <div className="mb-2 font-semibold">{q.question}</div>
          <div className="flex flex-col gap-1.5">
            {q.options.map((o) => {
              const on = picked[q.question]?.includes(o.label)
              return (
                <button key={o.label} onClick={() => toggle(q.question, o.label, q.multiSelect)} className={`rounded-lg border px-3 py-2 text-left ${on ? 'border-accent bg-accent/10' : 'border-line hover:bg-bg-hover'}`}>
                  <div className="text-[13px] font-medium">{o.label}</div>
                  {o.description && <div className="text-[12px] text-fg-2">{o.description}</div>}
                </button>
              )
            })}
            <input value={other[q.question] ?? ''} onChange={(e) => setOther((s) => ({ ...s, [q.question]: e.target.value }))} placeholder="Other…" className="rounded-lg border border-line bg-bg px-3 py-1.5 text-[13px] outline-none focus:border-accent" />
          </div>
        </div>
      ))}
      <div className="flex justify-end"><Btn primary disabled={!complete} onClick={() => reply({ type: 'question', answers })}>Submit</Btn></div>
    </>
  )
}

function Plan({ ask, reply }: { ask: Extract<Ask, { type: 'plan' }>; reply: (a: AskAnswer) => void }) {
  const [feedback, setFeedback] = useState('')
  return (
    <>
      <div className="mb-2 font-semibold">Review plan</div>
      <div className="max-h-80 overflow-auto rounded-lg bg-bg p-3 text-[13px]"><Markdown text={ask.plan} /></div>
      <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Feedback (optional)" rows={2} className="mt-3 w-full resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent" />
      <div className="mt-2 flex justify-end gap-2">
        <Btn danger onClick={() => reply({ type: 'plan', decision: 'reject', feedback: feedback || undefined })}>Request changes</Btn>
        <Btn onClick={() => reply({ type: 'plan', decision: 'approve' })}>Approve</Btn>
        <Btn primary onClick={() => reply({ type: 'plan', decision: 'approve-edits' })}>Approve &amp; auto-accept edits</Btn>
      </div>
    </>
  )
}
