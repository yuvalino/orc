import { app, BrowserWindow, Menu, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { configureClaude } from '../server/codecs/claude/codec'
import { setDataDir } from '../server/store'
import { push, registerIpc } from './ipc'
import { Remote } from './remote'
import { remoteHost, shellStore } from './shell'
import { boot } from './transport'

// One instance per target per machine: the single-instance lock is keyed on userData, so each remote host gets its own,
// and tests/dev instances get theirs (ORC_USER_DATA_DIR, defaulting to the engine's ORC_DATA_DIR) and never collide.
const userData = process.env.ORC_USER_DATA_DIR || process.env.ORC_DATA_DIR || (remoteHost && join(app.getPath('userData'), `remote-${remoteHost.replace(/[^\w.-]/g, '_')}`))
if (userData) app.setPath('userData', userData)
if (!app.requestSingleInstanceLock()) app.quit()
setDataDir(process.env.ORC_DATA_DIR || app.getPath('userData'))
// The SDK's bundled binary can't be spawned from inside app.asar; point it at the asarUnpack'ed copy when packaged.
const unpacked = join(process.resourcesPath ?? '', 'app.asar.unpacked/node_modules/@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}/claude`)
configureClaude({ version: __ORC_VERSION__, binaryPath: app.isPackaged && existsSync(unpacked) ? unpacked : undefined })
let secondInstances = 0
app.on('second-instance', () => { secondInstances++; const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus() } })
Object.assign(globalThis, { orcSecondInstances: () => secondInstances })
const remote = remoteHost ? new Remote(remoteHost, push) : null

function createWindow(): void {
  const saved = (shellStore.read().window as Electron.Rectangle | undefined) ?? { width: 1274, height: 797, x: undefined, y: undefined }
  const win = new BrowserWindow({
    ...saved,
    minWidth: 900,
    minHeight: 560,
    title: remoteHost ? `orc — ${remoteHost}` : 'orc',
    backgroundColor: '#181818',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false }
  })
  win.once('ready-to-show', () => win.show())
  let t: ReturnType<typeof setTimeout>
  const save = () => { clearTimeout(t); t = setTimeout(() => !win.isDestroyed() && shellStore.write({ ...shellStore.read(), window: win.getBounds() }), 400) }
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
  registerIpc(remote ?? undefined)
  if (remote) remote.connect(); else boot()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
// A remote instance lives as long as its window: closing it ends ssh and the server with it. Local keeps macOS's stay-in-Dock behaviour.
app.on('window-all-closed', () => (remote || process.platform !== 'darwin') && app.quit())
app.on('before-quit', () => remote?.shutdown())
