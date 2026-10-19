import { randomBytes } from 'crypto'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'

const win = process.platform === 'win32'

/**
 * ssh's password / passphrase / 2FA / host-key prompts, routed into the window: ssh runs our SSH_ASKPASS helper,
 * the helper connects to this per-instance socket (a Unix socket, or a named pipe on Windows), we show the prompt
 * and write the answer back. A `notice` is ssh's SSH_ASKPASS_PROMPT=none case (touch your security key): shown,
 * not answered, gone when ssh ends the helper.
 */
export class Askpass {
  readonly env: Record<string, string>
  private server: Server
  private dir: string
  private pending: { reply: (answer: string | null) => void } | null = null

  constructor(private onPrompt: (prompt: string | null, notice?: boolean) => void) {
    const dir = this.dir = mkdtempSync(join(tmpdir(), 'orc-askpass-')) // 0700 by mkdtemp
    const secret = randomBytes(16).toString('hex') // the pipe/socket name is guessable on Windows: callers must know this
    const sock = win ? `\\\\.\\pipe\\orc-askpass-${process.pid}-${secret}` : join(dir, 'sock')
    const helper = join(dir, 'askpass.js')
    writeFileSync(helper, "const s=require('net').connect(process.env.ORC_ASKPASS_SOCK);s.write(JSON.stringify({k:process.env.ORC_ASKPASS_KEY,p:process.argv[2]??'',n:process.env.SSH_ASKPASS_PROMPT==='none'})+'\\n');let b='';s.on('data',d=>b+=d);s.on('end',()=>{const r=JSON.parse(b||'null');if(r===null)process.exit(1);process.stdout.write(r)})\n")
    let askpass: string
    if (win) { // ssh must start a real executable, and a .cmd cannot carry a multi-line prompt: run ourselves as Node with the helper preloaded, which then becomes the main script
      const shim = join(dir, 'shim.js')
      writeFileSync(shim, `process.argv.splice(1, 0, ${JSON.stringify(helper)})\n`)
      askpass = process.execPath
      this.env = { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: `--require ${JSON.stringify(shim)}` }
    } else {
      askpass = join(dir, 'askpass')
      writeFileSync(askpass, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${helper}" "$@"\n`); chmodSync(askpass, 0o700)
      this.env = {}
    }
    this.server = createServer((c) => {
      let buf = ''
      c.on('data', (d) => {
        buf += d
        if (!buf.includes('\n')) return
        let m: { k?: string; p?: string; n?: boolean } = {}
        try { m = JSON.parse(buf.slice(0, buf.indexOf('\n'))) } catch { /* not ours */ }
        if (m.k !== secret) { c.destroy(); return }
        const mine = this.pending = { reply: (a) => { c.end(JSON.stringify(a)) } }
        c.on('close', () => { if (this.pending === mine) { this.pending = null; this.onPrompt(null) } }) // ssh ended the helper (notice done, or ssh gone)
        onPrompt(m.p ?? '', !!m.n)
      })
      c.on('error', () => {})
    }).listen(sock)
    Object.assign(this.env, { SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force', ORC_ASKPASS_SOCK: sock, ORC_ASKPASS_KEY: secret, ...(win && !process.env.DISPLAY ? { DISPLAY: 'orc' } : {}) }) // older ssh wants DISPLAY set before it will use askpass
  }

  /** The user's answer, or null to cancel (ssh then fails with its usual message). */
  answer(a: string | null): void { const p = this.pending; this.pending = null; p?.reply(a); this.onPrompt(null) }
  close(): void { this.answer(null); this.server.close(); rmSync(this.dir, { recursive: true, force: true }) }
}
