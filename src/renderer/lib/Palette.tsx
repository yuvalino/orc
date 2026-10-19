import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, FolderOpen, MessageSquare, Search, SquarePen } from 'lucide-react'
import { sessionTitle, useStore } from '../stores/store'

interface Row { key: string; icon: React.ReactNode; label: string; detail?: string; run: () => void }

/** ⌘K command palette: search chats and run actions, or (files mode) pick a project file into the composer. */
export function Palette() {
  const { palette, closePalette, openPalette, sessions, projects, draftProjectId, activeId, select, newChat, setDraft, draft } = useStore()
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const input = useRef<HTMLInputElement>(null)
  const active = sessions.find((s) => s.id === activeId)
  const projectId = active ? active.projectId : draftProjectId // an open no-project chat has no files to search, whatever the draft says

  useEffect(() => { setQ(''); setCursor(0); setFiles([]); if (palette) setTimeout(() => input.current?.focus()) }, [palette])
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
    const chats = [...sessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt).filter((s) => hit(sessionTitle(s))).slice(0, 8)
      .map((s) => ({ key: s.id, icon: <MessageSquare size={14} />, label: sessionTitle(s), detail: projects.find((p) => p.id === s.projectId)?.name ?? undefined, run: () => select(s.id) }))
    const actions: Row[] = [
      { key: 'new', icon: <SquarePen size={14} />, label: 'New chat', run: () => newChat() },
      { key: 'open', icon: <FolderOpen size={14} />, label: 'Open folder…', run: () => window.orc.projects.add().then((p) => p && newChat(p.id)) },
      { key: 'files', icon: <Search size={14} />, label: 'Search files…', detail: projectId ? undefined : 'Choose a project first', run: () => projectId && setTimeout(() => openPalette('files')) }
    ].filter((a) => hit(a.label))
    return [{ title: 'Chats', rows: chats }, { title: 'Actions', rows: actions }].filter((g) => g.rows.length)
  }, [palette, q, files, sessions, projects, projectId, draft])

  const flat = groups.flatMap((g) => g.rows)
  const pick = (r: Row) => { closePalette(); r.run() }
  if (!palette) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-[15vh]" onMouseDown={(e) => e.target === e.currentTarget && closePalette()}>
      <div className="w-[560px] overflow-hidden rounded-xl border border-line-strong bg-bg-sidebar shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={16} className="text-fg-2" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setCursor(0) }} placeholder={palette === 'files' ? 'Search files' : 'Search chats'}
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
