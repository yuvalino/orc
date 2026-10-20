import { useState } from 'react'

/**
 * A draggable pane edge. Sits on the pane's `edge` (its border with the conversation) and reports the new width,
 * clamped to [min, max]; a double click restores `initial`. Gray at rest, near white while hovered or dragged.
 */
export function Resizer({ edge, width, min, max, initial, onResize }: { edge: 'left' | 'right'; width: number; min: number; max: number; initial: number; onResize: (w: number) => void }) {
  const [dragging, setDragging] = useState(false)
  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement, x0 = e.clientX, w0 = width
    el.setPointerCapture(e.pointerId)
    setDragging(true)
    document.body.style.cursor = 'col-resize'
    const move = (ev: PointerEvent) => onResize(Math.round(Math.min(max, Math.max(min, w0 + (edge === 'right' ? ev.clientX - x0 : x0 - ev.clientX)))))
    const up = () => { setDragging(false); document.body.style.cursor = ''; el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up) }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }
  return (
    <div role="separator" aria-orientation="vertical" aria-valuenow={width} aria-valuemin={min} aria-valuemax={max} onPointerDown={down} onDoubleClick={() => onResize(initial)}
      className={`no-drag group/edge absolute inset-y-0 z-20 flex w-[7px] cursor-col-resize justify-center ${edge === 'right' ? '-right-[4px]' : '-left-[4px]'}`}>
      <div className={`w-px transition-colors ${dragging ? 'bg-edge-hover' : 'bg-edge group-hover/edge:bg-edge-hover'}`} />
    </div>
  )
}
