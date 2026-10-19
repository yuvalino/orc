import { chmodSync, mkdtempSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'

const win = process.platform === 'win32'

/**
 * ssh's password / passphrase / 2FA / host-key prompts, routed into the window: ssh runs our SSH_ASKPASS helper,
 * the helper connects to this per-instance socket (a Unix socket, or a named pipe on Windows), we show the prompt
 * and write the answer back.
 */
export class Askpass {
  readonly env: Record<string, string>
  private server: Server
  private pending: { prompt: string; reply: (answer: string | null) => void } | null = null

  constructor(private onPrompt: (prompt: string | null) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'orc-askpass-')) // 0700 by mkdtemp
    const sock = win ? `\\\\.\\pipe\\orc-askpass-${process.pid}-${Math.random().toString(36).slice(2)}` : join(dir, 'sock')
    const helper = join(dir, 'askpass.js'), sh = join(dir, win ? 'askpass.cmd' : 'askpass')
    writeFileSync(helper, "const s=require('net').connect(process.env.ORC_ASKPASS_SOCK);s.write(JSON.stringify(process.argv[2]??'')+'\\n');let b='';s.on('data',d=>b+=d);s.on('end',()=>{const r=JSON.parse(b);if(r===null)process.exit(1);process.stdout.write(r)})\n")
    if (win) writeFileSync(sh, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${helper}" %*\r\n`)
    else { writeFileSync(sh, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${helper}" "$@"\n`); chmodSync(sh, 0o700) }
    this.server = createServer((c) => {
      let buf = ''
      c.on('data', (d) => {
        buf += d
        if (!buf.includes('\n')) return
        const prompt = JSON.parse(buf.slice(0, buf.indexOf('\n'))) as string
        this.pending = { prompt, reply: (a) => { c.end(JSON.stringify(a)) } }
        onPrompt(prompt)
      })
    }).listen(sock)
    this.env = { SSH_ASKPASS: sh, SSH_ASKPASS_REQUIRE: 'force', ORC_ASKPASS_SOCK: sock, ...(win && !process.env.DISPLAY ? { DISPLAY: 'orc' } : {}) } // older ssh wants DISPLAY set before it will use askpass
  }

  /** The user's answer, or null to cancel (ssh then fails with its usual message). */
  answer(a: string | null): void { this.pending?.reply(a); this.pending = null; this.onPrompt(null) }
  close(): void { this.answer(null); this.server.close() }
}
