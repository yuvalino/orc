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

/**
 * Off macOS the window has no native menu bar: the title bar draws this menu itself (see MenuBar.tsx) and runs its items here.
 * The user picks the app's shortcuts (Settings → Keyboard shortcuts); the window handles those keys, so these items only show them.
 */
let shortcuts: Record<string, string | undefined> = { newChat: 'Mod+N', newWindow: 'Mod+Shift+N', settings: 'Mod+,' }
const shown = (k: string) => (shortcuts[k] ? { accelerator: shortcuts[k]!.replace('Mod', 'CmdOrCtrl'), registerAccelerator: false } : {})
const toFocused = (channel: 'menu:new-chat' | 'menu:settings') => () => BrowserWindow.getFocusedWindow()?.webContents.send(channel) // the focused window only
function buildMenu(): void {
  const mac = process.platform === 'darwin'
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [
      { label: 'New Chat', ...shown('newChat'), click: toFocused('menu:new-chat') },
      { label: 'New Window', ...shown('newWindow'), click: () => createWindow() },
      { type: 'separator' }, { label: 'Settings…', ...shown('settings'), click: toFocused('menu:settings') },
      { type: 'separator' }, { role: 'close' }, ...(mac ? [] : [{ role: 'quit' as const }])
    ] },
    { label: 'Edit', role: 'editMenu' },
    { label: 'View', role: 'viewMenu' },
    { label: 'Window', role: 'windowMenu' },
    { label: 'Help', role: 'help', submenu: [{ label: 'Claude Code docs', click: () => shell.openExternal('https://code.claude.com/docs') }] }
  ]))
}
// Shortcuts the roles bring along, which their items don't expose.
const ROLE_KEYS: Partial<Record<string, string>> = { undo: 'CmdOrCtrl+Z', redo: 'CmdOrCtrl+Y', cut: 'CmdOrCtrl+X', copy: 'CmdOrCtrl+C', paste: 'CmdOrCtrl+V', selectall: 'CmdOrCtrl+A', reload: 'CmdOrCtrl+R', forcereload: 'CmdOrCtrl+Shift+R', toggledevtools: 'CmdOrCtrl+Shift+I', resetzoom: 'CmdOrCtrl+0', zoomin: 'CmdOrCtrl+Plus', zoomout: 'CmdOrCtrl+-', togglefullscreen: 'F11', close: 'CmdOrCtrl+W' }
const topMenu = (label: string) => Menu.getApplicationMenu()?.items.find((i) => i.label === label)?.submenu
ipcMain.handle('menu.items', () => (Menu.getApplicationMenu()?.items ?? []).filter((m) => m.submenu && m.visible).map((m) => ({
  label: m.label,
  items: m.submenu!.items.filter((i) => i.visible).map((i) => i.type === 'separator' ? { separator: true } : { label: i.label, enabled: i.enabled, accelerator: (i.accelerator ?? (i.role ? ROLE_KEYS[i.role.toLowerCase()] : undefined))?.toString() })
})))
ipcMain.handle('menu.run', (e, menu: string, index: number) => { // index among the visible items, as menu.items listed them
  const window = BrowserWindow.fromWebContents(e.sender) ?? undefined
  const item = topMenu(menu)?.items.filter((i) => i.visible)[index]
  if (item?.enabled) item.click(undefined, window, e.sender) // roles (copy, zoom…) act on this window, like the native menu
})
ipcMain.handle('menu.shortcuts', (_e, map: typeof shortcuts) => { shortcuts = map; buildMenu() })
ipcMain.handle('window.open', () => createWindow())

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
