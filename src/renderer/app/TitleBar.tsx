import { ArrowLeft, ArrowRight, PanelLeft } from 'lucide-react'
import { ChatHeader } from '../chat/ChatView'
import { showCombo } from '../lib/shortcuts'
import { useStore } from '../stores/store'
import { MenuBar } from './MenuBar'

const mac = window.orc.platform === 'darwin'
const icon = 'no-drag flex size-7 shrink-0 items-center justify-center rounded-md text-fg-2 hover:bg-bg-hover hover:text-fg-bright disabled:text-fg-3 disabled:hover:bg-transparent'
const hint = (name: string, combo?: string) => (combo ? `${name} (${showCombo(combo)})` : name)

/** Back and forward through the places this window has been: chats, a new chat, settings pages. */
function Nav() {
  const { history, go, shortcuts } = useStore()
  return (
    <>
      <button onClick={() => go(-1)} disabled={history.at === 0} title={hint('Back', shortcuts.back[0])} className={icon}><ArrowLeft size={16} strokeWidth={1.8} /></button>
      <button onClick={() => go(1)} disabled={history.at === history.views.length - 1} title={hint('Forward', shortcuts.forward[0])} className={icon}><ArrowRight size={16} strokeWidth={1.8} /></button>
    </>
  )
}

/** The sidebar toggle (not in settings, which has no sidebar). */
function ToggleSidebar() {
  const { sidebarOpen, toggleSidebar, settings, shortcuts } = useStore()
  if (settings) return null
  return <button onClick={toggleSidebar} title={hint(`${sidebarOpen ? 'Hide' : 'Show'} sidebar`, shortcuts.toggleSidebar[0])} className={icon}><PanelLeft size={16} strokeWidth={1.8} /></button>
}

/**
 * The window's top bar: back, forward and the sidebar toggle first, on every platform. macOS (hiddenInset): after the traffic
 * lights, with the open chat's header across the rest; its menus stay in the system menu bar. Elsewhere (hidden + overlay
 * controls): followed by the in-window menu bar, nothing on the right but the system's controls; the chat header sits below.
 */
export function TitleBar() {
  const { sidebarOpen, widths, settings } = useStore()
  if (mac) return (
    <div className="drag flex h-[46px] shrink-0">
      <div style={sidebarOpen && !settings ? { width: widths.sidebar } : settings ? { width: widths.settings } : undefined} className={`flex shrink-0 items-center gap-0.5 pl-[80px] pr-2 ${sidebarOpen || settings ? 'border-r border-edge bg-bg-sidebar' : ''}`}><Nav /><ToggleSidebar /></div>
      <div className="flex min-w-0 flex-1 items-center gap-2 border-b border-line px-4">{!settings && <ChatHeader />}</div>
    </div>
  )
  return (
    <div className="drag relative z-30 flex h-[38px] shrink-0 items-center gap-0.5 border-b border-line bg-bg-sidebar pl-2 pr-[150px]">
      <Nav />
      <ToggleSidebar />
      <MenuBar />
    </div>
  )
}
