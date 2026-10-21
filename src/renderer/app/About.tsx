import { useEffect } from 'react'
import { X } from 'lucide-react'
import logo from '../assets/logo.png'

const link = 'text-accent hover:underline'

/**
 * The About Orc window (Help → About Orc): its own small frameless window in the app's dark theme, its title bar drawn here.
 * Esc or the ✕ closes it; links open in the browser.
 */
export function AboutWindow() {
  useEffect(() => {
    document.title = 'About Orc'
    const key = (e: KeyboardEvent) => e.key === 'Escape' && window.close()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return (
    <div className="flex h-full select-none flex-col bg-bg-composer">
      <div className="drag flex h-9 shrink-0 items-center gap-2 border-b border-line pl-3 pr-1.5 text-[13px] text-fg-bright">
        <img src={logo} alt="" className="size-[22px]" draggable={false} />About Orc
        <button onClick={() => window.close()} title="Close" className="no-drag ml-auto flex size-7 items-center justify-center rounded-md text-fg-2 hover:bg-bg-hover hover:text-fg-bright"><X size={15} /></button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-4 text-center text-[13px] text-fg-2">
        <img src={logo} alt="" className="size-[72px]" draggable={false} />
        <div className="mt-2 text-[20px] font-semibold text-fg-bright">Orc</div>
        <div className="mt-1">Powered by Electron.</div>
        <div>Version {__ORC_VERSION__}{__ORC_OFFLINE__ && ' (Offline)'}</div>
        <div className="mt-4 text-fg-sub">Created by Yuvalino</div>
        <a href="https://yuvalino.com" target="_blank" rel="noreferrer" className={link}>yuvalino.com</a>
        <a href="https://x.com/jachashx" target="_blank" rel="noreferrer" className={link}>@jachashx on X</a>
      </div>
    </div>
  )
}
