import { useEffect, useRef } from 'react'
import { ArrowUp, ChevronDown, Folder, ShieldCheck, Square } from 'lucide-react'
import type { ApprovalMode } from '@shared/types'
import { Menu } from '../lib/Menu'
import { COMPOSER_PAD, useActive, useStore } from '../stores/store'
import { ModelPicker } from './ModelPicker'

const MODE_LABEL: Record<ApprovalMode, string> = { ask: 'Ask for approval', auto: 'Auto mode', 'full-access': 'Bypass permissions', 'accept-edits': 'Accept edits', 'read-only': 'Read only' }
const MENU: { mode: ApprovalMode; detail: string; tone?: string }[] = [
  { mode: 'ask', detail: 'Prompt before edits and commands' },
  { mode: 'auto', detail: 'A classifier approves routine actions' },
  { mode: 'full-access', detail: 'Never ask. Claude can do anything on this machine.', tone: 'text-bypass' }
]

const btn = 'flex items-center gap-[5px] rounded-md px-2.5 py-[5px] text-[13px] hover:bg-bg-hover' // text color per use: two color classes would clash

export function Composer() {
  const { session, project } = useActive()
  const { projects, send, interrupt, update, newChat, status, draft, setDraft, defaults, setDefaults, addProject, openPalette } = useStore()
  const ref = useRef<HTMLTextAreaElement>(null)
  const running = session ? ['running', 'starting'].includes(status[session.id]?.state ?? '') : false
  const mode = session?.approvalMode ?? defaults.approvalMode
  const projectName = (p = project) => p ? (p.name ?? p.path.split(/[\\/]/).pop()) : 'No project'
  const projectItems = [
    { label: 'No project', detail: 'Runs in your home folder', active: !project, onSelect: () => newChat(null) },
    ...projects.map((p) => ({ label: projectName(p)!, detail: p.path, active: p.id === project?.id, onSelect: () => newChat(p.id) })),
    { label: 'Open folder…', onSelect: addProject },
    { label: 'Remote…', detail: 'Work on another machine over ssh', onSelect: () => openPalette('hosts') }
  ]

  useEffect(() => {
    const el = ref.current; if (!el) return
    el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 220) + 'px'
  }, [draft])
  const row = useRef<HTMLDivElement>(null), ro = useRef<ResizeObserver>(null)
  useEffect(() => { // a longer label (another mode or model), or a narrower window, can push the side panes in
    const fit = () => useStore.getState().fitPanes()
    ro.current = new ResizeObserver(fit)
    window.addEventListener('resize', fit)
    return () => { ro.current?.disconnect(); window.removeEventListener('resize', fit) }
  }, [])
  useEffect(() => { for (const k of row.current?.children ?? []) ro.current?.observe(k) }) // every render: the model picker mounts once models load
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && running && !useStore.getState().palette && !(e.target instanceof HTMLInputElement)) interrupt() } // Esc closes the palette or cancels an inline edit first
    window.addEventListener('keydown', onKey, true) // capture: runs before the palette closes itself
    return () => window.removeEventListener('keydown', onKey, true)
  }, [running])

  const submit = async () => {
    const t = draft.trim()
    if (!t || running) return
    setDraft(''); send(t)
  }
  const setMode = (m: ApprovalMode) => session ? update(session.id, { approvalMode: m }) : setDefaults({ approvalMode: m })

  return (
    <div style={{ paddingInline: `clamp(${COMPOSER_PAD.min}px, ${COMPOSER_PAD.share * 100}%, ${COMPOSER_PAD.max}px)` }} className="pb-3.5 pt-2">
      {!session && (
        <Menu up className="mx-3" trigger={<button data-testid="project-picker" className="flex w-full items-center gap-2 rounded-t-xl bg-[#272727] px-4 py-2 text-[13px] text-fg-sub hover:text-fg-bright"><Folder size={14} />{projectName()}<ChevronDown size={11} /></button>} items={projectItems} />
      )}
      <div className="rounded-[14px] bg-bg-composer">
        <textarea ref={ref} value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} placeholder="Work with Orc" autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
          className="block w-full resize-none bg-transparent px-4 pb-1.5 pt-3.5 text-[14px] leading-normal outline-none placeholder:text-fg-3" />
        <div ref={row} data-composer-row className="flex items-center gap-0.5 whitespace-nowrap px-2 pb-2 pt-1 [&>*]:shrink-0">
          <Menu up trigger={<button className={`${btn} ${mode === 'full-access' ? 'text-bypass' : 'text-fg-2 hover:text-fg'}`}><ShieldCheck size={15} />{MODE_LABEL[mode]}</button>}
            items={MENU.map((m) => ({ label: MODE_LABEL[m.mode], detail: m.detail, tone: m.tone, active: m.mode === mode, onSelect: () => setMode(m.mode) }))} />
          <div data-spacer className="flex-1 !shrink" />
          <ModelPicker session={session} />
          {running
            ? <button onClick={interrupt} className="ml-1 flex size-8 items-center justify-center rounded-full bg-fg-bright text-bg" title="Stop (Esc)"><Square size={12} fill="currentColor" /></button>
            : <button onClick={submit} disabled={!draft.trim()} className="ml-1 flex size-8 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40" title="Send"><ArrowUp size={16} strokeWidth={2.5} /></button>}
        </div>
      </div>
    </div>
  )
}
