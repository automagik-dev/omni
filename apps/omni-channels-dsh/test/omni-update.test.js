import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { install as installDiscover } from '../src/host/omni-discover.js'
import { FORBIDDEN, install, REFUSALS, TERMINAL_COMMAND } from '../src/host/omni-update.js'
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

const LINK_KEY = 'omni_sk_linked_secret'
const CLI_KEY = 'omni_sk_cli_secret'

// A host linked to https://omni.example.com, on a computer whose Omni CLI names a local
// Omni with a key and a remote one without. `answer(method, body)` is how the Omnis answer
// /api/v2/system/update.
function host(t, answer) {
  const home = mkdtempSync(join(tmpdir(), 'omni-update-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, '.omni'))
  writeFileSync(join(home, '.omni', 'config.json'), JSON.stringify({ apiUrl: 'http://localhost:8882', apiKey: CLI_KEY, servers: { list: { lab: { url: 'https://lab.example.com' } } } }))
  process.env.HOME = home
  delete process.env.OMNI_CONFIG_DIR
  delete process.env.OMNI_HOME
  const sent = []
  globalThis.fetch = async (address, init = {}) => {
    const url = new URL(String(address))
    const json = (status, data) => new Response(JSON.stringify(data), { status })
    if (url.pathname === '/api/v2/health') return json(200, { version: '2.261006.2' })
    if (url.pathname === '/api/v2/login/status') return json(401, {})
    sent.push({ host: url.host, method: init.method, key: init.headers?.['x-api-key'], body: init.body ? JSON.parse(init.body) : undefined })
    return answer(json, init.method, init.body ? JSON.parse(init.body) : undefined)
  }
  const rt = { home, config: {}, ctx: { effect: run => run() }, omniLink: () => ({ url: 'https://omni.example.com', key: LINK_KEY }) }
  installHooks(rt)
  installDiscover(rt)
  install(rt)
  return { rt, sent }
}

const status = data => json => json(200, { data: { current: '2.261023.6', channel: 'next', latest: '2.261023.10', updateAvailable: true, mode: 'command', ...data } })

test('the linked Omni\'s update reads as available, off, waiting, running or current', async (t) => {
  const cases = [
    [status({}), { state: 'available', current: '2.261023.6', latest: '2.261023.10' }],
    [status({ mode: 'off' }), { state: 'off', current: '2.261023.6', latest: '2.261023.10', command: TERMINAL_COMMAND }],
    [status({ pending: { version: '2.261023.10', expiresAt: '2026-10-23T20:00:00Z' } }), { state: 'pending', current: '2.261023.6', latest: '2.261023.10', version: '2.261023.10', expiresAt: '2026-10-23T20:00:00Z' }],
    [status({ inFlight: { version: '2.261023.10' } }), { state: 'updating', current: '2.261023.6', latest: '2.261023.10', version: '2.261023.10' }],
    [status({ current: '2.261023.10', updateAvailable: false }), { state: 'current', current: '2.261023.10', latest: '2.261023.10' }],
    [json => json(404, { error: { code: 'NOT_FOUND' } }), { state: 'terminal', command: TERMINAL_COMMAND }],
    [json => json(403, { error: { code: 'FORBIDDEN' } }), { state: 'forbidden', message: FORBIDDEN, command: TERMINAL_COMMAND }],
    [json => json(500, {}), { state: 'unknown' }],
  ]
  for (const [answer, expected] of cases) {
    const { rt, sent } = host(t, answer)
    const reply = await rt.omniUpdateEndpoint('omni-update-status', {})
    assert.deepEqual(reply, expected)
    assert.deepEqual(sent.map(entry => [entry.host, entry.method, entry.key]), [['omni.example.com', 'GET', LINK_KEY]])
    assert.equal(JSON.stringify(reply).includes(LINK_KEY), false)
  }
})

test('asking for the update hands the yes to WhatsApp, and every refusal says what it means', async (t) => {
  const accepted = host(t, json => json(202, { data: { status: 'awaiting-confirmation', version: '2.261023.10', expiresAt: '2026-10-23T20:00:00Z' } }))
  const reply = await accepted.rt.omniUpdateEndpoint('omni-update-request', { version: '2.261023.10' })
  assert.deepEqual(reply, { state: 'awaiting-confirmation', version: '2.261023.10', expiresAt: '2026-10-23T20:00:00Z' })
  assert.deepEqual(accepted.sent[0], { host: 'omni.example.com', method: 'POST', key: LINK_KEY, body: { version: '2.261023.10' } })

  for (const [code, message] of Object.entries(REFUSALS)) {
    const httpStatus = code === 'REGISTRY_UNAVAILABLE' ? 503 : code === 'CONFIRM_SEND_FAILED' ? 502 : 409
    const { rt } = host(t, json => json(httpStatus, { error: { code, message: 'server words' } }))
    await assert.rejects(rt.omniUpdateEndpoint('omni-update-request', { version: '2.261023.10' }), { code: 'bot/refused', message })
  }
  const forbidden = host(t, json => json(403, { error: { code: 'FORBIDDEN' } }))
  await assert.rejects(forbidden.rt.omniUpdateEndpoint('omni-update-request', { version: '2.261023.10' }), { message: FORBIDDEN })
  const old = host(t, json => json(404, {}))
  await assert.rejects(old.rt.omniUpdateEndpoint('omni-update-request', { version: '2.261023.10' }), { message: /Update it where it runs: omni update/ })
  const unknown = host(t, json => json(409, { error: { code: 'SOMETHING_NEW', message: 'Something new happened' } }))
  await assert.rejects(unknown.rt.omniUpdateEndpoint('omni-update-request', { version: '2.261023.10' }), { message: 'Something new happened' })
  for (const body of [{}, { version: 'latest' }, { version: '2.261023.10; rm -rf /' }]) {
    await assert.rejects(accepted.rt.omniUpdateEndpoint('omni-update-request', body), { code: 'bot/invalid' })
  }
})

test('an Omni found on this computer is asked with its own key, and one without a key is updated from a terminal', async (t) => {
  const { rt, sent } = host(t, status({}))
  const { omnis } = await rt.omniDiscoverEndpoint('omni-discover')
  const local = omnis.find(omni => omni.local)
  const remote = omnis.find(omni => !omni.local)
  assert.deepEqual(await rt.omniUpdateEndpoint('omni-update-status', { id: local.id }), { state: 'available', current: '2.261023.6', latest: '2.261023.10' })
  assert.deepEqual(sent.map(entry => [entry.host, entry.key]), [['localhost:8882', CLI_KEY]])
  assert.deepEqual(await rt.omniUpdateEndpoint('omni-update-status', { id: remote.id }), { state: 'terminal', command: TERMINAL_COMMAND })
  assert.equal(sent.length, 1, 'an Omni without a key is not asked')
  await assert.rejects(rt.omniUpdateEndpoint('omni-update-status', { id: '0123456789abcdef' }), { code: 'bot/refused' })
  await assert.rejects(rt.omniUpdateEndpoint('omni-update-status', { id: 'nope' }), { code: 'bot/invalid' })
})

test('with nothing linked there is nothing to ask', async (t) => {
  const { rt, sent } = host(t, status({}))
  rt.omniLink = () => null
  assert.deepEqual(await rt.omniUpdateEndpoint('omni-update-status', {}), { state: 'none' })
  assert.equal(sent.length, 0)
})
