// Which Omni this plugin installs on this computer (`omni install --sandbox`, omni-local.js and
// omni-terminal.js), and so which one a sandboxed Omni below this plugin's minimum moves to.
//
// Not this plugin's own version: that is the Omni release of the plugin's last change, which
// can be weeks old. A new Omni should be the newest release this plugin works with, that is
// at least its minimum (OMNI_MINIMUM, from `engines.omni`): npm's `latest` (Omni's stable
// channel), else `next` (its dev channel, for a plugin from a dev market that needs more than
// stable has yet). The tags are read from the registry `bun x` installs from, and only an exact
// release version (<major>.<yymmdd>.<n>) is taken, so the command always names one version and
// the person sees which before anything runs. When the registry does not answer, or neither
// tag meets the minimum, it is this plugin's own version: an Omni release it was cut with.
import { z } from 'zod'
import { newer, OMNI_MINIMUM, PLUGIN_VERSION } from './version.js'

export const OMNI_PACKAGE = '@automagik/omni'
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'
const RELEASE = /^\d+\.\d{6}\.\d+$/
const TIMEOUT_MS = 5000
const MAX_BYTES = 64 * 1024
const CACHE_MS = 10 * 60_000

const release = z.string().max(64).regex(RELEASE).optional().catch(undefined)
const DistTags = z.object({ latest: release, next: release }).passthrough()

// The registry `bun x` resolves from: Bun's or npm's setting when it is an https URL, else npm's.
export function registryOf(env = process.env) {
  for (const value of [env.BUN_CONFIG_REGISTRY, env.NPM_CONFIG_REGISTRY, env.npm_config_registry]) {
    if (!value) continue
    try {
      const url = new URL(value)
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href.endsWith('/') ? url.href : `${url.href}/`
    } catch {}
  }
  return DEFAULT_REGISTRY
}

// The release to install from a registry's dist-tags: the first of `latest`, `next` that is at
// least `minimum`, else `fallback` (or `minimum`, when that is newer).
export function pickRelease(tags, { minimum = OMNI_MINIMUM, fallback = PLUGIN_VERSION } = {}) {
  const parsed = DistTags.safeParse(tags ?? {})
  for (const channel of ['latest', 'next']) {
    const version = parsed.success ? parsed.data[channel] : undefined
    if (version && !newer(minimum, version)) return { version, from: channel }
  }
  return { version: newer(minimum, fallback) ? minimum : fallback, from: 'plugin' }
}

async function distTags(registry, fetchImpl, timeoutMs) {
  const response = await fetchImpl(`${registry}-/package/${OMNI_PACKAGE.replace('/', '%2f')}/dist-tags`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) return null
  const text = await response.text()
  return text.length > MAX_BYTES ? null : JSON.parse(text)
}

const cache = new Map()

// The Omni release a new sandbox gets: `{ version, from }`, `from` naming where it came from
// (`latest`, `next` or `plugin`). Remembered for a few minutes per registry, so what the page
// shows before the person confirms is what then runs.
export async function installRelease({ fetchImpl = (...args) => fetch(...args), env = process.env, now = Date.now, timeoutMs = TIMEOUT_MS } = {}) {
  const registry = registryOf(env)
  const known = cache.get(registry)
  if (known && now() - known.at < CACHE_MS) return known.release
  const tags = await distTags(registry, fetchImpl, timeoutMs).catch(() => null)
  const picked = pickRelease(tags)
  // Only an answer is remembered: a registry that did not answer is asked again next time.
  if (tags !== null) cache.set(registry, { at: now(), release: picked })
  return picked
}

// For tests: forget what the registry said.
export const forgetReleases = () => cache.clear()
