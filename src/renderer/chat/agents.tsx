import { ListTodo } from 'lucide-react'
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

/**
 * Every subagent gets a stable logo so it can be recognised at a glance; the id picks shape and colour.
 * Codex-style: a small two-tone geometric glyph on its own, no badge behind it — muted base, lighter highlight.
 */
const PALETTE: [string, string][] = [['#d9a04a', '#f5cf7a'], ['#3b9eb0', '#8fe0ee'], ['#8b6fd6', '#c9b8ff'], ['#5aa66c', '#a6e4b3'], ['#d9735f', '#f7ab98'], ['#4f86d9', '#a3c4f7']]
const SHAPES: ((b: string, h: string) => React.ReactNode)[] = [
  (b, h) => <><polygon fill={b} points="12,1 14.4,6.3 19.8,4.2 17.7,9.6 23,12 17.7,14.4 19.8,19.8 14.4,17.7 12,23 9.6,17.7 4.2,19.8 6.3,14.4 1,12 6.3,9.6 4.2,4.2 9.6,6.3" /><circle cx="12" cy="12" r="4.2" fill={h} /></>, // sunburst
  (b, h) => <><circle cx="12" cy="12" r="10" fill={b} /><path d="M12 2a10 10 0 0 1 10 10H12zM12 22A10 10 0 0 1 2 12h10z" fill={h} /><circle cx="12" cy="12" r="10" fill="none" stroke={b} strokeWidth="1.6" /></>, // split sphere
  (b, h) => <><path d="M12 4l9 8-9 8-9-8z" fill={b} /><circle cx="12" cy="4.6" r="2.6" fill={h} /><circle cx="12" cy="12" r="3.2" fill={h} /><circle cx="12" cy="19.4" r="2.6" fill={h} /></>, // diamond with beads
  (b, h) => <><path d="M12 1.5l9.1 5.25v10.5L12 22.5l-9.1-5.25V6.75z" fill={b} /><path d="M12 7l4.3 2.5v5L12 17l-4.3-2.5v-5z" fill={h} /></>, // hexagon
  (b, h) => <><circle cx="8" cy="8" r="5.2" fill={b} /><circle cx="16" cy="8" r="5.2" fill={b} /><circle cx="8" cy="16" r="5.2" fill={b} /><circle cx="16" cy="16" r="5.2" fill={b} /><circle cx="12" cy="12" r="4" fill={h} /></>, // clover
  (b, h) => <><path d="M12 2l10 18H2z" fill={b} /><path d="M12 9.5l5 9H7z" fill={h} /></>, // peak
  (b, h) => <><circle cx="12" cy="12" r="10" fill={b} /><circle cx="12" cy="12" r="5.5" fill="none" stroke={h} strokeWidth="3" /></>, // ring
  (b, h) => <><rect x="3" y="3" width="18" height="18" rx="4" fill={b} /><rect x="8" y="8" width="8" height="8" rx="2" fill={h} transform="rotate(45 12 12)" /></> // tile
]
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
export function Logo({ tool, size = 18 }: { tool: Tool; size?: number }) {
  const h = hash(tool.toolUseId ?? tool.id ?? ''), [base, light] = PALETTE[(h >>> 4) % PALETTE.length]
  return <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0">{SHAPES[h % SHAPES.length](base, light)}</svg>
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
