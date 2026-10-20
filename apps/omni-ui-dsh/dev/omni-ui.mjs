// Runs the Omni UI on this machine's DSH, either for this machine only or for your own devices
// over Tailscale. One command per mode:
//
//   node dev/omni-ui.mjs local        # http://127.0.0.1:3080, reachable from this machine only
//   node dev/omni-ui.mjs tailscale    # https://<this node>.ts.net:3080, your tailnet login only
//
// Options: --port <dsh port> (3080), --gate-port <port> (3081), --profile <name> (web),
// --allow <login,...> (tailscale mode; default: the login that owns this node),
// --log <file> (~/.dsh/logs/omni-ui-<profile>.log).
//
// In tailscale mode DSH still listens on loopback. `tailscale serve` terminates HTTPS on the
// tailnet and forwards to a gate in this process, which admits a request only when the
// Tailscale-User-Login header serve stamps on it names an allowed login. Serve overwrites that
// header, so a client cannot claim someone else's login, and a request from a tagged device
// carries none. Everyone else on the tailnet gets 403 before DSH sees anything, so the launch
// token is no longer the only lock on a DSH whose agents run shell on this host.
// Ctrl-C (or SIGTERM) stops DSH and removes the serve mapping.
import { execFileSync, spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const DSH_BIN = join(PLUGIN, 'dev', 'harness', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

const [mode, ...rest] = process.argv.slice(2)
if (mode !== 'local' && mode !== 'tailscale') {
  console.error('usage: node dev/omni-ui.mjs local|tailscale [--port 3080] [--gate-port 3081] [--profile web] [--allow login,...] [--log file]')
  process.exit(2)
}
const options = { port: '3080', 'gate-port': '3081', profile: 'web', allow: '', log: '' }
for (let i = 0; i < rest.length; i += 2) {
  const key = rest[i]?.replace(/^--/, '')
  if (!(key in options) || rest[i + 1] === undefined) {
    console.error(`unknown or incomplete option: ${rest[i]}`)
    process.exit(2)
  }
  options[key] = rest[i + 1]
}
const port = Number(options.port)
const gatePort = Number(options['gate-port'])
const logFile = options.log || join(homedir(), '.dsh', 'logs', `omni-ui-${options.profile}.log`)
const say = message => console.log(`[omni-ui] ${message}`)

const tailscale = (...args) => execFileSync('tailscale', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const serveOff = () => {
  for (const scheme of ['https', 'http']) {
    try { tailscale('serve', `--${scheme}=${port}`, 'off') } catch {}
  }
}

function tailnetSelf() {
  const status = JSON.parse(tailscale('status', '--self', '--json'))
  return {
    host: status.Self.DNSName.replace(/\.$/, ''),
    login: status.User?.[status.Self.UserID]?.LoginName,
  }
}

// The gate: a plain reverse proxy to DSH that refuses every request whose tailnet login is not
// on the allow list. WebSocket upgrades are spliced through as raw sockets after the same check.
function startGate(allow) {
  const admitted = req => allow.has(req.headers['tailscale-user-login'])
  const refuse = req => say(`refused ${req.headers['tailscale-user-login'] ?? 'a request without a tailnet login'} from ${req.headers['x-forwarded-for'] ?? 'loopback'}: ${req.method} ${req.url.split('?')[0]}`)
  const server = createServer((req, res) => {
    if (!admitted(req)) {
      refuse(req)
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('This Omni UI is private to its owner.\n')
      return
    }
    const upstream = request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers: req.headers }, reply => {
      res.writeHead(reply.statusCode, reply.headers)
      reply.pipe(res)
    })
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
      res.end('DSH is not answering.\n')
    })
    req.pipe(upstream)
  })
  server.on('upgrade', (req, socket, head) => {
    if (!admitted(req)) {
      refuse(req)
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    const upstream = connect(port, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head.length) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    const close = () => { socket.destroy(); upstream.destroy() }
    upstream.on('error', close)
    socket.on('error', close)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(gatePort, '127.0.0.1', () => resolve(server))
  })
}

// Prefers HTTPS (a tailnet certificate); falls back to HTTP when the tailnet has HTTPS
// certificates turned off. WireGuard encrypts either way; the gate is what limits access.
function serveOn() {
  serveOff()
  try {
    tailscale('serve', '--bg', `--https=${port}`, `http://127.0.0.1:${gatePort}`)
    return 'https'
  } catch (error) {
    say(`HTTPS serve failed (${String(error.stderr || error.message).trim().split('\n')[0]}); using HTTP inside the tailnet`)
    tailscale('serve', '--bg', `--http=${port}`, `http://127.0.0.1:${gatePort}`)
    return 'http'
  }
}

let publicOrigin = `http://127.0.0.1:${port}`
const dshArgs = [DSH_BIN, '--profile', options.profile, '--no-open', '--host', '127.0.0.1', '--port', String(port)]
let gate = null

if (mode === 'tailscale') {
  const self = tailnetSelf()
  const allow = new Set((options.allow || self.login || '').split(',').map(login => login.trim()).filter(Boolean))
  if (allow.size === 0) {
    console.error('no allowed login: this node has no owner login (tagged node?); pass --allow <login>')
    process.exit(2)
  }
  gate = await startGate(allow)
  const scheme = serveOn()
  publicOrigin = `${scheme}://${self.host}:${port}`
  dshArgs.push('--trusted-host', `${self.host}:${port}`)
  say(`tailnet: ${publicOrigin} (allowed: ${[...allow].join(', ')})`)
} else {
  serveOff()
  say('local only: no tailnet mapping')
}

mkdirSync(dirname(logFile), { recursive: true })
const log = createWriteStream(logFile, { flags: 'a' })
const dsh = spawn(process.execPath, dshArgs, { cwd: PLUGIN, stdio: ['ignore', 'pipe', 'pipe'] })
const relay = chunk => {
  log.write(chunk)
  const launch = String(chunk).match(/dsh web: http:\/\/127\.0\.0\.1:\d+(\/\S*token=\S+)/)
  if (launch) say(`open ${publicOrigin}${launch[1]}`)
}
dsh.stdout.on('data', relay)
dsh.stderr.on('data', relay)
say(`DSH pid ${dsh.pid}, log ${logFile}`)

let stopping = false
function stop(code) {
  if (stopping) return
  stopping = true
  if (mode === 'tailscale') serveOff()
  gate?.close()
  if (dsh.exitCode === null) dsh.kill('SIGTERM')
  process.exitCode = code
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
dsh.on('exit', code => {
  say(`DSH exited (${code})`)
  stop(code ?? 1)
  log.end()
})
