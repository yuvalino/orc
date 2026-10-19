import type { Codec } from './types'
import { ClaudeCodec } from './claude/codec'

const codecs: Record<string, Codec> = { claude: new ClaudeCodec() }

export function getCodec(id: string): Codec {
  const c = codecs[id]
  if (!c) throw new Error(`Unknown codec: ${id}`)
  return c
}

export const DEFAULT_CODEC = 'claude'
