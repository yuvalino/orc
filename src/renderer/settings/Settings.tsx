import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, Keyboard, Pencil, Search, Settings as Cog, User } from 'lucide-react'
import { SHORTCUTS, comboOf, showCombo, type ShortcutAction } from '../lib/shortcuts'
import { Resizer } from '../lib/Resizer'
import { PANE, useStore, type SettingsTab } from '../stores/store'

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode; keywords: string; disabled?: boolean }[] = [
  { id: 'general', label: 'General', icon: <Cog size={16} />, keywords: '', disabled: true },
  { id: 'personalization', label: 'Personalization', icon: <User size={16} />, keywords: 'custom instructions claude.md memory' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: <Keyboard size={16} />, keywords: 'keys hotkeys keybindings' }
]

const field = 'flex items-center gap-2.5 rounded-full border border-line-strong bg-[#2f2f2f] px-3.5 text-fg-2 focus-within:border-[#4a4a4a]' // a little lighter than the panes around it
const card = 'rounded-2xl border border-line-strong bg-[#212121]'

/** The settings screen: tabs and their search on the left, the open tab on the right. Covers the window below its title bar. */
export function Settings() {
  const { settings, setSettings, widths, setWidth } = useStore()
  const [query, setQuery] = useState('')
  if (!settings) return null
  const q = query.trim().toLowerCase()
  const tabs = TABS.filter((t) => !q || `${t.label} ${t.keywords}`.toLowerCase().includes(q))
  return (
    <div className="flex min-h-0 flex-1 select-none"> {/* all chrome; its text boxes opt back in */}
      <nav style={{ width: widths.settings }} className="relative flex shrink-0 flex-col bg-bg-sidebar px-3 pt-5">
        <Resizer edge="right" width={widths.settings} {...PANE.settings} onResize={(w) => setWidth('settings', w)} />
        <h1 className="px-2 text-[19px] font-semibold text-fg-bright">Settings</h1>
        <label className={`${field} mt-4 py-[7px]`}>
          <Search size={16} className="shrink-0" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search settings" className="min-w-0 flex-1 select-text bg-transparent text-[14px] text-fg-bright outline-none placeholder:text-fg-2" />
        </label>
        <div className="mt-4 flex flex-col gap-0.5">
          {tabs.map((t) => (
            <button key={t.id} disabled={t.disabled} onClick={() => setSettings({ tab: t.id })}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[14px] ${t.disabled ? 'text-fg-3' : settings.tab === t.id ? 'bg-bg-active text-fg-bright' : 'text-fg-sub hover:bg-bg-hover hover:text-fg-bright'}`}>
              {t.icon}{t.label}
            </button>
          ))}
          {tabs.length === 0 && <div className="px-2.5 py-1.5 text-[13px] text-fg-3">No matching settings</div>}
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto bg-bg">
        {settings.tab === 'personalization' && (settings.editing === 'instructions' ? <InstructionsEditor /> : <Personalization />)}
        {settings.tab === 'shortcuts' && <KeyboardShortcuts />}
      </main>
    </div>
  )
}

const Page = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mx-auto max-w-[728px] px-8 pb-16 pt-[72px]">
    <h2 className="text-[28px] font-semibold text-fg-bright">{title}</h2>
    {children}
  </div>
)

const INSTRUCTIONS = { title: 'Claude Code instructions', detail: 'Edit the CLAUDE.md file in your Claude folder (~/.claude), on the machine your chats run on. Project instructions may also apply.' }

function Personalization() {
  const setSettings = useStore((s) => s.setSettings)
  return (
    <Page title="Personalization">
      <h3 className="mt-12 text-[15px] font-semibold text-fg-bright">Custom instructions</h3>
      <button onClick={() => setSettings({ tab: 'personalization', editing: 'instructions' })} className={`${card} mt-3 flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-[#262626]`}>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-fg-bright">{INSTRUCTIONS.title}</span>
          <span className="block text-[12.5px] text-fg-2">{INSTRUCTIONS.detail}</span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-fg-2" />
      </button>
    </Page>
  )
}

/** The user's CLAUDE.md, edited whole. Save stays off until the text changes; Back and Cancel drop the edit. */
function InstructionsEditor() {
  const setSettings = useStore((s) => s.setSettings)
  const [saved, setSaved] = useState<string | null>(null) // null while loading
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { window.orc.instructions.get().then((r) => { setSaved(r.text ?? ''); setText(r.text ?? ''); requestAnimationFrame(() => ref.current?.focus()) }) }, [])
  const back = () => setSettings({ tab: 'personalization' })
  const save = async () => { setSaving(true); try { await window.orc.instructions.set(text); back() } finally { setSaving(false) } }
  const changed = saved !== null && text !== saved
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center px-8 pt-4">
        <button onClick={back} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-fg-sub hover:text-fg-bright"><ArrowLeft size={15} /> Back</button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={back} className="rounded-full bg-[#2c2c2c] px-3.5 py-1.5 text-[13px] text-fg-bright hover:bg-[#363636]">Cancel</button>
          <button onClick={save} disabled={!changed || saving} className="rounded-full bg-fg-bright px-3.5 py-1.5 text-[13px] font-medium text-bg hover:bg-white disabled:bg-[#4a4a4a] disabled:text-fg-2">Save</button>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[728px] px-8 pb-16 pt-9">
        <h2 className="text-[28px] font-semibold text-fg-bright">{INSTRUCTIONS.title}</h2>
        <p className="mt-1 text-[13px] text-fg-2">{INSTRUCTIONS.detail}</p>
        <textarea ref={ref} value={text} disabled={saved === null} onChange={(e) => setText(e.target.value)} placeholder="Add your custom instructions..." aria-label={INSTRUCTIONS.title}
          className="mt-6 h-[260px] w-full select-text resize-y rounded-xl border border-line-strong bg-[#2a2a2a] px-3 py-2.5 text-[14px] leading-relaxed text-fg-bright outline-none placeholder:text-fg-2 focus:border-accent" />
      </div>
    </div>
  )
}

function KeyboardShortcuts() {
  const { shortcuts, setShortcut } = useStore()
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<{ action: ShortcutAction; index: number } | null>(null)
  const q = query.trim().toLowerCase()
  const rows = SHORTCUTS.filter((s) => !q || `${s.name} ${s.desc} ${shortcuts[s.id].map(showCombo).join(' ')}`.toLowerCase().includes(q))
  const record = (e: React.KeyboardEvent, action: ShortcutAction, index: number) => {
    e.preventDefault(); e.stopPropagation() // the keys go to the recorder, not to the app
    if (e.key === 'Escape') return setRecording(null)
    const combo = comboOf(e.nativeEvent)
    if (combo) { setShortcut(action, index, combo); setRecording(null) }
  }
  return (
    <Page title="Keyboard shortcuts">
      <label className={`${field} mt-8 py-2`}>
        <Search size={16} className="shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search shortcuts" aria-label="Search shortcuts" className="min-w-0 flex-1 select-text bg-transparent text-[14px] text-fg-bright outline-none placeholder:text-fg-2" />
      </label>
      <div className={`${card} mt-6 px-4`}>
        {rows.map((s) => {
          const list = shortcuts[s.id].length ? shortcuts[s.id] : ['']
          return (
            <div key={s.id} className="grid grid-cols-[1fr_250px] items-center gap-4 border-b border-line py-3.5 last:border-b-0">
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-fg-bright">{s.name}</div>
                <div className="text-[12.5px] text-fg-2">{s.desc}</div>
              </div>
              <div className="flex flex-col gap-1.5">
                {list.map((combo, i) => recording?.action === s.id && recording.index === i ? (
                  <div key={i} className="flex items-center gap-3">
                    <input autoFocus readOnly placeholder="Press shortcut" aria-label={`New shortcut for ${s.name}`} onKeyDown={(e) => record(e, s.id, i)} onBlur={() => setRecording(null)}
                      className="w-[150px] rounded-lg border border-accent bg-bg px-2.5 py-1 text-[13px] text-fg-bright outline-none placeholder:text-fg-bright" />
                    <button onMouseDown={(e) => e.preventDefault()} onClick={() => setRecording(null)} className="text-[13px] text-fg-2 hover:text-fg-bright">Cancel</button>
                  </div>
                ) : (
                  <div key={i} className="flex items-center gap-2">
                    {combo ? <kbd className="rounded-md bg-[#2e2e2e] px-2 py-0.5 font-sans text-[12px] text-fg-sub">{showCombo(combo)}</kbd> : <span className="text-[13px] text-fg-2">Unassigned</span>}
                    <button onClick={() => setRecording({ action: s.id, index: i })} title={`Change shortcut for ${s.name}`} className="rounded p-1 text-fg-2 hover:text-fg-bright"><Pencil size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        {rows.length === 0 && <div className="py-4 text-[13px] text-fg-2">No matching shortcuts</div>}
      </div>
    </Page>
  )
}
