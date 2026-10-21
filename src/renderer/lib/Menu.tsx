import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem { label: ReactNode; icon?: ReactNode; detail?: string; hint?: string; onSelect?: () => void; active?: boolean; danger?: boolean; tone?: string } // hint: shown at the right (a shortcut); detail: a line below; tone: a text color class for the label, e.g. 'text-bypass' (the detail stays gray)

export const panel = 'z-50 min-w-52 select-none rounded-lg border border-line-strong bg-bg-composer p-1 shadow-xl' // every menu-like popover, the notifications too

/** A menu's rows; 'separator' splits them into sections. */
export type MenuEntry = MenuItem | 'separator'

function Items({ items, header, close }: { items: MenuEntry[]; header?: string; close: () => void }) {
  return (
    <>
      {header && <div className="px-2.5 pb-1 pt-1.5 text-[12px] text-fg-2">{header}</div>}
      {items.map((it, i) => it === 'separator' ? <div key={i} role="separator" className="mx-1 my-1 h-px bg-line-strong" /> : (
        <button key={i} onClick={(e) => { e.stopPropagation(); close(); it.onSelect?.() }}
          className={`flex w-full flex-col rounded-md px-2.5 py-1.5 text-[13px] hover:bg-bg-hover ${it.tone ?? (it.danger ? 'text-bad' : it.active ? 'text-fg-bright' : 'text-fg-sub')}`}>
          <span className="flex w-full items-center gap-2">{it.icon && <span className="flex size-4 shrink-0 items-center justify-center">{it.icon}</span>}{it.label}{it.hint && <span className="ml-auto pl-4 text-[12px] text-fg-2">{it.hint}</span>}{it.active && <span className="ml-auto text-accent">✓</span>}</span>
          {it.detail && <span className={`text-[11px] ${it.danger && !it.tone ? 'text-bad/70' : 'text-fg-2'}`}>{it.detail}</span>}
        </button>
      ))}
    </>
  )
}

/**
 * Minimal popover menu anchored to its trigger; a function trigger is told whether the menu is open. It opens below the trigger,
 * above it (`up`), or beside it to the right with their bottoms aligned (`beside`). `animate`: fades and slides in from that side, and back out.
 */
export function Menu({ trigger, items, header, align = 'left', up, beside, className = '', animate }: { trigger: ReactNode | ((open: boolean) => ReactNode); items: MenuEntry[]; header?: string; align?: 'left' | 'right'; up?: boolean; beside?: boolean; className?: string; animate?: 'right' | 'bottom' }) {
  const [open, setOpenState] = useState(false), [closing, setClosing] = useState(false)
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const v = typeof next === 'function' ? next(open) : next
    if (!v && open && animate) setClosing(true) // stays on screen until its fade-out ends
    setOpenState(v)
  }
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={ref} className={`relative ${className}`}>
      <div onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>{typeof trigger === 'function' ? trigger(open) : trigger}</div>
      {(open || closing) && (
        <div onAnimationEnd={() => !open && setClosing(false)} className={`absolute ${panel} ${beside ? 'bottom-0 left-full ml-2' : `${align === 'right' ? 'right-0' : 'left-0'} ${up ? 'bottom-full mb-1' : 'top-full mt-1'}`} ${animate ? `from-${animate} ${open ? 'menu-in' : 'menu-out pointer-events-none'}` : ''}`}>
          <Items items={items} header={header} close={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

/** The same menu opened at the pointer by a right click: spread `onContextMenu` on the target and render `menu` inside it. */
export function useContextMenu(items: () => MenuEntry[]) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!at) return
    const close = () => setAt(null)
    const outside = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', esc); window.addEventListener('blur', close); window.addEventListener('resize', close); document.addEventListener('scroll', close, true)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc); window.removeEventListener('blur', close); window.removeEventListener('resize', close); document.removeEventListener('scroll', close, true) }
  }, [at])
  useLayoutEffect(() => { // keep it inside the window near the edges
    const el = ref.current
    if (!el || !at) return
    const r = el.getBoundingClientRect()
    el.style.left = `${Math.max(4, Math.min(at.x, innerWidth - r.width - 4))}px`
    el.style.top = `${at.y + r.height > innerHeight - 4 ? Math.max(4, at.y - r.height) : at.y}px`
  }, [at])
  return {
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setAt({ x: e.clientX, y: e.clientY }) },
    menu: at && (
      <div ref={ref} role="menu" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }} className={`fixed ${panel}`} style={{ left: at.x, top: at.y }}>
        <Items items={items()} close={() => setAt(null)} />
      </div>
    )
  }
}
