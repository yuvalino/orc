import { useEffect } from 'react'
import { useStore } from '../stores/store'
import { Sidebar } from '../sidebar/Sidebar'
import { ChatView } from '../chat/ChatView'
import { Composer } from '../composer/Composer'
import { Palette } from '../lib/Palette'
import { SubagentsPanel } from '../chat/Subagents'
import { Connect } from './Connect'
import { TitleBar } from './TitleBar'

export default function App() {
  const { init, openPalette, newChat, toggleSidebar, sidebarOpen, transport } = useStore()
  useEffect(() => {
    init()
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'k' || e.key === 'p') { e.preventDefault(); openPalette('chats') }
      if (e.key === 'n') { e.preventDefault(); newChat() }
      if (e.key === 'b') { e.preventDefault(); toggleSidebar() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { document.title = transport?.kind === 'remote' ? `orc — ${transport.host}` : 'orc' }, [transport?.host])
  if (!transport || transport.phase !== 'ready') return <div className="flex h-full">{transport && <Connect t={transport} />}<Palette /></div> // the palette still signs in or opens another host
  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <Sidebar />}
        <main className="flex min-w-0 flex-1 flex-col bg-bg">
          <ChatView />
          <Composer />
        </main>
        <SubagentsPanel />
      </div>
      <Palette />
    </div>
  )
}
