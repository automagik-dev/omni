import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { install as installOmni, KEY } from '../src/host/omni.js'
import { cleanOmniUrl, install, LINK_FILE, marketUrlAllowed } from '../src/host/omni-link.js'
import { install as installThreadKeys, KEYS_FILE, NOT_LINKED } from '../src/host/thread-keys.js'
import { install as installHooks } from '@automagik/bots-dsh/src/host/extend.js'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

test('an Omni address is cleaned to its API base', () => {
  assert.equal(cleanOmniUrl('omni.example.com'), 'https://omni.example.com')
  assert.equal(cleanOmniUrl(' https://omni.example.com/api/v2/ '), 'https://omni.example.com')
  assert.equal(cleanOmniUrl('http://10.0.0.5:8882'), 'http://10.0.0.5:8882')
  assert.equal(cleanOmniUrl('https://omni.example.com/base/'), 'https://omni.example.com/base')
  for (const bad of ['', 'ftp://omni.example.com', 'https://user:pass@omni.example.com', 'https://omni.example.com/?x=1', 'not a url at all']) {
    assert.equal(cleanOmniUrl(bad), null, bad)
  }
})

// A fake Omni with human login: status, Better Auth's device flow, and the device-key
// exchange. The device code is pending until `approve()` (or `deny()`); its token works once.
// A sign-in started after one finished is a new round, with a new token and device key. It
// also serves Group 4's chat-key routes and /auth/validate (`children`: id → { key, parent,
// revoked }); a revoked key gets 401, as the auth middleware gives.
function fakeOmni({ statusCode = 200, claimed = true, whatsapp = true, keyStatus = 200 } = {}) {
  const asked = []
  let state = 'pending'
  let keyed = false
  let round = 1
  const token = () => (round === 1 ? 'device-token' : `device-token-${round}`)
  const deviceKey = () => (round === 1 ? 'omni_sk_device' : `omni_sk_device${round}`)
  const children = new Map()
  const childByKey = key => [...children.values()].find(child => child.key === key)
  globalThis.fetch = async (address, init = {}) => {
    const url = new URL(String(address))
    asked.push({ method: init.method ?? 'GET', path: url.pathname, bearer: init.headers?.authorization ?? null, key: init.headers?.['x-api-key'] ?? null, client: init.headers?.['x-omni-client'] ?? null, body: init.body ? JSON.parse(init.body) : undefined })
    const json = (status, data) => new Response(JSON.stringify(data), { status })
    switch (url.pathname) {
      case '/api/v2/health':
        return json(200, { status: 'healthy', version: '2.261006.2' })
      case '/api/v2/login/status':
        return statusCode === 200 ? json(200, { data: { claimed, whatsapp, deviceUrl: 'https://omni.example.com/api/login/device', whatsappUrl: 'https://omni.example.com/api/login/whatsapp' } }) : json(statusCode, { error: { code: 'X' } })
      case '/api/auth/device/code':
        if (state === 'used') { round += 1; state = 'pending'; keyed = false }
        return json(200, { device_code: 'dev-1', user_code: 'K7Q4X9ZP', verification_uri: 'https://omni.example.com/login/device', verification_uri_complete: 'https://omni.example.com/login/device?user_code=K7Q4X9ZP', expires_in: 600, interval: 2 })
      case '/api/auth/device/token':
        if (state === 'approved') { state = 'used'; return json(200, { access_token: token(), token_type: 'Bearer' }) }
        return json(400, { error: state === 'pending' ? 'authorization_pending' : state === 'denied' ? 'access_denied' : 'expired_token' })
      case '/api/v2/login/device-key':
        if (keyStatus !== 200) return json(keyStatus, { error: { code: 'X' } })
        if (init.headers?.authorization !== `Bearer ${token()}` || keyed) return json(401, { error: { code: 'UNAUTHORIZED' } })
        keyed = true
        return json(200, { data: { apiKey: deviceKey(), keyId: `k${round}`, scopes: ['instances:read'], keyExpiresAt: null, apiUrl: 'https://omni.example.com' } })
      case '/api/v2/keys/children': {
        const id = `00000000-0000-4000-8000-${String(children.size + 1).padStart(12, '0')}`
        const child = { id, key: `omni_sk_child${children.size + 1}`, parent: init.headers?.['x-api-key'], revoked: false }
        children.set(id, child)
        return json(201, { data: { id, plainTextKey: child.key, parentKeyId: child.parent, chatId: JSON.parse(init.body).chatId, chatExternalId: '5511988887777@s.whatsapp.net', instanceId: INSTANCE, scopes: ['chats:read'], expiresAt: null, replacedKeyId: null } })
      }
      case '/api/v2/keys/children/self/revoke': {
        const child = childByKey(init.headers?.['x-api-key'])
        if (!child || child.revoked) return json(401, { error: { code: 'UNAUTHORIZED' } })
        child.revoked = true
        return json(200, { data: { id: child.id, status: 'revoked' } })
      }
      case '/api/v2/auth/validate': {
        const child = childByKey(init.headers?.['x-api-key'])
        if (child) return child.revoked ? json(401, { error: { code: 'UNAUTHORIZED' } }) : json(403, { error: { code: 'FORBIDDEN' } })
        return json(200, { data: { valid: true, scopes: ['instances:read'] } })
      }
      case `/api/v2/instances/${INSTANCE}`:
        return json(200, { data: { id: INSTANCE, ownerIdentifier: '5511999990000:3@s.whatsapp.net' } })
      case '/api/v2/instances':
      case '/api/v2/chats':
        return json(200, { items: [] })
      default: {
        const revoke = url.pathname.match(/^\/api\/v2\/keys\/children\/([^/]+)\/revoke$/)
        const child = revoke && children.get(revoke[1])
        if (!child) return json(404, {})
        if (child.parent !== init.headers?.['x-api-key']) return json(403, { error: { code: 'FORBIDDEN', message: 'not one of your chat keys' } })
        const status = child.revoked ? 'already_revoked' : 'revoked'
        child.revoked = true
        return json(200, { data: { id: child.id, status } })
      }
    }
  }
  return { asked, children, approve: () => { state = 'approved' }, deny: () => { state = 'denied' } }
}

const INSTANCE = '0b5f1c1e-6a51-4d5e-9a41-0c0d9b6f1a01'
const CHAT = '1c6f2d2e-7b62-4e6f-8b52-1d1e0c7f2b02'

// The link, Omni's requests and the threads' keys (thread-keys.js), as index.js installs them.
function runtime({ omniUrl, profileKey, settings } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'omni-link-'))
  const synced = []
  const disposers = []
  const rt = {
    home,
    config: omniUrl ? { omni: { url: omniUrl } } : {},
    ctx: { effect: (run) => { const dispose = run(); if (typeof dispose === 'function') disposers.push(dispose) }, settings, get: name => (name === 'credentials' ? { resolve: async ref => (ref === KEY && profileKey ? { value: profileKey } : undefined) } : undefined) },
    teamResume: { ready: true, reason: null },
    syncOmniEvents: () => synced.push(Date.now()),
  }
  installHooks(rt)
  install(rt)
  installOmni(rt)
  installThreadKeys(rt)
  const stop = async () => {
    await Promise.all(disposers.map(dispose => dispose()))
    rmSync(home, { recursive: true, force: true })
  }
  return { rt, home, synced, stop }
}

test('signing in shows the WhatsApp QR and the approval link, then saves a device key of Omni\'s own', async (t) => {
  const omni = fakeOmni()
  const { rt, home, synced, stop } = runtime()
  t.after(stop)

  const started = await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com', deviceName: 'Laptop' })
  assert.deepEqual(started.pairing, {
    origin: 'omni.example.com',
    code: 'K7Q4-X9ZP',
    sendTo: null,
    waLink: 'https://omni.example.com/api/login/whatsapp?user_code=K7Q4X9ZP',
    approveUrl: 'https://omni.example.com/login/device?user_code=K7Q4X9ZP',
    expiresAt: started.pairing.expiresAt,
    pollIntervalMs: 2000,
  })
  assert.deepEqual(omni.asked.find(call => call.path === '/api/auth/device/code').body, { client_id: 'omni-dsh' })
  assert.ok(!JSON.stringify(started).includes('dev-1'))

  assert.equal((await rt.omniLinkEndpoint('omni-pair-poll')).status, 'pending')
  omni.approve()
  assert.deepEqual(await rt.omniLinkEndpoint('omni-pair-poll'), { status: 'paired', origin: 'omni.example.com' })
  const exchange = omni.asked.find(call => call.path === '/api/v2/login/device-key')
  assert.equal(exchange.bearer, 'Bearer device-token')
  assert.deepEqual(exchange.body, { deviceName: 'Laptop' })
  assert.equal(synced.length, 1)

  const file = join(home, LINK_FILE)
  assert.equal(statSync(file).mode & 0o777, 0o600)
  const link = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(link.url, 'https://omni.example.com')
  assert.equal(link.key, 'omni_sk_device')
  assert.equal(link.keyExpiresAt, null)

  // The Channels view now reads that Omni with that key.
  assert.equal((await rt.omniEndpoint('omni-overview', {})).configured, true)
  assert.equal(omni.asked.at(-1).key, 'omni_sk_device')
  assert.equal((await rt.omniLinkEndpoint('omni-pair-poll')).status, 'idle')
})

test('a saved link wins whole over the profile\'s URL and key, and disconnecting falls back to them', async (t) => {
  const omni = fakeOmni()
  const { rt, stop } = runtime({ omniUrl: 'https://profile.example.com', profileKey: 'omni_sk_profile' })
  t.after(stop)
  assert.equal(rt.omniNamed(), true)
  await rt.omniLinkEndpoint('omni-pair-start', { url: 'https://omni.example.com' })
  omni.approve()
  await rt.omniLinkEndpoint('omni-pair-poll')
  await rt.omniEndpoint('omni-overview', {})
  assert.equal(omni.asked.at(-1).key, 'omni_sk_device')

  assert.deepEqual(await rt.omniLinkEndpoint('omni-disconnect'), { status: 'disconnected' })
  assert.equal(rt.omniLink(), null)
  await rt.omniEndpoint('omni-overview', {})
  assert.equal(omni.asked.at(-1).key, 'omni_sk_profile')
})

// The onboarding step Connect Omni completes on `configured`.
test('omni-link says whether this host reaches an Omni, by a link or by the profile\'s URL and key', async (t) => {
  const omni = fakeOmni()
  const none = runtime()
  t.after(none.stop)
  assert.deepEqual(await none.rt.omniLinkEndpoint('omni-link'), { linked: false, configured: false, origin: null, pairedAt: null, pairing: null })
  const urlOnly = runtime({ omniUrl: 'https://profile.example.com' })
  t.after(urlOnly.stop)
  assert.equal((await urlOnly.rt.omniLinkEndpoint('omni-link')).configured, false)

  const profile = runtime({ omniUrl: 'https://profile.example.com', profileKey: 'omni_sk_profile' })
  t.after(profile.stop)
  assert.deepEqual(await profile.rt.omniLinkEndpoint('omni-link'), { linked: false, configured: true, origin: null, pairedAt: null, pairing: null })

  await none.rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' })
  omni.approve()
  await none.rt.omniLinkEndpoint('omni-pair-poll')
  const linked = await none.rt.omniLinkEndpoint('omni-link')
  assert.equal(linked.linked, true)
  assert.equal(linked.configured, true)
  assert.equal(linked.origin, 'omni.example.com')
})

test('an Omni without login, an unclaimed one, and a bad address say so', async (t) => {
  const { rt, stop } = runtime()
  t.after(stop)
  await assert.rejects(rt.omniLinkEndpoint('omni-pair-start', { url: 'ftp://nope' }), /Give the address/)
  fakeOmni({ statusCode: 404 })
  const off = await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' })
  assert.deepEqual({ status: off.status, reason: off.reason, url: off.url, origin: off.origin }, { status: 'unavailable', reason: 'off', url: 'https://omni.example.com', origin: 'omni.example.com' })
  assert.equal(off.message, 'Pairing is off on omni.example.com. Its owner can turn it on, or you can paste an API key.')
  fakeOmni({ claimed: false })
  await assert.rejects(rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' }), /has no owner yet/)
})

test('an Omni from before device sign-in (its login status is behind a key) answers with its version, not an error', async (t) => {
  const { rt, stop } = runtime()
  t.after(stop)
  fakeOmni({ statusCode: 401 })
  const old = await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' })
  assert.deepEqual({ status: old.status, reason: old.reason, version: old.version, url: old.url }, { status: 'unavailable', reason: 'too-old', version: '2.261006.2', url: 'https://omni.example.com' })
  assert.equal(old.message, 'Omni 2.261006.2 at omni.example.com is too old to pair from here. Update it, or paste an API key or the link it sent you.')
  assert.equal(old.pairing, undefined)
})

test('without the owner\'s WhatsApp connected, the card offers only the approval page', async (t) => {
  fakeOmni({ whatsapp: false })
  const { rt, stop } = runtime()
  t.after(stop)
  const { pairing } = await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' })
  assert.equal(pairing.waLink, null)
  assert.equal(pairing.approveUrl, 'https://omni.example.com/login/device?user_code=K7Q4X9ZP')
})

test('a denied sign-in says so; cancelling just forgets it', async (t) => {
  const omni = fakeOmni()
  const { rt, stop } = runtime()
  t.after(stop)
  await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' })
  omni.deny()
  assert.equal((await rt.omniLinkEndpoint('omni-pair-poll')).status, 'denied')
  await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' })
  assert.deepEqual(await rt.omniLinkEndpoint('omni-pair-cancel'), { status: 'cancelled' })
  assert.equal((await rt.omniLinkEndpoint('omni-pair-poll')).status, 'idle')
})

test('two windows polling at once make one request, and both see the sign-in finish', async (t) => {
  const omni = fakeOmni()
  const { rt, stop } = runtime()
  t.after(stop)
  await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' })
  omni.approve()
  const before = omni.asked.length
  const [a, b] = await Promise.all([rt.omniLinkEndpoint('omni-pair-poll'), rt.omniLinkEndpoint('omni-pair-poll')])
  assert.equal(omni.asked.filter((call, index) => index >= before && call.path === '/api/auth/device/token').length, 1)
  assert.deepEqual(a, { status: 'paired', origin: 'omni.example.com' })
  assert.deepEqual(b, a)
  assert.equal(rt.omniLink().key, 'omni_sk_device')
})

test('an approval that lands after the card was cancelled still becomes the device key', async (t) => {
  const omni = fakeOmni()
  const { rt, stop } = runtime()
  t.after(stop)
  await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' })
  omni.approve()
  const polling = rt.omniLinkEndpoint('omni-pair-poll')
  await rt.omniLinkEndpoint('omni-pair-cancel')
  assert.equal((await polling).status, 'paired')
  assert.equal(rt.omniLink().key, 'omni_sk_device')
})

test('a refused device token ends the sign-in instead of polling forever', async (t) => {
  const omni = fakeOmni({ keyStatus: 401 })
  const { rt, stop } = runtime()
  t.after(stop)
  await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' })
  omni.approve()
  assert.equal((await rt.omniLinkEndpoint('omni-pair-poll')).status, 'expired')
  assert.equal((await rt.omniLinkEndpoint('omni-pair-poll')).status, 'idle')
  assert.equal(rt.omniLink(), null)
})

test('a sign-in nobody approved stops at its expiry without asking Omni again', async (t) => {
  const omni = fakeOmni()
  const { rt, stop } = runtime()
  t.after(stop)
  const realNow = Date.now
  await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' })
  Date.now = () => realNow() + 11 * 60_000
  t.after(() => { Date.now = realNow })
  const before = omni.asked.length
  assert.equal((await rt.omniLinkEndpoint('omni-pair-poll')).status, 'expired')
  assert.equal(omni.asked.length, before)
})

test('a new link adds that Omni\'s market to DSH\'s plugin market, once, when the market is on', async (t) => {
  const omni = fakeOmni()
  const updates = []
  const rows = [{ ns: 'plugin-market', value: { indexes: ['https://example.org/index.json'] }, revision: 3 }]
  const settings = { describe: () => rows, update: async (ns, patch, revision) => updates.push({ ns, patch, revision }) }
  const { rt, stop } = runtime({ settings })
  t.after(stop)
  await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com', deviceName: 'Laptop' })
  omni.approve()
  assert.equal((await rt.omniLinkEndpoint('omni-pair-poll')).status, 'paired')
  assert.deepEqual(updates, [{
    ns: 'plugin-market',
    patch: { indexes: ['https://example.org/index.json', 'https://omni.example.com/api/market/index.json'] },
    revision: 3,
  }])
  // Already listed, or no market at all: nothing to change.
  rows[0].value.indexes.push('https://omni.example.com/api/market/index.json')
  await rt.addOmniMarket('https://omni.example.com')
  rows.length = 0
  await rt.addOmniMarket('https://omni.example.com')
  assert.equal(updates.length, 1)
})

test('a link made before the market was offered gets the offer once, when the plugin starts', async (t) => {
  const updates = []
  const rows = [{ ns: 'plugin-market', value: { indexes: [] }, revision: 1 }]
  const settings = { describe: () => rows, update: async (ns, patch) => updates.push(patch) }
  const { rt, home, stop } = runtime({ settings })
  t.after(stop)
  writeFileSync(join(home, LINK_FILE), JSON.stringify({ url: 'https://omni.example.com', key: 'omni_sk_old' }))
  await rt.offerOmniMarket()
  assert.deepEqual(updates, [{ indexes: ['https://omni.example.com/api/market/index.json'] }])
  const link = JSON.parse(readFileSync(join(home, LINK_FILE), 'utf8'))
  assert.equal(link.marketOffered, true)
  assert.equal(link.key, 'omni_sk_old')
  // Offered once: an index the user removes stays removed.
  rows[0].value.indexes = []
  await rt.offerOmniMarket()
  assert.equal(updates.length, 1)
})

test('the market is offered only over https or this machine\'s loopback, and leaves with the link', async (t) => {
  assert.equal(marketUrlAllowed('https://omni.example.com'), true)
  assert.equal(marketUrlAllowed('http://127.0.0.1:8882'), true)
  assert.equal(marketUrlAllowed('http://omni.example.com'), false)
  const updates = []
  const rows = [{ ns: 'plugin-market', value: { indexes: [] }, revision: 1 }]
  const settings = { describe: () => rows, update: async (ns, patch) => { updates.push(patch); rows[0].value = { ...rows[0].value, ...patch } } }
  const { rt, home, stop } = runtime({ settings })
  t.after(stop)
  assert.equal(await rt.addOmniMarket('http://omni.example.com'), false)
  writeFileSync(join(home, LINK_FILE), JSON.stringify({ url: 'https://omni.example.com', key: 'omni_sk_old' }))
  await rt.offerOmniMarket()
  assert.deepEqual(rows[0].value.indexes, ['https://omni.example.com/api/market/index.json'])
  await rt.omniLinkEndpoint('omni-disconnect')
  assert.deepEqual(rows[0].value.indexes, [])
})

test('a sign-in the desktop app started from an omni:// link finishes by itself once approved', async (t) => {
  const omni = fakeOmni()
  const { rt, home, stop } = runtime()
  t.after(stop)
  const started = await rt.omniLinkEndpoint('omni-pair-start', { url: 'https://omni.example.com', auto: true })
  assert.equal(started.pairing.approveUrl, 'https://omni.example.com/login/device?user_code=K7Q4X9ZP')
  omni.approve()
  // Nobody polls: the host does, on the pairing's own interval (2 s).
  for (let waited = 0; waited < 8000 && !existsSync(join(home, LINK_FILE)); waited += 100) await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(JSON.parse(readFileSync(join(home, LINK_FILE), 'utf8')).key, 'omni_sk_device')
  assert.equal((await rt.omniLinkEndpoint('omni-pair-poll')).status, 'idle')
})

// Wish omni-chat-threads, criterion :188: every new link and Disconnect hand the threads' keys
// over at the two choke points, saveOmniLink and disconnect.
test('signing in again to the same Omni gives each thread a fresh child of the new key; Disconnect leaves none live', async (t) => {
  const omni = fakeOmni()
  const { rt, home, stop } = runtime()
  t.after(stop)
  const signIn = async () => {
    await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' })
    omni.approve()
    assert.equal((await rt.omniLinkEndpoint('omni-pair-poll')).status, 'paired')
  }
  await signIn()
  assert.deepEqual(await rt.threadKeys.mint('t1', CHAT), { ok: true, self: '5511999990000' })
  const [first] = omni.children.values()
  assert.equal(first.parent, 'omni_sk_device')

  await signIn()
  assert.equal(rt.omniLink().key, 'omni_sk_device2')
  assert.equal(first.revoked, true)
  // Cut with the old key, which was still the link then.
  assert.deepEqual(omni.asked.find(call => call.path === `/api/v2/keys/children/${first.id}/revoke`)?.key, 'omni_sk_device')
  const second = [...omni.children.values()].find(child => !child.revoked)
  assert.equal(second.parent, 'omni_sk_device2')
  assert.equal(rt.threadKeys.keyFor('t1'), second.key)

  await rt.omniLinkEndpoint('omni-disconnect')
  assert.equal(second.revoked, true)
  assert.deepEqual(omni.asked.find(call => call.path === `/api/v2/keys/children/${second.id}/revoke`)?.key, 'omni_sk_device2')
  assert.equal(rt.threadKeys.keyFor('t1'), null)
  assert.equal(rt.threadKeys.reasonOf('t1'), NOT_LINKED)
  assert.ok([...omni.children.values()].every(child => child.revoked))
  const kept = readFileSync(join(home, KEYS_FILE), 'utf8')
  for (const key of ['omni_sk_device', 'omni_sk_device2', first.key, second.key]) assert.ok(!kept.includes(key), key)
})
