import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import type { Session } from '@shared/types'
import { useStore } from '../stores/store'

const EFFORT: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-High', max: 'Max' }
const label = (e: string) => EFFORT[e] ?? e
const name = (s: string) => s.replace(/ \(recommended\)$/, '')

/**
 * Composer button "<model> <effort>": opens the effort slider; the model link inside it opens the model list. Both are one panel:
 * it fades in from above (and back out), and switching between them changes its height and content in place.
 */
export function ModelPicker({ session }: { session: Session | null }) {
  const { models, update, defaults, setDefaults } = useStore()
  const status = useStore((s) => (session ? s.status[session.id] : undefined))
  const [view, setView] = useState<null | 'effort' | 'models'>(null)
  const [last, setLast] = useState<'effort' | 'models'>('effort'), [closing, setClosing] = useState(false) // still shown while it fades out
  const open = (v: 'effort' | 'models') => { setView(v); setLast(v); setClosing(false) }
  const close = () => { if (view) { setView(null); setClosing(true) } }
  const panel = view ?? (closing ? last : null)
  const ref = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  useEffect(() => {
    if (!view) return
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close()
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [view])
  useLayoutEffect(() => { // the panel follows its content's height, animated (CSS), so a switch reads as one menu changing
    const el = inner.current
    if (!panel || !el) return setHeight(undefined)
    setHeight(el.offsetHeight)
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [panel])

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
  const pop = 'absolute bottom-full left-1/2 z-50 -ml-[125px] mb-2 w-[250px] select-none whitespace-normal rounded-xl border border-line-strong bg-bg-picker shadow-xl' // centered over the button (by margin: its animation owns transform); wraps long descriptions (the composer row it sits in doesn't wrap)

  return (
    <div ref={ref} className="relative">
      <button onClick={() => (view ? close() : open('effort'))} className={`flex items-center gap-[5px] rounded-full px-2.5 py-[5px] text-[13px] text-fg-2 ${view ? 'bg-[#3a3a3a]' : 'hover:bg-[#3a3a3a] hover:text-fg'}`}> {/* light gray on hover, and kept while open, steady under the mouse */}
        {/* every label it can show, stacked in one cell: the button keeps the widest one's width, so the panel centered over it never moves */}
        <span className="grid justify-items-center">
          {[null, 'effort', 'models'].map((v) => (
            <span key={v ?? 'closed'} aria-hidden={v !== view} className={`col-start-1 row-start-1 flex items-center gap-[5px] ${v === view ? '' : 'invisible'}`}>
              {v === null ? <><span className="text-fg-bright">{name(current.displayName)}</span>{shown && <span>{label(shown)}</span>}</> : v === 'effort' ? 'Select effort' : 'Select model'}
            </span>
          ))}
        </span>
        <ChevronDown size={10} />
      </button>
      {panel && (
        <div style={{ height }} onAnimationEnd={(e) => { if (e.target === e.currentTarget && !view) setClosing(false) }}
          className={`${pop} from-top overflow-hidden transition-[height] duration-200 ease-out ${view ? 'menu-in' : 'menu-out pointer-events-none'}`}>
          <div ref={inner} key={panel} className="swap-in">
            {panel === 'effort' ? (
              <div className="relative px-3 pb-3 pt-2 text-center">
                <button onClick={() => set({ effort: null })} title="Reset to default" className="absolute right-2.5 top-2.5 text-fg-2 hover:text-fg-bright"><RotateCcw size={14} /></button>
                <button onClick={() => open('models')} title="Select model" className="mx-auto flex flex-col items-center rounded-lg px-3 py-1 hover:bg-[#3a3a3a]"> {/* the level and the model together open the list */}
                  <span className="text-[14px] font-semibold text-accent">{shown ? label(shown) : 'Model default'}</span>
                  <span className="mt-0.5 flex items-center gap-0.5 text-[12px] text-fg-sub">{name(current.displayName)}<ChevronRight size={12} /></span>
                </button>
                {levels.length > 1 && (
                  <div className="relative mt-2">
                    <input type="range" min={0} max={levels.length - 1} value={idx} onChange={(e) => set({ effort: levels[Number(e.target.value)] })} aria-label="Effort" className="effort block w-full" style={{ background: `linear-gradient(to right, var(--color-accent) ${pct}%, #3a3a3a ${pct}%)` }} />
                    {/* a dot at every other level it can move to, on either side of the thumb (whose center runs 11px in from each end) */}
                    <div aria-hidden className="pointer-events-none absolute inset-y-0 left-[11px] right-[11px]">
                      {levels.map((l, i) => i !== idx && <span key={l} data-effort-dot className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/45" style={{ left: `${(i / (levels.length - 1)) * 100}%` }} />)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-1">
                <div className="px-2.5 pb-1 pt-1.5 text-[12px] text-fg-2">Select model</div>
                {choices.map((m) => (
                  <button key={m.value} onClick={() => { pick(m); open('effort') }} className="flex w-full items-center rounded-md px-2.5 py-1.5 text-[13px] hover:bg-bg-hover">
                    <span className="flex flex-col"><span className={m.value === current.value ? 'text-fg-bright' : 'text-fg-sub'}>{name(m.displayName)}</span>{m.description && <span className="text-[11px] text-fg-2">{m.description}</span>}</span>
                    {m.value === current.value && <span className="ml-auto text-fg-bright">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
