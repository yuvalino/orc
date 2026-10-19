import { useEffect, useState } from 'react'
import { Check, ChevronLeft, ListTodo, Loader2, X } from 'lucide-react'
import type { Item } from '@shared/types'
import { useActive, useStore } from '../stores/store'
import { Turns } from './ChatView'
import { Logo, isActive, launches, taskName, type Tool } from './agents'

/** One clock per list, re-rendering every second for the elapsed/ago columns — in the engine's time, which may be another machine's. */
const useNow = () => {
  const offset = useStore((s) => s.transport?.clockOffset ?? 0)
  const [now, set] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => set(Date.now()), 1000); return () => clearInterval(t) }, [])
  return now + offset
}
const elapsed = (from: number | undefined, now: number) => { if (!from) return ''; const ms = now - from; return ms < 60_000 ? `${Math.floor(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000).toString().padStart(2, '0')}s` }
const ago = (at: number | undefined, now: number) => { if (!at) return ''; const m = Math.floor((now - at) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago` }
const modelName = (id?: string) => { const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id ?? ''); return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id ?? '' }

export function SubagentsPanel() {
  const { session } = useActive()
  const { panel, setPanel, stopTask } = useStore()
  const items = useStore((s) => (session ? s.transcripts[session.id] : undefined)) ?? []
  if (!panel || !session) return null
  const tools = launches(items), open = panel.toolUseId ? tools.find((t) => t.toolUseId === panel.toolUseId) : undefined
  return (
    <aside className="flex w-[330px] shrink-0 flex-col border-l border-line bg-bg">
      <div className="titlebar-end drag flex h-[46px] shrink-0 items-center border-b border-line px-3">
        <span className="no-drag flex items-center gap-2 rounded-md bg-bg-active px-2.5 py-1 text-[13px] text-fg-bright"><ListTodo size={14} /> Subagents<button onClick={() => setPanel(null)} className="text-fg-2 hover:text-fg-bright" title="Close"><X size={14} /></button></span>
      </div>
      {open ? <Thread tool={open} items={items} back={() => setPanel({ toolUseId: null })} stop={stopTask} />
        : <TaskList tools={tools} onOpen={(t) => setPanel({ toolUseId: t.toolUseId })} stop={stopTask} />}
    </aside>
  )
}

const StopButton = ({ tool, stop }: { tool: Tool; stop: (id: string) => void }) => tool.task?.id
  ? <button onClick={(e) => { e.stopPropagation(); stop(tool.task!.id) }} className="rounded border border-bad/40 px-1.5 text-[11px] text-bad hover:bg-bad/10">Stop</button> : null

function TaskList({ tools, onOpen, stop }: { tools: Tool[]; onOpen: (t: Tool) => void; stop: (id: string) => void }) {
  const now = useNow()
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
          <span className="shrink-0 text-[12px] text-fg-2">{elapsed(t.task?.startedAt, now)}</span>
          <StopButton tool={t} stop={stop} />
        </div>
      ))}
      <Head>Done · {done.length}</Head>
      {done.map((t) => (
        <div key={t.id} onClick={() => onOpen(t)} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-bg-hover">
          <Logo tool={t} /><span className="min-w-0 flex-1 truncate font-medium text-fg-bright">{taskName(t)}</span>
          <span className="shrink-0 text-[12px] text-fg-2">{t.status === 'error' ? 'failed' : t.status === 'interrupted' || t.status === 'denied' ? 'stopped' : ago(t.task?.endedAt, now)}</span>
        </div>
      ))}
    </div>
  )
}

/** One agent's own transcript (its prompt, tool calls, then its report), or a background command's output. */
function Thread({ tool, items, back, stop }: { tool: Tool; items: Item[]; back: () => void; stop: (id: string) => void }) {
  const now = useNow()
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
          {active ? <><Loader2 size={12} className="animate-spin" />{elapsed(tool.task?.startedAt, now)}<StopButton tool={tool} stop={stop} /></> : modelName(tool.task?.model)}
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
