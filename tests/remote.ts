import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const electron = require('electron') as unknown as string
const server = join(__dirname, '../out/main/orc-server.js')

export interface FakeSsh { env: Record<string, string>; dir: string; failOnce(): void; drop(): void }

/**
 * A fake `ssh` for Orc (tests/fake-ssh.cjs, via ORC_SSH): `server` runs orc-server for `dataDir` whatever the command,
 * `runner` runs the remote command itself. See fake-ssh.cjs for the options.
 */
export function fakeSsh(dataDir: string, o: { mode?: 'server' | 'runner'; fail?: string; password?: string; env?: Record<string, string>; windows?: boolean } = {}): FakeSsh {
  const dir = mkdtempSync(join(tmpdir(), 'orc-ssh-'))
  const config = join(dir, 'config.json')
  writeFileSync(config, JSON.stringify({ mode: o.mode ?? 'server', fail: o.fail, password: o.password, env: o.env, windows: o.windows, dir, dataDir, electron, server, fixtures: join(__dirname, 'fixtures') }))
  return {
    env: { ORC_SSH: JSON.stringify([process.execPath, join(__dirname, 'fake-ssh.cjs'), config]) },
    dir,
    failOnce: () => writeFileSync(join(dir, 'fail-once'), ''),
    drop: () => process.kill(Number(readFileSync(join(dir, 'ssh.pid'), 'utf-8'))) // the link drops: ssh dies, the server reads EOF
  }
}
