// Windows only: preloaded (NODE_OPTIONS --require) into the Node that ssh starts as SSH_ASKPASS, `askpass <prompt>`.
// ssh can only start an executable, so that is Orc's own binary running as Node; by the time this runs, Node has taken
// the prompt for the main script's path. Swap in the helper as the main module, and hand it the prompt verbatim from
// the raw command line (Node normalised its copy as a path, which would garble a host key's base64 fingerprint).
// NODE_OPTIONS also reaches any other Node program ssh starts (a ProxyCommand, say): those get more arguments, and are left alone.
if (process.argv.length <= 2) {
  const path = require('path')
  const main = process.argv[1] ?? ''

  /** Windows' own argument splitting (CommandLineToArgvW): backslashes escape only before a quote, "" inside quotes is a quote. */
  const split = (line) => {
    const args = []
    const end = line[0] === '"' ? line.indexOf('"', 1) : line.search(/[ \t]/) // the program name: quotes, no escapes
    args.push(end < 0 ? line : line.slice(line[0] === '"' ? 1 : 0, end))
    let i = end < 0 ? line.length : end + 1
    for (;;) {
      while (line[i] === ' ' || line[i] === '\t') i++
      if (i >= line.length) return args
      let arg = '', quoted = false
      while (i < line.length) {
        const c = line[i]
        if (c === '\\') {
          let n = 0
          while (line[i] === '\\') { n++; i++ }
          if (line[i] !== '"') arg += '\\'.repeat(n)
          else { arg += '\\'.repeat(n >> 1); if (n % 2) { arg += '"'; i++ } } // an even run leaves the quote to act as one
          continue
        }
        if (c === '"') { if (quoted && line[i + 1] === '"') { arg += '"'; i += 2 } else { quoted = !quoted; i++ } continue }
        if (!quoted && (c === ' ' || c === '\t')) break
        arg += c; i++
      }
      args.push(arg)
    }
  }

  let prompt
  try {
    const query = `[Console]::OutputEncoding=[Text.Encoding]::UTF8;(Get-CimInstance Win32_Process -Filter 'ProcessId=${process.pid}').CommandLine`
    const line = require('child_process').execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf-8', windowsHide: true }).replace(/\r?\n$/, '')
    prompt = split(line)[1]
  } catch { /* below */ }
  if (prompt === undefined) { const cwd = path.join(process.cwd(), path.sep); prompt = main.startsWith(cwd) ? main.slice(cwd.length) : main }
  process.env.ORC_ASKPASS_PROMPT = prompt
  const helper = require('url').pathToFileURL(path.join(__dirname, 'askpass.js')).href
  require('module').registerHooks({ resolve: (s, c, next) => (s === main ? { url: helper, shortCircuit: true } : next(s, c)) })
}
