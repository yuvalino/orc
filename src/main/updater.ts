import { app } from 'electron'
import { execFile } from 'child_process'
import { accessSync, appendFileSync, constants, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { autoUpdater, CancellationToken, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { allActivity } from './activity'
import { dropNotice, setNotice, updateNotice } from './notices'
import { updatePrefs } from './updates'

/**
 * Regular Orc's updater (Orc Offline never loads this module, so none of it is in that app). electron-updater checks the
 * GitHub releases (prereleases too when beta updates are on), downloads only what changed, verifies and installs.
 * Automatic updates: download what's found, then install once every Orc process has been idle for 5 minutes in a row
 * (allActivity), or on quit. Restart to update installs now, after a dialog when it would interrupt something.
 *
 * Tests: ORC_UPDATE_FEED points at a fake generic feed (and turns the updater on unpackaged), ORC_UPDATE_FIRST_CHECK_MS
 * and ORC_UPDATE_IDLE_MS shorten the waits, ORC_UPDATE_INSTALLED names a file written instead of installing, and
 * ORC_UPDATE_LOG a file for electron-updater's log.
 */
const RELEASES = 'https://github.com/yuvalino/orc/releases/tag/v'
const NOTICE = 'update' // one update card at a time
const IDLE = Number(process.env.ORC_UPDATE_IDLE_MS) || 5 * 60_000
const FIRST_CHECK = Number(process.env.ORC_UPDATE_FIRST_CHECK_MS) || 30_000
const EVERY = 4 * 3600_000
const feed = process.env.ORC_UPDATE_FEED

export interface UpdaterHooks {
  confirm(version: string): void // the Restart to update dialog
  beforeInstall(others: { pid: number; host: string | null }[]): Promise<void> // remember the windows and remote hosts to reopen, close the other processes
}

let hooks: UpdaterHooks
let busy: 'checking' | 'downloading' | null = null
let manual = false // the running check came from Check for updates: report "up to date" and errors too
let found: UpdateInfo | null = null, ready: string | null = null
let token: CancellationToken | null = null
const skipped = new Set<string>() // cancelled this session: automatic checks leave them alone
let idleSince: number | null = null

/** Whether Orc can install updates here: an AppImage on Linux, a Developer ID–signed app on macOS (Squirrel.Mac refuses others). */
let installable: Promise<boolean>
function canInstall(): Promise<boolean> {
  if (feed) return Promise.resolve(true)
  if (process.platform === 'linux') return Promise.resolve(!!process.env.APPIMAGE)
  if (process.platform !== 'darwin') return Promise.resolve(true)
  const bundle = join(app.getPath('exe'), '../../..')
  return new Promise((r) => execFile('codesign', ['-dv', '--verbose=2', bundle], (_e, _out, err) => r(/Authority=Developer ID Application/.test(String(err)))))
}
/** Installing would need an administrator: Orc installed for all users (Windows), or where this account can't write. */
function needsAdmin(): boolean {
  if (feed) return false
  if (process.platform === 'win32') return !!process.env.LOCALAPPDATA && !app.getPath('exe').toLowerCase().startsWith(process.env.LOCALAPPDATA.toLowerCase())
  const target = process.platform === 'darwin' ? dirname(join(app.getPath('exe'), '../../..')) : dirname(process.env.APPIMAGE ?? app.getPath('exe'))
  try { accessSync(target, constants.W_OK); return false } catch { return true }
}

const failed = (message: string, version?: string) => setNotice({ id: NOTICE, kind: 'update-failed', version, message })
const shortError = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0]

/** Check for updates; `byUser`: Help → Check for updates… or Settings, whose result always shows. */
export async function check(byUser = false): Promise<void> {
  if (ready) { if (byUser) setNotice({ id: NOTICE, kind: 'update-ready', version: ready }); return }
  if (busy) return
  busy = 'checking'; manual = byUser
  try { await autoUpdater.checkForUpdates() } catch (e) { if (manual) failed(`Couldn't check for updates: ${shortError(e)}`) } finally { if (busy === 'checking') busy = null }
}

export async function download(): Promise<void> {
  if (!found || busy === 'downloading' || ready) return
  const { version } = found
  busy = 'downloading'; token = new CancellationToken()
  updateNotice({ id: NOTICE, kind: 'update-downloading', version, transferred: 0, total: 0, bytesPerSecond: 0 })
  try { await autoUpdater.downloadUpdate(token) } catch (e) {
    if (!token?.cancelled) failed(`Couldn't download Orc ${version}: ${shortError(e)}`, version)
  } finally { busy = null; token = null }
}

export function cancel(): void {
  if (busy !== 'downloading' || !found) return
  skipped.add(found.version)
  token?.cancel()
  dropNotice(NOTICE)
}

/** What a restart would interrupt now; null when there's no update to install. */
export function pending() { return ready ? { version: ready, activity: allActivity().activity } : null }

/** Restart to update: straight away when nothing would be interrupted, otherwise the dialog decides. */
export function restart(): void {
  const p = pending()
  if (!p) return
  const { working, waiting, drafts } = p.activity
  if (working.length || waiting.length || drafts) hooks.confirm(p.version)
  else void install()
}

export async function install(): Promise<void> {
  if (!ready) return
  await hooks.beforeInstall(allActivity().others)
  if (process.env.ORC_UPDATE_INSTALLED) { writeFileSync(process.env.ORC_UPDATE_INSTALLED, JSON.stringify({ version: ready })); return }
  autoUpdater.quitAndInstall(true, true) // silent on Windows, and Orc starts again afterwards
}

/** Settings changed: betas on checks at once; off cancels a beta download (a beta in use stays until a newer stable). */
export function prefsChanged(): void {
  const p = updatePrefs()
  autoUpdater.allowPrerelease = p.beta
  autoUpdater.autoInstallOnAppQuit = p.auto
  if (p.beta) void check()
  else if (busy === 'downloading' && found && /-/.test(found.version)) cancel()
}

/** Every few seconds: with automatic updates on and an update ready, install once everything has been idle for 5 minutes. */
function idleTick(): void {
  if (!ready || !updatePrefs().auto || needsAdmin()) { idleSince = null; return }
  const { activity, lastInput } = allActivity()
  if (activity.working.length || activity.waiting.length || activity.drafts) { idleSince = null; return }
  idleSince ??= Date.now()
  if (Date.now() - Math.max(idleSince, lastInput) >= IDLE) { idleSince = null; void install() }
}

export function startUpdater(h: UpdaterHooks): void {
  hooks = h
  if (!app.isPackaged && !feed) return // development: nothing to update
  if (feed) { // unpackaged, Electron reports its own version as the app's
    autoUpdater.forceDevUpdateConfig = true
    const config = join(mkdtempSync(join(tmpdir(), 'orc-update-')), 'app-update.yml') // what a packaged app carries
    writeFileSync(config, `provider: generic
url: ${feed}
updaterCacheDirName: orc-updater-test
`)
    autoUpdater.updateConfigPath = config
    autoUpdater.setFeedURL({ provider: 'generic', url: feed })
    const SemVer = autoUpdater.currentVersion.constructor as new (v: string) => typeof autoUpdater.currentVersion // its own semver's
    Object.assign(autoUpdater, { currentVersion: new SemVer(__ORC_VERSION__) })
  }
  const log = process.env.ORC_UPDATE_LOG, line = (m: unknown) => log && appendFileSync(log, `${m instanceof Error ? m.stack : m}
`) // debugging: a file to log to
  autoUpdater.logger = log ? { info: line, warn: line, error: line, debug: line } : null
  autoUpdater.autoDownload = false // downloads go through download(), so they can be cancelled
  autoUpdater.allowDowngrade = false
  installable = canInstall()
  prefsChanged()

  autoUpdater.on('update-available', async (info: UpdateInfo) => {
    found = info
    const byUser = manual
    busy = null
    if (skipped.has(info.version) && !byUser) return
    if (!(await installable)) return setNotice({ id: NOTICE, kind: 'update-available', version: info.version, url: `${RELEASES}${info.version}` })
    if (updatePrefs().auto || byUser) void download()
    else setNotice({ id: NOTICE, kind: 'update-available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => { if (manual) setNotice({ id: NOTICE, kind: 'update-current', version: __ORC_VERSION__ }) })
  let last = 0
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    if (Date.now() - last < 250 || !found) return // a few updates a second is smooth enough
    last = Date.now()
    updateNotice({ id: NOTICE, kind: 'update-downloading', version: found.version, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond })
  })
  autoUpdater.on('error', () => {}) // reported through the check and download promises
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => { ready = info.version; setNotice({ id: NOTICE, kind: 'update-ready', version: info.version }) })

  setTimeout(() => void check(), FIRST_CHECK) // not unref()d: in Electron's main process an unref()d timer may never fire
  setInterval(() => void check(), EVERY)
  setInterval(idleTick, Math.min(15_000, IDLE / 4))
}
