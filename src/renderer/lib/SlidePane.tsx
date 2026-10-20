import { useEffect, useState, type ReactNode } from 'react'

/**
 * A side pane that slides open and shut: its width animates while the pane itself stays anchored to the window's `side`,
 * so its edge with the conversation sweeps and nothing inside reflows. Children stay mounted until it has closed.
 */
export function SlidePane({ open, width, side, pane, children }: { open: boolean; width: number; side: 'left' | 'right'; pane: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(open), [shown, setShown] = useState(open), [animating, setAnimating] = useState(false)
  const settle = (isOpen: boolean) => { setAnimating(false); if (isOpen) setShown(true); else setMounted(false) }
  useEffect(() => {
    if (open === shown) return
    setAnimating(true)
    const done = setTimeout(() => settle(open), 260) // in case transitionend never comes (a hidden or covered window doesn't animate)
    if (!open) { setShown(false); return () => clearTimeout(done) }
    setMounted(true)
    const f = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true))) // mount closed, then open, so the transition runs
    return () => { cancelAnimationFrame(f); clearTimeout(done) }
  }, [open])
  if (!mounted) return null
  return (
    <div data-pane={pane} style={{ width: shown ? width : 0, clipPath: animating || !shown ? (side === 'right' ? 'inset(0 0 0 -8px)' : 'inset(0 -8px 0 0)') : undefined }} // clipped only while sliding (room left for the resize edge), so menus can reach past it once open
      onTransitionEnd={(e) => { if (e.target === e.currentTarget && e.propertyName === 'width') settle(shown) }}
      className={`relative z-10 shrink-0 ${animating ? 'transition-[width] duration-200 ease-out' : ''}`}>
      <div style={{ width }} className={`absolute inset-y-0 flex ${side === 'right' ? 'right-0' : 'left-0'}`}>{children}</div>
    </div>
  )
}
