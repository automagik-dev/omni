// The Omnis this user already has, found without asking for an address: the Omni CLI's
// config (config.json in $OMNI_CONFIG_DIR, else ~/.omni: its apiUrl and the servers it
// knows), a sandboxed Omni's config (sandbox/config/config.json under $OMNI_HOME and under
// ~/.omni), and an Omni answering on this computer's default port. Only these local files
// and this computer's loopback are read, so finding them takes a moment and tells no one.
//
// The page sees each Omni's address, where it was found, its version and what it can do;
// never a key. "Use it" links an Omni found with a key: the key is checked against that
// Omni and copied, here on the host, into the link file a sign-in writes (omni-link.js).
// Without a key, or with one the Omni refuses, it starts the usual device sign-in there.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { cleanOmniUrl, deviceNameOf } from './omni-link.js'
import { installRelease } from './omni-release.js'
import { newer, OMNI_MINIMUM } from './version.js'

export const DEFAULT_PORT = 8882
const PROBE_TIMEOUT_MS = 800
const CHECK_TIMEOUT_MS = 10_000
const MAX_FILE = 1024 * 1024
const CLIENT_ID = process.env.OMNI_CLIENT_ID === 'omni-desktop' ? 'omni-desktop' : 'omni-dsh'
// The order a found Omni's details are taken in when two places name the same one.
const SOURCES = ['sandbox', 'cli', 'cli-server', 'running']

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })
const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })

// The CLI's config.json, as far as finding an Omni needs it (packages/cli/src/config.ts).
const text = max => z.string().max(max)
const Server = z.object({ url: text(2048), apiKey: text(4096).optional() })
const CliConfig = z.object({
  apiUrl: text(2048).optional(),
  apiKey: text(4096).optional(),
  server: z.object({ port: z.coerce.number().int().min(1).max(65535).optional() }).optional(),
  servers: z.object({ active: text(200).optional(), list: z.record(text(200), Server).optional() }).optional(),
})
const Health = z.object({ version: text(64).optional() })
const LoginStatus = z.object({ data: z.object({ claimed: z.boolean().optional() }).optional() })
const Validated = z.object({ data: z.object({ valid: z.literal(true), scopes: z.array(text(200)).max(500).optional(), credential: z.object({ expiresAt: text(64).nullable().optional() }).optional() }) })
const UsePayload = z.object({ id: z.string().regex(/^[a-f0-9]{16}$/) })
// A key the person pastes for an Omni that cannot approve this app: one unbroken string.
const KeyPayload = z.object({ id: z.string().regex(/^[a-f0-9]{16}$/).optional(), url: text(2048).optional(), apiKey: z.string().trim().min(8).max(4096).regex(/^\S+$/) }).strict()
  .refine(body => (body.id === undefined) !== (body.url === undefined), 'Name either a found Omni or an address')
const Refusal = z.object({ error: z.object({ message: text(500).optional() }).optional() })

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
export const isLoopback = url => LOOPBACK.has(new URL(url).hostname)

// localhost, 127.0.0.1 and ::1 are one Omni on the same port.
export function sameOmni(url) {
  const at = new URL(url)
  const port = at.port || (at.protocol === 'https:' ? '443' : '80')
  return `${at.protocol}//${LOOPBACK.has(at.hostname) ? 'loopback' : at.hostname}:${port}${at.pathname}`
}
const idOf = url => createHash('sha256').update(sameOmni(url)).digest('hex').slice(0, 16)

function readConfig(path) {
  try {
    if (statSync(path).size > MAX_FILE) return null
    const parsed = CliConfig.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// <OMNI_HOME>, else ~/.omni: Omni's own folder (the Automagik app keeps to ~/.automagik and
// leaves it unset). A sandboxed Omni (omni-local.js) lives in its sandbox folder.
const omniRoot = ({ env, home }) => env.OMNI_HOME || join(home, '.omni')
export const sandboxHome = ({ env = process.env, home = homedir() } = {}) => join(omniRoot({ env, home }), 'sandbox')
const cliConfigPath = ({ env, home }) => join(env.OMNI_CONFIG_DIR || join(home, '.omni'), 'config.json')

const processAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

// The services `omni install` runs its API under (packages/cli): PM2's omni-api, whose pid
// files sit in PM2's home, or the omni-api unit `--systemd` writes.
function cliServiceRuns({ env, home, exists, list, readText, isAlive }) {
  if (exists('/etc/systemd/system/omni-api.service')) return true
  const pids = join(env.PM2_HOME || join(home, '.pm2'), 'pids')
  let names = []
  try {
    names = list(pids).filter(name => /^omni-api-\d+\.pid$/.test(name))
  } catch {
    return false
  }
  return names.some((name) => {
    const pid = Number.parseInt(readText(join(pids, name)), 10)
    return Number.isInteger(pid) && pid > 0 && isAlive(pid)
  })
}

const portOf = (url) => {
  try {
    const at = new URL(url)
    return Number(at.port || (at.protocol === 'https:' ? 443 : 80))
  } catch {
    return null
  }
}

/**
 * Who runs an Omni found at `url` on this computer: `sandbox` for the sandboxed one, `cli` when
 * the Omni CLI's own install runs it (its config names that port, and its PM2 process or
 * systemd unit is there), `other` for any other loopback Omni (another app runs it, so this
 * one cannot update it), null for an Omni elsewhere.
 */
export function managerOf(url, { env = process.env, home = homedir(), exists = existsSync, list = readdirSync, readText = path => readFileSync(path, 'utf8'), isAlive = processAlive } = {}) {
  if (!isLoopback(url)) return null
  const sandbox = readConfig(join(sandboxHome({ env, home }), 'config', 'config.json'))
  if (sandbox?.apiUrl && cleanOmniUrl(sandbox.apiUrl) && sameOmni(cleanOmniUrl(sandbox.apiUrl)) === sameOmni(url)) return 'sandbox'
  const cli = readConfig(cliConfigPath({ env, home }))
  if (cli === null) return 'other'
  const cliPort = cli.server?.port ?? (cli.apiUrl && isLoopback(cli.apiUrl) ? portOf(cli.apiUrl) : null) ?? DEFAULT_PORT
  if (portOf(url) !== cliPort) return 'other'
  return cliServiceRuns({ env, home, exists, list, readText, isAlive }) ? 'cli' : 'other'
}

// Every place that names an Omni, keys included; this stays on the host.
export function candidates({ env = process.env, home = homedir() } = {}) {
  const found = []
  const add = (source, url, extra = {}) => {
    const clean = cleanOmniUrl(url)
    if (clean) found.push({ source, url: clean, ...extra })
  }
  const cli = readConfig(cliConfigPath({ env, home }))
  if (cli) {
    // The CLI's own default when it names none: the API it installs on this computer.
    add('cli', cli.apiUrl ?? `http://localhost:${cli.server?.port ?? DEFAULT_PORT}`, { key: cli.apiKey })
    if (cli.server?.port) add('running', `http://127.0.0.1:${cli.server.port}`)
    for (const [name, server] of Object.entries(cli.servers?.list ?? {})) add('cli-server', server.url, { name, key: server.apiKey })
  }
  const sandboxes = new Set([env.OMNI_HOME, join(home, '.omni')].filter(Boolean).map(dir => join(dir, 'sandbox', 'config', 'config.json')))
  for (const path of sandboxes) {
    const sandbox = readConfig(path)
    if (sandbox?.apiUrl) add('sandbox', sandbox.apiUrl, { key: sandbox.apiKey })
  }
  add('running', `http://127.0.0.1:${DEFAULT_PORT}`)
  return found
}

// One entry per Omni: the details of the first place in SOURCES that names it, and a key
// from whichever place has one.
export function merge(found) {
  const byOmni = new Map()
  for (const candidate of [...found].sort((a, b) => SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source))) {
    const id = idOf(candidate.url)
    const known = byOmni.get(id)
    if (!known) byOmni.set(id, { id, ...candidate, key: candidate.key || undefined })
    else if (!known.key && candidate.key) known.key = candidate.key
    if (known && !known.name && candidate.name) known.name = candidate.name
  }
  return [...byOmni.values()]
}

// What an Omni on this computer answers: its version, and whether a device can sign in to
// it. Login status is public on an Omni with device sign-in, 404 where its owner turned it
// off, and behind a key (401) on one from before device sign-in.
export async function probe(url, fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS) {
  const get = path => fetchImpl(`${url}${path}`, { headers: { accept: 'application/json', 'x-omni-client': CLIENT_ID }, signal: AbortSignal.timeout(timeoutMs) })
  let health
  try {
    health = await get('/api/v2/health')
  } catch {
    return { reachable: false, version: null, canPair: false, pairing: 'unreachable' }
  }
  const version = Health.safeParse(await health.json().catch(() => null)).data?.version ?? null
  let status
  try {
    status = await get('/api/v2/login/status')
  } catch {
    return { reachable: true, version, canPair: false, pairing: 'unknown' }
  }
  if (status.status === 200) {
    const claimed = LoginStatus.safeParse(await status.json().catch(() => null)).data?.data?.claimed === true
    return { reachable: true, version, canPair: claimed, pairing: claimed ? 'available' : 'unclaimed' }
  }
  const pairing = status.status === 404 ? 'off' : status.status === 401 || status.status === 403 ? 'too-old' : 'unknown'
  return { reachable: true, version, canPair: false, pairing }
}

// The Omnis to offer, as the page may see them. Omnis elsewhere are not asked anything
// until the person picks one; `running` entries that do not answer are left out, since
// nothing but the probe named them.
// An Omni older than this plugin's minimum (`engines.omni`) is `outdated`: a sandboxed one is
// reinstalled at the release a new one would get (`updateTo`, omni-release.js), one the Omni
// CLI runs is updated with it, and any other says so.
export async function discover({ env = process.env, home = homedir(), fetchImpl = fetch, manager = url => managerOf(url, { env, home }), release = () => installRelease({ env }), minimum = OMNI_MINIMUM } = {}) {
  const omnis = merge(candidates({ env, home }))
  const answers = await Promise.all(omnis.map(omni => (isLoopback(omni.url) ? probe(omni.url, fetchImpl) : null)))
  const outdated = answers.map(answer => newer(minimum, answer?.version))
  // Asked only when a sandbox needs it, so discovery stays off the network otherwise.
  const updateTo = omnis.some((omni, index) => omni.source === 'sandbox' && outdated[index]) ? (await release()).version : null
  return omnis
    .map((omni, index) => {
      const local = isLoopback(omni.url)
      const answer = answers[index] ?? { reachable: null, version: null, canPair: null, pairing: 'unknown' }
      return { id: omni.id, url: omni.url, source: omni.source, name: omni.name ?? null, local, hasKey: Boolean(omni.key), outdated: outdated[index], updateTo: omni.source === 'sandbox' && outdated[index] ? updateTo : null, manager: local ? manager(omni.url) : null, ...answer }
    })
    .filter(omni => omni.source !== 'running' || omni.reachable)
    .sort((a, b) => Number(b.local) - Number(a.local))
}

// The Omni found with this id, its key included (for this host only).
export const foundOmni = id => merge(candidates()).find(entry => entry.id === id)

// Links this host to an Omni by a key it already has: the key is checked with that Omni
// first, then written to the link file a sign-in writes. `refused` when the Omni no longer
// takes it.
// What a key this plugin makes for itself carries: what it reads and acts on in Omni
// (instances, chats, messages, media, events and their durable consumers), and seeing and
// asking for updates. Never keys, settings, auth or platform.
export const DEVICE_SCOPES = Object.freeze(['instances:*', 'chats:*', 'messages:*', 'media:*', 'events:*', 'system:read', 'system:update'])
// A key that can do anything, or make keys, is never kept as found.
const BROAD = new Set(['*', 'keys:*', 'keys:write'])
export const isBroad = scopes => (scopes ?? []).some(scope => BROAD.has(scope))
const Minted = z.object({ data: z.object({ id: text(200).optional(), plainTextKey: text(4096).min(1), scopes: z.array(text(200)).max(500).optional(), expiresAt: text(64).nullable().optional() }) })

// A device key of this host's own, made once with a broad key (POST /api/v2/keys); null when
// that key cannot make one.
async function mintDeviceKey(url, key, deviceName) {
  let reply
  try {
    reply = await fetch(`${url}/api/v2/keys`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': key, 'x-omni-client': CLIENT_ID },
      body: JSON.stringify({ name: `device: ${deviceName}`.slice(0, 255), scopes: [...DEVICE_SCOPES] }),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
  } catch {
    return null
  }
  if (reply.status !== 201 && reply.status !== 200) return null
  const minted = Minted.safeParse(await reply.json().catch(() => null))
  if (!minted.success) return null
  return { key: minted.data.data.plainTextKey, keyId: minted.data.data.id ?? null, scopes: minted.data.data.scopes ?? [...DEVICE_SCOPES], keyExpiresAt: minted.data.data.expiresAt ?? null }
}

// Links this host to an Omni by a key it already has: the key is checked with that Omni
// first. A scoped key is written to the link file a sign-in writes. A broad one (it can do
// anything, or make keys) is used once to make this device a key of its own, and only that
// one is kept; when it cannot, the found key is kept and the reply says so (`notice`).
// `refused` when the Omni no longer takes it.
export async function linkWithKey(rt, url, key, { deviceName = deviceNameOf() } = {}) {
  let reply
  try {
    reply = await fetch(`${url}/api/v2/auth/validate`, { method: 'POST', headers: { accept: 'application/json', 'x-api-key': key, 'x-omni-client': CLIENT_ID }, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
  } catch {
    throw refused(`Could not reach Omni at ${url}`)
  }
  // Omni's own words for a key it refuses, when it gives them.
  if (reply.status === 401 || reply.status === 403) return { status: 'refused', message: Refusal.safeParse(await reply.json().catch(() => null)).data?.error?.message ?? null }
  const valid = Validated.safeParse(await reply.json().catch(() => null))
  if (reply.status !== 200 || !valid.success) throw refused(`Omni answered ${reply.status} at ${new URL(url).host}`)
  const scopes = valid.data.data.scopes ?? []
  const own = isBroad(scopes) ? await mintDeviceKey(url, key, deviceName) : null
  const kept = own ?? { key, keyId: null, scopes, keyExpiresAt: valid.data.data.credential?.expiresAt ?? null }
  await rt.saveOmniLink({ url, ...kept, pairedAt: new Date().toISOString() })
  rt.syncOmniEvents?.()
  const origin = new URL(url).host
  return isBroad(scopes) && own === null ? { status: 'paired', origin, notice: 'broad-key' } : { status: 'paired', origin }
}

export function install(rt) {
  // An Omni that cannot approve this app (one from before device sign-in, or with it off)
  // takes its API key instead, pasted by the person: checked with that Omni and kept like
  // "Use it" keeps one. The key goes no further than this host.
  async function useKey(body) {
    const parsed = KeyPayload.safeParse(body)
    if (!parsed.success) throw invalid('Paste the whole API key.')
    // A found Omni by its id, or one at an address the person typed.
    const url = parsed.data.id ? foundOmni(parsed.data.id)?.url : cleanOmniUrl(parsed.data.url)
    if (!url) throw parsed.data.id ? refused('That Omni is not there any more. Look again.') : invalid('Give the address of the Omni, like omni.example.com')
    const linked = await linkWithKey(rt, url, parsed.data.apiKey)
    if (linked.status !== 'paired') throw refused(linked.message ? `Omni did not accept that key: ${linked.message}` : 'Omni did not accept that key.')
    return linked
  }

  async function use(body) {
    const parsed = UsePayload.safeParse(body)
    if (!parsed.success) throw invalid('Pick one of the Omnis found on this computer')
    const omni = foundOmni(parsed.data.id)
    if (!omni) throw refused('That Omni is not there any more. Look again.')
    if (!omni.key) return { status: 'pairing', ...(await rt.startOmniPairing({ url: omni.url })) }
    const linked = await linkWithKey(rt, omni.url, omni.key)
    // A key the Omni no longer takes: sign this device in there instead.
    return linked.status === 'refused' ? { status: 'pairing', ...(await rt.startOmniPairing({ url: omni.url })) } : linked
  }

  // The Omni this host is linked to, for the settings page: where it is and the version it
  // answers with. Never its key.
  async function linkInfo() {
    const link = rt.omniLink?.() ?? null
    const configured = link !== null || (await Promise.resolve(rt.omniConfigured?.()).catch(() => false)) === true
    if (link === null) return { linked: false, configured, origin: null, version: null, pairedAt: null }
    const answer = await probe(link.url, fetch, CHECK_TIMEOUT_MS / 5).catch(() => null)
    const version = answer?.version ?? null
    // Older than this plugin's minimum (`engines.omni`): the sidebar offers no + on it.
    return { linked: true, configured, origin: new URL(link.url).host, version, outdated: newer(OMNI_MINIMUM, version), reachable: answer?.reachable ?? false, pairedAt: link.pairedAt ?? null }
  }

  const endpoints = {
    // Where a sandboxed Omni would go, so the page can say before setting one up.
    'omni-discover': async () => ({ omnis: await discover(), sandbox: { home: sandboxHome(), minimum: OMNI_MINIMUM } }),
    'omni-link-info': linkInfo,
    'omni-discover-use': use,
    'omni-discover-key': useKey,
  }
  rt.omniDiscoverEndpoint = (endpoint, body) => endpoints[endpoint](body)
  for (const [name, run] of Object.entries(endpoints)) {
    rt.ctx.effect(() => rt.hooks.endpoint(name, run, { read: true }), `omni-channels: ${name}`)
  }
}
