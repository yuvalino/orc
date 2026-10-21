import { useEffect, useLayoutEffect, useRef } from 'react'
import { Bell } from 'lucide-react'
import type { Notice } from '@shared/api'
import { duration } from '../lib/duration'
import { panel } from '../lib/Menu'
import { useStore } from '../stores/store'

const RELEASES = 'https://github.com/yuvalino/orc/releases/tag/v'
const WIDTH = 320
/** "0.10.0-beta.1" → "0.10.0 beta 1". */
const shown = (version: string) => version.replace(/-(\w+)\.(\d+)$/, ' $1 $2')
const mb = (bytes: number) => { const n = bytes / 1048576; return `${n < 10 ? n.toFixed(1) : Math.round(n)} MB` }
const button = 'rounded-full px-3 py-1 text-[12.5px]'
const primary = `${button} bg-fg-bright font-medium text-bg hover:bg-white`
const secondary = `${button} bg-[#2c2c2c] text-fg-bright hover:bg-[#363636]`

/**
 * The bell in the sidebar's title bar and its panel: notifications, newest first, kept in memory (main's notices.ts).
 * A dot means something is going on or waiting: a download, or an update ready to install.
 */
export function NotificationsButton() {
  const { notices, noticesOpen: open, setNoticesOpen: setOpen } = useStore()
  const ref = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null)
  const dot = notices.some((n) => n.kind === 'update-downloading' || n.kind === 'update-ready')
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc) }
  }, [open])
  useLayoutEffect(() => { // below the bell, kept inside the window (the sidebar can be narrower than the panel)
    const b = ref.current?.getBoundingClientRect(), el = pop.current
    if (b && el) { el.style.left = `${Math.max(8, Math.min(b.left, innerWidth - WIDTH - 8))}px`; el.style.top = `${b.bottom + 4}px` }
  }, [open])
  return (
    <div ref={ref}>
      <button onClick={() => setOpen(!open)} title="Notifications" aria-label="Notifications" aria-expanded={open}
        className="no-drag relative flex size-8 items-center justify-center rounded-md text-fg-2 hover:bg-bg-hover hover:text-fg-bright">
        <Bell size={18} strokeWidth={1.8} />
        {dot && <span data-testid="notices-dot" className="absolute right-[7px] top-[7px] size-[7px] rounded-full bg-accent" />}
      </button>
      {open && (
        <div ref={pop} role="dialog" aria-label="Notifications" style={{ width: WIDTH }} className={`fixed ${panel} from-top menu-in`}>
          <div className="px-2.5 pb-1 pt-1.5 text-[12px] text-fg-2">Notifications</div>
          {notices.length === 0 ? <div className="px-2.5 pb-3 pt-1 text-[13px] text-fg-sub">No notifications</div>
            : notices.map((n) => <Card key={n.id} n={n} />)}
        </div>
      )}
    </div>
  )
}

function Card({ n }: { n: Notice }) {
  const u = window.orc.updates, dismiss = () => window.orc.notices.dismiss(n.id)
  const body = (title: string, detail: React.ReactNode, actions: React.ReactNode) => (
    <div data-testid={`notice-${n.kind}`} className="rounded-md px-2.5 py-2 hover:bg-bg-hover/40">
      <div className="text-[13px] font-medium text-fg-bright">{title}</div>
      {detail && <div className="mt-0.5 text-[12px] text-fg-2">{detail}</div>}
      {actions && <div className="mt-2 flex gap-2">{actions}</div>}
    </div>
  )
  switch (n.kind) {
    case 'update-downloading': {
      const pct = n.total ? (n.transferred / n.total) * 100 : 0
      const left = n.bytesPerSecond && n.total ? ` · about ${duration(((n.total - n.transferred) / n.bytesPerSecond) * 1000)} left` : ''
      return body(`Downloading Orc ${shown(n.version)}`, (
        <>
          <div className="mb-1 mt-1.5 h-1 overflow-hidden rounded-full bg-line-strong"><div role="progressbar" aria-valuenow={Math.round(pct)} className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} /></div>
          {n.total ? `${mb(n.transferred)} of ${mb(n.total)}${left}` : 'Starting…'}
        </>
      ), <button onClick={() => u.cancel()} className={secondary}>Cancel</button>)
    }
    case 'update-ready':
      return body(`Orc ${shown(n.version)} is ready to install`, 'Restart Orc to finish updating.', (
        <><button onClick={() => u.restart()} className={primary}>Restart to update</button><a href={`${RELEASES}${n.version}`} target="_blank" rel="noreferrer" className={secondary}>What's new</a></>
      ))
    case 'update-available':
      return body(`Orc ${shown(n.version)} is available`, n.url ? 'Download it from the release page to install it.' : null, (
        <>{n.url ? <a href={n.url} target="_blank" rel="noreferrer" className={primary}>Get it</a> : <button onClick={() => u.download()} className={primary}>Download</button>}<button onClick={dismiss} className={secondary}>Dismiss</button></>
      ))
    case 'update-failed':
      return body(n.message, null, <><button onClick={() => u.check()} className={primary}>Retry</button><button onClick={dismiss} className={secondary}>Dismiss</button></>)
    case 'update-current':
      return body(`Orc is up to date`, `You have the latest version, ${shown(n.version)}.`, <button onClick={dismiss} className={secondary}>Dismiss</button>)
  }
}
