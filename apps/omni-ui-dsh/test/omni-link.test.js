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

// A fake Omni with pairing: start hands out one pairing; polls answer pending until
// `approve()`, then the key once, then consumed.
function fakeOmni({ startStatus = 200 } = {}) {
  const asked = []
  let approved = false
  let consumed = false
  globalThis.fetch = async (address, init = {}) => {
    const url = new URL(String(address))
    asked.push({ method: init.method, path: url.pathname, token: init.headers?.['x-pairing-token'] ?? null, key: init.headers?.['x-api-key'] ?? null, body: init.body ? JSON.parse(init.body) : undefined })
    const json = (status, data) => new Response(JSON.stringify(data), { status })
    if (url.pathname === '/api/v2/pair/start') {
      if (startStatus !== 200) return json(startStatus, { error: { code: 'X' } })
      return json(200, { data: { pairingId: 'p1', code: '7KQ4-9XZP', sendTo: '+5511999990000', waLink: 'https://wa.me/5511999990000?text=Omni%207KQ4-9XZP', expiresAt: '2030-01-01T00:00:00.000Z', pollToken: 'omni_pt_secret', pollIntervalMs: 2000 } })
    }
    if (url.pathname === '/api/v2/pair/p1') {
      if (init.headers?.['x-pairing-token'] !== 'omni_pt_secret') return json(404, { error: { code: 'NOT_FOUND' } })
      if (init.method === 'DELETE') return json(200, { data: { cancelled: true } })
      if (!approved) return json(200, { data: { status: 'pending' } })
      if (consumed) return json(200, { data: { status: 'consumed' } })
      consumed = true
      return json(200, { data: { status: 'approved', apiKey: 'omni_sk_paired', keyId: 'k1', scopes: ['instances:read'], keyExpiresAt: '2030-02-01T00:00:00.000Z', apiUrl: null } })
    }
    if (url.pathname === '/api/v2/instances') return json(200, { items: [] })
    if (url.pathname === '/api/v2/chats') return json(200, { items: [] })
    return json(404, {})
  }
  return { asked, approve: () => { approved = true } }
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

test('pairing by code saves a link of Omni\'s own, and the poll token never reaches the browser', async (t) => {
  const omni = fakeOmni()
  const { rt, home, synced, stop } = runtime()
  t.after(stop)

  const started = await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com', deviceName: 'Laptop' })
  assert.deepEqual(started.pairing, { origin: 'omni.example.com', code: '7KQ4-9XZP', sendTo: '+5511999990000', waLink: 'https://wa.me/5511999990000?text=Omni%207KQ4-9XZP', expiresAt: '2030-01-01T00:00:00.000Z', pollIntervalMs: 2000 })
  assert.deepEqual(omni.asked[0].body, { deviceName: 'Laptop' })
  assert.ok(!JSON.stringify(started).includes('omni_pt_secret'))

  assert.equal((await rt.omniLinkEndpoint('omni-pair-poll')).status, 'pending')
  omni.approve()
  assert.deepEqual(await rt.omniLinkEndpoint('omni-pair-poll'), { status: 'paired', origin: 'omni.example.com' })
  assert.equal(synced.length, 1)

  const file = join(home, LINK_FILE)
  assert.equal(statSync(file).mode & 0o777, 0o600)
  const link = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(link.url, 'https://omni.example.com')
  assert.equal(link.key, 'omni_sk_paired')
  assert.deepEqual(link.scopes, ['instances:read'])

  // The Channels view now reads that Omni with that key.
  const view = await rt.omniEndpoint('omni-overview', {})
  assert.equal(view.configured, true)
  assert.equal(omni.asked.at(-1).key, 'omni_sk_paired')
  assert.equal((await rt.omniLinkEndpoint('omni-link')).linked, true)

  // Nothing is pending any more.
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
  assert.match(omni.asked.at(-1).path, /^\/api\/v2\//)
  assert.equal(omni.asked.at(-1).key, 'omni_sk_paired')

  assert.deepEqual(await rt.omniLinkEndpoint('omni-disconnect'), { status: 'disconnected' })
  assert.equal(rt.omniLink(), null)
  await rt.omniEndpoint('omni-overview', {})
  assert.equal(omni.asked.at(-1).key, 'omni_sk_profile')
})

test('a server without pairing, a busy one, and a bad address say so', async (t) => {
  const { rt, stop } = runtime()
  t.after(stop)
  await assert.rejects(rt.omniLinkEndpoint('omni-pair-start', { url: 'ftp://nope' }), /Give the address/)
  fakeOmni({ startStatus: 404 })
  await assert.rejects(rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' }), /does not offer pairing/)
  fakeOmni({ startStatus: 429 })
  await assert.rejects(rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' }), /Too many pairing attempts/)
  fakeOmni({ startStatus: 503 })
  await assert.rejects(rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' }), /cannot take pairing codes/)
})

test('cancelling tells Omni with the poll token and forgets the pairing', async (t) => {
  const omni = fakeOmni()
  const { rt, stop } = runtime()
  t.after(stop)
  await rt.omniLinkEndpoint('omni-pair-start', { url: 'omni.example.com' })
  assert.deepEqual(await rt.omniLinkEndpoint('omni-pair-cancel'), { status: 'cancelled' })
  assert.deepEqual(omni.asked.at(-1), { method: 'DELETE', path: '/api/v2/pair/p1', token: 'omni_pt_secret', key: null, body: undefined })
  assert.equal((await rt.omniLinkEndpoint('omni-pair-poll')).status, 'idle')
})
