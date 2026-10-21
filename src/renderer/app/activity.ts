import type { Activity } from '@shared/api'
import { sessionTitle, useStore } from '../stores/store'

/**
 * This window's part in "is Orc idle?" (updates install only then): its chats that are working or waiting on you, whether
 * its composer holds unsent text, and that you're using it. Also its view, which an update's restart brings back.
 */
export function startActivity(): () => void {
  let last = ''
  const report = () => {
    const { sessions, status, draft } = useStore.getState()
    const titled = (ok: (id: string) => boolean) => sessions.filter((x) => ok(x.id)).map(sessionTitle)
    const a: Activity = {
      working: titled((id) => { const st = status[id]; return !!st && (st.state === 'running' || st.state === 'starting' || !!st.tasks) }),
      waiting: titled((id) => status[id]?.state === 'requires_action'),
      drafts: draft.trim() ? 1 : 0
    }
    const json = JSON.stringify(a)
    if (json !== last) { last = json; window.orc.activity.report(a) }
  }
  const unsubscribe = useStore.subscribe(report)
  report()

  let sent = 0
  const input = () => { if (Date.now() - sent > 5_000) { sent = Date.now(); window.orc.activity.input() } } // a few a minute is plenty for a 5-minute clock
  const events = ['keydown', 'mousedown', 'wheel'] as const
  events.forEach((e) => window.addEventListener(e, input, { passive: true }))

  Object.assign(window, { orcView: () => { const s = useStore.getState(); return { activeId: s.activeId, settingsTab: s.settings?.tab ?? null } } })
  return () => { unsubscribe(); events.forEach((e) => window.removeEventListener(e, input)) }
}
