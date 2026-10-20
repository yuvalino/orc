import { useEffect, useState, type RefObject } from 'react'
import { Markdown } from './Markdown'

/** One sent prompt and the start of its reply: a tick on the timeline. */
export interface TimelineTurn { id: string; prompt: string; reply: string }

const MIN = 4 // prompts before there's a timeline: shorter chats are easy to scroll
// Measured off ChatGPT's: 2px ticks 10px apart, 6px long at rest and 26/20/14/10px across the wave; #464646, #a3a3a3 while their
// turn is on screen, and #fff for the hovered one (all others back to #464646 while hovering).
const GAP = 10, FILL = 0.8 // px between ticks (less when there are many), and the most of the view's height they take
const BASE = 6, WAVE = [20, 14, 8, 4] // tick length at rest, and the extra for the hovered tick and its 3 neighbors each way

/**
 * The conversation's timeline, like ChatGPT's: a tick per prompt down the left edge, white while that turn is on screen. Hovering
 * picks the nearest tick: it alone turns white, and it and its 3 neighbors each way swell into a wave that follows the mouse; a
 * preview shows its prompt with the start of the reply, and a click anywhere on it scrolls to that turn (the ticks are only 2px tall). Length and color change quickly, smoothly.
 */
export function Timeline({ turns, view, onJump }: { turns: TimelineTurn[]; view: RefObject<HTMLDivElement | null>; onJump: (id: string) => void }) {
  const [seen, setSeen] = useState<Set<string>>(new Set()) // turns on screen
  const [wide, setWide] = useState(false) // room beside the text for it
  const [room, setRoom] = useState(0) // the view's height
  const [mouse, setMouse] = useState<number | null>(null) // y within the timeline while hovered
  useEffect(() => {
    const el = view.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect(), on = new Set<string>()
      el.querySelectorAll<HTMLElement>('[data-turn]').forEach((t) => { const b = t.getBoundingClientRect(); if (t.dataset.turn && b.bottom > r.top + 8 && b.top < r.bottom - 8) on.add(t.dataset.turn) })
      setSeen((s) => (s.size === on.size && [...on].every((x) => s.has(x)) ? s : on))
      setWide(el.clientWidth >= 640); setRoom(el.clientHeight)
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => { el.removeEventListener('scroll', measure); ro.disconnect() }
  }, [view, turns.length])
  if (turns.length < MIN || !wide) return null

  const gap = Math.min(GAP, (room * FILL) / turns.length), height = gap * (turns.length - 1)
  const nearest = mouse === null ? -1 : Math.min(turns.length - 1, Math.max(0, Math.round(mouse / gap)))
  const hovered = turns[nearest]
  return (
    <div data-testid="timeline" onClick={() => hovered && onJump(hovered.id)} onMouseMove={(e) => setMouse(e.clientY - e.currentTarget.getBoundingClientRect().top - 12)} onMouseLeave={() => setMouse(null)}
      style={{ height: height + 24 }} className="absolute left-3 top-1/2 z-20 w-10 -translate-y-1/2 select-none">
      {turns.map((t, i) => {
        const k = nearest < 0 ? -1 : Math.abs(i - nearest)
        const color = nearest < 0 ? (seen.has(t.id) ? 'bg-[#a3a3a3]' : 'bg-[#464646]') : k === 0 ? 'bg-white' : 'bg-[#464646]'
        return (
          <button key={t.id} aria-label={t.prompt} data-seen={seen.has(t.id) || undefined}
            style={{ top: 12 + i * gap - 1, width: BASE + (k >= 0 ? WAVE[k] ?? 0 : 0) }}
            className={`absolute left-1 h-[2px] rounded-full transition-[width,background-color] duration-[120ms] ease-out ${color}`} />
        )
      })}
      {hovered && (
        <div role="tooltip" style={{ top: 12 + nearest * gap }} className="pointer-events-none absolute left-11 w-[300px] -translate-y-1/2 rounded-xl border border-line-strong bg-bg-picker px-3 py-2.5 shadow-xl">
          <div className="truncate text-[13px] font-semibold text-fg-bright">{hovered.prompt}</div>
          {/* the reply all in one gray: its headings and bold text too (the prompt above stays white) */}
          {hovered.reply && <div className="mt-1 line-clamp-3 text-[12px] leading-snug text-fg-2 [&_*]:!text-fg-2 [&_.md]:leading-snug [&_li]:mb-0 [&_p]:mb-0.5 [&_ul]:my-0.5">{<Markdown text={hovered.reply} />}</div>}
        </div>
      )}
    </div>
  )
}
