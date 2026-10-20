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
import { readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

export const LINK_FILE = 'omni.json'
const TIMEOUT_MS = 10_000
const POLL_TIMEOUT_MS = 30_000
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
// Which Omni client this is: the desktop app sets OMNI_CLIENT_ID=omni-desktop for its dsh.
const CLIENT_ID = process.env.OMNI_CLIENT_ID === 'omni-desktop' ? 'omni-desktop' : 'omni-dsh'
const DEVICE_NAME_MAX = 80

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
    ? { url, key: value.key, keyId: value.keyId ?? null, scopes: Array.isArray(value.scopes) ? value.scopes : [], pairedAt: value.pairedAt ?? null, keyExpiresAt: value.keyExpiresAt ?? null }
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

  async function saveLink(link) {
    await mkdir(rt.home, { recursive: true })
    const temp = `${path}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(link, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, path)
  }

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
    const deviceName = String(body?.deviceName ?? '').trim().slice(0, DEVICE_NAME_MAX) || `Omni UI on ${hostname()}`.slice(0, DEVICE_NAME_MAX)
    pairing = null
    const host = new URL(url).host
    const status = await omniFetch(url, 'GET', '/api/v2/login/status')
    if (status.status === 404) throw refused(`${host} does not offer sign-in from devices. Ask its owner to turn it on, or connect with a key.`)
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
    return { pairing: publicPairing() }
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
    await saveLink(link)
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

  async function cancel() {
    // Nothing to tell Omni: an unapproved device code just expires.
    const had = pairing !== null
    pairing = null
    return { status: had ? 'cancelled' : 'idle' }
  }

  async function disconnect() {
    await rm(path, { force: true })
    rt.syncOmniEvents?.()
    return { status: 'disconnected' }
  }

  rt.omniLinkEndpoint = async (endpoint, body) => {
    if (endpoint === 'omni-pair-start') return start(body)
    if (endpoint === 'omni-pair-poll') return poll()
    if (endpoint === 'omni-pair-cancel') return cancel()
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
}
