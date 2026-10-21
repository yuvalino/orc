/** A version as people read it: "0.10.0-beta.1" → "0.10.0 beta 1". */
export const shownVersion = (version: string) => version.replace(/-(\w+)\.(\d+)$/, ' $1 $2')
