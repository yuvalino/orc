import { app, BrowserWindow } from 'electron'
import type { TransportState } from '@shared/api'
import { Lock } from '../server/lock'
import { dataDir } from '../server/store'
import { engine, push } from './ipc'

/**
 * The local transport: this window's engine is in-process, but it only runs once this process holds the
 * data dir's lock (one engine per target). Everything the renderer sees about that is a TransportState.
 */
let state: TransportState = { kind: 'local', phase: 'starting', clockOffset: 0 }
let lock: Lock

export const transportState = () => state
function set(patch: Partial<TransportState>): void { state = { ...state, ...patch }; push('transport:state', state) }

/** Try to become the engine for this data dir; otherwise show who has it. */
export function start(): void {
  if (state.phase === 'ready') return
  if (lock.acquire('local')) { engine.hydrateTitles(); set({ phase: 'ready', holder: undefined, by: undefined }) }
  else { const h = lock.holder(); set({ phase: 'busy', holder: h ? { client: h.client, since: h.since, kind: h.kind } : undefined }) }
}

export async function takeover(): Promise<void> {
  if (!(await lock.takeover())) { set({ phase: 'error', error: 'orc is running on another machine with this folder; stop it there first.' }); return }
  start()
}

export function boot(): void {
  lock = new Lock(dataDir())
  lock.onTakeover(() => { // a take-over by another instance, or a plain kill
    const mine = state.phase === 'ready'
    engine.closeAll()
    const by = mine ? lock.takenOverBy() : null
    lock.release()
    if (by && BrowserWindow.getAllWindows().length) set({ phase: 'taken-over', by })
    else app.quit()
  })
  app.on('before-quit', () => { engine.closeAll(); lock.release() })
  start()
}
