import { contextBridge, ipcRenderer } from 'electron'
import type { OrcApi } from '@shared/api'

const call = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(ch, ...args)

const api: OrcApi = {
  projects: { list: call('projects.list'), add: call('projects.add'), remove: call('projects.remove'), files: call('projects.files') },
  sessions: {
    list: call('sessions.list'), create: call('sessions.create'), open: call('sessions.open'),
    send: call('sessions.send'), interrupt: call('sessions.interrupt'), stopTask: call('sessions.stopTask'), update: call('sessions.update'),
    remove: call('sessions.remove'), status: call('sessions.status')
  },
  answerAsk: call('asks.answer'),
  codecInfo: call('codec.info'),
  settings: { get: call('settings.get'), set: call('settings.set') },
  transport: { state: call('transport.state'), takeover: call('transport.takeover'), reconnect: call('transport.reconnect') },
  on: (channel, cb) => {
    const h = (_: unknown, payload: unknown) => cb(payload as never)
    ipcRenderer.on(channel, h)
    return () => ipcRenderer.removeListener(channel, h)
  }
}

contextBridge.exposeInMainWorld('orc', api)
