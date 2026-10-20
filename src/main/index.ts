import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
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
const unpacked = join(process.resourcesPath ?? '', 'app.asar.unpacked/node_modules/@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}/claude${process.platform === 'win32' ? '.exe' : ''}`)
configureClaude({ version: __ORC_VERSION__, binaryPath: app.isPackaged && existsSync(unpacked) ? unpacked : undefined })
let secondInstances = 0
const background = !!process.env.ORC_BACKGROUND // tests and scripted runs: windows render but are never shown, so nothing pops up over your work
app.on('second-instance', () => { secondInstances++; const w = BrowserWindow.getAllWindows()[0]; if (w && !background) { if (w.isMinimized()) w.restore(); w.focus() } })
Object.assign(globalThis, { orcSecondInstances: () => secondInstances, orcNewWindow: () => createWindow() })
const remote = remoteHost && app.hasSingleInstanceLock() ? new Remote(remoteHost, push) : null // a duplicate instance is quitting: no ssh, no askpass dir
const icon = join(__dirname, '../../build/icon.png') // in development; packaged builds carry the icons electron-builder derives from this file

/** Windows take the lowest free slot so each remembers its own bounds (the first window is slot 0 again after it was closed). */
const slots = new Set<number>()
function createWindow(): void {
  let n = 0; while (slots.has(n)) n++
  slots.add(n)
  const saved = ((shellStore.read().windows as Electron.Rectangle[] | undefined) ?? [])[n] ?? { width: 1274, height: 797, x: undefined, y: undefined }
  const win = new BrowserWindow({
    ...saved,
    minWidth: 980, // both side panes at their minimum (220 + 280) still leave the composer room for its bottom row
    minHeight: 560,
    title: remoteHost ? `orc — ${remoteHost}` : 'orc',
    backgroundColor: '#181818',
    ...(process.platform !== 'darwin' && existsSync(icon) ? { icon } : {}), // the window's own icon on Windows and Linux in development
    ...(process.platform !== 'darwin' ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#252526', symbolColor: '#a0a0a0', height: 38 } } : { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 16 } }), // see TitleBar.tsx
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false, backgroundThrottling: !background }
  })
  if (!background) win.once('ready-to-show', () => win.show())
  let t: ReturnType<typeof setTimeout>
  const save = () => { clearTimeout(t); t = setTimeout(() => { if (win.isDestroyed()) return; const all = [...((shellStore.read().windows as Electron.Rectangle[] | undefined) ?? [])]; all[n] = win.getBounds(); shellStore.write({ ...shellStore.read(), windows: all }) }, 400) }
  win.on('resize', save).on('move', save).on('closed', () => slots.delete(n))
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Off macOS the window has no native menu bar: the title bar draws these labels and pops their submenus (see TitleBar.tsx). */
function buildMenu(): void {
  const mac = process.platform === 'darwin'
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [
      { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:new-chat') }, // the focused window only
      { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
      { type: 'separator' }, { role: 'close' }, ...(mac ? [] : [{ role: 'quit' as const }])
    ] },
    { label: 'Edit', role: 'editMenu' },
    { label: 'View', role: 'viewMenu' },
    { label: 'Window', role: 'windowMenu' },
    { label: 'Help', role: 'help', submenu: [{ label: 'Claude Code docs', click: () => shell.openExternal('https://code.claude.com/docs') }] }
  ]))
  ipcMain.handle('menu.popup', (e, label: string, x: number, y: number) => {
    const window = BrowserWindow.fromWebContents(e.sender)
    Menu.getApplicationMenu()?.items.find((i) => i.label === label)?.submenu?.popup({ window: window ?? undefined, x, y })
  })
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !app.isPackaged && existsSync(icon)) app.dock?.setIcon(icon)
  buildMenu()
  registerIpc(remote ?? undefined)
  if (remote) remote.connect(); else boot()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
// A remote instance lives as long as its window: closing it ends ssh and the server with it. Local keeps macOS's stay-in-Dock behaviour.
app.on('window-all-closed', () => (remote || process.platform !== 'darwin') && app.quit())
app.on('before-quit', () => remote?.shutdown())
