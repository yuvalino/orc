// A stand-in for `ssh`, run by Orc through ORC_SSH as `node fake-ssh.cjs <config.json> <ssh args…>`. Plain Node, so the
// remote tests run alike on Windows, Linux and macOS. The config (written by tests/remote.ts) picks the behaviour:
//   server: a fake host whose shell prints a motd line and runs orc-server against the fake SDK, whatever the command;
//   runner: runs the remote command (the last argument) locally, under sh or, on Windows, cmd like an OpenSSH host;
//   fail:   a connection that never comes up, with that message.
// `password` asks through SSH_ASKPASS first, as ssh does; `windows` rejects the Unix bootstrap like a Windows host's cmd.
// A `fail-once` file in the config's dir makes the next attempt fail (a transient network error); `ssh.pid` names this
// process, so a test drops the link by killing it.
const { spawn, spawnSync } = require('child_process')
const { existsSync, readFileSync, rmSync, writeFileSync } = require('fs')
const { join } = require('path')

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf-8'))
const command = process.argv.at(-1)
const die = (msg, code = 255) => { process.stderr.write(msg + '\n'); process.exit(code) }

writeFileSync(join(cfg.dir, 'ssh.pid'), String(process.pid))
if (cfg.fail) die(cfg.fail)
if (existsSync(join(cfg.dir, 'fail-once'))) { rmSync(join(cfg.dir, 'fail-once')); die('ssh: Could not resolve hostname fakehost') }
if (cfg.password) {
  const r = spawnSync(process.env.SSH_ASKPASS, ["fakehost's password:"], { encoding: 'utf-8' })
  if (r.status !== 0 || r.stdout !== cfg.password) die('Permission denied (password).')
}
if (cfg.windows && !command.startsWith('cmd')) die("'sh' is not recognized as an internal or external command,", 1)

// A real ssh forwards none of the client's environment; the tests need theirs (fake SDK, data dir), but not the askpass
// shim Orc preloads into Node programs ssh starts.
const env = { ...process.env, ...cfg.env }
delete env.NODE_OPTIONS
delete env.PSModulePath // PowerShell 7's, which keeps a host's Windows PowerShell from loading its own modules
let child
if (cfg.mode === 'runner') {
  child = process.platform === 'win32'
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${command}"`], { env, windowsVerbatimArguments: true, stdio: ['pipe', 'inherit', 'inherit'] })
    : spawn('sh', ['-c', command], { env, stdio: ['pipe', 'inherit', 'inherit'] })
} else {
  process.stdout.write('Welcome to fakehost (motd)\n')
  child = spawn(cfg.electron, [cfg.server, '--stdio', '--data-dir', cfg.dataDir], { env: { ...env, ELECTRON_RUN_AS_NODE: '1', ORC_FAKE_SDK: cfg.fixtures }, stdio: ['pipe', 'inherit', 'inherit'] })
}
// The host's stdin is ours: when this process dies (the link drops), the remote side reads EOF and exits, as over ssh.
process.stdin.pipe(child.stdin)
child.stdin.on('error', () => {})
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 255 : 0)))
