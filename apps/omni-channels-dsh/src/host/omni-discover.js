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
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { cleanOmniUrl } from './omni-link.js'

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
const GrantPayload = z.object({ url: text(2048), grant: z.string().min(16).max(512).regex(/^[A-Za-z0-9._~-]+$/) })

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

// Every place that names an Omni, keys included; this stays on the host.
export function candidates({ env = process.env, home = homedir() } = {}) {
  const found = []
  const add = (source, url, extra = {}) => {
    const clean = cleanOmniUrl(url)
    if (clean) found.push({ source, url: clean, ...extra })
  }
  const cliDir = env.OMNI_CONFIG_DIR || join(home, '.omni')
  const cli = readConfig(join(cliDir, 'config.json'))
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
function merge(found) {
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
export async function discover({ env = process.env, home = homedir(), fetchImpl = fetch } = {}) {
  const omnis = merge(candidates({ env, home }))
  const answers = await Promise.all(omnis.map(omni => (isLoopback(omni.url) ? probe(omni.url, fetchImpl) : null)))
  return omnis
    .map((omni, index) => {
      const local = isLoopback(omni.url)
      const answer = answers[index] ?? { reachable: null, version: null, canPair: null, pairing: 'unknown' }
      return { id: omni.id, url: omni.url, source: omni.source, name: omni.name ?? null, local, hasKey: Boolean(omni.key), ...answer }
    })
    .filter(omni => omni.source !== 'running' || omni.reachable)
    .sort((a, b) => Number(b.local) - Number(a.local))
}

export function install(rt) {
  async function use(body) {
    const parsed = UsePayload.safeParse(body)
    if (!parsed.success) throw invalid('Pick one of the Omnis found on this computer')
    const omni = merge(candidates()).find(entry => entry.id === parsed.data.id)
    if (!omni) throw refused('That Omni is not there any more. Look again.')
    if (!omni.key) return { status: 'pairing', ...(await rt.startOmniPairing({ url: omni.url })) }
    let reply
    try {
      reply = await fetch(`${omni.url}/api/v2/auth/validate`, { method: 'POST', headers: { accept: 'application/json', 'x-api-key': omni.key, 'x-omni-client': CLIENT_ID }, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
    } catch {
      throw refused(`Could not reach Omni at ${omni.url}`)
    }
    // A key the Omni no longer takes: sign this device in there instead.
    if (reply.status === 401 || reply.status === 403) return { status: 'pairing', ...(await rt.startOmniPairing({ url: omni.url })) }
    const valid = Validated.safeParse(await reply.json().catch(() => null))
    if (reply.status !== 200 || !valid.success) throw refused(`Omni answered ${reply.status} at ${new URL(omni.url).host}`)
    await rt.saveOmniLink({
      url: omni.url,
      key: omni.key,
      keyId: null,
      scopes: valid.data.data.scopes ?? [],
      keyExpiresAt: valid.data.data.credential?.expiresAt ?? null,
      pairedAt: new Date().toISOString(),
    })
    rt.syncOmniEvents?.()
    return { status: 'paired', origin: new URL(omni.url).host }
  }

  // Not here yet: the Omni's side of a link sent in its owner's WhatsApp chat, and running
  // Omni on this computer (`omni install --sandbox`), arrive in their own changes.
  async function connectGrant(body) {
    const parsed = GrantPayload.safeParse(body)
    if (!parsed.success || cleanOmniUrl(parsed.data.url) === null) throw invalid('That link is not one your Omni sends. Text connect to yourself on WhatsApp for a new one.')
    return { status: 'unavailable', message: 'Connecting with a link is not available yet. Type your Omni\'s address and get a code instead.' }
  }
  const localInstall = async () => ({ status: 'unavailable', message: 'Running Omni on this computer is not available yet.' })

  const endpoints = {
    'omni-discover': async () => ({ omnis: await discover() }),
    'omni-discover-use': use,
    'omni-connect-grant': connectGrant,
    'omni-local-install': localInstall,
  }
  rt.omniDiscoverEndpoint = (endpoint, body) => endpoints[endpoint](body)
  for (const [name, run] of Object.entries(endpoints)) {
    rt.ctx.effect(() => rt.hooks.endpoint(name, run, { read: true }), `omni-channels: ${name}`)
  }
}
