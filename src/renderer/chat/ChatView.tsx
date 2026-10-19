import { useEffect, useRef, useState } from 'react'
import { Bot, Check, ChevronRight, Copy, FileText, Folder, Globe, Hand, Loader2, Pencil, Search, Terminal, Wrench, X } from 'lucide-react'
import type { Item } from '@shared/types'
import { AskCard } from './asks'
import { Markdown } from './Markdown'
import { sessionTitle, useActive, useStore } from '../stores/store'

type Tool = Extract<Item, { kind: 'tool' }>
const HIDDEN_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])

interface Turn { user?: Extract<Item, { kind: 'user' }>; work: Item[]; final: Item[]; end?: Extract<Item, { kind: 'turn_end' }> }

/** Group a flat transcript into turns; the trailing top-level text of each turn is the reply, everything else is "work". */
function groupTurns(items: Item[]): Turn[] {
  const turns: Turn[] = []
  let t: Turn = { work: [], final: [] }
  const flush = () => { if (t.user || t.work.length || t.final.length) turns.push(t); t = { work: [], final: [] } }
  for (const it of items) {
    if (it.kind === 'user') { flush(); t.user = it }
    else if (it.kind === 'turn_end') { t.end = it; flush() }
    else if ((it.kind === 'text' && !it.parent) || it.kind === 'note') t.final.push(it) // replies and errors stay visible outside the fold
    else { if (it.kind === 'tool' && HIDDEN_TOOLS.has(it.name)) continue; t.work.push(...t.final); t.final = []; t.work.push(it) }
  }
  flush()
  return turns
}

export function ChatView() {
  const { session, project } = useActive()
  const items = useStore((s) => (session ? s.transcripts[session.id] : undefined))
  const status = useStore((s) => (session ? s.status[session.id] : undefined))
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => { if (stick.current) ref.current?.scrollTo({ top: ref.current.scrollHeight }) }, [items])
  const onScroll = () => { const el = ref.current!; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60 }

  const turns = groupTurns(items ?? [])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="drag flex h-[46px] shrink-0 items-center gap-2 border-b border-line px-4 text-[14px] font-medium text-fg-bright">
        <Folder size={18} className="shrink-0 text-fg-2" />
        <span className="truncate">{session ? sessionTitle(session) : <span className="text-fg-2">New session</span>}</span>
        {status?.rateLimit && <span className="ml-auto rounded-full bg-warn/15 px-2 py-0.5 text-[11px] text-warn">Usage {Math.round((status.rateLimit.utilization ?? 0) * 100)}%</span>}
      </div>
      {!session ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-fg-3">
          <div className="text-2xl opacity-15">◇</div>
          <div className="text-[14px] font-medium text-fg">Start a conversation</div>
          <div className="text-[13px]">Working in <code className="rounded bg-bg-active px-1.5 py-0.5 font-mono text-[12px]">{project ? project.path.replace(/^\/Users\/[^/]+/, '~') : '~'}</code></div>
        </div>
      ) : (
        <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-[100px] py-3">
          <div className="flex flex-col gap-3.5">
            {turns.map((t, i) => <TurnView key={t.user?.id ?? i} turn={t} running={i === turns.length - 1 && status?.state !== 'idle' && status?.state !== 'closed' && !t.end} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function TurnView({ turn, running }: { turn: Turn; running: boolean }) {
  return (
    <div className="flex flex-col gap-3.5">
      {turn.user && <div className="mr-2.5 max-w-[65%] self-end rounded-3xl bg-bubble px-5 py-2.5 text-white whitespace-pre-wrap">{turn.user.text}</div>}
      {turn.work.length > 0 && <WorkSection items={turn.work} running={running && turn.final.length === 0} durationMs={turn.end?.durationMs} />}
      {turn.final.map((it) => it.kind === 'note' ? <WorkItem key={it.id} item={it} /> : it.kind === 'text' && (
        <div key={it.id} className="group">
          <div className={it.streaming ? 'caret' : ''}><Markdown text={it.text} /></div>
          {!it.streaming && <Actions text={it.text} />}
        </div>
      ))}
      {turn.end?.stopped && <div className="text-[12.5px] text-fg-3">Stopped</div>}
      {running && turn.work.length === 0 && turn.final.length === 0 && <Loader2 size={16} className="animate-spin text-fg-3" />}
    </div>
  )
}

function Actions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  return (
    <div className="mt-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100">
      <button className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-bg-hover hover:text-fg-2" onClick={copy} title="Copy">{copied ? <Check size={16} /> : <Copy size={16} />}</button>
    </div>
  )
}

function WorkSection({ items, running, durationMs }: { items: Item[]; running: boolean; durationMs?: number }) {
  const [open, setOpen] = useState(false)
  const pendingAsk = items.some((i) => i.kind === 'ask' && !i.answer && !i.cancelled)
  useEffect(() => { if (pendingAsk) setOpen(true) }, [pendingAsk]) // asks pop the section open; it stays open after answering
  const last = [...items].reverse().find((i) => i.kind === 'tool') as Tool | undefined
  const lastText = last ? toolLabel(last).text.trim() : ''
  const live = lastText.includes(' ') ? lastText : last?.name // input is still streaming: fall back to the tool name
  const label = running ? `Working… ${live ? '· ' + live : ''}` : durationMs ? `Worked for ${durationMs < 1000 ? '<1s' : Math.round(durationMs / 1000) + 's'}` : 'Worked'
  return (
    <div className="border-t border-line pt-2">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 pb-1 text-[13px] text-fg-2 hover:text-fg">
        {running && <Loader2 size={13} className="animate-spin" />}<span className="truncate">{label}</span>
        <ChevronRight size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="mt-2 flex flex-col gap-1">{items.map((it) => <WorkItem key={it.id} item={it} />)}</div>}
    </div>
  )
}

function WorkItem({ item }: { item: Item }) {
  switch (item.kind) {
    case 'tool': return <ToolRow tool={item} />
    case 'ask': return <AskCard item={item} />
    case 'thinking': return <Collapsible head={<span className="italic">Thought for a moment</span>}><div className="whitespace-pre-wrap text-[12.5px] italic text-fg-2">{item.text}</div></Collapsible>
    case 'text': return <div className="pl-6 text-[13px] text-fg-2"><Markdown text={item.text} /></div>
    case 'note': return <div className={`text-[12.5px] ${item.level === 'error' ? 'text-bad' : 'text-fg-3'}`}>{item.text}</div>
    default: return null
  }
}

function toolLabel(t: Tool): { icon: typeof FileText; text: string } {
  const i = (t.input ?? {}) as Record<string, string>
  const short = (s?: string) => (s ?? '').split('\n')[0].slice(0, 80)
  const file = (p?: string) => (p ?? '').split('/').slice(-2).join('/')
  switch (t.name) {
    case 'Read': return { icon: FileText, text: `Read ${file(i.file_path)}` }
    case 'Edit': case 'MultiEdit': return { icon: Pencil, text: `Edited ${file(i.file_path)}` }
    case 'Write': return { icon: Pencil, text: `Wrote ${file(i.file_path)}` }
    case 'Bash': return { icon: Terminal, text: `Ran ${short(i.command)}` }
    case 'Grep': case 'Glob': return { icon: Search, text: `Searched ${short(i.pattern)}` }
    case 'WebFetch': case 'WebSearch': return { icon: Globe, text: short(i.url ?? i.query) }
    case 'Agent': case 'Task': return { icon: Bot, text: `Agent: ${short(i.description)}` }
    default: return { icon: Wrench, text: t.name }
  }
}

function ToolRow({ tool }: { tool: Tool }) {
  const { icon: Icon, text } = toolLabel(tool)
  const i = tool.input as Record<string, string>
  const Status = { running: <Loader2 size={13} className="animate-spin text-fg-3" />, awaiting_approval: <Hand size={13} className="text-warn" />, done: <Check size={13} className="text-ok" />, error: <X size={13} className="text-bad" />, denied: <X size={13} className="text-fg-3" />, interrupted: <X size={13} className="text-fg-3" /> }[tool.status]
  const diff = (tool.name === 'Edit' || tool.name === 'Write') && (i.old_string || i.new_string || i.content)
  return (
    <Collapsible head={<><Icon size={14} className="shrink-0 text-fg-2" /><span className="truncate font-mono text-[12.5px]">{text}</span><span className="ml-auto">{Status}</span></>}>
      {diff ? <Diff before={i.old_string ?? ''} after={i.new_string ?? i.content ?? ''} /> : null}
      {tool.result?.text && <pre className={`max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[12px] ${tool.result.isError ? 'text-bad' : 'text-fg-2'}`}>{tool.result.text.slice(0, 4000)}</pre>}
      {!diff && !tool.result && <pre className="font-mono text-[12px] text-fg-2">{JSON.stringify(tool.input, null, 2)}</pre>}
    </Collapsible>
  )
}

const Diff = ({ before, after }: { before: string; after: string }) => (
  <pre className="max-h-64 overflow-auto rounded-md bg-bg p-2 font-mono text-[12px] leading-5">
    {before.split('\n').map((l, i) => <div key={'b' + i} className="bg-bad/10 text-bad">- {l}</div>)}
    {after.split('\n').map((l, i) => <div key={'a' + i} className="bg-ok/10 text-ok">+ {l}</div>)}
  </pre>
)

function Collapsible({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] text-fg hover:bg-bg-hover">{head}</button>
      {open && <div className="ml-7 mt-1 mb-2">{children}</div>}
    </div>
  )
}
