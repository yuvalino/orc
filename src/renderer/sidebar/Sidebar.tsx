import { useState } from 'react'
import { Folder, Loader2, Pin, PinOff, Plus, Search, SquarePen } from 'lucide-react'
import type { Project, Session } from '@shared/types'
import { useContextMenu } from '../lib/Menu'
import { Resizer } from '../lib/Resizer'
import { PANE, sessionTitle, useStore } from '../stores/store'
import logo from '../assets/logo.png'

export function Sidebar() {
  const { projects, sessions, newChat, openPalette, transport, widths, setWidth } = useStore()
  const recent = [...sessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  const pinned = recent.filter((s) => s.isPinned)
  return (
    <aside style={{ width: widths.sidebar }} className="relative flex shrink-0 flex-col bg-bg-sidebar">
      <Resizer edge="right" width={widths.sidebar} {...PANE.sidebar} onResize={(w) => setWidth('sidebar', w)} />
      <div className="flex items-center justify-between pb-1.5 pl-4 pr-3 pt-2">
        <span className="flex items-center gap-2 text-[16px] font-semibold text-fg-bright"><img src={logo} alt="" className="size-[20px]" draggable={false} />orc{transport?.kind === 'remote' && <span className="rounded-md bg-accent/20 px-1.5 py-0.5 text-[11px] font-medium text-[#93b4ff]">ssh: {transport.host}</span>}</span>
        <button onClick={() => openPalette('chats')} title={`Search chats (${window.orc.platform === 'darwin' ? '⌘P' : 'Ctrl+P'})`} className="no-drag flex size-8 items-center justify-center rounded-md text-fg-2 hover:bg-bg-hover hover:text-fg-bright"><Search size={18} strokeWidth={1.8} /></button>
      </div>
      <button onClick={() => newChat()} className="mb-1 mt-1.5 flex w-full items-center gap-2 py-[5px] pl-[18px] pr-4 text-[14px] text-fg-bright hover:bg-bg-hover"><SquarePen size={15} /> New chat</button>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-0.5">
        {pinned.length > 0 && <Section label="Pinned" first>{pinned.map((s) => <ChatRow key={s.id} s={s} />)}</Section>}
        <Section label="Projects" first={pinned.length === 0} action={<AddProject />}>
          {projects.length === 0 && <Empty>No projects yet</Empty>}
          {projects.map((p) => <ProjectRow key={p.id} p={p} chats={recent.filter((s) => s.projectId === p.id)} />)}
        </Section>
        {recent.length > 0 && <Section label="Recents">{recent.slice(0, 20).map((s) => <ChatRow key={s.id} s={s} />)}</Section>}
      </div>
    </aside>
  )
}

const Section = ({ label, action, first, children }: { label: string; action?: React.ReactNode; first?: boolean; children: React.ReactNode }) => (
  <div>
    <div className={`group flex items-center justify-between px-2.5 pb-0.5 text-[12px] font-medium text-fg-label ${first ? 'pt-1' : 'pt-2'}`}>{label}{action}</div>
    {children}
  </div>
)
const Empty = ({ children }: { children: React.ReactNode }) => <div className="px-2.5 py-1 text-[13px] text-fg-3">{children}</div>

function AddProject() {
  const addProject = useStore((s) => s.addProject)
  return <button onClick={addProject} title="Add project" className="rounded p-0.5 text-fg-3 opacity-0 hover:text-fg group-hover:opacity-100"><Plus size={14} /></button>
}

/** Running → spinner; finished while you were elsewhere → dot; waiting on you → amber dot. */
function Indicator({ ids }: { ids: string[] }) {
  const { status, sessions } = useStore()
  const states = ids.map((id) => status[id]?.state)
  if (states.includes('requires_action')) return <span className="size-2 shrink-0 rounded-full bg-warn" title="Needs your attention" />
  if (states.some((s) => s === 'running' || s === 'starting') || ids.some((id) => status[id]?.tasks)) return <span title="Working" className="flex shrink-0"><Loader2 size={13} className="animate-spin text-fg-2" /></span>
  if (sessions.some((x) => ids.includes(x.id) && x.unread)) return <span className="size-2 shrink-0 rounded-full bg-accent" title="Finished" />
  return null
}

/** A row's right edge: its status indicator, swapped for its buttons while the mouse is over the row. */
function Trailing({ indicator, children }: { indicator: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="ml-auto flex shrink-0 items-center">
      <span className="flex items-center group-hover:hidden">{indicator}</span>
      <span className="hidden items-center gap-0.5 group-hover:flex">{children}</span>
    </span>
  )
}

function ProjectRow({ p, chats }: { p: Project; chats: Session[] }) {
  const { newChat, draftProjectId, activeId } = useStore()
  const selected = !activeId && draftProjectId === p.id
  const ctx = useContextMenu(() => [{ label: 'New chat', onSelect: () => newChat(p.id) }, { label: 'Remove project', danger: true, onSelect: () => confirm(`Remove "${p.name ?? p.path.split(/[\\/]/).pop()}" and its ${chats.length} chat${chats.length === 1 ? '' : 's'}?`) && window.orc.projects.remove(p.id) }])
  return (
    <div>
      <div onClick={() => newChat(p.id)} onContextMenu={ctx.onContextMenu} className={`group flex cursor-pointer items-center gap-[7px] rounded-md px-2.5 py-[3px] text-[14px] font-medium text-fg ${selected ? 'bg-bg-active' : 'hover:bg-bg-hover'}`}>
        <Folder size={16} className="shrink-0 text-fg-2" />
        <span className="truncate">{p.name ?? p.path.split(/[\\/]/).pop()}</span>
        <span className="ml-auto flex shrink-0 items-center"><Indicator ids={chats.map((c) => c.id)} /></span>
        {ctx.menu}
      </div>
      {chats.slice(0, 5).map((s) => <ChatRow key={s.id} s={s} nested />)}
    </div>
  )
}

function ChatRow({ s, nested }: { s: Session; nested?: boolean }) {
  const { activeId, select, update } = useStore()
  const [renaming, setRenaming] = useState(false) // window.prompt() is unavailable in Electron, so the title is edited in place
  const commit = (t: string) => { setRenaming(false); if (t.trim() && t.trim() !== sessionTitle(s)) update(s.id, { title: t.trim() }) }
  const ctx = useContextMenu(() => [
    { label: s.isPinned ? 'Unpin' : 'Pin', onSelect: () => update(s.id, { isPinned: !s.isPinned }) },
    { label: 'Rename', onSelect: () => setRenaming(true) },
    { label: 'Delete', danger: true, onSelect: () => confirm(`Delete "${sessionTitle(s)}"?`) && window.orc.sessions.remove(s.id) }
  ])
  return (
    <div onClick={() => select(s.id)} onContextMenu={ctx.onContextMenu} className={`group flex cursor-pointer items-center gap-2 rounded-md py-[3px] pr-1 text-[14px] ${nested ? 'pl-[38px]' : 'pl-2.5'} ${activeId === s.id ? 'bg-bg-active text-fg-bright' : 'text-fg-sub hover:bg-bg-hover hover:text-fg-bright'}`}>
      {renaming
        ? <input autoFocus defaultValue={sessionTitle(s)} aria-label="Chat title" onClick={(e) => e.stopPropagation()} onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(e.currentTarget.value); if (e.key === 'Escape') setRenaming(false) }}
            className="min-w-0 flex-1 rounded bg-bg px-1 text-[14px] text-fg-bright outline-none" />
        : <span className="truncate">{sessionTitle(s)}</span>}
      <Trailing indicator={<Indicator ids={[s.id]} />}>
        <button title={s.isPinned ? 'Unpin' : 'Pin'} onClick={(e) => { e.stopPropagation(); update(s.id, { isPinned: !s.isPinned }) }} className="rounded p-0.5 text-fg-3 hover:text-fg">{s.isPinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
      </Trailing>
      {ctx.menu}
    </div>
  )
}
