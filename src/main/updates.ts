import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { UpdatePrefs } from '@shared/api'
import { baseUserData } from './shell'

/**
 * Update preferences, shared by every window and instance (Settings → General → Updates). Read from disk every time, not
 * cached: a remote host's window (another process) may have just changed them, and the updater must see it.
 */
const file = () => join(baseUserData, 'updates.json')
const DEFAULTS: UpdatePrefs = { auto: true, beta: false }

export function updatePrefs(): UpdatePrefs {
  try { return { ...DEFAULTS, ...(JSON.parse(readFileSync(file(), 'utf-8')) as Partial<UpdatePrefs>) } } catch { return DEFAULTS }
}
export function setUpdatePrefs(patch: Partial<UpdatePrefs>): UpdatePrefs {
  const next = { ...updatePrefs(), ...patch }
  writeFileSync(file(), JSON.stringify(next))
  return next
}
