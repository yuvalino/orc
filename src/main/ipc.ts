import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { OrcApi, PushEvents } from '@shared/api'
import { Engine } from '../server/engine'
import { createHandlers, methodTable } from '../server/handlers'
import type { Remote } from './remote'
import { hosts, openRemote } from './shell'
import { setToken, token } from './signin'
import { start, takeover, transportState } from './transport'

const shared = { hosts: async () => hosts(), open: async (h: string) => openRemote(h), signIn: async (t: string | null) => setToken(t), signedIn: async () => !!token() }

export const push = <K extends keyof PushEvents>(channel: K, payload: PushEvents[K]) =>
  BrowserWindow.getAllWindows().forEach((w) => !w.isDestroyed() && w.webContents.send(channel, payload))

/** A local target: the engine runs in this process. */
export const engine = new Engine(push)
const base = createHandlers(engine, push)

/** The desktop binds the engine's handlers to IPC and adds what only a desktop can do: the native folder dialog and the transport itself. */
const local: Omit<OrcApi, 'on' | 'platform' | 'menu' | 'window' | 'updates' | 'notices' | 'activity'> = {
  ...base,
  projects: {
    ...base.projects,
    add: async (path?: string) => {
      if (!path) {
        const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
        if (r.canceled || !r.filePaths[0]) return null
        path = r.filePaths[0]
      }
      return base.projects.add(path)
    }
  },
  transport: { ...shared, state: async () => transportState(), takeover: () => takeover(), reconnect: async () => start(), answer: async () => {} }
}

/** A remote target: every engine method is forwarded to the server; the transport methods stay here. */
function remoteTable(remote: Remote): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const table: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const name of Object.keys(methodTable(base))) table[name] = (...args) => remote.call(name, args)
  const transport = { ...shared, state: async () => remote.state, takeover: async () => remote.takeover(), reconnect: async () => remote.reconnect(), answer: async (t: string | null) => remote.answer(t) }
  for (const [k, fn] of Object.entries(transport)) table[`transport.${k}`] = fn as (...args: unknown[]) => Promise<unknown>
  return table
}

export function registerIpc(remote?: Remote): void {
  for (const [name, fn] of Object.entries(remote ? remoteTable(remote) : methodTable(local))) ipcMain.handle(name, (_e, ...args) => fn(...args))
}
