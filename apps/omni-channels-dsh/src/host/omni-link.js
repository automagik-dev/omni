// The Omni this host is linked to, and signing in to one from this device. The link is a
// file of Omni's own, omni.json in the plugin's home (0600), holding the API URL and the
// device's Omni key; nothing goes into DSH's credential store or profile. Signing in is
// the Omni's Better Auth device flow (RFC 8628): the browser shows the code as a QR that
// opens the owner's WhatsApp chat with themselves with the code typed, plus a link to the
// approval page; once the owner approves, the device token Omni grants once becomes this
// device's key. The device token stays on this host; the browser sees the code, the QR
// link, the approval link and the outcome.
//
// Before a sign-in, a profile may still name an Omni the older way (config.omni.url and
// the OMNI_API_KEY credential); omni.js reads that only when no link file exists.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

export const LINK_FILE = 'omni.json'
export const MARKET_ROW = 'plugin-market'
export const MARKET_INDEX_PATH = '/api/market/index.json'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])
export const marketUrlAllowed = (url) => {
  try {
    const { protocol, hostname: host } = new URL(url)
    return protocol === 'https:' || (protocol === 'http:' && LOOPBACK.has(host))
  } catch {
    return false
  }
}
const TIMEOUT_MS = 10_000
const POLL_TIMEOUT_MS = 30_000
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
// Which Omni client this is: the desktop app sets OMNI_CLIENT_ID=omni-desktop for its dsh.
const CLIENT_ID = process.env.OMNI_CLIENT_ID === 'omni-desktop' ? 'omni-desktop' : 'omni-dsh'
const DEVICE_NAME_MAX = 80

export const deviceNameOf = body => String(body?.deviceName ?? '').trim().slice(0, DEVICE_NAME_MAX) || `Omni UI on ${hostname()}`.slice(0, DEVICE_NAME_MAX)
// The one-time grant in a link an Omni sends its owner who texted "connect" (24 base64url
// characters, as the Omni's GrantSchema has it).
export const GRANT = /^[A-Za-z0-9_-]{24}$/

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })
const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })

// An API base URL as the person may type it: scheme optional, no /api/v2, no trailing slash.
export function cleanOmniUrl(text) {
  const value = String(text ?? '').trim()
  if (value === '') return null
  // Another scheme typed out is refused, not taken for a host name.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) return null
  let url
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password || url.search || url.hash) return null
  return `${url.origin}${url.pathname.replace(/\/api\/v2\/?$/, '').replace(/\/+$/, '')}`
}

const linkOf = (value) => {
  const url = cleanOmniUrl(value?.url)
  return url && typeof value?.key === 'string' && value.key.length > 0
    ? { url, key: value.key, keyId: value.keyId ?? null, scopes: Array.isArray(value.scopes) ? value.scopes : [], pairedAt: value.pairedAt ?? null, keyExpiresAt: value.keyExpiresAt ?? null, marketOffered: value.marketOffered === true, marketUrl: typeof value.marketUrl === 'string' ? value.marketUrl : null }
    : null
}

export function install(rt) {
  const path = join(rt.home, LINK_FILE)
  // One pairing at a time per host; it lives in memory, so a restart starts over.
  let pairing = null

  rt.omniLink = () => {
    try {
      return linkOf(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      return null
    }
  }

  // The team sends a plugin's view fields again only with a new revision (its state endpoint
  // answers `unchanged` otherwise), so a link written or removed saves the team: the + under
  // each channel, and its reason, follow the link at once instead of at the next team change.
  const viewChanged = () => Promise.resolve(rt.save?.()).catch(error => rt.warn('omni-channels: the team view did not take the new link: %s', error?.message ?? error))

  async function writeLink(link) {
    await mkdir(rt.home, { recursive: true })
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temp, `${JSON.stringify(link, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, path)
    await viewChanged()
  }

  // `typed` is the address the user typed: the market is offered there, not wherever the
  // Omni's reply points. Every new link passes here (sign-in, a connect link, the sandbox,
  // "Use it", a pasted key, a sandbox update's re-link): before it is written, the old link's
  // thread keys are cut with the old key, and the same Omni gives each thread a fresh one of
  // the new key (thread-keys.js).
  async function saveLink(link, typed = link.url) {
    await handOver(link, async () => {
      const offered = await addOmniMarket(typed)
      await writeLink({ ...link, marketOffered: offered, marketUrl: offered ? typed : null })
    })
  }
  // omni.json changes only inside the hand-over, which holds the thread keys' lock.
  const handOver = (next, commit) => (rt.handOverThreadKeys ? rt.handOverThreadKeys(next, commit) : commit().then(() => ({ unreadable: null })))

  async function marketRow() {
    return rt.ctx.settings?.describe?.().find(entry => entry.ns === MARKET_ROW)
  }

  // Each Omni serves a market of its own release's plugins (/api/market/index.json). The
  // linked one joins DSH's plugin market, when that is on (its plugin-market row), so the
  // Omni plugins of the right version are a click away. It is offered once per link
  // (omni.json's marketOffered): one the user removed stays removed until the next link.
  // True when the market is on and lists it.
  // Only over https (or this machine's loopback): a plugin source on plain http could be
  // swapped by anyone on the network.
  async function addOmniMarket(url) {
    if (!marketUrlAllowed(url)) return false
    try {
      const row = await marketRow()
      if (row === undefined) return false
      const index = `${url}${MARKET_INDEX_PATH}`
      const indexes = Array.isArray(row.value?.indexes) ? row.value.indexes : []
      if (!indexes.includes(index)) await rt.ctx.settings.update(MARKET_ROW, { indexes: [...indexes, index] }, row.revision)
      return true
    } catch (error) {
      rt.warn?.('omni-channels: the Omni market was not added to the plugin market: %s', error?.message ?? error)
      return false
    }
  }
  rt.addOmniMarket = addOmniMarket

  // A link made before its market was offered (an earlier version, or the market off then)
  // gets the offer when this plugin starts.
  rt.offerOmniMarket = async () => {
    const link = rt.omniLink()
    if (link === null || link.marketOffered) return
    if (!(await addOmniMarket(link.url))) return
    // A pairing or a disconnect while the market was being updated wins over this mark.
    const now = rt.omniLink()
    if (now?.url === link.url && now.key === link.key && !now.marketOffered) await writeLink({ ...now, marketOffered: true, marketUrl: link.url })
  }

  // Disconnecting takes that Omni's market back out of the plugin market.
  async function removeOmniMarket(url) {
    try {
      const row = await marketRow()
      const indexes = Array.isArray(row?.value?.indexes) ? row.value.indexes : []
      const index = `${url}${MARKET_INDEX_PATH}`
      if (row !== undefined && indexes.includes(index)) await rt.ctx.settings.update(MARKET_ROW, { indexes: indexes.filter(item => item !== index) }, row.revision)
    } catch (error) {
      rt.warn?.('omni-channels: the Omni market was not removed from the plugin market: %s', error?.message ?? error)
    }
  }
  rt.ctx.effect?.(() => {
    void rt.offerOmniMarket().catch(() => {})
    return () => {}
  }, 'omni-channels: offer the linked Omni\'s market')

  async function omniFetch(url, method, path, { body, bearer, timeoutMs = TIMEOUT_MS } = {}) {
    let response
    try {
      response = await fetch(`${url}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          'x-omni-client': CLIENT_ID,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw refused(`Could not reach Omni at ${url}`)
    }
    const reply = await response.json().catch(() => null)
    return { status: response.status, json: reply, data: reply?.data }
  }

  const publicPairing = () => pairing && {
    origin: new URL(pairing.url).host,
    code: pairing.code,
    sendTo: pairing.sendTo,
    waLink: pairing.waLink,
    approveUrl: pairing.approveUrl,
    expiresAt: pairing.expiresAt,
    pollIntervalMs: pairing.pollIntervalMs,
  }

  // Signing in is Omni's Better Auth device flow (RFC 8628): a device code, approved by the
  // owner by sending the user code to themselves on WhatsApp or on the approval page
  // (Face ID, Touch ID, a fingerprint, or a code), then a one-time token this host trades
  // for the device's Omni key.
  async function start(body) {
    const url = cleanOmniUrl(body?.url)
    if (!url) throw invalid('Give the address of the Omni to connect to, like omni.example.com')
    const deviceName = deviceNameOf(body)
    pairing = null
    const host = new URL(url).host
    const status = await omniFetch(url, 'GET', '/api/v2/login/status')
    // Two Omnis that cannot approve this device answer the page, not an error, so it can
    // offer the key instead: one with sign-in off (404), and one from before device sign-in,
    // whose login status is behind a key (401); its version comes from its health.
    if (status.status === 404) return { status: 'unavailable', reason: 'off', url, origin: host, message: `Pairing is off on ${host}. Its owner can turn it on, or you can paste an API key.` }
    if (status.status === 401 || status.status === 403) {
      const version = (await omniFetch(url, 'GET', '/api/v2/health').catch(() => null))?.json?.version
      const at = typeof version === 'string' && /^[\w.+-]{1,64}$/.test(version) ? version : null
      return { status: 'unavailable', reason: 'too-old', url, origin: host, version: at, message: `Omni ${at ?? ''} at ${host} is too old to pair from here. Update it, or paste an API key or the link it sent you.`.replace('Omni  at', 'Omni at') }
    }
    if (status.status !== 200) throw refused(`Omni answered ${status.status} at ${host}`)
    if (!status.data?.claimed) throw refused(`${host} has no owner yet. Claim it first with the link in its server log.`)
    const code = await omniFetch(url, 'POST', '/api/auth/device/code', { body: { client_id: CLIENT_ID } })
    if (code.status === 429) throw refused('Too many sign-in attempts; wait a minute and try again.')
    if (code.status !== 200 || !code.json?.device_code) throw refused(`Omni answered ${code.status} to the sign-in request`)
    const userCode = String(code.json.user_code)
    const shown = userCode.length === 8 ? `${userCode.slice(0, 4)}-${userCode.slice(4)}` : userCode
    // The QR opens the Omni, which sends the phone on to the owner's own WhatsApp chat with
    // the code typed; the owner's number never reaches this host.
    const whatsappUrl = status.data.whatsapp === true && typeof status.data.whatsappUrl === 'string' ? status.data.whatsappUrl : null
    pairing = {
      url,
      deviceName,
      deviceCode: code.json.device_code,
      code: shown,
      sendTo: null,
      waLink: whatsappUrl ? `${whatsappUrl}?user_code=${encodeURIComponent(userCode)}` : null,
      approveUrl: code.json.verification_uri_complete ?? null,
      expiresAt: new Date(Date.now() + Number(code.json.expires_in ?? 600) * 1000).toISOString(),
      pollIntervalMs: Math.max(2000, Number(code.json.interval ?? 2) * 1000),
      accessToken: null,
    }
    // `auto`: the desktop app started this from an omni:// link and no card may be on screen
    // to poll, so this host polls until the sign-in ends.
    if (body?.auto === true) void autoPoll(pairing)
    return { pairing: publicPairing() }
  }

  async function autoPoll(current) {
    while (pairing === current) {
      await new Promise(resolve => setTimeout(resolve, current.pollIntervalMs))
      if (pairing !== current) return
      const reply = await poll().catch(() => ({ status: 'pending' }))
      if (reply.status !== 'pending') return
    }
  }

  // One poll at a time per host, whoever asks (two windows poll the same sign-in): the
  // device token Omni grants once is held here until it has become the device's key.
  let polling = null
  function poll() {
    polling ??= pollOnce().finally(() => { polling = null })
    return polling
  }

  // The key, or 'retry' (try again later), or 'lost' (the token is spent or refused: Omni
  // will not answer it again, so the sign-in has to start over).
  async function exchange(current) {
    const reply = await omniFetch(current.url, 'POST', '/api/v2/login/device-key', { body: { deviceName: current.deviceName }, bearer: current.accessToken, timeoutMs: POLL_TIMEOUT_MS })
    if (reply.status === 400 || reply.status === 401) return 'lost'
    if (reply.status !== 200 || !reply.data?.apiKey) return 'retry'
    const link = {
      url: cleanOmniUrl(reply.data.apiUrl) ?? current.url,
      key: reply.data.apiKey,
      keyId: reply.data.keyId ?? null,
      scopes: reply.data.scopes ?? [],
      keyExpiresAt: reply.data.keyExpiresAt ?? null,
      pairedAt: new Date().toISOString(),
    }
    await saveLink(link, current.url)
    rt.syncOmniEvents?.()
    return link
  }

  async function pollOnce() {
    if (!pairing) return { status: 'idle' }
    const current = pairing
    if (!current.accessToken && Date.parse(current.expiresAt) <= Date.now()) {
      pairing = null
      return { status: 'expired' }
    }
    if (!current.accessToken) {
      const reply = await omniFetch(current.url, 'POST', '/api/auth/device/token', {
        body: { grant_type: DEVICE_GRANT, device_code: current.deviceCode, client_id: CLIENT_ID },
      })
      if (reply.status === 200 && reply.json?.access_token) current.accessToken = reply.json.access_token
      else {
        const error = reply.json?.error
        if (error === 'authorization_pending' || error === 'slow_down' || reply.status >= 500 || reply.status === 429) {
          return pairing === current ? { status: 'pending', pairing: publicPairing() } : { status: 'idle' }
        }
        if (pairing === current) pairing = null
        return { status: error === 'access_denied' ? 'denied' : 'expired' }
      }
    }
    // Approved: the token becomes the key, even if the card was closed meanwhile.
    const link = await exchange(current)
    if (link === 'retry') return { status: 'pending', pairing: publicPairing() }
    if (link === 'lost') {
      if (pairing === current) pairing = null
      return { status: 'expired' }
    }
    if (pairing === current) pairing = null
    return { status: 'paired', origin: new URL(link.url).host }
  }

  // A link the Omni sent its owner, who texted "connect" in their own chat: its grant is the
  // owner's yes already, so it becomes this device's key at once, with no code to approve.
  // The grant is spent there whatever happens next; the key stays on this host.
  async function connectWithGrant(body) {
    const url = cleanOmniUrl(body?.url)
    const grant = typeof body?.grant === 'string' ? body.grant : ''
    if (!url || !GRANT.test(grant)) throw invalid('That is not a link your Omni sends. Text connect to yourself on WhatsApp for a new one.')
    const host = new URL(url).host
    const reply = await omniFetch(url, 'POST', '/api/v2/login/connect', { body: { grant, clientId: CLIENT_ID, deviceName: deviceNameOf(body) } })
    const message = typeof reply.json?.error?.message === 'string' ? reply.json.error.message : null
    if (reply.status === 410 || reply.status === 400) throw refused(message ?? 'This connect link expired or was already used. Text connect to yourself on WhatsApp for a new one.')
    if (reply.status === 404) throw refused(`Sign-in is off on ${host}.`)
    if (reply.status === 429) throw refused('Too many tries; wait a minute and try again.')
    if (reply.status !== 200 || typeof reply.data?.apiKey !== 'string' || reply.data.apiKey === '') throw refused(`Omni answered ${reply.status} at ${host}`)
    const link = {
      url: cleanOmniUrl(reply.data.apiUrl) ?? url,
      key: reply.data.apiKey,
      keyId: reply.data.keyId ?? null,
      scopes: Array.isArray(reply.data.scopes) ? reply.data.scopes : [],
      keyExpiresAt: reply.data.keyExpiresAt ?? null,
      pairedAt: new Date().toISOString(),
    }
    pairing = null
    await saveLink(link, url)
    rt.syncOmniEvents?.()
    return { status: 'paired', origin: new URL(link.url).host }
  }

  async function cancel() {
    // Nothing to tell Omni: an unapproved device code just expires.
    const had = pairing !== null
    pairing = null
    return { status: had ? 'cancelled' : 'idle' }
  }

  async function disconnect() {
    const link = rt.omniLink()
    // The thread keys are cut with this key while it is still here.
    const { unreadable } = await handOver(null, () => rm(path, { force: true }))
    await viewChanged()
    // The market where it was added, which can differ from the Omni's own API address.
    if (link?.marketUrl) await removeOmniMarket(link.marketUrl)
    rt.syncOmniEvents?.()
    return unreadable ? { status: 'disconnected', notice: 'thread-keys-unreadable', message: unreadable } : { status: 'disconnected' }
  }

  // For omni-discover.js: an Omni found on this computer links the same way a sign-in does.
  rt.saveOmniLink = saveLink
  // For omni-discover.js: the link as it is, with the scopes its key was widened to.
  rt.writeOmniLink = writeLink
  rt.startOmniPairing = start

  rt.omniLinkEndpoint = async (endpoint, body) => {
    if (endpoint === 'omni-pair-start') return start(body)
    if (endpoint === 'omni-pair-poll') return poll()
    if (endpoint === 'omni-pair-cancel') return cancel()
    if (endpoint === 'omni-connect-grant') return connectWithGrant(body)
    if (endpoint === 'omni-disconnect') return disconnect()
    if (endpoint === 'omni-link') {
      const link = rt.omniLink()
      // `configured`: this host reaches an Omni, by this link or by the profile's older URL
      // and key (omni.js); the onboarding step Connect Omni completes on it.
      const configured = link !== null || (await Promise.resolve(rt.omniConfigured?.()).catch(() => false)) === true
      return { linked: link !== null, configured, origin: link ? new URL(link.url).host : null, pairedAt: link?.pairedAt ?? null, pairing: publicPairing() }
    }
    throw invalid(`Unknown omni endpoint ${endpoint}`)
  }
  // Linking changes omni.json, not the team, so a host that only reads the team may link too.
  for (const name of ['omni-link', 'omni-pair-start', 'omni-pair-poll', 'omni-pair-cancel', 'omni-connect-grant', 'omni-disconnect']) {
    rt.ctx.effect(() => rt.hooks.endpoint(name, body => rt.omniLinkEndpoint(name, body), { read: true }), `ds-bot: ${name}`)
  }
}
