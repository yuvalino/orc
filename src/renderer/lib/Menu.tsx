import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem { label: ReactNode; detail?: string; onSelect?: () => void; active?: boolean; danger?: boolean }

/** Minimal popover menu anchored to its trigger. */
export function Menu({ trigger, items, align = 'left', up, className = '' }: { trigger: ReactNode; items: MenuItem[]; align?: 'left' | 'right'; up?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={ref} className={`relative ${className}`}>
      <div onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>{trigger}</div>
      {open && (
        <div className={`absolute z-50 min-w-52 rounded-lg border border-line-strong bg-bg-composer p-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'} ${up ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
          {items.map((it, i) => (
            <button key={i} onClick={(e) => { e.stopPropagation(); setOpen(false); it.onSelect?.() }}
              className={`flex w-full flex-col rounded-md px-2.5 py-1.5 text-[13px] hover:bg-bg-hover ${it.danger ? 'text-bad' : it.active ? 'text-fg-bright' : 'text-fg-sub'}`}>
              <span className="flex w-full items-center gap-2">{it.label}{it.active && <span className="ml-auto text-accent">✓</span>}</span>
              {it.detail && <span className={`text-[11px] ${it.danger ? 'text-bad/70' : 'text-fg-2'}`}>{it.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
