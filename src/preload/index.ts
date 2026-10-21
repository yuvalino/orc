import { contextBridge, ipcRenderer } from 'electron'
import type { OrcApi } from '@shared/api'

const call = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(ch, ...args)

const api: OrcApi = {
  platform: process.platform,
  menu: { items: call('menu.items'), run: call('menu.run'), shortcuts: call('menu.shortcuts') },
  window: { open: call('window.open'), quit: call('window.quit'), restored: call('window.restored') },
  updates: { prefs: call('updates.prefs'), setPrefs: call('updates.setPrefs'), check: call('updates.check'), download: call('updates.download'), cancel: call('updates.cancel'), restart: call('updates.restart'), pending: call('updates.pending'), restartNow: call('updates.restartNow') },
  notices: { list: call('notices.list'), dismiss: call('notices.dismiss') },
  activity: { report: call('activity.report'), input: call('activity.input') },
  projects: { list: call('projects.list'), add: call('projects.add'), remove: call('projects.remove'), files: call('projects.files'), browse: call('projects.browse') },
  sessions: {
    list: call('sessions.list'), create: call('sessions.create'), open: call('sessions.open'),
    send: call('sessions.send'), interrupt: call('sessions.interrupt'), stopTask: call('sessions.stopTask'), markRead: call('sessions.markRead'), update: call('sessions.update'),
    remove: call('sessions.remove'), status: call('sessions.status')
  },
  answerAsk: call('asks.answer'),
  codecInfo: call('codec.info'),
  settings: { get: call('settings.get'), set: call('settings.set') },
  instructions: { get: call('instructions.get'), set: call('instructions.set') },
  transport: { state: call('transport.state'), takeover: call('transport.takeover'), reconnect: call('transport.reconnect'), hosts: call('transport.hosts'), open: call('transport.open'), answer: call('transport.answer'), signIn: call('transport.signIn'), signedIn: call('transport.signedIn') },
  on: (channel, cb) => {
    const h = (_: unknown, payload: unknown) => cb(payload as never)
    ipcRenderer.on(channel, h)
    return () => ipcRenderer.removeListener(channel, h)
  }
}

contextBridge.exposeInMainWorld('orc', api)
