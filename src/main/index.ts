import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { UpdatePrefs } from '@shared/api'
import { configureClaude } from '../server/codecs/claude/codec'
import { setDataDir } from '../server/store'
import { startActivity } from './activity'
import { push, registerIpc } from './ipc'
import { Remote } from './remote'
import { dropNotice, notices } from './notices'
import { openRemote, remoteHost, sharedStore, shellStore } from './shell'
import { boot } from './transport'
import { setUpdatePrefs, updatePrefs } from './updates'

app.setName('Orc') // shown in menus and dialogs; package.json keeps the lowercase package name
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
app.on('second-instance', (_e, argv) => { if (argv.includes('--check-updates')) return void checkForUpdates(); secondInstances++; const w = BrowserWindow.getAllWindows()[0]; if (w && !background) { if (w.isMinimized()) w.restore(); w.focus() } })
Object.assign(globalThis, { orcSecondInstances: () => secondInstances, orcNewWindow: () => createWindow() })
const remote = remoteHost && app.hasSingleInstanceLock() ? new Remote(remoteHost, push) : null // a duplicate instance is quitting: no ssh, no askpass dir
const icon = join(__dirname, '../../build/icon.png') // in development; packaged builds carry the icons electron-builder derives from this file

/** Windows take the lowest free slot so each remembers its own bounds (the first window is slot 0 again after it was closed). */
const slots = new Set<number>()
const slotOf = new Map<number, number>() // webContents → slot, to hand each restored window its view
function createWindow(): void {
  let n = 0; while (slots.has(n)) n++
  slots.add(n)
  const saved = ((shellStore.read().windows as Electron.Rectangle[] | undefined) ?? [])[n] ?? { width: 1274, height: 797, x: undefined, y: undefined }
  const win = new BrowserWindow({
    ...saved,
    minWidth: 980, // both side panes at their minimum (220 + 280) still leave the composer room for its bottom row
    minHeight: 560,
    title: remoteHost ? `Orc — ${remoteHost}` : 'Orc',
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
  slotOf.set(win.webContents.id, n)
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

/**
 * Small floating windows over the current one, frameless so they can wear the app's theme: Help → About Orc (About.tsx) and
 * the Restart to update confirmation (RestartDialog.tsx). One of each at a time.
 */
const dialogs = new Map<string, BrowserWindow>()
function openDialog(hash: 'about' | 'restart', title: string, width: number, height: number): void {
  const open = dialogs.get(hash)
  if (open) return open.focus()
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const at = parent?.getBounds() // centered on the window it's about, not on the display
  const win = new BrowserWindow({
    parent, modal: process.platform !== 'darwin', // a sheet on macOS would look nothing like a dialog
    width, height, ...(at ? { x: Math.round(at.x + (at.width - width) / 2), y: Math.round(at.y + (at.height - height) / 2) } : {}), useContentSize: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    frame: false, title, backgroundColor: '#303030', show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false }
  })
  dialogs.set(hash, win)
  if (!background) win.once('ready-to-show', () => win.show())
  win.on('closed', () => dialogs.delete(hash))
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}
const openAbout = () => openDialog('about', 'About Orc', 340, 340)

/**
 * Updates (regular Orc only; see updater.ts). Orc Offline never imports the updater, so the bundler leaves it, and
 * electron-updater with it, out of that app. Only the local instance updates; a remote host's window hands
 * Check for Updates over to it.
 */
let updater: typeof import('./updater') | null = null
function checkForUpdates(): void {
  if (__ORC_OFFLINE__) return
  if (remoteHost) { spawn(process.execPath, [...(app.isPackaged ? [] : [app.getAppPath()]), '--check-updates'], { detached: true, stdio: 'ignore' }).unref(); return }
  const w = BrowserWindow.getAllWindows().find((x) => slotOf.has(x.webContents.id) && x.isFocused()) ?? BrowserWindow.getAllWindows().find((x) => slotOf.has(x.webContents.id))
  if (w) { if (w.isMinimized()) w.restore(); if (!background) w.focus(); w.webContents.send('notices:open') }
  void updater?.check(true)
}
/** Before an update installs: each window's view and the remote hosts open now come back after the restart; the other processes close. */
async function beforeInstall(others: { pid: number; host: string | null }[]): Promise<void> {
  const wins = BrowserWindow.getAllWindows().filter((w) => slotOf.has(w.webContents.id)).sort((a, b) => slotOf.get(a.webContents.id)! - slotOf.get(b.webContents.id)!)
  const views = await Promise.all(wins.map((w) => w.webContents.executeJavaScript('window.orcView?.() ?? null').catch(() => null)))
  shellStore.write({ ...shellStore.read(), restore: views })
  sharedStore.write({ ...sharedStore.read(), reopen: others.map((o) => o.host).filter(Boolean) })
  for (const o of others) try { process.kill(o.pid) } catch { /* gone */ }
}

/**
 * Off macOS the window has no native menu bar: the title bar draws this menu itself (see MenuBar.tsx) and runs its items here.
 * The user picks the app's shortcuts (Settings → Keyboard shortcuts); the window handles those keys, so these items only show them.
 */
let shortcuts: Record<string, string | undefined> = { newChat: 'Mod+N', newWindow: 'Mod+Shift+N', settings: 'Mod+,' }
const shown = (k: string) => (shortcuts[k] ? { accelerator: shortcuts[k]!.replace('Mod', 'CmdOrCtrl'), registerAccelerator: false } : {})
// To the window the menu was used in: the one Electron passes (the in-window menu bar names it), else the focused one.
// Focus alone isn't enough: after a dialog closes, Windows doesn't always hand it back.
const toFocused = (channel: 'menu:new-chat' | 'menu:settings' | 'menu:open-folder') => (_item: Electron.MenuItem, win?: Electron.BaseWindow) =>
  ((win instanceof BrowserWindow ? win : null) ?? BrowserWindow.getFocusedWindow())?.webContents.send(channel)
function buildMenu(): void {
  const mac = process.platform === 'darwin'
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [
      { label: 'New Window', ...shown('newWindow'), click: () => createWindow() },
      { label: 'New Chat', ...shown('newChat'), click: toFocused('menu:new-chat') },
      { type: 'separator' }, { label: 'Open Folder…', click: toFocused('menu:open-folder') }, // a new project
      { type: 'separator' }, { role: 'close' },
      ...(mac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: 'Quit' }]) // macOS quits from the app menu
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'delete' }, { type: 'separator' }, { role: 'selectAll' },
      { type: 'separator' }, { label: 'Settings…', ...shown('settings'), click: toFocused('menu:settings') }
    ] },
    { label: 'View', role: 'viewMenu' },
    ...(mac ? [{ label: 'Window', role: 'windowMenu' as const }] : []), // off macOS the title bar has no use for it
    { label: 'Help', role: 'help', submenu: [
      { label: 'Claude Code docs', click: () => shell.openExternal('https://code.claude.com/docs') },
      { label: 'Check for Updates…', enabled: !__ORC_OFFLINE__, click: () => checkForUpdates() }, // Orc Offline: shown, never active
      { type: 'separator' }, { label: 'About Orc', click: () => openAbout() }
    ] }
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
ipcMain.handle('window.quit', () => app.quit())
ipcMain.handle('updates.prefs', () => updatePrefs())
ipcMain.handle('updates.setPrefs', (_e, patch: Partial<UpdatePrefs>) => { const p = setUpdatePrefs(patch); push('updates:prefs', p); updater?.prefsChanged(); return p })
ipcMain.handle('updates.check', () => checkForUpdates())
ipcMain.handle('updates.download', () => updater?.download())
ipcMain.handle('updates.cancel', () => updater?.cancel())
ipcMain.handle('updates.restart', () => updater?.restart())
ipcMain.handle('updates.pending', () => updater?.pending() ?? null)
ipcMain.handle('updates.restartNow', () => updater?.install())
ipcMain.handle('notices.list', () => notices())
ipcMain.handle('notices.dismiss', (_e, id: string) => dropNotice(id))
ipcMain.handle('window.restored', (e) => { // a window reopened after an update: its view from before, once
  const views = (shellStore.read().restore as unknown[] | undefined) ?? [], n = slotOf.get(e.sender.id)
  if (n == null || views[n] == null) return null
  const v = views[n]
  const rest = views.map((x, i) => (i === n ? null : x))
  shellStore.write({ ...shellStore.read(), restore: rest.some((x) => x != null) ? rest : undefined })
  return v
})

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !app.isPackaged && existsSync(icon)) app.dock?.setIcon(icon)
  buildMenu()
  registerIpc(remote ?? undefined)
  if (remote) remote.connect(); else boot()
  startActivity()
  const restore = remote ? [] : ((shellStore.read().restore as unknown[] | undefined) ?? []) // after an update: as many windows as before
  for (let i = 0; i < Math.max(1, restore.length); i++) createWindow()
  if (!remote) {
    const reopen = (sharedStore.read().reopen as string[] | undefined) ?? []
    if (reopen.length) { sharedStore.write({ ...sharedStore.read(), reopen: [] }); reopen.forEach(openRemote) }
    if (!__ORC_OFFLINE__) void import('./updater').then((m) => { updater = m; m.startUpdater({ confirm: (v) => openDialog('restart', `Update to Orc ${v}`, 400, 280), beforeInstall }) }).catch((e) => console.error('updater failed to start:', e))
  }
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
// A remote instance lives as long as its window: closing it ends ssh and the server with it. Local keeps macOS's stay-in-Dock behaviour.
app.on('window-all-closed', () => (remote || process.platform !== 'darwin') && app.quit())
app.on('before-quit', () => remote?.shutdown())
