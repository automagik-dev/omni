import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { install as installOmni, KEY } from '../src/host/omni.js'
import { cleanOmniUrl, install, LINK_FILE } from '../src/host/omni-link.js'

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
function fakeOmni({ statusCode = 200, claimed = true, whatsapp = '+5511999990000' } = {}) {
  const asked = []
  let state = 'pending'
  let keyed = false
  globalThis.fetch = async (address, init = {}) => {
    const url = new URL(String(address))
    asked.push({ method: init.method ?? 'GET', path: url.pathname, bearer: init.headers?.authorization ?? null, key: init.headers?.['x-api-key'] ?? null, client: init.headers?.['x-omni-client'] ?? null, body: init.body ? JSON.parse(init.body) : undefined })
    const json = (status, data) => new Response(JSON.stringify(data), { status })
    switch (url.pathname) {
      case '/api/v2/login/status':
        return statusCode === 200 ? json(200, { data: { claimed, whatsapp, deviceUrl: 'https://omni.example.com/login/device' } }) : json(statusCode, { error: { code: 'X' } })
      case '/api/auth/device/code':
        return json(200, { device_code: 'dev-1', user_code: 'K7Q4X9ZP', verification_uri: 'https://omni.example.com/login/device', verification_uri_complete: 'https://omni.example.com/login/device?user_code=K7Q4X9ZP', expires_in: 600, interval: 2 })
      case '/api/auth/device/token':
        if (state === 'approved') { state = 'used'; return json(200, { access_token: 'device-token', token_type: 'Bearer' }) }
        return json(400, { error: state === 'pending' ? 'authorization_pending' : state === 'denied' ? 'access_denied' : 'expired_token' })
      case '/api/v2/login/device-key':
        if (init.headers?.authorization !== 'Bearer device-token' || keyed) return json(401, { error: { code: 'UNAUTHORIZED' } })
        keyed = true
        return json(200, { data: { apiKey: 'omni_sk_device', keyId: 'k1', scopes: ['instances:read'], keyExpiresAt: null, apiUrl: 'https://omni.example.com' } })
      case '/api/v2/instances':
      case '/api/v2/chats':
        return json(200, { items: [] })
      default:
        return json(404, {})
    }
  }
  return { asked, approve: () => { state = 'approved' }, deny: () => { state = 'denied' } }
}

function runtime({ omniUrl, profileKey } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'omni-link-'))
  const synced = []
  const rt = {
    home,
    config: omniUrl ? { omni: { url: omniUrl } } : {},
    ctx: { get: name => (name === 'credentials' ? { resolve: async ref => (ref === KEY && profileKey ? { value: profileKey } : undefined) } : undefined) },
    syncOmniEvents: () => synced.push(Date.now()),
  }
  install(rt)
  installOmni(rt)
  return { rt, home, synced, stop: () => rmSync(home, { recursive: true, force: true }) }
}

test('signing in shows the WhatsApp QR and the approval link, then saves a device key of Omni\'s own', async (t) => {
  const omni = fakeOmni()
  const { rt, home, synced, stop } = runtime()
  t.after(stop)

  const started = await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com', deviceName: 'Laptop' })
  assert.deepEqual(started.pairing, {
    origin: 'omni.example.com',
    code: 'K7Q4-X9ZP',
    sendTo: '+5511999990000',
    waLink: 'https://wa.me/5511999990000?text=Omni%20K7Q4-X9ZP',
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

test('an Omni without login, an unclaimed one, and a bad address say so', async (t) => {
  const { rt, stop } = runtime()
  t.after(stop)
  await assert.rejects(rt.omniLinkEndpoint('omni-pair-start', { url: 'ftp://nope' }), /Give the address/)
  fakeOmni({ statusCode: 404 })
  await assert.rejects(rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' }), /does not offer sign-in/)
  fakeOmni({ claimed: false })
  await assert.rejects(rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' }), /has no owner yet/)
})

test('without the owner\'s WhatsApp connected, the card offers only the approval page', async (t) => {
  fakeOmni({ whatsapp: null })
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
