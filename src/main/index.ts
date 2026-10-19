import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'path'
import { push, registerIpc } from './ipc'
import { settings } from './store'
import { boot } from './transport'

// One instance per target per machine: the single-instance lock is keyed on userData, so tests and dev
// instances get their own (ORC_USER_DATA_DIR, defaulting to the engine's ORC_DATA_DIR) and never collide.
const userData = process.env.ORC_USER_DATA_DIR || process.env.ORC_DATA_DIR
if (userData) app.setPath('userData', userData)
if (!app.requestSingleInstanceLock()) app.quit()
let secondInstances = 0
app.on('second-instance', () => { secondInstances++; const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus() } })
Object.assign(globalThis, { orcSecondInstances: () => secondInstances })

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
  boot()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
