import { useEffect, useRef, useState } from 'react'
import type { MenuBarMenu } from '@shared/api'

const keys = (a: string) => a.replace(/CmdOrCtrl|CommandOrControl|Control/, 'Ctrl').replace('Plus', '+')
const LABELS = ['File', 'Edit', 'View', 'Window', 'Help'] // drawn before the items arrive

/**
 * The application menu, drawn in the title bar off macOS. Like a native menu bar: a click opens a menu, and while one is open,
 * hovering another name switches to it; ←/→ move between menus, ↑/↓ and Enter pick an item, Esc closes. Nothing here takes the
 * keyboard focus, so Copy, Paste and the like act on whatever was focused before.
 */
export function MenuBar() {
  const [menus, setMenus] = useState<MenuBarMenu[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [hot, setHot] = useState(-1) // the highlighted item, for the keyboard
  const ref = useRef<HTMLElement>(null)
  const load = () => window.orc.menu.items().then(setMenus) // fresh each time: shortcuts can change
  useEffect(() => { load() }, [])
  const show = (i: number | null) => { setOpen(i); setHot(-1); if (i !== null) load() }

  const items = open === null ? [] : menus[open]?.items ?? []
  const run = (i: number) => { const m = menus[open!]; show(null); window.orc.menu.run(m.label, i) }
  useEffect(() => {
    if (open === null) return
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && show(null)
    const step = (from: number, d: number) => { for (let k = 1; k <= items.length; k++) { const j = (from + d * k + items.length * 2) % items.length, it = items[j]; if (!it.separator && it.enabled) return j } return from }
    const key = (e: KeyboardEvent) => {
      const n = menus.length, act: Record<string, () => void> = {
        Escape: () => show(null), ArrowLeft: () => show((open + n - 1) % n), ArrowRight: () => show((open + 1) % n),
        ArrowDown: () => setHot((h) => step(h, 1)), ArrowUp: () => setHot((h) => step(h < 0 ? 0 : h, -1)), Enter: () => hot >= 0 && run(hot)
      }
      if (act[e.key]) { e.preventDefault(); e.stopPropagation(); act[e.key]() }
    }
    const blur = () => show(null)
    document.addEventListener('mousedown', away); window.addEventListener('keydown', key, true); window.addEventListener('blur', blur)
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', blur) }
  }, [open, hot, menus])

  const names = menus.length ? menus.map((m) => m.label) : LABELS
  return (
    <nav ref={ref} className="ml-1 flex items-center" onMouseDown={(e) => e.preventDefault()}>
      {names.map((label, i) => (
        <div key={label} className="relative">
          <button onClick={() => show(open === i ? null : i)} onMouseEnter={() => open !== null && open !== i && show(i)} aria-expanded={open === i}
            className={`no-drag rounded-md px-2 py-0.5 text-[13px] ${open === i ? 'bg-bg-active text-fg-bright' : 'text-fg-sub hover:bg-bg-hover hover:text-fg-bright'}`}>{label}</button>
          {open === i && (
            <div role="menu" aria-label={label} className="no-drag absolute left-0 top-full z-50 mt-1 min-w-56 rounded-lg border border-line-strong bg-bg-composer p-1 shadow-xl">
              {items.map((it, j) => it.separator ? <div key={j} role="separator" className="mx-1 my-1 h-px bg-line-strong" /> : (
                <button key={j} role="menuitem" disabled={!it.enabled} onClick={() => run(j)} onMouseEnter={() => setHot(j)}
                  className={`flex w-full items-center gap-6 rounded-md px-2.5 py-1.5 text-[13px] ${!it.enabled ? 'text-fg-3' : hot === j ? 'bg-bg-hover text-fg-bright' : 'text-fg-sub'}`}>
                  {it.label}{it.accelerator && <span className="ml-auto text-[12px] text-fg-2">{keys(it.accelerator)}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  )
}
