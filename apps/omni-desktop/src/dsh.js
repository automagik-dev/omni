// The DeepSeek Harness the app runs, as plain Node: where its home is, how the profile the
// app ships lands there, and the server process itself. Electron's main process
// (main.js) uses this; tests use it without Electron.
//
// Everything the app keeps is under one folder, ~/.omni/desktop by default:
//   dsh/   DSH_HOME: dsh's own Sessions, settings and the `omni` profile
//   ui/    the Omni UI plugin's home (OMNI_HOME is this folder, so the plugin uses ui/)
//   bin/   `node` and `pnpm` for dsh, both on Electron's own Node (writeTools)
// It is apart from a dsh you already run (~/.dsh) and from the Omni UI plugin installed
// into that one (~/.omni/ui), so neither sees the other's Bots or Sessions.
import { spawn } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

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
    pnpm: join(root, 'runtime', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
    profile: join(root, 'profile'),
  }
}

const shellQuote = text => `'${String(text).replaceAll("'", `'\\''`)}'`

/**
 * Write `node` and `pnpm` into `dir` for dsh's PATH: dsh's plugin manager installs plugins
 * (the market, Settings → Plugins) with pnpm, and nothing guarantees a machine has Node or
 * pnpm. Both run on `node`, the app's own binary as Node (ELECTRON_RUN_AS_NODE). Written at
 * every launch, since the app's path changes with each install.
 */
export function writeTools({ dir, node, pnpm }) {
  mkdirSync(dir, { recursive: true })
  const tools = {
    node: `ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(node)} "$@"`,
    pnpm: `ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(node)} ${shellQuote(pnpm)} "$@"`,
  }
  for (const [name, line] of Object.entries(tools)) {
    const file = join(dir, name)
    writeFileSync(file, `#!/bin/sh\n# Written by the Omni desktop app at launch (src/dsh.js writeTools).\n${line}\n`)
    chmodSync(file, 0o755)
  }
  return dir
}

// The top-level entries of a cordis patch file (a YAML list): each starts with "- " at the
// first column, runs over its indented lines, and takes the comment lines right above it.
function patchEntries(text) {
  const entries = []
  let comments = []
  let current = null
  for (const line of String(text).split('\n')) {
    if (line.startsWith('- ')) {
      current = { lines: [...comments, line], ids: [] }
      comments = []
      entries.push(current)
    } else if (line.startsWith('#')) {
      comments.push(line)
      continue
    } else if (current && /^\s+\S/.test(line)) {
      current.lines.push(line)
    } else {
      comments = []
      continue
    }
    const id = line.match(/^[\s-]*id:\s*['"]?([^'"\s#]+)/)
    if (id) current.ids.push(id[1])
  }
  return entries
}

const idsIn = text => new Set([...String(text).matchAll(/^[\s-]*id:\s*['"]?([^'"\s#]+)/gm)].map(match => match[1]))

/**
 * The user's profile patch with the shipped entries it lacks appended, or null when it
 * lacks none. An entry is missing when none of the ids it names appears in the user's file;
 * one the user has (changed or not) is theirs and stays. DSH's empty template (`[]`) is
 * replaced rather than appended to.
 */
export function mergeProfilePatch(user, shipped) {
  const have = idsIn(user)
  const missing = patchEntries(shipped).filter(entry => entry.ids.length > 0 && entry.ids.every(id => !have.has(id)))
  if (missing.length === 0) return null
  const added = missing.map(entry => entry.lines.join('\n')).join('\n')
  const base = String(user).replace(/^\[\]\s*$/m, '').replace(/\s*$/, '')
  return `${base === '' ? '' : `${base}\n`}${added}\n`
}

/**
 * Put the shipped profile in place under DSH_HOME/profiles/omni. It is copied, not
 * linked: dsh routes a plugin's imports to its own packages only for files inside the
 * profile. A profile already there from the same build (scripts/prepare-runtime.mjs stamps
 * each with .build-id) is left as it is. Another build's gets the new packages
 * (node_modules, package.json) and nothing else: dsh keeps the user's settings in that
 * folder too (models and preferences in cordis.patch.yml, .plugin-manager/), and an
 * update must not take them away. The shipped cordis.patch.yml only seeds a new profile.
 */
export function installProfile({ dshHome, source }) {
  const target = join(dshHome, 'profiles', PROFILE)
  const id = join(source, '.build-id')
  const stamp = existsSync(id) ? readFileSync(id, 'utf8') : readFileSync(join(source, 'package.json'), 'utf8')
  const marker = join(target, '.omni-desktop-profile')
  if (existsSync(marker) && readFileSync(marker, 'utf8') === stamp) return { target, installed: false }
  if (!existsSync(target)) {
    mkdirSync(join(dshHome, 'profiles'), { recursive: true })
    cpSync(source, target, { recursive: true })
  } else {
    // Only the packages the app ships are replaced: a plugin the user installed (the market,
    // Settings → Plugins) stays, with its dependencies, and in package.json.
    for (const name of packagesIn(join(source, 'node_modules'))) {
      rmSync(join(target, 'node_modules', name), { recursive: true, force: true })
      cpSync(join(source, 'node_modules', name), join(target, 'node_modules', name), { recursive: true })
    }
    // The plugins' tarballs the package.json names (file:vendor/…) are the app's own.
    rmSync(join(target, 'vendor'), { recursive: true, force: true })
    if (existsSync(join(source, 'vendor'))) cpSync(join(source, 'vendor'), join(target, 'vendor'), { recursive: true })
    writeFileSync(join(target, 'package.json'), mergeProfilePackage(readJson(join(target, 'package.json')), readJson(join(source, 'package.json'))))
    if (existsSync(join(source, '.build-id'))) cpSync(join(source, '.build-id'), join(target, '.build-id'))
    for (const file of ['cordis.patch.yml', 'pnpm-workspace.yaml']) {
      if (!existsSync(join(target, file)) && existsSync(join(source, file))) cpSync(join(source, file), join(target, file))
    }
    // A setting a newer build ships (a new plugin's row, a seed) reaches an existing profile.
    const patch = join(target, 'cordis.patch.yml')
    const merged = mergeProfilePatch(readFileSync(patch, 'utf8'), readFileSync(join(source, 'cordis.patch.yml'), 'utf8'))
    if (merged !== null) writeFileSync(patch, merged)
  }
  writeFileSync(marker, stamp)
  return { target, installed: true }
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

// The packages in a node_modules folder, scoped ones as @scope/name; npm's and pnpm's own
// dot files are not packages.
function packagesIn(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(name => !name.startsWith('.')).flatMap(name =>
    name.startsWith('@') ? readdirSync(join(dir, name)).map(inner => `${name}/${inner}`) : [name])
}

/**
 * The shipped profile package.json with what the user added on top: dependencies and
 * bundles the shipped one does not name keep their place after the shipped ones.
 */
export function mergeProfilePackage(user, shipped) {
  const merged = structuredClone(shipped)
  const extraDependencies = Object.entries(user?.dependencies ?? {}).filter(([name]) => !Object.hasOwn(shipped.dependencies ?? {}, name))
  if (extraDependencies.length > 0) merged.dependencies = { ...shipped.dependencies, ...Object.fromEntries(extraDependencies) }
  const shippedBundles = shipped.dsh?.profile?.bundles ?? []
  const extraBundles = (user?.dsh?.profile?.bundles ?? []).filter(name => !shippedBundles.includes(name))
  if (extraBundles.length > 0) merged.dsh.profile.bundles = [...shippedBundles, ...extraBundles]
  return `${JSON.stringify(merged, null, 2)}\n`
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
export function dshEnv({ base = process.env, home, electronAsNode = false, binDir }) {
  return {
    ...base,
    // After the machine's own: a project's commands keep the user's node and pnpm.
    ...(binDir ? { PATH: [base.PATH, binDir].filter(Boolean).join(delimiter) } : {}),
    DSH_HOME: join(home, 'dsh'),
    OMNI_HOME: home,
    // Signs in to an Omni as the desktop app (the Better Auth device-flow client id).
    OMNI_CLIENT_ID: 'omni-desktop',
    DO_NOT_TRACK: '1',
    ...(electronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  }
}

/**
 * Start dsh on 127.0.0.1:`port` and resolve with { child, url } once it prints its launch
 * URL. `node` is the executable that runs dsh: Electron itself (with ELECTRON_RUN_AS_NODE),
 * or a Node in tests. Output goes to `log` (a writable stream) when given. `onSpawn` gets
 * the process at once, so a quit while dsh starts can stop it.
 */
export function startDsh({ node, bin, env, port, cwd, log, timeoutMs = READY_TIMEOUT_MS, onSpawn }) {
  const child = spawn(node, [bin, '--profile', PROFILE, '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  onSpawn?.(child)
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
