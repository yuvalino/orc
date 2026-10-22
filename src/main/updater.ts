import { app, net } from 'electron'
import { execFile } from 'child_process'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { autoUpdater, CancellationToken, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { allActivity } from './activity'
import { dropNotice, setNotice, updateNotice } from './notices'
import { updatePrefs } from './updates'

/**
 * Regular Orc's updater (Orc Offline never loads this module, so none of it is in that app). Orc finds the release to
 * update to (newestPublished: the newest published one, betas when opted in); electron-updater then downloads only what
 * changed, verifies and installs.
 * Automatic updates: download what's found, then install once every Orc process has been idle for 5 minutes in a row
 * (allActivity), or on quit. Restart to update installs now, after a dialog when it would interrupt something.
 * Installing is always ours (never electron-updater's own install-on-quit), so the remote-host windows are closed
 * properly first and come back afterwards.
 *
 * Tests: ORC_UPDATE_RELEASES points at a fake releases page (and turns the updater on unpackaged), ORC_UPDATE_FIRST_CHECK_MS
 * and ORC_UPDATE_IDLE_MS shorten the waits, ORC_UPDATE_INSTALLED names a file written instead of installing,
 * ORC_UPDATE_CAN_INSTALL=0 plays a platform Orc can't install on, and ORC_UPDATE_LOG names a file for electron-updater's log.
 */
const RELEASES = process.env.ORC_UPDATE_RELEASES || 'https://github.com/yuvalino/orc/releases'
const NOTICE = 'update' // one update card at a time
const IDLE = Number(process.env.ORC_UPDATE_IDLE_MS) || 5 * 60_000
const FIRST_CHECK = Number(process.env.ORC_UPDATE_FIRST_CHECK_MS) || 30_000
const EVERY = 4 * 3600_000
const testing = !!process.env.ORC_UPDATE_RELEASES
const CHANNEL = ({ darwin: 'latest-mac.yml', linux: 'latest-linux.yml' } as Record<string, string>)[process.platform] ?? 'latest.yml' // betas carry it too

export interface UpdaterHooks {
  confirm(version: string): void // the Restart to update dialog
  /** Close the other Orc processes (remote hosts) so they come back after the update; with `restart`, also remember this one's windows. */
  beforeInstall(others: { pid: number; host: string | null }[], restart: boolean): Promise<void>
  /** The install didn't happen after all: reopen the remote hosts beforeInstall closed, forget the windows it remembered. */
  installFailed(): void
}

let hooks: UpdaterHooks
let busy: 'checking' | 'downloading' | null = null
let manual = false // the running check came from Check for updates: report "up to date" and errors too
let found: UpdateInfo | null = null, ready: string | null = null
let installing = false // once: the idle timer and quitting must not start a second install
let token: CancellationToken | null = null
const skipped = new Set<string>() // cancelled or given up this session: automatic checks leave them alone
let idleSince: number | null = null
const isBeta = (v: string) => v.includes('-')

/**
 * Whether Orc can install updates where it runs: yes; 'move' — a Mac app outside the Applications folders (run from the
 * DMG, from Downloads, or from the read-only copy macOS runs a downloaded app from until it's moved), where Squirrel.Mac
 * can't replace it: Move to Applications fixes that; 'link' — no updater here (not an AppImage on Linux, an app not
 * signed with a Developer ID on macOS): the release page instead.
 */
type Installable = 'yes' | 'move' | 'link'
let installable: Promise<Installable>
function canInstall(): Promise<Installable> {
  if (testing) { const t = process.env.ORC_UPDATE_CAN_INSTALL; return Promise.resolve(t === '0' ? 'link' : t === 'move' ? 'move' : 'yes') }
  if (process.platform === 'linux') return Promise.resolve(process.env.APPIMAGE ? 'yes' : 'link')
  if (process.platform !== 'darwin') return Promise.resolve('yes')
  const bundle = join(app.getPath('exe'), '../../..')
  return new Promise((r) => execFile('codesign', ['-dv', '--verbose=2', bundle], (_e, _out, err) =>
    r(!/Authority=Developer ID Application/.test(String(err)) ? 'link' : app.isInApplicationsFolder() ? 'yes' : 'move')))
}

/** Move to Applications (macOS): Orc moves itself there and relaunches, and can update from then on. */
export function moveToApplications(): void {
  if (process.env.ORC_UPDATE_MOVED) { writeFileSync(process.env.ORC_UPDATE_MOVED, 'moved'); return } // tests
  try { if (!app.moveToApplicationsFolder()) failed('Orc stayed where it is. Move it to your Applications folder to get updates.') }
  catch (e) { failed(`Couldn't move Orc to Applications: ${shortError(e)}`) }
}
/**
 * Installing would need an administrator: Orc lives where this account can't write (Windows all-users installs,
 * /Applications on a standard account). Tried with a real file, since Windows' access checks ignore permissions.
 */
function needsAdmin(): boolean {
  if (testing) return false
  const dir = process.platform === 'darwin' ? dirname(join(app.getPath('exe'), '../../..')) : process.platform === 'linux' ? dirname(process.env.APPIMAGE ?? app.getPath('exe')) : dirname(app.getPath('exe'))
  const probe = join(dir, `.orc-write-test-${process.pid}`)
  try { writeFileSync(probe, ''); rmSync(probe, { force: true }); return false } catch { return true }
}

const failed = (message: string, version?: string) => setNotice({ id: NOTICE, kind: 'update-failed', version, message })
/** What went wrong, in words: the common network failures named, anything else kept short (the log has the details). */
function shortError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION/.test(m)) return 'GitHub can\'t be reached. Check your internet connection.'
  if (/\b(403|429)\b|rate limit/i.test(m)) return 'GitHub is limiting requests right now. Try again later.'
  if (/sha512|checksum/i.test(m)) return 'the download was damaged. Try again.'
  return m.split('\n')[0].replace(/\s*\(https?:\/\/\S+\)/g, '').slice(0, 160)
}

/** "0.10.0-beta.2" → [0, 10, 0, 'beta', 2]; stable sorts after its own betas. null when it isn't a version. */
function versionKey(v: string): (string | number)[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/i.exec(v)
  return m ? [+m[1], +m[2], +m[3], m[4] ?? '~', m[5] ? +m[5] : 0] : null // '~' sorts after every letter: stable > beta
}
export function compareVersions(a: string, b: string): number {
  const x = versionKey(a)!, y = versionKey(b)!
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

/**
 * The release to update to: newest first by version (not feed order) among the published releases, betas only when
 * opted in. A tag whose release isn't published yet (still building, or a failed build) has no update file, so it's
 * skipped and the one below it counts — it never hides an older release that's there. null: nothing newer.
 */
async function newestPublished(): Promise<string | null> {
  const res = await net.fetch(`${RELEASES}.atom`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`the releases feed answered ${res.status}`)
  const feedText = await res.text()
  const beta = updatePrefs().beta, current = __ORC_VERSION__
  const tags = [...new Set([...feedText.matchAll(/\/releases\/tag\/([^"<\s]+)/g)].map((m) => decodeURIComponent(m[1])))]
    .filter((t) => versionKey(t) && (beta || !isBeta(t)))
    .sort((a, b) => compareVersions(b, a))
  for (const tag of tags) {
    if (compareVersions(tag, current) <= 0) return null // the rest are older
    const file = await net.fetch(`${RELEASES}/download/${tag}/${CHANNEL}`, { method: 'HEAD', cache: 'no-store' })
    if (file.ok) return tag
  }
  return null
}
/**
 * The prefs file is the truth: another Orc process (a remote host's window) may have changed it, with no prefsChanged()
 * here. So every decision re-reads it, and a ready beta goes once betas are off.
 */
function applyPrefs(): void {
  autoUpdater.allowPrerelease = updatePrefs().beta
  autoUpdater.autoInstallOnAppQuit = false // see install()
  if (updatePrefs().beta) return
  if (ready && isBeta(ready) && !installing) { skipped.add(ready); ready = null; found = null; dropNotice(NOTICE) }
  else if (!ready && !busy && found && isBeta(found.version)) { skipped.add(found.version); found = null; dropNotice(NOTICE) } // found, not downloaded (automatic updates off)
}

/** Check for updates; `byUser`: Help → Check for updates… or Settings, whose result always shows. */
export async function check(byUser = false): Promise<void> {
  applyPrefs()
  if (ready) { if (byUser) setNotice({ id: NOTICE, kind: 'update-ready', version: ready }); return }
  if (busy) { if (byUser) manual = true; return } // a check or download already running reports to you when it ends
  busy = 'checking'; manual = byUser
  try {
    const tag = await newestPublished()
    if (!tag) { if (manual) setNotice({ id: NOTICE, kind: 'update-current', version: __ORC_VERSION__ }); manual = false; return }
    autoUpdater.setFeedURL({ provider: 'generic', url: `${RELEASES}/download/${tag}` }) // that release's own files
    autoUpdater.previousBlockmapBaseUrlOverride = `${RELEASES}/download/v${__ORC_VERSION__}` // the installed version's, to download only what changed
    await autoUpdater.checkForUpdates()
  } catch (e) { if (manual) failed(`Couldn't check for updates: ${shortError(e)}`) } finally { if (busy === 'checking') busy = null }
}

export async function download(): Promise<void> {
  if (!found || busy === 'downloading' || ready) return
  const { version } = found
  const mine = new CancellationToken()
  busy = 'downloading'; token = mine
  updateNotice({ id: NOTICE, kind: 'update-downloading', version, transferred: 0, total: 0, bytesPerSecond: 0 })
  try { await autoUpdater.downloadUpdate(mine) } catch (e) {
    if (mine.cancelled) return // cancel() already let go of it
    ready = null // on macOS "downloaded" can come before Squirrel.Mac took the update, and then fail
    failed(`Couldn't download Orc ${version}: ${shortError(e)}`, version)
  } finally { if (token === mine) { busy = null; token = null; manual = false } }
}

/** Cancel the download; it's done with at once, so a check right after starts fresh. */
export function cancel(): void {
  if (busy !== 'downloading' || !found) return
  skipped.add(found.version)
  token?.cancel()
  busy = null; token = null; manual = false
  dropNotice(NOTICE)
}

/** What a restart would interrupt now; null when there's no update to install. */
export function pending() { return ready && !installing ? { version: ready, activity: allActivity().activity } : null }

/** Restart to update: straight away when nothing would be interrupted, otherwise the dialog decides. */
export function restart(): void {
  applyPrefs()
  const p = pending()
  if (!p) return
  const { working, waiting, drafts } = p.activity
  if (working.length || waiting.length || drafts) hooks.confirm(p.version)
  else void install(true)
}

/**
 * Install, once. `restart` (Restart to update, or idle): Orc comes back with the same windows. Otherwise (quitting): it stays
 * closed. Either way the remote-host windows are closed properly first and reopen with Orc.
 */
let installRestart = false
export async function install(restart: boolean): Promise<void> {
  if (!ready || installing) return
  installing = true; installRestart = restart
  try {
    await hooks.beforeInstall(allActivity().others, restart)
    if (process.env.ORC_UPDATE_INSTALL_FAILS) throw new Error('the installer could not start') // tests
    if (process.env.ORC_UPDATE_INSTALLED) { // tests: record it; quitting still quits
      writeFileSync(process.env.ORC_UPDATE_INSTALLED, JSON.stringify({ version: ready, restart }))
      if (restart) installing = false; else app.quit()
      return
    }
    autoUpdater.autoRunAppAfterInstall = restart
    autoUpdater.quitAndInstall(true, restart) // silent on Windows
  } catch (e) { installFailed(e) }
}
/** Back to how things were: the remote hosts reopen, a quit goes ahead, and the card says what happened. */
function installFailed(e: unknown): void {
  const version = ready
  installing = false
  hooks.installFailed()
  failed(`Couldn't install Orc ${version}: ${shortError(e)}`, version ?? undefined)
  if (version) skipped.add(version)
  ready = null // a retry starts over with a fresh check
  if (!installRestart) app.quit() // the user was quitting: nothing to install now, so let it
}

/** Quitting with an update ready and automatic updates on installs it on the way out (unless that would need an administrator). */
export function installsOnQuit(): boolean {
  applyPrefs()
  return !!ready && !installing && updatePrefs().auto && !needsAdmin()
}

/** Settings changed: betas on checks at once; off drops a beta not yet installed (a beta in use stays until a newer stable). */
export function prefsChanged(): void {
  applyPrefs()
  if (updatePrefs().beta) { for (const v of skipped) if (isBeta(v)) skipped.delete(v); return void check() } // betas back on: the ones dropped come back
  if (busy === 'downloading' && found && isBeta(found.version)) cancel()
}

/** Every few seconds: with automatic updates on and an update ready, install once everything has been idle for 5 minutes. */
function idleTick(): void {
  applyPrefs()
  if (!ready || installing || !updatePrefs().auto || needsAdmin()) { idleSince = null; return }
  const { activity, lastInput } = allActivity()
  if (activity.working.length || activity.waiting.length || activity.drafts) { idleSince = null; return }
  idleSince ??= Date.now()
  if (Date.now() - Math.max(idleSince, lastInput) >= IDLE) { idleSince = null; void install(true) }
}

export function startUpdater(h: UpdaterHooks): void {
  hooks = h
  if (!app.isPackaged && !testing) return // development: nothing to update
  if (testing) { // unpackaged, Electron reports its own version as the app's
    autoUpdater.forceDevUpdateConfig = true
    const config = join(mkdtempSync(join(tmpdir(), 'orc-update-')), 'app-update.yml') // what a packaged app carries
    writeFileSync(config, `provider: generic\nurl: ${RELEASES}\nupdaterCacheDirName: orc-updater-test\n`)
    autoUpdater.updateConfigPath = config
    const SemVer = autoUpdater.currentVersion.constructor as new (v: string) => typeof autoUpdater.currentVersion // its own semver's
    Object.assign(autoUpdater, { currentVersion: new SemVer(__ORC_VERSION__) })
  }
  const log = process.env.ORC_UPDATE_LOG, line = (m: unknown) => log && appendFileSync(log, `${m instanceof Error ? m.stack : m}\n`) // debugging: a file to log to
  autoUpdater.logger = log ? { info: line, warn: line, error: line, debug: line } : null
  autoUpdater.autoDownload = false // downloads go through download(), so they can be cancelled
  autoUpdater.allowDowngrade = false
  installable = canInstall()
  applyPrefs()

  autoUpdater.on('update-available', async (info: UpdateInfo) => {
    found = info
    const byUser = manual
    busy = null
    if (skipped.has(info.version) && !byUser) return
    const here = await installable
    if (here !== 'yes') { manual = false; return setNotice({ id: NOTICE, kind: 'update-available', version: info.version, ...(here === 'move' ? { move: true } : { url: `${RELEASES}/tag/v${info.version}` }) }) }
    if (updatePrefs().auto || byUser) void download()
    else { manual = false; setNotice({ id: NOTICE, kind: 'update-available', version: info.version }) }
  })
  autoUpdater.on('update-not-available', () => { if (manual) setNotice({ id: NOTICE, kind: 'update-current', version: __ORC_VERSION__ }); manual = false })
  let last = 0
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    if (Date.now() - last < 250 || !found) return // a few updates a second is smooth enough
    last = Date.now()
    updateNotice({ id: NOTICE, kind: 'update-downloading', version: found.version, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond })
  })
  autoUpdater.on('error', (e) => { if (installing && ready) installFailed(e) }) // mostly reported through the check and download promises; this one is installing (Squirrel.Mac)
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => { ready = info.version; setNotice({ id: NOTICE, kind: 'update-ready', version: info.version }) })

  setTimeout(() => void check(), FIRST_CHECK) // not unref()d: in Electron's main process an unref()d timer may never fire
  setInterval(() => void check(), EVERY)
  setInterval(idleTick, Math.min(15_000, IDLE / 4))
}
