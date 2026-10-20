import { useEffect, useRef, useState } from 'react'
import { Bot, Check, ChevronRight, Copy, FileText, Folder, Globe, Hand, ListChecks, Loader2, Pencil, Search, Terminal, Wrench, X } from 'lucide-react'
import type { Item } from '@shared/types'
import { AskCard } from './asks'
import { Markdown } from './Markdown'
import { LaunchRow, SubagentsButton, isLaunch, type Tool } from './agents'
import { sessionTitle, useActive, useStore } from '../stores/store'
import logo from '../assets/logo.png'

const HIDDEN_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])

interface Turn { user?: Extract<Item, { kind: 'user' }>; work: Item[]; final: Item[]; end?: Extract<Item, { kind: 'turn_end' }> }

/** Group a flat transcript into turns; the trailing top-level text of each turn is the reply, everything else is "work". */
function groupTurns(items: Item[]): Turn[] {
  const turns: Turn[] = []
  let t: Turn = { work: [], final: [] }
  const flush = () => { if (t.user || t.work.length || t.final.length) turns.push(t); t = { work: [], final: [] } }
  for (const it of items) {
    if ('parent' in it && it.parent) continue // a subagent's own work shows in the Subagents panel
    if (it.kind === 'user') { flush(); t.user = it }
    else if (it.kind === 'turn_end') { t.end = it; flush() }
    else if (it.kind === 'text' || it.kind === 'note') t.final.push(it) // replies and errors stay visible outside the fold
    else {
      if ((it.kind === 'tool' && HIDDEN_TOOLS.has(it.name)) || (it.kind === 'thinking' && !it.text && !it.streaming)) continue
      t.work.push(...t.final); t.final = []; t.work.push(it)
    }
  }
  flush()
  return turns
}

export function ChatView() {
  const { session, project } = useActive()
  const items = useStore((s) => (session ? s.transcripts[session.id] : undefined))
  const status = useStore((s) => (session ? s.status[session.id] : undefined))
  const panel = useStore((s) => s.panel)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [leaving, setLeaving] = useState(false) // the empty screen fading out over the first turn
  const hadSession = useRef(!!session)
  useEffect(() => {
    if (session && !hadSession.current) { setLeaving(true); const t = setTimeout(() => setLeaving(false), 300); hadSession.current = true; return () => clearTimeout(t) }
    hadSession.current = !!session
  }, [session?.id])

  useEffect(() => { stick.current = true }, [session?.id]) // a freshly opened chat starts at its latest message
  useEffect(() => { if (stick.current) ref.current?.scrollTo({ top: ref.current.scrollHeight }) }, [items])
  const onScroll = () => { const el = ref.current!; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60 }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`drag flex h-[46px] shrink-0 items-center gap-2 border-b border-line px-4 text-[14px] font-medium text-fg-bright ${panel ? '' : 'titlebar-end'}`}>
        <Folder size={18} className="shrink-0 text-fg-2" />
        <span className="truncate">{session ? sessionTitle(session) : <span className="text-fg-2">New session</span>}</span>
        <div className="no-drag ml-auto flex shrink-0 items-center gap-2">
          {status?.rateLimit && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] text-warn">Usage {Math.round((status.rateLimit.utilization ?? 0) * 100)}%</span>}
          {session && <SubagentsButton />}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {session && (
          <div key={session.id} ref={ref} onScroll={onScroll} className="fade-in min-h-0 flex-1 overflow-y-auto px-[100px] py-3">
            <Turns items={items ?? []} running={!!status && status.state !== 'idle' && status.state !== 'closed'} />
          </div>
        )}
        {(!session || leaving) && (
          <div className={`flex flex-1 flex-col items-center justify-center gap-1.5 text-fg-3 ${leaving ? 'fade-out pointer-events-none absolute inset-0 bg-bg' : ''}`}>
            <div className="logo-glow mb-3"><span className="logo-sway flex"><img src={logo} alt="" className="logo-float size-[104px]" draggable={false} /></span></div>
            <div className="text-[14px] font-medium text-fg">Start a conversation</div>
            <div className="text-[13px]">Working in <code className="rounded bg-bg-active px-1.5 py-0.5 font-mono text-[12px]">{project ? project.path.replace(/^\/Users\/[^/]+/, '~') : '~'}</code></div>
          </div>
        )}
      </div>
    </div>
  )
}

/** The transcript body; also renders a subagent's thread in the panel. `running` applies to the last turn. */
export function Turns({ items, running }: { items: Item[]; running: boolean }) {
  const turns = groupTurns(items)
  return <div className="flex flex-col gap-3.5">{turns.map((t, i) => <TurnView key={t.user?.id ?? i} turn={t} running={running && i === turns.length - 1 && !t.end} />)}</div>
}

function TurnView({ turn, running }: { turn: Turn; running: boolean }) {
  return (
    <div className="flex flex-col gap-3.5">
      {turn.user && <div className="mr-2.5 max-w-[65%] self-end break-words rounded-3xl bg-bubble px-5 py-2.5 text-white whitespace-pre-wrap">{turn.user.text}</div>}
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
  const launches = items.filter((i): i is Tool => i.kind === 'tool' && isLaunch(i))
  return (
    <div className="border-t border-line pt-2">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 pb-1 text-[13px] text-fg-2 hover:text-fg">
        {running && <Loader2 size={13} className="animate-spin" />}<span className="truncate">{label}</span>
        <ChevronRight size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open
        ? <div className="mt-2 flex flex-col gap-1">{workRows(items)}</div>
        : launches.length > 0 && <div className="mt-1 flex flex-col gap-1">{workRows(launches)}</div>} {/* launches stay in view when the rest is folded away, as in Codex */}
    </div>
  )
}

/** Consecutive launches ("A and B started working") share one row; everything else is a WorkItem. */
function workRows(items: Item[]): React.ReactNode[] {
  const rows: React.ReactNode[] = []
  let group: Tool[] = []
  const flush = () => { if (group.length) rows.push(<LaunchRow key={group[0].id} tools={group} />); group = [] }
  for (const it of items) {
    if (it.kind === 'tool' && isLaunch(it)) group.push(it)
    else { flush(); rows.push(<WorkItem key={it.id} item={it} />) }
  }
  flush()
  return rows
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

type Hunk = { lines: string[] }
/** Claude Code's `tool_use_result` payloads we draw: Edit/Write patches, Grep/Glob matches, Bash file diffs. */
type ResultData = { structuredPatch?: Hunk[]; filenames?: string[]; numFiles?: number; bashEditDiff?: { files: { filePath: string; hunks: Hunk[] }[] } }

const file = (p?: string) => (p ?? '').split(/[\\/]/).slice(-2).join('/')

function toolLabel(t: Tool): { icon: typeof FileText; text: string } {
  const i = (t.input ?? {}) as Record<string, string>
  const d = (t.result?.data ?? {}) as ResultData
  const done = t.status === 'done' || t.status === 'error'
  const v = (now: string, past: string) => (done ? past : now)
  const short = (s?: string) => (s ?? '').split('\n')[0].slice(0, 80)
  const mcp = /^mcp__(.+?)__(.+)$/.exec(t.name)
  switch (t.name) {
    case 'Read': return { icon: FileText, text: `Read ${file(i.file_path)}` }
    case 'Edit': case 'MultiEdit': return { icon: Pencil, text: `${v('Edit', 'Edited')} ${file(i.file_path)}` }
    case 'Write': return { icon: Pencil, text: `${v('Write', 'Wrote')} ${file(i.file_path)}` }
    case 'Bash': return { icon: Terminal, text: `${v('Run', 'Ran')} ${short(i.command)}` }
    case 'Grep': case 'Glob': return { icon: Search, text: `${v('Search', 'Searched')} ${short(i.pattern)}${d.numFiles ? ` · ${d.numFiles} files` : ''}` }
    case 'WebFetch': case 'WebSearch': return { icon: Globe, text: short(i.url ?? i.query) }
    case 'Agent': case 'Task': return { icon: Bot, text: `Agent: ${short(i.description)}${t.task?.summary ? ` · ${t.task.summary}` : ''}` }
    case 'TaskCreate': return { icon: ListChecks, text: `Task: ${short(i.subject)}` }
    case 'TaskUpdate': return { icon: ListChecks, text: `Task #${i.taskId} → ${i.status ?? 'updated'}` }
    default: return { icon: Wrench, text: mcp ? `${mcp[2]} (${mcp[1]})` : t.name }
  }
}

function ToolRow({ tool }: { tool: Tool }) {
  const { icon: Icon, text } = toolLabel(tool)
  const i = tool.input as Record<string, string>
  const d = (tool.result?.data ?? {}) as ResultData
  const Status = { running: <Loader2 size={13} className="animate-spin text-fg-3" />, awaiting_approval: <Hand size={13} className="text-warn" />, done: <Check size={13} className="text-ok" />, error: <X size={13} className="text-bad" />, denied: <X size={13} className="text-fg-3" />, interrupted: <X size={13} className="text-fg-3" /> }[tool.status]
  const diffLines = d.structuredPatch ? d.structuredPatch.flatMap((h) => h.lines)
    : tool.name === 'Edit' || tool.name === 'MultiEdit' ? [...(i.old_string ?? '').split('\n').map((l) => '-' + l), ...(i.new_string ?? '').split('\n').map((l) => '+' + l)]
    : tool.name === 'Write' ? (i.content ?? '').split('\n').map((l) => '+' + l) : null
  const files = d.filenames ?? []
  const rich = !!(diffLines || files.length || d.bashEditDiff?.files.length) // structured body replaces the raw result text
  return (
    <Collapsible head={<><Icon size={14} className="shrink-0 text-fg-2" /><span className="truncate font-mono text-[12.5px]">{text}</span><span className="ml-auto">{Status}</span></>}>
      {diffLines && <Diff lines={diffLines} />}
      {files.length > 0 && <pre className="max-h-64 overflow-auto font-mono text-[12px] text-fg-2">{files.join('\n')}</pre>}
      {tool.result?.text && (!rich || tool.result.isError) && <pre className={`max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[12px] ${tool.result.isError ? 'text-bad' : 'text-fg-2'}`}>{tool.result.text.slice(0, 4000)}</pre>}
      {d.bashEditDiff?.files.map((f) => <div key={f.filePath} className="mt-1.5"><div className="mb-1 font-mono text-[12px] text-fg-3">{file(f.filePath)}</div><Diff lines={f.hunks.flatMap((h) => h.lines)} /></div>)}
      {!rich && !tool.result && <pre className="font-mono text-[12px] text-fg-2">{JSON.stringify(tool.input, null, 2)}</pre>}
    </Collapsible>
  )
}

/** Unified-diff lines: first char is ' ', '+' or '-'. */
const Diff = ({ lines }: { lines: string[] }) => (
  <pre className="max-h-64 overflow-auto rounded-md bg-bg p-2 font-mono text-[12px] leading-5">
    {lines.map((l, i) => <div key={i} className={l[0] === '+' ? 'bg-ok/10 text-ok' : l[0] === '-' ? 'bg-bad/10 text-bad' : 'text-fg-2'}>{l}</div>)}
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
