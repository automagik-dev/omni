// The DeepSeek Harness the app runs, as plain Node: where its home is, how the profile the
// app ships lands there, and the server process itself. Electron's main process
// (main.js) uses this; tests use it without Electron.
//
// Everything the app keeps is under one folder, ~/.omni/desktop by default:
//   dsh/   DSH_HOME: dsh's own Sessions, settings and the `omni` profile
//   ui/    the Omni UI plugin's home (OMNI_HOME is this folder, so the plugin uses ui/)
// It is apart from a dsh you already run (~/.dsh) and from the Omni UI plugin installed
// into that one (~/.omni/ui), so neither sees the other's Bots or Sessions.
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const PROFILE = 'omni'
const READY_TIMEOUT_MS = 120_000
const STOP_GRACE_MS = 8_000

const expandHome = text => (text === '~' ? homedir() : /^~[\\/]/.test(text) ? join(homedir(), text.slice(2)) : text)

/** The app's own folder: OMNI_DESKTOP_HOME, else $OMNI_HOME/desktop, else ~/.omni/desktop. */
export function appHome(env = process.env) {
  if (env.OMNI_DESKTOP_HOME?.trim()) return resolve(expandHome(env.OMNI_DESKTOP_HOME.trim()))
  const omni = env.OMNI_HOME?.trim() ? resolve(expandHome(env.OMNI_HOME.trim())) : join(homedir(), '.omni')
  return join(omni, 'desktop')
}

/** Where the runtime and the profile are: inside the app when packaged, build/ in a checkout. */
export function resourcesOf({ packaged, resourcesPath, appPath }) {
  const root = packaged ? resourcesPath : join(appPath, 'build')
  return {
    bin: join(root, 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    profile: join(root, 'profile'),
  }
}

/**
 * Put the shipped profile in place under DSH_HOME/profiles/omni. It is copied, not
 * linked: dsh routes a plugin's imports to its own packages only for files inside the
 * profile. A profile already there from the same build (scripts/prepare-runtime.mjs stamps
 * each with .build-id) is left as it is; another build's is replaced whole.
 */
export function installProfile({ dshHome, source }) {
  const target = join(dshHome, 'profiles', PROFILE)
  const id = join(source, '.build-id')
  const stamp = existsSync(id) ? readFileSync(id, 'utf8') : readFileSync(join(source, 'package.json'), 'utf8')
  const marker = join(target, '.omni-desktop-profile')
  if (existsSync(marker) && readFileSync(marker, 'utf8') === stamp) return { target, installed: false }
  rmSync(target, { recursive: true, force: true })
  mkdirSync(join(dshHome, 'profiles'), { recursive: true })
  cpSync(source, target, { recursive: true })
  writeFileSync(marker, stamp)
  return { target, installed: true }
}

/** A loopback port nobody listens on. */
export function freePort() {
  return new Promise((done, fail) => {
    const server = createServer()
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })
}

/** The launch URL (with dsh's per-launch token) in a line of dsh's output, or null. */
export function launchUrlOf(text, port) {
  const match = String(text).match(/dsh web: (http:\/\/127\.0\.0\.1:(\d+)\/\S*token=\S+)/)
  if (!match || (port !== undefined && Number(match[2]) !== port)) return null
  return match[1]
}

/** The environment dsh runs with: its own home, Omni's, and nothing that phones home. */
export function dshEnv({ base = process.env, home, electronAsNode = false }) {
  return {
    ...base,
    DSH_HOME: join(home, 'dsh'),
    OMNI_HOME: home,
    DO_NOT_TRACK: '1',
    ...(electronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  }
}

/**
 * Start dsh on 127.0.0.1:`port` and resolve with { child, url } once it prints its launch
 * URL. `node` is the executable that runs dsh: Electron itself (with ELECTRON_RUN_AS_NODE),
 * or a Node in tests. Output goes to `log` (a writable stream) when given.
 */
export function startDsh({ node, bin, env, port, cwd, log, timeoutMs = READY_TIMEOUT_MS }) {
  const child = spawn(node, [bin, '--profile', PROFILE, '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const ready = new Promise((done, fail) => {
    let seen = ''
    const timer = setTimeout(() => fail(new Error(`dsh did not start within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs)
    const onData = (chunk) => {
      log?.write(chunk)
      seen = `${seen}${chunk}`.slice(-4096)
      const url = launchUrlOf(seen, port)
      if (url) {
        clearTimeout(timer)
        done(url)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      fail(new Error(`dsh exited before it was ready (${signal ?? code})`))
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      fail(error)
    })
  })
  return ready.then(url => ({ child, url }), (error) => {
    stopDsh(child)
    throw error
  })
}

/** Stop dsh: SIGTERM, then SIGKILL if it is still there after the grace period. */
export function stopDsh(child, graceMs = STOP_GRACE_MS) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((done) => {
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, graceMs)
    child.once('exit', () => {
      clearTimeout(timer)
      done()
    })
    try { child.kill('SIGTERM') } catch { done() }
  })
}

/**
 * What the window may do with a URL. The app page and everything on its origin stays in
 * the window; web links (a wa.me link, docs, a channel's web page) open in the system
 * browser; anything else is refused.
 */
export function navigationOf(url, origin) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return 'deny'
  }
  if (parsed.origin === origin) return 'allow'
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:') return 'external'
  return 'deny'
}
