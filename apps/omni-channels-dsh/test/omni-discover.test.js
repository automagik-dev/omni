import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { candidates, discover, install, probe, sameOmni } from '../src/host/omni-discover.js'
import { install as installLink, LINK_FILE } from '../src/host/omni-link.js'
import { parseConnectLink } from '../src/client/connect-link.js'
import { OMNI_MINIMUM } from '../src/host/version.js'
import { install as installHooks } from '@automagik/bots-dsh/src/host/extend.js'

const realFetch = globalThis.fetch
const realEnv = { HOME: process.env.HOME, OMNI_CONFIG_DIR: process.env.OMNI_CONFIG_DIR, OMNI_HOME: process.env.OMNI_HOME }
afterEach(() => {
  globalThis.fetch = realFetch
  for (const [name, value] of Object.entries(realEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

const LOCAL_KEY = 'omni_sk_local_secret'
const REMOTE_KEY = 'omni_sk_remote_secret'
const SANDBOX_KEY = 'omni_sk_sandbox_secret'

function homeWith({ cli, sandbox, raw } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'omni-discover-'))
  if (cli !== undefined || raw !== undefined) {
    mkdirSync(join(home, '.omni'), { recursive: true })
    writeFileSync(join(home, '.omni', 'config.json'), raw ?? JSON.stringify(cli))
  }
  if (sandbox !== undefined) {
    mkdirSync(join(home, '.omni', 'sandbox', 'config'), { recursive: true })
    writeFileSync(join(home, '.omni', 'sandbox', 'config', 'config.json'), JSON.stringify(sandbox))
  }
  return { home, stop: () => rmSync(home, { recursive: true, force: true }) }
}

// Omnis on loopback ports: `ports[port]` is how that one answers ('pairable', 'unclaimed',
// 'old' for one from before device sign-in, 'off' for sign-in turned off); any other port
// refuses the connection, like nothing listening.
function loopback(ports, { asked = [] } = {}) {
  return async (address, init = {}) => {
    const url = new URL(String(address))
    asked.push({ method: init.method ?? 'GET', port: url.port, path: url.pathname, key: init.headers?.['x-api-key'] ?? null })
    const kind = ports[url.port]
    if (kind === undefined) throw new TypeError('fetch failed')
    const json = (status, data) => new Response(JSON.stringify(data), { status })
    if (url.pathname === '/api/v2/health') return json(200, { status: 'healthy', version: kind === 'old' ? '2.261006.2' : '2.261023.8' })
    if (url.pathname === '/api/v2/login/status') {
      if (kind === 'old') return json(401, { error: { code: 'UNAUTHORIZED' } })
      if (kind === 'off') return json(404, { error: { code: 'NOT_FOUND' } })
      return json(200, { data: { claimed: kind !== 'unclaimed', whatsapp: false } })
    }
    return json(404, {})
  }
}

test('nothing found when no config names an Omni and nothing answers on this computer', async (t) => {
  const { home, stop } = homeWith()
  t.after(stop)
  assert.deepEqual(await discover({ env: {}, home, fetchImpl: loopback({}) }), [])
})

test('the CLI\'s Omni, the servers it knows and a sandboxed Omni are found once each, keys left out', async (t) => {
  const { home, stop } = homeWith({
    cli: {
      apiUrl: 'http://localhost:8882',
      apiKey: LOCAL_KEY,
      servers: {
        active: 'default',
        list: {
          default: { url: 'http://127.0.0.1:8882', apiKey: LOCAL_KEY },
          prod: { url: 'https://omni.example.com', apiKey: REMOTE_KEY },
          lab: { url: 'https://lab.example.com/api/v2' },
        },
      },
    },
    sandbox: { apiUrl: 'http://127.0.0.1:47123', apiKey: SANDBOX_KEY },
  })
  t.after(stop)
  const asked = []
  const omnis = await discover({ env: {}, home, fetchImpl: loopback({ 8882: 'pairable', 47123: 'pairable' }, { asked }) })

  const text = JSON.stringify(omnis)
  for (const key of [LOCAL_KEY, REMOTE_KEY, SANDBOX_KEY]) assert.equal(text.includes(key), false, 'a key reached the page')
  assert.deepEqual(omnis.map(omni => [omni.source, omni.url, omni.local, omni.hasKey]), [
    ['sandbox', 'http://127.0.0.1:47123', true, true],
    ['cli', 'http://localhost:8882', true, true],
    ['cli-server', 'https://omni.example.com', false, true],
    ['cli-server', 'https://lab.example.com', false, false],
  ])
  const local = omnis.find(omni => omni.source === 'cli')
  assert.deepEqual({ version: local.version, reachable: local.reachable, canPair: local.canPair, pairing: local.pairing }, { version: '2.261023.8', reachable: true, canPair: true, pairing: 'available' })
  // Omnis elsewhere are not asked anything until the person picks one.
  const remote = omnis.find(omni => omni.url === 'https://omni.example.com')
  assert.deepEqual({ name: remote.name, reachable: remote.reachable, canPair: remote.canPair }, { name: 'prod', reachable: null, canPair: null })
  assert.ok(asked.every(entry => entry.key === null), 'a probe sent a key')
  assert.ok(asked.every(entry => ['8882', '47123'].includes(entry.port)))
})

test('a config that does not parse is passed over, and an Omni that answers is still found', async (t) => {
  for (const raw of ['{not json', JSON.stringify({ apiUrl: 42 }), JSON.stringify({ servers: { list: [] } })]) {
    const { home, stop } = homeWith({ raw })
    t.after(stop)
    const omnis = await discover({ env: {}, home, fetchImpl: loopback({ 8882: 'pairable' }) })
    assert.deepEqual(omnis.map(omni => [omni.source, omni.hasKey]), [['running', false]], raw)
  }
})

// The floor is the Omni release with the chat keys this plugin's threads mint (engines.omni):
// the one just before it shows as outdated in Connect, the floor itself does not.
test('an Omni older than the plugin\'s minimum shows as outdated, and one at the minimum does not', async (t) => {
  assert.equal(OMNI_MINIMUM, '2.261027.3')
  const { home, stop } = homeWith({ cli: { apiUrl: 'http://localhost:8882' } })
  t.after(stop)
  for (const [version, outdated] of [['2.261027.2', true], [OMNI_MINIMUM, false]]) {
    const answers = loopback({ 8882: 'pairable' })
    const fetchImpl = async (address, init) => {
      if (new URL(String(address)).pathname !== '/api/v2/health') return answers(address, init)
      return new Response(JSON.stringify({ status: 'healthy', version }), { status: 200 })
    }
    const [omni] = await discover({ env: {}, home, fetchImpl })
    assert.deepEqual([omni.version, omni.outdated], [version, outdated])
  }
})

test('OMNI_CONFIG_DIR and OMNI_HOME are where the CLI and the desktop app keep their Omnis', async (t) => {
  const { home, stop } = homeWith()
  t.after(stop)
  const dir = join(home, 'custom')
  mkdirSync(join(dir, 'sandbox', 'config'), { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ server: { port: 9001 } }))
  writeFileSync(join(dir, 'sandbox', 'config', 'config.json'), JSON.stringify({ apiUrl: 'http://127.0.0.1:47200', apiKey: SANDBOX_KEY }))
  const found = candidates({ env: { OMNI_CONFIG_DIR: dir, OMNI_HOME: dir }, home })
  assert.deepEqual(found.map(entry => [entry.source, entry.url]), [
    ['cli', 'http://localhost:9001'],
    ['running', 'http://127.0.0.1:9001'],
    ['sandbox', 'http://127.0.0.1:47200'],
    ['running', 'http://127.0.0.1:8882'],
  ])
  assert.equal(sameOmni('http://localhost:9001'), sameOmni('http://127.0.0.1:9001/'))
})

test('a probe tells an Omni a device can sign in to from one that is too old, off, unclaimed or not there', async () => {
  const fetchImpl = loopback({ 1001: 'pairable', 1002: 'old', 1003: 'off', 1004: 'unclaimed' })
  assert.deepEqual(await probe('http://127.0.0.1:1001', fetchImpl), { reachable: true, version: '2.261023.8', canPair: true, pairing: 'available' })
  assert.deepEqual(await probe('http://127.0.0.1:1002', fetchImpl), { reachable: true, version: '2.261006.2', canPair: false, pairing: 'too-old' })
  assert.deepEqual(await probe('http://127.0.0.1:1003', fetchImpl), { reachable: true, version: '2.261023.8', canPair: false, pairing: 'off' })
  assert.deepEqual(await probe('http://127.0.0.1:1004', fetchImpl), { reachable: true, version: '2.261023.8', canPair: false, pairing: 'unclaimed' })
  assert.deepEqual(await probe('http://127.0.0.1:1005', fetchImpl), { reachable: false, version: null, canPair: false, pairing: 'unreachable' })
})

// The host with the link and discovery modules, on a home of its own; HOME points at a
// computer whose CLI knows a local Omni with a key and a remote one without.
function host(t, validate, { mint } = {}) {
  const { home: user, stop } = homeWith({ cli: { apiUrl: 'http://localhost:8882', apiKey: LOCAL_KEY, servers: { active: 'default', list: { lab: { url: 'https://lab.example.com' } } } } })
  t.after(stop)
  process.env.HOME = user
  delete process.env.OMNI_CONFIG_DIR
  delete process.env.OMNI_HOME
  const asked = []
  const probes = loopback({ 8882: 'pairable' })
  globalThis.fetch = async (address, init = {}) => {
    const url = new URL(String(address))
    asked.push({ host: url.host, path: url.pathname, key: init.headers?.['x-api-key'] ?? null })
    const json = (status, data) => new Response(JSON.stringify(data), { status })
    if (url.pathname === '/api/v2/auth/validate') return validate(json)
    if (url.pathname === '/api/v2/keys') return mint ? mint(json, init) : json(404, {})
    if (url.pathname === '/api/v2/login/status') return json(200, { data: { claimed: true, whatsapp: false } })
    if (url.pathname === '/api/auth/device/code') return json(200, { device_code: 'dev-1', user_code: 'K7Q4X9ZP', verification_uri_complete: `${url.origin}/login/device?user_code=K7Q4X9ZP`, expires_in: 600, interval: 2 })
    return probes(address, init)
  }
  const rt = { home: mkdtempSync(join(tmpdir(), 'omni-discover-host-')), config: {}, ctx: { effect: run => run() }, syncOmniEvents: () => {} }
  t.after(() => rmSync(rt.home, { recursive: true, force: true }))
  installHooks(rt)
  installLink(rt)
  install(rt)
  return { rt, asked }
}

test('Use it checks the key with that Omni and links it, and the key stays on the host', async (t) => {
  const { rt, asked } = host(t, json => json(200, { data: { valid: true, keyName: 'ui', scopes: ['instances:*', 'chats:*'], credential: { expiresAt: null } } }))
  const { omnis } = await rt.omniDiscoverEndpoint('omni-discover')
  const local = omnis.find(omni => omni.local)
  const reply = await rt.omniDiscoverEndpoint('omni-discover-use', { id: local.id })
  assert.deepEqual(reply, { status: 'paired', origin: 'localhost:8882' })
  assert.ok(asked.some(entry => entry.path === '/api/v2/auth/validate' && entry.key === LOCAL_KEY))
  const link = JSON.parse(readFileSync(join(rt.home, LINK_FILE), 'utf8'))
  assert.deepEqual({ url: link.url, key: link.key, scopes: link.scopes }, { url: 'http://localhost:8882', key: LOCAL_KEY, scopes: ['instances:*', 'chats:*'] })
  // A key already scoped is kept as found: no key is made with it.
  assert.equal(asked.some(entry => entry.path === '/api/v2/keys'), false)
  const shown = await rt.omniLinkEndpoint('omni-link')
  assert.equal(shown.linked, true)
  assert.equal(JSON.stringify(shown).includes(LOCAL_KEY), false)
})

test('a key the Omni refuses, or no key at all, signs this device in there instead', async (t) => {
  const { rt } = host(t, json => json(401, { error: { code: 'UNAUTHORIZED' } }))
  const { omnis } = await rt.omniDiscoverEndpoint('omni-discover')
  const refusedKey = await rt.omniDiscoverEndpoint('omni-discover-use', { id: omnis.find(omni => omni.local).id })
  assert.equal(refusedKey.status, 'pairing')
  assert.equal(refusedKey.pairing.origin, 'localhost:8882')
  assert.equal(refusedKey.pairing.code, 'K7Q4-X9ZP')
  const noKey = await rt.omniDiscoverEndpoint('omni-discover-use', { id: omnis.find(omni => !omni.local).id })
  assert.equal(noKey.pairing.origin, 'lab.example.com')
  await assert.rejects(rt.omniDiscoverEndpoint('omni-discover-use', { id: 'nope' }), { code: 'bot/invalid' })
  await assert.rejects(rt.omniDiscoverEndpoint('omni-discover-use', { id: '0123456789abcdef' }), { code: 'bot/refused' })
})

const PASTED_KEY = 'omni_sk_pasted_by_hand'

test('a pasted API key for an Omni that cannot approve this app links it like Use it, and stays on the host', async (t) => {
  const { rt, asked } = host(t, json => json(200, { data: { valid: true, scopes: ['instances:*', 'messages:*'], credential: { expiresAt: null } } }))
  const { omnis } = await rt.omniDiscoverEndpoint('omni-discover')
  const local = omnis.find(omni => omni.local)
  const reply = await rt.omniDiscoverEndpoint('omni-discover-key', { id: local.id, apiKey: ` ${PASTED_KEY} ` })
  assert.deepEqual(reply, { status: 'paired', origin: 'localhost:8882' })
  assert.ok(asked.some(entry => entry.path === '/api/v2/auth/validate' && entry.key === PASTED_KEY))
  assert.equal(JSON.parse(readFileSync(join(rt.home, LINK_FILE), 'utf8')).key, PASTED_KEY)
  assert.equal(JSON.stringify(reply).includes(PASTED_KEY), false)
  assert.equal(JSON.stringify(await rt.omniLinkEndpoint('omni-link')).includes(PASTED_KEY), false)
  assert.equal(JSON.stringify(await rt.omniDiscoverEndpoint('omni-discover')).includes(PASTED_KEY), false)
})

test('a pasted key the Omni refuses shows the Omni\'s own words, links nothing, and never echoes the key', async (t) => {
  const { rt } = host(t, json => json(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }))
  const { omnis } = await rt.omniDiscoverEndpoint('omni-discover')
  const local = omnis.find(omni => omni.local)
  await assert.rejects(rt.omniDiscoverEndpoint('omni-discover-key', { id: local.id, apiKey: PASTED_KEY }), (error) => {
    assert.equal(error.code, 'bot/refused')
    assert.equal(error.message, 'Omni did not accept that key: Invalid API key')
    assert.equal(error.message.includes(PASTED_KEY), false)
    return true
  })
  assert.equal(existsSync(join(rt.home, LINK_FILE)), false)
  for (const body of [{ id: local.id, apiKey: 'short' }, { id: local.id, apiKey: 'has a space inside it' }, { id: local.id }, { id: local.id, apiKey: PASTED_KEY, extra: 1 }]) {
    await assert.rejects(rt.omniDiscoverEndpoint('omni-discover-key', body), { code: 'bot/invalid' }, JSON.stringify(body))
  }
})

const MINTED_KEY = 'omni_sk_device_minted'

test('a key that can do everything makes this device its own scoped key once, and only that one is kept', async (t) => {
  const made = []
  const { rt, asked } = host(t, json => json(200, { data: { valid: true, scopes: ['*'], credential: { expiresAt: null } } }), {
    mint: (json, init) => {
      made.push({ key: init.headers['x-api-key'], body: JSON.parse(init.body) })
      return json(201, { data: { id: 'key-7', name: JSON.parse(init.body).name, scopes: JSON.parse(init.body).scopes, expiresAt: null, plainTextKey: MINTED_KEY } })
    },
  })
  const { omnis } = await rt.omniDiscoverEndpoint('omni-discover')
  const reply = await rt.omniDiscoverEndpoint('omni-discover-use', { id: omnis.find(omni => omni.local).id })
  assert.deepEqual(reply, { status: 'paired', origin: 'localhost:8882' })
  assert.equal(made.length, 1)
  assert.equal(made[0].key, LOCAL_KEY)
  assert.match(made[0].body.name, /^device: /)
  assert.deepEqual(made[0].body.scopes, ['instances:*', 'chats:*', 'messages:*', 'media:*', 'events:*', 'system:read', 'system:update'])
  assert.equal(made[0].body.scopes.some(scope => /^(\*|keys|settings|auth|platform)/.test(scope)), false)
  const saved = readFileSync(join(rt.home, LINK_FILE), 'utf8')
  const link = JSON.parse(saved)
  assert.deepEqual({ key: link.key, keyId: link.keyId, scopes: link.scopes }, { key: MINTED_KEY, keyId: 'key-7', scopes: made[0].body.scopes })
  // The broad key is never kept, and never reaches the page.
  assert.equal(saved.includes(LOCAL_KEY), false)
  assert.equal(JSON.stringify(reply).includes(LOCAL_KEY), false)
  assert.equal(asked.filter(entry => entry.path === '/api/v2/keys').length, 1)
})

test('a pasted key that can make keys is traded for a device key too', async (t) => {
  const { rt } = host(t, json => json(200, { data: { valid: true, scopes: ['keys:write', 'instances:*'] } }), {
    mint: json => json(201, { data: { id: 'key-8', plainTextKey: MINTED_KEY } }),
  })
  const { omnis } = await rt.omniDiscoverEndpoint('omni-discover')
  await rt.omniDiscoverEndpoint('omni-discover-key', { id: omnis.find(omni => omni.local).id, apiKey: PASTED_KEY })
  const saved = readFileSync(join(rt.home, LINK_FILE), 'utf8')
  assert.equal(JSON.parse(saved).key, MINTED_KEY)
  assert.equal(saved.includes(PASTED_KEY), false)
})

test('when a broad key cannot make one, it is kept with a note that it can do everything', async (t) => {
  const { rt } = host(t, json => json(200, { data: { valid: true, scopes: ['*'] } }), {
    mint: json => json(403, { error: { code: 'FORBIDDEN', message: 'Cannot grant scopes' } }),
  })
  const { omnis } = await rt.omniDiscoverEndpoint('omni-discover')
  const reply = await rt.omniDiscoverEndpoint('omni-discover-use', { id: omnis.find(omni => omni.local).id })
  assert.deepEqual(reply, { status: 'paired', origin: 'localhost:8882', notice: 'broad-key' })
  assert.equal(JSON.parse(readFileSync(join(rt.home, LINK_FILE), 'utf8')).key, LOCAL_KEY)
})

const GRANT = 'Zx81_kq-Pz0aBcD9eF12-_Qw'
const DEVICE_KEY = 'omni_sk_connect_secret'

// An Omni's answer to POST /api/v2/login/connect, recorded with what it was sent.
function connectOmni(t, answer) {
  const { rt } = host(t, json => json(500, {}))
  const sent = []
  const probes = globalThis.fetch
  globalThis.fetch = async (address, init = {}) => {
    const url = new URL(String(address))
    if (url.pathname !== '/api/v2/login/connect') return probes(address, init)
    sent.push({ host: url.host, method: init.method, headers: init.headers, body: JSON.parse(init.body) })
    return answer((status, data) => new Response(JSON.stringify(data), { status }))
  }
  return { rt, sent }
}

test('a link the Omni sent becomes this device\'s key at once, kept on the host', async (t) => {
  const { rt, sent } = connectOmni(t, json => json(200, { data: { apiKey: DEVICE_KEY, keyId: 'k9', scopes: ['instances:read'], keyExpiresAt: null, apiUrl: 'https://api.omni.example.com/' } }))
  const reply = await rt.omniLinkEndpoint('omni-connect-grant', { url: 'https://omni.example.com', grant: GRANT, deviceName: 'Laptop' })
  assert.deepEqual(reply, { status: 'paired', origin: 'api.omni.example.com' })
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].body, { grant: GRANT, clientId: 'omni-dsh', deviceName: 'Laptop' })
  assert.equal(sent[0].headers['x-api-key'], undefined)
  assert.equal(sent[0].headers.authorization, undefined)
  const link = JSON.parse(readFileSync(join(rt.home, LINK_FILE), 'utf8'))
  assert.deepEqual({ url: link.url, key: link.key, keyId: link.keyId, scopes: link.scopes }, { url: 'https://api.omni.example.com', key: DEVICE_KEY, keyId: 'k9', scopes: ['instances:read'] })
  const shown = await rt.omniLinkEndpoint('omni-link')
  assert.equal(shown.origin, 'api.omni.example.com')
  assert.equal(JSON.stringify([reply, shown]).includes(DEVICE_KEY), false)
})

test('a spent link, sign-in turned off and too many tries each say so, and nothing is linked', async (t) => {
  const expired = 'This connect link expired or was already used. Text connect to yourself on WhatsApp for a new one.'
  const cases = [
    [json => json(410, { error: { code: 'LINK_EXPIRED', message: expired } }), expired],
    [json => json(404, { error: { code: 'NOT_FOUND', message: 'Not found' } }), 'Sign-in is off on omni.example.com.'],
    [json => json(429, { error: { code: 'RATE_LIMITED' } }), 'Too many tries; wait a minute and try again.'],
    [json => json(400, { error: { code: 'VALIDATION', message: 'Body must be { grant, clientId, deviceName }' } }), 'Body must be { grant, clientId, deviceName }'],
    [json => json(200, { data: {} }), 'Omni answered 200 at omni.example.com'],
  ]
  for (const [answer, message] of cases) {
    const { rt } = connectOmni(t, answer)
    await assert.rejects(rt.omniLinkEndpoint('omni-connect-grant', { url: 'omni.example.com', grant: GRANT }), { code: 'bot/refused', message })
    assert.equal((await rt.omniLinkEndpoint('omni-link')).linked, false)
  }
})

test('a grant that is not one an Omni mints is refused before anything is sent', async (t) => {
  const { rt, sent } = connectOmni(t, json => json(200, {}))
  for (const body of [{ url: 'https://omni.example.com', grant: 'short' }, { url: 'https://omni.example.com', grant: `${GRANT}x` }, { url: 'https://omni.example.com', grant: `${GRANT.slice(0, 23)}.` }, { url: 'ftp://omni.example.com', grant: GRANT }, { url: 'https://omni.example.com' }]) {
    await assert.rejects(rt.omniLinkEndpoint('omni-connect-grant', body), { code: 'bot/invalid' })
  }
  assert.equal(sent.length, 0)
})

test('a link the Omni sends reads as its address and grant, and anything else as nothing', () => {
  const grant = GRANT
  assert.deepEqual(parseConnectLink(`https://omni.example.com/api/login/app?grant=${grant}`), { url: 'https://omni.example.com', grant })
  assert.deepEqual(parseConnectLink(` https://omni.example.com/base/api/login/app/?grant=${grant} `), { url: 'https://omni.example.com/base', grant })
  assert.deepEqual(parseConnectLink(`omni://connect?url=${encodeURIComponent('https://omni.example.com/api/v2')}&grant=${grant}`), { url: 'https://omni.example.com', grant })
  for (const bad of [
    '',
    'omni.example.com',
    `https://omni.example.com/api/login/device?grant=${grant}`,
    'https://omni.example.com/api/login/app',
    'https://omni.example.com/api/login/app?grant=short',
    `https://omni.example.com/api/login/app?grant=${grant}%20x`,
    `https://omni.example.com/api/login/app?grant=${grant}x`,
    `https://omni.example.com/api/login/app?grant=${grant.slice(0, 23)}~`,
    `omni://connect?url=${encodeURIComponent('javascript:alert(1)')}&grant=${grant}`,
    `omni://other?url=https://omni.example.com&grant=${grant}`,
    `ftp://omni.example.com/api/login/app?grant=${grant}`,
  ]) assert.equal(parseConnectLink(bad), null, bad)
})
