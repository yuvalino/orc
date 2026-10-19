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

export function token(): string | undefined {
  if (process.env.ORC_OAUTH_TOKEN) return process.env.ORC_OAUTH_TOKEN // tests
  try { return existsSync(file()) ? safeStorage.decryptString(readFileSync(file())) : undefined } catch { return undefined }
}

export function setToken(t: string | null): void {
  if (!t) { rmSync(file(), { force: true }); return }
  writeFileSync(file(), safeStorage.encryptString(t.trim()), { mode: 0o600 })
}
