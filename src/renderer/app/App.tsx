import { useEffect } from 'react'
import { useStore } from '../stores/store'
import { Sidebar } from '../sidebar/Sidebar'
import { ChatView } from '../chat/ChatView'
import { Composer } from '../composer/Composer'
import { Palette } from '../lib/Palette'
import { SubagentsPanel } from '../chat/Subagents'
import { Connect } from './Connect'

export default function App() {
  const { init, openPalette, newChat, transport } = useStore()
  useEffect(() => {
    init()
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'k') { e.preventDefault(); openPalette('chats') }
      if (e.key === 'n') { e.preventDefault(); newChat() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!transport || transport.phase !== 'ready') return <div className="flex h-full">{transport && <Connect t={transport} />}</div>
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        <ChatView />
        <Composer />
      </main>
      <SubagentsPanel />
      <Palette />
    </div>
  )
}
