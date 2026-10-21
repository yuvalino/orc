/**
 * A duration for "Worked for", "Working for" and the Subagents pane: every unit from the largest present down to seconds,
 * zero-padded after the first — "45s", "3m 07s", "2h 05m 09s", "1d 03h 00m 12s".
 */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const units: [number, string][] = [[Math.floor(s / 86_400), 'd'], [Math.floor(s / 3600) % 24, 'h'], [Math.floor(s / 60) % 60, 'm'], [s % 60, 's']]
  const first = units.findIndex(([n]) => n > 0)
  return units.slice(first < 0 ? 3 : first).map(([n, u], i) => `${i ? String(n).padStart(2, '0') : n}${u}`).join(' ')
}
