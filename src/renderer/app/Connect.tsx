import { Loader2 } from 'lucide-react'
import type { TransportState } from '@shared/api'

const when = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const Btn = ({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) => (
  <button onClick={onClick} className={`rounded-lg px-4 py-1.5 text-[13px] ${primary ? 'bg-accent text-white hover:bg-accent/90' : 'border border-line-strong text-fg-sub hover:bg-bg-hover hover:text-fg-bright'}`}>{children}</button>
)

/** Full-window state of the connection to this window's engine: everything but `ready`. */
export function Connect({ t }: { t: TransportState }) {
  const tr = window.orc.transport
  const body = (() => {
    switch (t.phase) {
      case 'busy': return {
        title: 'orc is already running for this folder',
        text: t.holder ? `Controlled by ${t.holder.client.user}@${t.holder.client.host} since ${when(t.holder.since)}.` : '',
        actions: <><Btn onClick={() => tr.reconnect()}>Retry</Btn><Btn primary onClick={() => tr.takeover()}>Take over</Btn></>
      }
      case 'taken-over': return { title: `Taken over by ${t.by?.user}@${t.by?.host}`, text: 'This window no longer controls the folder.', actions: <Btn primary onClick={() => tr.takeover()}>Take back</Btn> }
      case 'error': return { title: 'Could not connect', text: t.error ?? '', actions: <Btn primary onClick={() => tr.reconnect()}>Retry</Btn> }
      case 'disconnected': return { title: `Disconnected from ${t.host}`, text: 'Reconnecting…', actions: <Btn onClick={() => tr.reconnect()}>Reconnect now</Btn> }
      default: return { title: t.kind === 'remote' ? `Connecting to ${t.host}…` : 'Starting…', text: '', actions: null }
    }
  })()
  return (
    <div className="drag flex h-full flex-1 flex-col items-center justify-center gap-3 bg-bg text-center">
      {body.actions === null && <Loader2 size={20} className="animate-spin text-fg-2" />}
      <div className="text-[15px] font-medium text-fg-bright">{body.title}</div>
      {body.text && <div className="max-w-md text-[13px] text-fg-sub">{body.text}</div>}
      {body.actions && <div className="no-drag mt-2 flex gap-2">{body.actions}</div>}
    </div>
  )
}
