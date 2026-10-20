import { useEffect } from 'react'
import { useStore } from '../stores/store'
import { Sidebar } from '../sidebar/Sidebar'
import { ChatView } from '../chat/ChatView'
import { Composer } from '../composer/Composer'
import { Palette } from '../lib/Palette'
import { SubagentsPanel } from '../chat/Subagents'
import { Connect } from './Connect'
import { TitleBar } from './TitleBar'
import { SlidePane } from '../lib/SlidePane'
import { Settings } from '../settings/Settings'
import { comboOf, type ShortcutAction } from '../lib/shortcuts'

export default function App() {
  const { init, sidebarOpen, widths, transport, settings } = useStore()
  useEffect(() => {
    init()
    const run: Record<ShortcutAction, () => void> = {
      back: () => useStore.getState().go(-1),
      forward: () => useStore.getState().go(1),
      newChat: () => useStore.getState().newChat(),
      newWindow: () => window.orc.window.open(),
      search: () => useStore.getState().openPalette('chats'),
      toggleSidebar: () => useStore.getState().toggleSidebar(),
      settings: () => useStore.getState().openSettings()
    }
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if (e.key === 'Escape' && s.settings && !s.settings.editing && !s.palette) { s.closeSettings(); return } // the editor has its own Back
      const combo = comboOf(e), action = combo && (Object.keys(s.shortcuts) as ShortcutAction[]).find((a) => s.shortcuts[a].includes(combo))
      if (action) { e.preventDefault(); run[action]() }
    }
    const onMouse = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); useStore.getState().go(e.button === 3 ? -1 : 1) } } // a mouse's back/forward buttons
    window.addEventListener('keydown', onKey); window.addEventListener('mouseup', onMouse)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mouseup', onMouse) }
  }, [])
  useEffect(() => { document.title = transport?.kind === 'remote' ? `Orc — ${transport.host}` : 'Orc' }, [transport?.host])
  if (!transport || transport.phase !== 'ready') return <div className="flex h-full">{transport && <Connect t={transport} />}<Palette /></div> // the palette still signs in or opens another host
  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      {settings ? <Settings /> : (
        <div className="flex min-h-0 flex-1">
          <SlidePane open={sidebarOpen} width={widths.sidebar} side="left" pane="sidebar"><Sidebar /></SlidePane>
          <main className="flex min-w-0 flex-1 flex-col bg-bg">
            <ChatView />
            <Composer />
          </main>
          <SubagentsPanel />
        </div>
      )}
      <Palette />
    </div>
  )
}
