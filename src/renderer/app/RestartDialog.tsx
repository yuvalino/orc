import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Activity } from '@shared/api'
import logo from '../assets/logo.png'

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * Restart to update, when it would interrupt something: its own small frameless window, styled like About Orc. Lists what
 * a restart would stop, across every Orc window (remote hosts' too); Later keeps the update ready.
 */
export function RestartDialog() {
  const [p, setP] = useState<{ version: string; activity: Activity } | null>(null)
  useEffect(() => {
    window.orc.updates.pending().then((x) => { setP(x); document.title = x ? `Update to Orc ${x.version}` : 'Update' })
    const key = (e: KeyboardEvent) => e.key === 'Escape' && window.close()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const version = p?.version.replace(/-(\w+)\.(\d+)$/, ' $1 $2')
  const a = p?.activity
  const lines = a ? [
    ...a.working.map((t) => `${t} is working`),
    ...a.waiting.map((t) => `${t} is waiting for your answer`),
    ...(a.drafts ? [`Unsent text in ${plural(a.drafts, 'chat')}`] : [])
  ] : []
  return (
    <div className="flex h-full select-none flex-col bg-bg-composer">
      <div className="drag flex h-9 shrink-0 items-center gap-2 border-b border-line pl-3 pr-1.5 text-[13px] text-fg-bright">
        <img src={logo} alt="" className="size-[22px]" draggable={false} />Update Orc
        <button onClick={() => window.close()} title="Close" className="no-drag ml-auto flex size-7 items-center justify-center rounded-md text-fg-2 hover:bg-bg-hover hover:text-fg-bright"><X size={15} /></button>
      </div>
      {p && (
        <div className="flex min-h-0 flex-1 flex-col px-5 pb-4 pt-4 text-[13px] text-fg-2">
          <div className="text-[15px] font-semibold text-fg-bright">Restart to update to Orc {version}?</div>
          <div className="mt-2">This will interrupt:</div>
          <ul className="mt-1 min-h-0 flex-1 overflow-y-auto pl-1 text-fg-sub">{lines.map((l, i) => <li key={i} className="truncate">• {l}</li>)}</ul>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => window.close()} className="rounded-full bg-[#2c2c2c] px-3.5 py-1.5 text-[13px] text-fg-bright hover:bg-[#363636]">Later</button>
            <button onClick={() => { window.orc.updates.restartNow(); window.close() }} className="rounded-full bg-fg-bright px-3.5 py-1.5 text-[13px] font-medium text-bg hover:bg-white">Restart and update</button>
          </div>
        </div>
      )}
    </div>
  )
}
