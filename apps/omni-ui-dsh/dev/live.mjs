// Runs Omni's four DSH plugins from this checkout in a DSH of their own, the way the desktop
// app starts them, and reloads the browser whenever one changes: the live loop for working on
// the UI.
//
//   node dev/live.mjs [--home ~/.omni-dev] [--port 3080] [--fresh]
//
// The DSH and its profile live under --home (DSH_HOME is <home>/dsh, the plugins' home is
// <home>/ui), apart from any DSH or Omni desktop app you already run. --fresh empties it
// first, so the welcome and the connect steps show again. The profile links the plugins'
// folders in place (apps/*-dsh beside this one). A change under a plugin's src/client
// rebuilds its bundle (npm run build); that, or a change to host code (index.js, src/host,
// src/shared), restarts DSH, which serves a plugin's bundle as it was when DSH started;
// then the page reloads. Open the URL it prints.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = dirname(HERE)
const APPS = dirname(PLUGIN)
const DSH_BIN = join(PLUGIN, 'dev', 'harness', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const PROFILE = 'omni'
const LIVE_PATH = '/__omni-live'
// The plugins the desktop app ships, by folder, in its bundle order.
const FOLDERS = ['omni-ui-dsh', 'omni-channels-dsh', 'omni-canvas-dsh', 'omni-ai-dsh']

const options = { home: join(homedir(), '.omni-dev'), port: '3080', fresh: false }
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  const key = args[i].replace(/^--/, '')
  if (key === 'fresh') options.fresh = true
  else if (key in options && args[i + 1] !== undefined) options[key] = args[++i]
  else {
    console.error('usage: node dev/live.mjs [--home ~/.omni-dev] [--port 3080] [--fresh]')
    process.exit(2)
  }
}
const home = resolve(options.home.replace(/^~(?=\/|$)/, homedir()))
const port = Number(options.port)
const dshPort = port + 1
const dshHome = join(home, 'dsh')
const say = message => console.log(`[omni-live] ${message}`)
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))

if (!existsSync(DSH_BIN)) {
  console.error('no DSH here: run `npm run harness` in apps/omni-ui-dsh first')
  process.exit(2)
}
if (options.fresh) {
  rmSync(home, { recursive: true, force: true })
  say(`emptied ${home}`)
}

// The profile: the desktop app's bundles and settings, with each plugin linked in place.
const plugins = FOLDERS.map(folder => ({ folder, dir: join(APPS, folder), name: readJson(join(APPS, folder, 'package.json')).name }))
const profileDir = join(dshHome, 'profiles', PROFILE)
mkdirSync(join(profileDir, 'node_modules', '@automagik'), { recursive: true })
for (const plugin of plugins) {
  const link = join(profileDir, 'node_modules', plugin.name)
  rmSync(link, { recursive: true, force: true })
  symlinkSync(plugin.dir, link, 'dir')
}
// Add-ons (dev/live-addons.json: npm name -> exact version) join the profile the way DSH adds
// any plugin: `dsh plugin --profile omni add`, which is pnpm in the profile (hoisted, as every
// DSH profile is), never npm. pnpm is pinned to the release the desktop app ships.
const PNPM = 'pnpm@10.34.6'
const addons = existsSync(join(HERE, 'live-addons.json')) ? readJson(join(HERE, 'live-addons.json')) : {}
const installed = name => {
  try {
    return readJson(join(profileDir, 'node_modules', name, 'package.json')).version
  } catch {
    return null
  }
}
const writeProfile = () => writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
  name: 'omni-live-profile',
  private: true,
  dependencies: { ...Object.fromEntries(plugins.map(plugin => [plugin.name, `link:${plugin.dir}`])), ...addons },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-experimental-plugin-market-bundle', ...plugins.map(plugin => plugin.name), ...Object.keys(addons)] } },
}, null, 2)}\n`)
if (!existsSync(join(profileDir, 'pnpm-workspace.yaml'))) writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
writeProfile()
const missing = Object.entries(addons).filter(([name, version]) => installed(name) !== version)
if (missing.length > 0) {
  say(`adding ${missing.map(([name, version]) => `${name}@${version}`).join(', ')} with dsh plugin add (${PNPM})`)
  // A pnpm shim first on PATH, so DSH's plugin manager runs the pinned pnpm.
  const shims = join(home, 'bin')
  mkdirSync(shims, { recursive: true })
  writeFileSync(join(shims, 'pnpm'), `#!/bin/sh\nexec npx --yes ${PNPM} "$@"\n`, { mode: 0o755 })
  execFileSync(process.execPath, [DSH_BIN, 'plugin', '--profile', PROFILE, 'add', '--ignore-scripts', ...missing.map(([name, version]) => `${name}@${version}`)], {
    cwd: profileDir,
    env: { ...process.env, DSH_HOME: dshHome, DO_NOT_TRACK: '1', PATH: `${shims}:${process.env.PATH}` },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  // DSH's add records the plugin its own way; the profile is rewritten from the same lists.
  writeProfile()
}
// The profile's settings: dev/live-profile.patch.yml seeds a new profile, and an entry it
// ships that an existing profile lacks (by id) is appended, as the desktop app does.
const shippedPatch = readFileSync(join(HERE, 'live-profile.patch.yml'), 'utf8')
const patchFile = join(profileDir, 'cordis.patch.yml')
if (!existsSync(patchFile)) writeFileSync(patchFile, shippedPatch)
else {
  const ids = text => new Set([...String(text).matchAll(/^[\s-]*id:\s*['"]?([^'"\s#]+)/gm)].map(match => match[1]))
  const have = ids(readFileSync(patchFile, 'utf8'))
  const entries = []
  let comments = []
  for (const line of shippedPatch.split('\n')) {
    if (line.startsWith('- ')) {
      entries.push({ lines: [...comments, line] })
      comments = []
    } else if (line.startsWith('#')) comments.push(line)
    else if (entries.length > 0 && /^\s+\S/.test(line)) entries.at(-1).lines.push(line)
    else comments = []
  }
  const missing = entries.filter(entry => [...ids(entry.lines.join('\n'))].every(id => !have.has(id)))
  if (missing.length > 0) {
    writeFileSync(patchFile, `${readFileSync(patchFile, 'utf8').replace(/\s*$/, '')}\n${missing.map(entry => entry.lines.join('\n')).join('\n')}\n`)
    say(`profile settings: added ${missing.length} shipped ${missing.length === 1 ? 'entry' : 'entries'}`)
  }
}

// Browsers waiting for a reload (Server-Sent Events).
const listeners = new Set()
const reload = (why) => {
  say(`reload: ${why}`)
  for (const res of listeners) res.write(`data: ${why}\n\n`)
}
// A page carries the launcher run it came from: one served by an earlier run reloads as soon
// as it reconnects, so restarting this script also refreshes an open tab.
const BOOT = Date.now().toString(36)
const RELOADER = `<script>(()=>{const s=new EventSource(${JSON.stringify(`${LIVE_PATH}?boot=${BOOT}`)});s.onmessage=()=>location.reload()})()</script>`

// DSH on loopback, restarted when host code changes.
let dsh = null
let launchPath = null
function startDsh() {
  const env = { ...process.env, DSH_HOME: dshHome, OMNI_HOME: home, OMNI_CLIENT_ID: 'omni-desktop', DO_NOT_TRACK: '1' }
  dsh = spawn(process.execPath, [DSH_BIN, '--profile', PROFILE, '--no-open', '--host', '127.0.0.1', '--port', String(dshPort)], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const relay = (chunk) => {
    process.stdout.write(chunk)
    const match = String(chunk).match(/dsh web: http:\/\/127\.0\.0\.1:\d+(\/\S*token=\S+)/)
    if (!match) return
    const first = launchPath === null
    launchPath = match[1]
    if (first) say(`open http://127.0.0.1:${port}${launchPath}`)
    else reload('DSH restarted')
  }
  dsh.stdout.on('data', relay)
  dsh.stderr.on('data', relay)
  dsh.on('exit', (code, signal) => {
    if (!stopping && !restarting) say(`DSH exited (${signal ?? code}); edit a host file to start it again`)
  })
}
let restarting = false
async function restartDsh(why) {
  if (restarting) return
  restarting = true
  say(`restarting DSH: ${why}`)
  if (dsh?.exitCode === null) {
    const exited = new Promise(done => dsh.once('exit', done))
    dsh.kill('SIGTERM')
    await exited
  }
  restarting = false
  startDsh()
}

// The front door: a reverse proxy to DSH that adds the reloader to its pages.
const gate = createServer((req, res) => {
  if (req.url === LIVE_PATH || req.url.startsWith(`${LIVE_PATH}?`)) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(': live\n\n')
    if (new URL(req.url, 'http://live').searchParams.get('boot') !== BOOT) res.write('data: a newer launcher run\n\n')
    listeners.add(res)
    res.on('close', () => listeners.delete(res))
    return
  }
  const headers = { ...req.headers, 'accept-encoding': 'identity' }
  const upstream = request({ host: '127.0.0.1', port: dshPort, method: req.method, path: req.url, headers }, (reply) => {
    const html = String(reply.headers['content-type'] ?? '').includes('text/html')
    if (!html) {
      res.writeHead(reply.statusCode, reply.headers)
      reply.pipe(res)
      return
    }
    const chunks = []
    reply.on('data', chunk => chunks.push(chunk))
    reply.on('end', () => {
      const page = Buffer.concat(chunks).toString('utf8')
      const body = page.includes('</body>') ? page.replace('</body>', `${RELOADER}</body>`) : `${page}${RELOADER}`
      const out = { ...reply.headers }
      delete out['content-length']
      delete out['content-security-policy']
      res.writeHead(reply.statusCode, out)
      res.end(body)
    })
  })
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
    res.end('DSH is starting…\n')
  })
  req.pipe(upstream)
})
gate.on('upgrade', (req, socket, head) => {
  const upstream = connect(dshPort, '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`]
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head.length) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
  const close = () => {
    socket.destroy()
    upstream.destroy()
  }
  upstream.on('error', close)
  socket.on('error', close)
})

// One build at a time per plugin; a change during a build builds once more after it. What a
// build writes itself (client.js, and generated host files such as omni-routes.js) is not a
// change to react to: events from a plugin during its build and for a second after are dropped.
const building = new Map()
const quietUntil = new Map()
function build(plugin) {
  const state = building.get(plugin.folder) ?? { running: false, again: false }
  building.set(plugin.folder, state)
  if (state.running) {
    state.again = true
    return
  }
  state.running = true
  const started = Date.now()
  const child = spawn('npm', ['run', '--silent', 'build'], { cwd: plugin.dir, env: { ...process.env, DO_NOT_TRACK: '1' }, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('exit', (code) => {
    state.running = false
    quietUntil.set(plugin.folder, Date.now() + 1000)
    // DSH fingerprints each plugin's client.js when it starts and serves it as immutable
    // under that fingerprint, so a new bundle reaches the page only through a restart.
    if (code === 0) debounce('dsh', () => restartDsh(`${plugin.folder} rebuilt in ${Date.now() - started} ms`))
    else say(`${plugin.folder}: build failed (${code})`)
    if (state.again) {
      state.again = false
      build(plugin)
    }
  })
}

const timers = new Map()
const debounce = (key, fn) => {
  clearTimeout(timers.get(key))
  timers.set(key, setTimeout(fn, 150))
}
// Polled, not fs.watch: on macOS fs.watch reports every file as changed when it starts and
// misses files a sync rewrites. A plugin's sources are a few hundred files, so a stat of each
// every 400 ms is cheap.
const WATCHED = [/^src\/client\//, /^src\/host\//, /^src\/shared\//, /^index\.js$/, /^cordis\.patch\.yml$/]
function snapshot(dir, prefix = '', into = new Map()) {
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && (path === 'src' || path.startsWith('src/'))) snapshot(dir, path, into)
    } else if (WATCHED.some(pattern => pattern.test(path))) {
      try {
        const info = statSync(join(dir, path))
        into.set(path, `${info.mtimeMs}:${info.size}`)
      } catch {}
    }
  }
  return into
}
const seen = new Map(plugins.map(plugin => [plugin.folder, snapshot(plugin.dir)]))
setInterval(() => {
  for (const plugin of plugins) {
    const before = seen.get(plugin.folder)
    const now = snapshot(plugin.dir)
    seen.set(plugin.folder, now)
    if (building.get(plugin.folder)?.running || Date.now() < (quietUntil.get(plugin.folder) ?? 0)) continue
    const changed = [...now].filter(([path, stamp]) => before.get(path) !== stamp).map(([path]) => path)
    for (const path of before.keys()) if (!now.has(path)) changed.push(path)
    if (changed.length === 0) continue
    if (changed.some(path => !path.startsWith('src/client/'))) {
      debounce('dsh', () => restartDsh(`${plugin.folder}/${changed.find(path => !path.startsWith('src/client/'))}`))
    } else debounce(`${plugin.folder}:client`, () => build(plugin))
  }
}, 400).unref()

let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  gate.close()
  for (const res of listeners) res.end()
  if (dsh?.exitCode === null) dsh.kill('SIGTERM')
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

gate.listen(port, '127.0.0.1', () => {
  say(`plugins: ${plugins.map(plugin => plugin.name).join(', ')}`)
  say(`home: ${home}`)
  startDsh()
})
