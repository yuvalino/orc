import { join } from 'path'
import type { UpdatePrefs } from '@shared/api'
import { JsonFile } from '../server/store'
import { baseUserData } from './shell'

/** Update preferences, shared by every window and instance (Settings → General → Updates); the updater reads them. */
const file = new JsonFile<Partial<UpdatePrefs>>(() => join(baseUserData, 'updates.json'), {})
const DEFAULTS: UpdatePrefs = { auto: true, beta: false }

export const updatePrefs = (): UpdatePrefs => ({ ...DEFAULTS, ...file.read() })
export function setUpdatePrefs(patch: Partial<UpdatePrefs>): UpdatePrefs {
  const next = { ...updatePrefs(), ...patch }
  file.write(next)
  return next
}
