import type { ReactNode } from 'react'

/** Children that fold up into (and unfold from) the row above them, animated. Folded children leave the tab order. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div style={{ gridTemplateRows: open ? '1fr' : '0fr' }} className="grid transition-[grid-template-rows] duration-200 ease-out">
      <div inert={!open} className={`min-h-0 overflow-hidden transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}>{children}</div>
    </div>
  )
}
