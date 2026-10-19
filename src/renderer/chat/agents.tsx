import { Anchor, Cpu, Flame, Gem, Globe, Leaf, ListTodo, Rocket, Star, Sun, Terminal, Zap } from 'lucide-react'
import type { Item } from '@shared/types'
import { Menu } from '../lib/Menu'
import { useActive, useStore } from '../stores/store'

export type Tool = Extract<Item, { kind: 'tool' }>

/** Tool calls that spawn work with a life of its own: subagents, and commands sent to the background. */
export const isLaunch = (t: Tool) => t.name === 'Agent' || t.name === 'Task' || !!t.task?.background
export const isActive = (t: Tool) => t.status === 'running' || t.status === 'awaiting_approval' // a launch stays running until its result or task notification lands
export const taskName = (t: Tool) => { const i = t.input as Record<string, string>; return i.description || (i.command ?? '').split('\n')[0] || t.name }
export const launches = (items: Item[]) => items.filter((i): i is Tool => i.kind === 'tool' && isLaunch(i))
export const useLaunches = () => { const { session } = useActive(); return launches(useStore((s) => (session ? s.transcripts[session.id] : undefined)) ?? []) }

/** Every subagent gets a stable logo so it can be recognised at a glance; the id picks icon and colour. */
const ICONS = [Globe, Sun, Gem, Zap, Leaf, Flame, Star, Rocket, Cpu, Anchor]
const COLORS = ['#0ea5e9', '#f59e0b', '#8b5cf6', '#10b981', '#f43f5e', '#f97316']
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
export function Logo({ tool, size = 18 }: { tool: Tool; size?: number }) {
  const h = hash(tool.toolUseId), Icon = tool.name === 'Bash' ? Terminal : ICONS[h % ICONS.length]
  return <span className="inline-flex shrink-0 items-center justify-center rounded-full text-white" style={{ width: size, height: size, background: COLORS[(h >> 4) % COLORS.length] }}><Icon size={Math.round(size * 0.6)} strokeWidth={2.2} /></span>
}

/** "A and B started working" — the transcript's only trace of a launch; the panel has the rest. */
export function LaunchRow({ tools }: { tools: Tool[] }) {
  const setPanel = useStore((s) => s.setPanel)
  const bg = tools.length === 1 && tools[0].name !== 'Agent' && tools[0].name !== 'Task'
  return (
    <button onClick={() => setPanel({ toolUseId: tools.length === 1 ? tools[0].toolUseId : null })} className="flex max-w-full items-center gap-2 rounded-lg px-2 py-1 text-[13px] text-fg-sub hover:bg-bg-hover hover:text-fg-bright">
      <span className="flex shrink-0 gap-1">{tools.map((t) => <Logo key={t.id} tool={t} />)}</span>
      <span className="truncate">{tools.map(taskName).join(' and ')} started {bg ? 'in the background' : 'working'}</span>
    </button>
  )
}

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
