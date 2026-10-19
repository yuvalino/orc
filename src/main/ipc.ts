import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { OrcApi, PushEvents } from '@shared/api'
import { Engine } from '../server/engine'
import { createHandlers, methodTable } from '../server/handlers'
import { start, takeover, transportState } from './transport'

export const push = <K extends keyof PushEvents>(channel: K, payload: PushEvents[K]) =>
  BrowserWindow.getAllWindows().forEach((w) => !w.isDestroyed() && w.webContents.send(channel, payload))

export const engine = new Engine(push)
const base = createHandlers(engine, push)

/** The desktop binds the engine's handlers to IPC and adds what only a desktop can do: the native folder dialog and the transport itself. */
const handlers: Omit<OrcApi, 'on'> = {
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
  transport: { state: async () => transportState(), takeover: () => takeover(), reconnect: async () => start() }
}

export function registerIpc(): void {
  for (const [name, fn] of Object.entries(methodTable(handlers))) ipcMain.handle(name, (_e, ...args) => fn(...args))
}
