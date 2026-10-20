import { ArrowLeft, PanelLeft } from 'lucide-react'
import { ChatHeader } from '../chat/ChatView'
import { useStore } from '../stores/store'

const mac = window.orc.platform === 'darwin'
const MENUS = ['File', 'Edit', 'View', 'Window', 'Help'] // the application menu's labels (main/index.ts)

/** The sidebar toggle; in settings, the way back to the chats instead. */
function ToggleSidebar() {
  const { sidebarOpen, toggleSidebar, settings, closeSettings } = useStore()
  if (settings) return <button onClick={closeSettings} title="Back (Esc)" className="no-drag flex size-7 shrink-0 items-center justify-center rounded-md text-fg-2 hover:bg-bg-hover hover:text-fg-bright"><ArrowLeft size={16} strokeWidth={1.8} /></button>
  return (
    <button onClick={toggleSidebar} title={`${sidebarOpen ? 'Hide' : 'Show'} sidebar (${mac ? '⌘B' : 'Ctrl+B'})`}
      className="no-drag flex size-7 shrink-0 items-center justify-center rounded-md text-fg-2 hover:bg-bg-hover hover:text-fg-bright"><PanelLeft size={16} strokeWidth={1.8} /></button>
  )
}

/**
 * The window's top bar. macOS (hiddenInset): traffic lights, the sidebar toggle, then the open chat's header across the rest, its
 * menus stay in the system menu bar. Elsewhere (hidden + overlay controls): the sidebar toggle and an in-window menu bar, nothing on
 * the right but the system's controls; the chat header sits below it in ChatView.
 */
export function TitleBar() {
  const { sidebarOpen, widths, settings } = useStore()
  if (mac) return (
    <div className="drag flex h-[46px] shrink-0">
      <div style={sidebarOpen && !settings ? { width: widths.sidebar } : settings ? { width: widths.settings } : undefined} className={`flex shrink-0 items-center pl-[80px] pr-2 ${sidebarOpen || settings ? 'border-r border-edge bg-bg-sidebar' : ''}`}><ToggleSidebar /></div>
      <div className="flex min-w-0 flex-1 items-center gap-2 border-b border-line px-4">{!settings && <ChatHeader />}</div>
    </div>
  )
  return (
    <div className="drag flex h-[38px] shrink-0 items-center gap-0.5 border-b border-line bg-bg-sidebar pl-2 pr-[150px]">
      <ToggleSidebar />
      <nav className="ml-1 flex items-center">
        {MENUS.map((l) => (
          <button key={l} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); window.orc.menu.popup(l, Math.round(r.left), Math.round(r.bottom)) }}
            className="no-drag rounded-md px-2 py-0.5 text-[13px] text-fg-sub hover:bg-bg-hover hover:text-fg-bright">{l}</button>
        ))}
      </nav>
    </div>
  )
}
