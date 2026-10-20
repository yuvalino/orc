import { useState } from 'react'
import { ChevronRight, Folder, FolderOpen, Loader2, Pencil, Pin, PinOff, Plus, Search, Settings, SquarePen, Trash2 } from 'lucide-react'
import type { Project, Session } from '@shared/types'
import { Collapse } from '../lib/Collapse'
import { Menu, useContextMenu } from '../lib/Menu'
import { Resizer } from '../lib/Resizer'
import { PANE, sessionTitle, useStore } from '../stores/store'
import { showCombo } from '../lib/shortcuts'
import logo from '../assets/logo.png'

export function Sidebar() {
  const { projects, sessions, newChat, openPalette, openSettings, transport, widths, setWidth, activeId, activeRow, shortcuts, collapsed } = useStore()
  const recent = [...sessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  const pinned = recent.filter((s) => s.isPinned)
  const projectChats = (p: Project) => recent.filter((s) => s.projectId === p.id)
  // A chat can be listed more than once (pinned, under its project, in recents): highlight only the row it was opened from,
  // or its first unfolded row when it was opened elsewhere (search, a new chat).
  const has = (list: Session[]) => list.some((s) => s.id === activeId)
  const rows = [!collapsed.pinned && has(pinned) && 'pinned', ...projects.map((p) => !collapsed.projects && !collapsed[`project:${p.id}`] && has(projectChats(p).slice(0, 5)) && `project:${p.id}`), !collapsed.recents && has(recent.slice(0, 20)) && 'recents'].filter(Boolean) as string[]
  const lit = activeRow && rows.includes(activeRow) ? activeRow : rows[0]
  return (
    <aside className="relative flex w-full select-none flex-col bg-bg-sidebar"> {/* all chrome: nothing here is text to select (the rename box opts back in) */}
      <Resizer edge="right" width={widths.sidebar} {...PANE.sidebar} onResize={(w) => setWidth('sidebar', w)} />
      <div className="flex items-center justify-between pb-1.5 pl-4 pr-3 pt-2">
        <span className="flex items-center gap-2 text-[16px] font-semibold text-fg-bright"><img src={logo} alt="" className="size-[32px]" draggable={false} />orc{transport?.kind === 'remote' && <span className="rounded-md bg-accent/20 px-1.5 py-0.5 text-[11px] font-medium text-[#93b4ff]">ssh: {transport.host}</span>}</span>
        <button onClick={() => openPalette('chats')} title={`Search chats${shortcuts.search[0] ? ` (${showCombo(shortcuts.search[0])})` : ''}`} className="no-drag flex size-8 items-center justify-center rounded-md text-fg-2 hover:bg-bg-hover hover:text-fg-bright"><Search size={18} strokeWidth={1.8} /></button>
      </div>
      <button onClick={() => newChat()} className="mb-1 mt-1.5 flex w-full items-center gap-2 py-[5px] pl-[18px] pr-4 text-[14px] text-fg-bright hover:bg-bg-hover"><SquarePen size={15} /> New chat</button>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-0.5">
        {pinned.length > 0 && <Section id="pinned" label="Pinned" first ids={pinned.map((s) => s.id)}>{pinned.map((s) => <ChatRow key={s.id} s={s} row="pinned" lit={lit} />)}</Section>}
        <Section id="projects" label="Projects" first={pinned.length === 0} ids={recent.filter((s) => s.projectId).map((s) => s.id)} action={<AddProject />}>
          {projects.length === 0 && <Empty>No projects yet</Empty>}
          {projects.map((p) => <ProjectRow key={p.id} p={p} chats={projectChats(p)} lit={lit} />)}
        </Section>
        {recent.length > 0 && (
          <Section id="recents" label="Recents" ids={recent.slice(0, 20).map((s) => s.id)} action={<button onClick={() => newChat()} title="New chat" className="rounded p-0.5 text-fg-3 hover:text-fg"><SquarePen size={14} /></button>}>
            {recent.slice(0, 20).map((s) => <ChatRow key={s.id} s={s} row="recents" lit={lit} />)}
          </Section>
        )}
      </div>
      <div className="flex shrink-0 items-center px-3 pb-3 pt-1.5">
        <Menu beside animate="bottom" items={[{ label: 'Settings', icon: <Settings size={14} />, hint: shortcuts.settings[0] && showCombo(shortcuts.settings[0]), onSelect: () => openSettings() }]}
          trigger={(open) => <button title="Settings" className={`flex size-8 items-center justify-center rounded-md hover:bg-bg-hover hover:text-fg-bright ${open ? 'bg-bg-active text-fg-bright' : 'text-fg-2'}`}><Settings size={18} strokeWidth={1.8} /></button>} />
      </div>
    </aside>
  )
}

/**
 * A titled group that folds on a click of its title. Folded, its title shows a › and the combined status of the chats inside;
 * open, the arrow (turned down) shows only while hovered. `ids`: the chats it holds.
 */
function Section({ id, label, ids, action, first, children }: { id: string; label: string; ids: string[]; action?: React.ReactNode; first?: boolean; children: React.ReactNode }) {
  const { collapsed, toggleCollapsed } = useStore()
  const open = !collapsed[id]
  return (
    <div>
      <div role="button" aria-expanded={open} onClick={() => toggleCollapsed(id)} className={`group flex h-[26px] select-none items-center gap-1 rounded-md px-2.5 text-[12px] font-medium text-fg-label hover:text-fg ${first ? 'mt-0.5' : 'mt-1.5'}`}>
        {label}
        <ChevronRight size={12} strokeWidth={2.2} className={`transition-transform duration-200 ${open ? 'rotate-90 opacity-0 group-hover:opacity-100' : ''}`} />
        <span className="ml-auto flex items-center">
          {!open && <span className="flex group-hover:hidden"><Indicator ids={ids} /></span>}
          {action && <span onClick={(e) => e.stopPropagation()} className="hidden group-hover:flex">{action}</span>}
        </span>
      </div>
      <Collapse open={open}>{children}</Collapse>
    </div>
  )
}
const Empty = ({ children }: { children: React.ReactNode }) => <div className="px-2.5 py-1 text-[13px] text-fg-3">{children}</div>

function AddProject() {
  const addProject = useStore((s) => s.addProject)
  return <button onClick={addProject} title="Add project" className="rounded p-0.5 text-fg-3 hover:text-fg"><Plus size={14} /></button>
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

/** A project folds its chats on a click (open folder ↔ closed folder); folded, it shows their combined status. */
function ProjectRow({ p, chats, lit }: { p: Project; chats: Session[]; lit?: string }) {
  const { newChat, draftProjectId, activeId, collapsed, toggleCollapsed } = useStore()
  const key = `project:${p.id}`, open = !collapsed[key], name = p.name ?? p.path.split(/[\\/]/).pop()
  const selected = !activeId && draftProjectId === p.id
  const ctx = useContextMenu(() => [{ label: 'New chat', icon: <SquarePen size={14} />, onSelect: () => newChat(p.id) }, 'separator', { label: 'Remove project', icon: <Trash2 size={14} />, danger: true, onSelect: () => confirm(`Remove "${name}" and its ${chats.length} chat${chats.length === 1 ? '' : 's'}?`) && window.orc.projects.remove(p.id) }])
  return (
    <div>
      <div role="button" aria-expanded={open} onClick={() => toggleCollapsed(key)} onContextMenu={ctx.onContextMenu} className={`group flex select-none items-center gap-[7px] rounded-md px-2.5 py-[3px] text-[14px] font-medium text-fg ${selected ? 'bg-bg-active' : 'hover:bg-bg-hover'}`}>
        {open ? <FolderOpen size={16} className="shrink-0 text-fg-2" /> : <Folder size={16} className="shrink-0 text-fg-2" />}
        <span className="truncate">{name}</span>
        <Trailing indicator={!open && <Indicator ids={chats.map((c) => c.id)} />}>
          <button title={`New chat in ${name}`} onClick={(e) => { e.stopPropagation(); newChat(p.id) }} className="rounded p-0.5 text-fg-3 hover:text-fg"><SquarePen size={14} /></button>
        </Trailing>
        {ctx.menu}
      </div>
      <Collapse open={open}>{chats.slice(0, 5).map((s) => <ChatRow key={s.id} s={s} row={key} lit={lit} nested />)}</Collapse>
    </div>
  )
}

/** Pin is a tilted pin: outlined to pin, filled when pinned (to unpin). */
const PinIcon = ({ filled, off }: { filled?: boolean; off?: boolean }) => off ? <PinOff size={14} className="rotate-45" /> : <Pin size={14} className="rotate-45" fill={filled ? 'currentColor' : 'none'} />

function ChatRow({ s, row, lit, nested }: { s: Session; row: string; lit?: string; nested?: boolean }) {
  const { activeId, select, update } = useStore()
  const [renaming, setRenaming] = useState(false) // window.prompt() is unavailable in Electron, so the title is edited in place
  const commit = (t: string) => { setRenaming(false); if (t.trim() && t.trim() !== sessionTitle(s)) update(s.id, { title: t.trim() }) }
  const ctx = useContextMenu(() => [
    { label: 'Rename', icon: <Pencil size={14} />, onSelect: () => setRenaming(true) },
    { label: s.isPinned ? 'Unpin' : 'Pin', icon: <PinIcon off={s.isPinned} />, onSelect: () => update(s.id, { isPinned: !s.isPinned }) },
    'separator',
    { label: 'Permanently delete', icon: <Trash2 size={14} />, danger: true, onSelect: () => confirm(`Permanently delete "${sessionTitle(s)}"?`) && window.orc.sessions.remove(s.id) }
  ])
  const active = activeId === s.id && row === lit
  return (
    <div onClick={() => select(s.id, row)} onContextMenu={ctx.onContextMenu} className={`group flex cursor-default select-none items-center gap-2 rounded-md py-[3px] pr-1 text-[14px] ${nested ? 'pl-[38px]' : 'pl-2.5'} ${active ? 'bg-bg-active text-fg-bright' : 'text-fg-sub hover:bg-bg-hover hover:text-fg-bright'}`}>
      {renaming
        ? <input autoFocus defaultValue={sessionTitle(s)} aria-label="Chat title" onClick={(e) => e.stopPropagation()} onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(e.currentTarget.value); if (e.key === 'Escape') setRenaming(false) }}
            className="min-w-0 flex-1 select-text rounded bg-bg px-1 text-[14px] text-fg-bright outline-none" />
        : <span className="truncate">{sessionTitle(s)}</span>}
      <Trailing indicator={<Indicator ids={[s.id]} />}>
        <button title={s.isPinned ? 'Unpin' : 'Pin'} onClick={(e) => { e.stopPropagation(); update(s.id, { isPinned: !s.isPinned }) }} className="rounded p-0.5 text-fg-3 hover:text-fg"><PinIcon filled={s.isPinned} /></button>
      </Trailing>
      {ctx.menu}
    </div>
  )
}
