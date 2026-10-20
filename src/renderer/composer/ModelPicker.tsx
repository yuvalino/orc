import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import type { Session } from '@shared/types'
import { useStore } from '../stores/store'

const EFFORT: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-High', max: 'Max' }
const label = (e: string) => EFFORT[e] ?? e
const name = (s: string) => s.replace(/ \(recommended\)$/, '')

/** Composer button "<model> <effort>": opens the effort slider; the model link inside it opens the model list. */
export function ModelPicker({ session }: { session: Session | null }) {
  const { models, update, defaults, setDefaults } = useStore()
  const status = useStore((s) => (session ? s.status[session.id] : undefined))
  const [view, setView] = useState<null | 'effort' | 'models'>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!view) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setView(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [view])

  // Aliases only (the dated ids are noise), and no "Default" entry: no model chosen shows the model it stands for, named in its description.
  const fallback = models.find((m) => m.value === 'default'), standsFor = fallback?.description?.split(' · ')[0]
  const aliases = models.filter((m) => !m.value.startsWith('claude-') && m.value !== 'default')
  const choices = aliases.length ? aliases : fallback ? [fallback] : []
  const sel = session ?? defaults // without a session the choice becomes the default for the next chat
  const current = choices.find((m) => m.value === sel.model) ?? choices.find((m) => name(m.displayName) === standsFor) ?? choices[0]
  if (!current) return null
  const levels = current.effortLevels ?? [], effort = sel.effort && levels.includes(sel.effort) ? sel.effort : null
  // Never "Default": no level chosen shows the one the CLI will actually use — the running chat's, else the model's own default.
  const live = status && status.state !== 'closed' ? status.effort : undefined
  const modelDefault = sel.model ? current.defaultEffort : fallback?.defaultEffort ?? current.defaultEffort
  const shown = [effort, live, modelDefault].find((e) => e && levels.includes(e)) ?? null
  const idx = Math.max(0, levels.indexOf(shown ?? 'medium')), pct = levels.length > 1 ? (idx / (levels.length - 1)) * 100 : 0
  const set = (patch: { model?: string | null; effort?: string | null }) => (session ? update(session.id, patch) : setDefaults(patch))
  const pick = (m: typeof current) => set({ model: m.value === 'default' ? null : m.value, ...(sel.effort && !m.effortLevels?.includes(sel.effort) ? { effort: null } : {}) }) // an effort the new model lacks resets
  const pop = 'absolute bottom-full right-0 z-50 mb-2 w-[250px] select-none whitespace-normal rounded-xl border border-line-strong bg-bg-composer shadow-xl' // wraps long descriptions (the composer row it sits in doesn't wrap)

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setView((v) => (v ? null : 'effort'))} className={`flex items-center gap-[5px] rounded-md px-2.5 py-[5px] text-[13px] text-fg-2 hover:bg-bg-hover hover:text-fg ${view ? 'bg-bg-active' : ''}`}>
        {view ? (view === 'effort' ? 'Select effort' : 'Select model') : <><span className="text-fg-bright">{name(current.displayName)}</span>{shown && <span>{label(shown)}</span>}</>}<ChevronDown size={10} />
      </button>
      {view === 'effort' && (
        <div className={`${pop} p-4 text-center`}>
          <button onClick={() => set({ effort: null })} title="Reset to default" className="absolute right-3 top-3 text-fg-2 hover:text-fg-bright"><RotateCcw size={14} /></button>
          <div className="text-[14px] font-semibold text-accent">{shown ? label(shown) : 'Model default'}</div>
          <button onClick={() => setView('models')} className="mx-auto mt-0.5 flex items-center gap-0.5 text-[12px] text-fg-sub hover:text-fg-bright">{name(current.displayName)}<ChevronRight size={12} /></button>
          {levels.length > 1 && (
            <>
              <input type="range" min={0} max={levels.length - 1} value={idx} onChange={(e) => set({ effort: levels[Number(e.target.value)] })} className="effort mt-3 w-full" style={{ background: `linear-gradient(to right, var(--color-accent) ${pct}%, #3a3a3a ${pct}%)` }} />
              <div className="mt-1 flex justify-between text-[10px] text-fg-2">{levels.map((l) => <span key={l}>{label(l)}</span>)}</div>
            </>
          )}
        </div>
      )}
      {view === 'models' && (
        <div className={`${pop} p-1`}>
          <div className="px-2.5 pb-1 pt-1.5 text-[12px] text-fg-2">Select model</div>
          {choices.map((m) => (
            <button key={m.value} onClick={() => { pick(m); setView('effort') }} className="flex w-full items-center rounded-md px-2.5 py-1.5 text-[13px] hover:bg-bg-hover">
              <span className="flex flex-col"><span className={m.value === current.value ? 'text-fg-bright' : 'text-fg-sub'}>{name(m.displayName)}</span>{m.description && <span className="text-[11px] text-fg-2">{m.description}</span>}</span>
              {m.value === current.value && <span className="ml-auto text-fg-bright">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
