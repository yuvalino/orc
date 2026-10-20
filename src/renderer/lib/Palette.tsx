import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CornerLeftUp, FileText, Folder, FolderOpen, KeyRound, MessageSquare, Plus, Search, Server, SquarePen, Trash2 } from 'lucide-react'
import { sessionTitle, useStore } from '../stores/store'

interface Row { key: string; icon: React.ReactNode; label: string; detail?: string; keep?: boolean; run: () => void } // keep: the palette stays open (navigation)
type Listing = { path: string; dirs: string[]; parent: string | null }

const PLACEHOLDER = { chats: 'Search chats', files: 'Search files', hosts: 'user@host', folders: 'Filter folders', signin: 'Paste the output of `claude setup-token`' }

/** Command palette (Ctrl/⌘+P): chats and actions; files mode inserts a project file into the composer; hosts opens a remote instance; folders picks a project on a remote host; signin stores the Claude token used on remote hosts. */
export function Palette() {
  const { palette, closePalette, openPalette, sessions, projects, draftProjectId, activeId, select, newChat, addProject, setDraft, draft } = useStore()
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const [hosts, setHosts] = useState<string[]>([])
  const [signedIn, setSignedIn] = useState(false)
  const [dir, setDir] = useState<Listing | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const active = sessions.find((s) => s.id === activeId)
  const projectId = active ? active.projectId : draftProjectId // an open no-project chat has no files to search, whatever the draft says

  useEffect(() => {
    setQ(''); setCursor(0); setFiles([]); setDir(null)
    if (palette) setTimeout(() => input.current?.focus())
    if (palette === 'hosts') window.orc.transport.hosts().then(setHosts)
    if (palette === 'signin') window.orc.transport.signedIn().then(setSignedIn)
    if (palette === 'folders') window.orc.projects.browse().then(setDir)
  }, [palette])
  useEffect(() => {
    if (palette !== 'files' || !projectId) return
    let live = true
    window.orc.projects.files(projectId, q).then((f) => live && setFiles(f))
    return () => { live = false }
  }, [palette, projectId, q])

  const groups = useMemo<{ title: string; rows: Row[] }[]>(() => {
    const ql = q.toLowerCase()
    const hit = (s: string) => s.toLowerCase().includes(ql)
    if (palette === 'files') return [{ title: 'Files', rows: files.map((f) => ({ key: f, icon: <FileText size={14} />, label: f, run: () => setDraft(draft + (draft && !draft.endsWith(' ') ? ' ' : '') + '@' + f + ' ') })) }]
    if (palette === 'hosts') {
      const rows: Row[] = hosts.filter(hit).map((h) => ({ key: h, icon: <Server size={14} />, label: h, run: () => window.orc.transport.open(h) }))
      if (q && !hosts.includes(q)) rows.push({ key: 'new', icon: <Plus size={14} />, label: `Connect to ${q}`, run: () => window.orc.transport.open(q) })
      return [{ title: 'Hosts', rows }]
    }
    if (palette === 'signin') {
      const t = q.trim(), rows: Row[] = []
      if (t) rows.push({ key: 'save', icon: <KeyRound size={14} />, label: 'Save token for remote hosts', detail: `${t.slice(0, 12)}…`, run: () => window.orc.transport.signIn(t) })
      else rows.push({ key: 'how', icon: <KeyRound size={14} />, label: signedIn ? 'Signed in for remote hosts' : 'Not signed in', detail: 'Run `claude setup-token`, paste it here', keep: true, run: () => {} })
      if (signedIn) rows.push({ key: 'forget', icon: <Trash2 size={14} />, label: 'Forget token', run: () => window.orc.transport.signIn(null) })
      return [{ title: 'Remote sign-in', rows }]
    }
    if (palette === 'folders') {
      if (!dir) return []
      const go = (path: string) => { setQ(''); setCursor(0); window.orc.projects.browse(path).then(setDir) }
      const rows: Row[] = [{ key: 'use', icon: <Check size={14} />, label: `Use ${dir.path}`, run: () => window.orc.projects.add(dir.path).then((p) => p && newChat(p.id)) }]
      if (dir.parent) rows.push({ key: '..', icon: <CornerLeftUp size={14} />, label: '..', detail: dir.parent, keep: true, run: () => go(dir.parent!) })
      rows.push(...dir.dirs.filter(hit).map((d) => ({ key: d, icon: <Folder size={14} />, label: d, keep: true, run: () => go(`${dir.path.replace(/[\\/]$/, '')}/${d}`) })))
      return [{ title: 'Folders', rows }]
    }
    const chats = [...sessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt).filter((s) => hit(sessionTitle(s))).slice(0, 8)
      .map((s) => ({ key: s.id, icon: <MessageSquare size={14} />, label: sessionTitle(s), detail: projects.find((p) => p.id === s.projectId)?.name ?? undefined, run: () => select(s.id) }))
    const actions: Row[] = [
      { key: 'new', icon: <SquarePen size={14} />, label: 'New chat', run: () => newChat() },
      { key: 'open', icon: <FolderOpen size={14} />, label: 'Open folder…', run: () => addProject() },
      { key: 'files', icon: <Search size={14} />, label: 'Search files…', detail: projectId ? undefined : 'Choose a project first', run: () => projectId && setTimeout(() => openPalette('files')) },
      { key: 'remote', icon: <Server size={14} />, label: 'Connect to host…', run: () => setTimeout(() => openPalette('hosts')) },
      { key: 'signin', icon: <KeyRound size={14} />, label: 'Remote sign-in…', run: () => setTimeout(() => openPalette('signin')) }
    ].filter((a) => hit(a.label))
    return [{ title: 'Chats', rows: chats }, { title: 'Actions', rows: actions }].filter((g) => g.rows.length)
  }, [palette, q, files, hosts, signedIn, dir, sessions, projects, projectId, draft])

  const flat = groups.flatMap((g) => g.rows)
  const pick = (r: Row) => { if (!r.keep) closePalette(); r.run() }
  if (!palette) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-[15vh]" onMouseDown={(e) => e.target === e.currentTarget && closePalette()}>
      <div className="w-[560px] overflow-hidden rounded-xl border border-line-strong bg-bg-sidebar shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={16} className="text-fg-2" />
          <input ref={input} value={q} type={palette === 'signin' ? 'password' : 'text'} onChange={(e) => { setQ(e.target.value); setCursor(0) }} placeholder={PLACEHOLDER[palette]}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closePalette()
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
              if (e.key === 'Enter' && flat[cursor]) pick(flat[cursor])
            }}
            className="w-full bg-transparent py-3 text-[15px] outline-none placeholder:text-fg-3" />
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {flat.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-fg-3">No results</div>}
          {groups.map((g) => (
            <div key={g.title} className="mb-1">
              <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-fg-label">{g.title}</div>
              {g.rows.map((r) => {
                const i = flat.indexOf(r)
                return (
                  <button key={r.key} onMouseEnter={() => setCursor(i)} onClick={() => pick(r)} className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] ${i === cursor ? 'bg-bg-active text-fg-bright' : 'text-fg-sub'}`}>
                    <span className="text-fg-2">{r.icon}</span><span className="truncate">{r.label}</span>{r.detail && <span className="ml-auto truncate pl-3 text-[12px] text-fg-3">{r.detail}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
