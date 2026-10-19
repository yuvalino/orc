import type { PushEvents } from './api'

/** NDJSON frames between a client and `orc-server --stdio`; one per line, server stdout only ever carries these. */
export interface Hello { version: string; client: { host: string; user: string }; takeover: boolean; oauthToken?: string } // oauthToken: goes only into the SDK process's env on the host
export interface Ready { version: string; host: string; dataDir: string; now: number }
export interface Busy { holder: { client: { host: string; user: string }; since: number; kind: 'local' | 'server' } }
export type ServerFrame =
  | { ready: Ready }
  | { busy: Busy }
  | { error: string; claude?: string; reason?: string }
  | { install: { phase: 'downloading' | 'verifying' | 'unpacking' } }
  | { id: number; result?: unknown; error?: string }
  | { event: keyof PushEvents | 'taken-over'; payload: unknown }
  | { pong: number }
export type ClientFrame =
  | { hello: Hello }
  | { id: number; method: string; args: unknown[] }
  | { ping: number }
  | { shutdown: true }

export const encode = (f: ServerFrame | ClientFrame): string => JSON.stringify(f) + '\n'

/** Parse one line; null for anything that is not a JSON object (shell noise before the handshake, blank lines). */
export function decode<T>(line: string): T | null {
  if (!line.startsWith('{')) return null
  try { return JSON.parse(line) as T } catch { return null }
}
