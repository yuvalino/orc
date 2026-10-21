import { safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { baseUserData } from './shell'

/**
 * The long-lived Claude token for remote hosts (`claude setup-token` on this machine), kept encrypted under the app's
 * shared userData (every instance, local or remote, reads the same one) and sent to a host's server in `hello` — only
 * ever into the SDK process's environment there.
 */
const file = () => join(baseUserData, 'token')

/** Linux with no keyring (a bare window manager, CI): Chromium's own fallback, the way Claude Code keeps its credentials there (a 0600 file). */
function ensureBackend(): void {
  if (process.platform === 'linux' && !safeStorage.isEncryptionAvailable()) safeStorage.setUsePlainTextEncryption(true)
}

export function token(): string | undefined {
  if (process.env.ORC_OAUTH_TOKEN) return process.env.ORC_OAUTH_TOKEN // tests
  ensureBackend()
  try { return existsSync(file()) ? safeStorage.decryptString(readFileSync(file())) : undefined } catch { return undefined }
}

export function setToken(t: string | null): void {
  if (!t) { rmSync(file(), { force: true }); return }
  ensureBackend()
  writeFileSync(file(), safeStorage.encryptString(t.trim()), { mode: 0o600 })
}
