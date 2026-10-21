import { BrowserWindow } from 'electron'
import type { Notice } from '@shared/api'

/** The notifications panel's contents (the bell), newest first: kept in memory, the same in every window of this instance. */
let list: Notice[] = []
const changed = () => BrowserWindow.getAllWindows().forEach((w) => !w.isDestroyed() && w.webContents.send('notices:changed', list))

export const notices = (): Notice[] => list
export function setNotice(n: Notice): void { list = [n, ...list.filter((x) => x.id !== n.id)]; changed() }
/** Replace a notice in place (download progress), keeping its position. */
export function updateNotice(n: Notice): void { list = list.some((x) => x.id === n.id) ? list.map((x) => (x.id === n.id ? n : x)) : [n, ...list]; changed() }
export function dropNotice(id: string): void { list = list.filter((x) => x.id !== id); changed() }
