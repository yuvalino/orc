import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'path'
import { engine, push, registerIpc } from './ipc'
import { settings } from './store'

function createWindow(): void {
  const saved = (settings.get('window') as Electron.Rectangle | undefined) ?? { width: 1274, height: 797, x: undefined, y: undefined }
  const win = new BrowserWindow({
    ...saved,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#181818',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false }
  })
  win.once('ready-to-show', () => win.show())
  let t: ReturnType<typeof setTimeout>
  const save = () => { clearTimeout(t); t = setTimeout(() => !win.isDestroyed() && settings.set('window', win.getBounds()), 400) }
  win.on('resize', save).on('move', save)
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function buildMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'File', submenu: [{ label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: () => push('menu:new-chat', undefined) }, { type: 'separator' }, { role: 'close' }] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Claude Code docs', click: () => shell.openExternal('https://code.claude.com/docs') }] }
  ]))
}

app.whenReady().then(() => {
  buildMenu()
  registerIpc()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('before-quit', () => engine.closeAll())
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
