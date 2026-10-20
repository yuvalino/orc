/** The app's keyboard shortcuts: what each does, its defaults, and how a key press becomes a combo string like "Mod+Shift+N". */
export type ShortcutAction = 'newChat' | 'newWindow' | 'search' | 'toggleSidebar' | 'settings'
export type Shortcuts = Record<ShortcutAction, string[]>

export const SHORTCUTS: { id: ShortcutAction; name: string; desc: string; defaults: string[] }[] = [
  { id: 'newChat', name: 'New chat', desc: 'Start a new chat', defaults: ['Mod+N'] },
  { id: 'newWindow', name: 'New window', desc: 'Open another orc window', defaults: ['Mod+Shift+N'] },
  { id: 'search', name: 'Search chats', desc: 'Find a chat or run a command', defaults: ['Mod+P'] },
  { id: 'toggleSidebar', name: 'Toggle sidebar', desc: 'Show or hide the chat list', defaults: ['Mod+B'] },
  { id: 'settings', name: 'Settings', desc: 'Open settings', defaults: ['Mod+,'] }
]
export const defaultShortcuts = (): Shortcuts => Object.fromEntries(SHORTCUTS.map((s) => [s.id, [...s.defaults]])) as Shortcuts

const mac = () => window.orc.platform === 'darwin'
const KEYS: Record<string, string> = { Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`', Minus: '-', Equal: '=', Space: 'Space' }

/**
 * The combo a key press makes, or null for one that can't be a shortcut: a modifier alone, or a plain key without
 * Ctrl/Cmd/Alt (that would be typing), function keys excepted. Mod is Cmd on macOS and Ctrl elsewhere.
 */
export function comboOf(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'OS'].includes(e.key)) return null
  const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : KEYS[e.code] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  const mod = mac() ? e.metaKey : e.ctrlKey || e.metaKey
  const parts = [mod && 'Mod', mac() && e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean) as string[]
  if (!parts.some((p) => p !== 'Shift') && !/^F\d{1,2}$/.test(key)) return null
  return [...parts, key].join('+')
}

/** "Mod+Shift+N" as this platform writes it: Ctrl+Shift+N, or Cmd+Shift+N on macOS. */
export const showCombo = (combo: string): string => combo.replace(/^Mod(?=\+)/, mac() ? 'Cmd' : 'Ctrl').replace(/(^|\+)Alt(?=\+)/, mac() ? '$1Option' : '$1Alt')
