import { useEffect, useState } from 'react'
import { Anchor, Check, ChevronLeft, Cpu, Flame, Gem, Globe, Leaf, ListTodo, Loader2, Rocket, Star, Sun, Terminal, X, Zap } from 'lucide-react'
import type { Item } from '@shared/types'
import { Menu } from '../lib/Menu'
import { useActive, useStore } from '../stores/store'
import { Turns } from './ChatView'

type Tool = Extract<Item, { kind: 'tool' }>

/** Tool calls that spawn work with a life of its own: subagents, and commands sent to the background. */
export const isLaunch = (t: Tool) => t.name === 'Agent' || t.name === 'Task' || !!t.task?.background
export const isActive = (t: Tool) => (t.task ? t.task.status === 'running' : t.status === 'running' || t.status === 'awaiting_approval')
export const taskName = (t: Tool) => { const i = t.input as Record<string, string>; return i.description || (i.command ?? '').split('\n')[0] || t.name }
const launches = (items: Item[]) => items.filter((i): i is Tool => i.kind === 'tool' && isLaunch(i))

/** Every subagent gets a stable logo so it can be recognised at a glance; the id picks icon and colour. */
const ICONS = [Globe, Sun, Gem, Zap, Leaf, Flame, Star, Rocket, Cpu, Anchor]
const COLORS = ['#0ea5e9', '#f59e0b', '#8b5cf6', '#10b981', '#f43f5e', '#f97316']
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
export function Logo({ tool, size = 18 }: { tool: Tool; size?: number }) {
  const h = hash(tool.toolUseId), Icon = tool.name === 'Bash' ? Terminal : ICONS[h % ICONS.length]
  return <span className="inline-flex shrink-0 items-center justify-center rounded-full text-white" style={{ width: size, height: size, background: COLORS[(h >> 4) % COLORS.length] }}><Icon size={Math.round(size * 0.6)} strokeWidth={2.2} /></span>
}

const useTick = () => { const [, set] = useState(0); useEffect(() => { const t = setInterval(() => set((n) => n + 1), 1000); return () => clearInterval(t) }, []) }
const fmt = (ms: number) => (ms < 60_000 ? `${Math.floor(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000).toString().padStart(2, '0')}s`)
function Elapsed({ from }: { from?: number }) { useTick(); return <>{from ? fmt(Date.now() - from) : ''}</> }
function Ago({ at }: { at?: number }) { useTick(); if (!at) return null; const m = Math.floor((Date.now() - at) / 60_000); return <>{m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`}</> }
const modelName = (id?: string) => { const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id ?? ''); return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id ?? '' }

/** "A and B started working" — the transcript's only trace of a launch; the panel has the rest. */
export function LaunchRow({ tools }: { tools: Tool[] }) {
  const setPanel = useStore((s) => s.setPanel)
  const bg = tools.length === 1 && tools[0].name !== 'Agent' && tools[0].name !== 'Task'
  return (
    <button onClick={() => setPanel({ toolUseId: tools[0].toolUseId })} className="flex max-w-full items-center gap-2 rounded-lg px-2 py-1 text-[13px] text-fg-sub hover:bg-bg-hover hover:text-fg-bright">
      <span className="flex shrink-0 gap-1">{tools.map((t) => <Logo key={t.id} tool={t} />)}</span>
      <span className="truncate">{tools.map(taskName).join(' and ')} started {bg ? 'in the background' : 'working'}</span>
    </button>
  )
}

const useLaunches = () => { const { session } = useActive(); return launches(useStore((s) => (session ? s.transcripts[session.id] : undefined)) ?? []) }

/** Top-bar button: a dropdown with the live count that opens the panel. */
export function SubagentsButton() {
  const tools = useLaunches(), { panel, setPanel } = useStore()
  const active = tools.filter(isActive), done = tools.length - active.length
  const summary = tools.length
    ? <>{(active.length ? active : tools).slice(0, 3).map((t) => <Logo key={t.id} tool={t} size={16} />)}<span>{active.length ? `${active.length} working` : `${done} done`}</span>{active.length > 0 && done > 0 && <span className="ml-auto text-fg-2">{done} done</span>}</>
    : <span className="text-fg-2">No subagents yet</span>
  return <Menu align="right" header="Subagents" items={[{ label: summary, onSelect: () => setPanel({ toolUseId: null }) }]}
    trigger={<button title="Subagents" className={`flex size-7 items-center justify-center rounded-md hover:bg-bg-hover ${panel ? 'bg-bg-active text-fg-bright' : 'text-fg-2'}`}><ListTodo size={16} /></button>} />
}

export function SubagentsPanel() {
  const { session } = useActive()
  const { panel, setPanel, stopTask } = useStore()
  const items = useStore((s) => (session ? s.transcripts[session.id] : undefined)) ?? []
  if (!panel) return null
  const tools = launches(items), open = panel.toolUseId ? tools.find((t) => t.toolUseId === panel.toolUseId) : undefined
  return (
    <aside className="flex w-[330px] shrink-0 flex-col border-l border-line bg-bg">
      <div className="drag flex h-[46px] shrink-0 items-center border-b border-line px-3">
        <span className="no-drag flex items-center gap-2 rounded-md bg-bg-active px-2.5 py-1 text-[13px] text-fg-bright"><ListTodo size={14} /> Subagents<button onClick={() => setPanel(null)} className="text-fg-2 hover:text-fg-bright" title="Close"><X size={14} /></button></span>
      </div>
      {open ? <Thread tool={open} items={items} back={() => setPanel({ toolUseId: null })} stop={stopTask} />
        : <TaskList tools={tools} onOpen={(t) => setPanel({ toolUseId: t.toolUseId })} stop={stopTask} />}
    </aside>
  )
}

const StopButton = ({ tool, stop }: { tool: Tool; stop: (id: string) => void }) => tool.task
  ? <button onClick={(e) => { e.stopPropagation(); stop(tool.task!.id) }} className="rounded border border-bad/40 px-1.5 text-[11px] text-bad hover:bg-bad/10">Stop</button> : null

function TaskList({ tools, onOpen, stop }: { tools: Tool[]; onOpen: (t: Tool) => void; stop: (id: string) => void }) {
  const active = tools.filter(isActive), done = tools.filter((t) => !isActive(t)).reverse()
  const Head = ({ children }: { children: React.ReactNode }) => <div className="px-2 pb-1 pt-2 text-[13px] text-fg-2">{children}</div>
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[13px]">
      <Head>Active · {active.length}</Head>
      {active.length === 0 && <div className="px-2 pb-3 text-fg-2">No active subagents</div>}
      {active.map((t) => (
        <div key={t.id} onClick={() => onOpen(t)} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-bg-hover">
          <Logo tool={t} />
          <div className="min-w-0 flex-1"><div className="truncate font-medium text-fg-bright">{taskName(t)}</div><div className="truncate text-[12px] text-fg-2">Working{t.task?.summary ? ` · ${t.task.summary}` : t.task?.background ? ' · background' : ''}</div></div>
          <span className="shrink-0 text-[12px] text-fg-2"><Elapsed from={t.task?.startedAt} /></span>
          <StopButton tool={t} stop={stop} />
        </div>
      ))}
      <Head>Done · {done.length}</Head>
      {done.map((t) => (
        <div key={t.id} onClick={() => onOpen(t)} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-bg-hover">
          <Logo tool={t} /><span className="min-w-0 flex-1 truncate font-medium text-fg-bright">{taskName(t)}</span>
          <span className="shrink-0 text-[12px] text-fg-2">{t.status === 'error' || t.task?.status === 'failed' ? 'failed' : t.task?.status === 'stopped' || t.status === 'interrupted' ? 'stopped' : <Ago at={t.task?.endedAt} />}</span>
        </div>
      ))}
    </div>
  )
}

/** One agent's own transcript (its tool calls, then its report), or a background command's output. */
function Thread({ tool, items, back, stop }: { tool: Tool; items: Item[]; back: () => void; stop: (id: string) => void }) {
  const active = isActive(tool), shell = tool.name !== 'Agent' && tool.name !== 'Task'
  const children = items.filter((i) => 'parent' in i && i.parent === tool.toolUseId).map((i) => ({ ...i, parent: null })) as Item[]
  if (!shell && tool.result?.text && !children.some((c) => c.kind === 'text')) children.push({ kind: 'text', id: `${tool.id}:r`, text: tool.result.text, streaming: false, parent: null }) // the report, unless the agent's own frames already carry it
  if (!active) children.push({ kind: 'turn_end', id: `${tool.id}:e`, durationMs: tool.task?.endedAt && tool.task.startedAt ? tool.task.endedAt - tool.task.startedAt : ((tool.result?.data as { totalDurationMs?: number } | undefined)?.totalDurationMs ?? 0), isError: tool.status === 'error' })
  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-3 py-3">
        <button onClick={back} className="text-fg-2 hover:text-fg-bright" title="Back"><ChevronLeft size={16} /></button>
        <Logo tool={tool} /><span className="truncate text-[14px] font-semibold text-fg-bright">{taskName(tool)}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[12px] text-fg-2">
          {active ? <><Loader2 size={12} className="animate-spin" /><Elapsed from={tool.task?.startedAt} /><StopButton tool={tool} stop={stop} /></> : modelName(tool.task?.model)}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13.5px]">
        {shell ? (
          <>
            <div className="flex items-center gap-2 text-[13px] text-fg-2">
              {active ? <><Loader2 size={13} className="animate-spin" /> Running in the background</> : tool.task?.status === 'completed' ? <><Check size={13} className="text-ok" /> Finished</> : <><X size={13} className="text-bad" /> {tool.task?.status ?? 'stopped'}</>}
            </div>
            <pre className="mt-2 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg bg-[#141414] p-3 font-mono text-[12px] text-fg-sub">$ {(tool.input as { command?: string }).command}{tool.result?.text ? `\n\n${tool.result.text}` : ''}</pre>
          </>
        ) : <Turns items={children} running={active} />}
      </div>
    </>
  )
}
