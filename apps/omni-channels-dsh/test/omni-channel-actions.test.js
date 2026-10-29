import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FORBIDDEN_CHANGE, FORBIDDEN_SEND, install, scopeAllows } from '../src/host/omni-channel-actions.js'
import { install as installHooks } from '@automagik/bots-dsh/src/host/extend.js'

const KEY = 'omni_sk_linked_secret'
const CHANNEL = '11111111-2222-4333-8444-555555555555'
const CHAT = '66666666-7777-4888-8999-aaaaaaaaaaaa'

// A host linked to an Omni whose answers come from `routes`: `"METHOD /path": (body) => [status, json]`.
// Every call is kept, with the key the host sent, so a test can read what reached omni.
function host(routes) {
  const calls = []
  const rt = {
    ctx: { effect: run => run() },
    omniRequest: async (method, path, { body } = {}) => {
      calls.push({ method, path, body, key: KEY })
      const route = routes[`${method} ${path}`]
      const [status, json] = route ? route(body) : [404, { error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } }]
      return new Response(JSON.stringify(json), { status })
    },
  }
  installHooks(rt)
  install(rt)
  return { rt, calls, run: (endpoint, body) => rt.omniChannelEndpoint(endpoint, body) }
}

const created = body => [201, { data: { id: CHANNEL, name: body.name, channel: body.channel, isActive: true } }]

test('scopes allow what the API allows: "*", the scope, or its namespace', () => {
  assert.equal(scopeAllows(['*'], 'instances:write'), true)
  assert.equal(scopeAllows(['instances:*'], 'instances:write'), true)
  assert.equal(scopeAllows(['instances:write'], 'instances:write'), true)
  assert.equal(scopeAllows(['instances:read', 'messages:*'], 'instances:write'), false)
})

test('what the key may change comes from /auth/validate; an Omni that cannot say is tried', async () => {
  const scoped = host({ 'POST /auth/validate': () => [200, { data: { valid: true, scopes: ['instances:read', 'messages:*'] } }] })
  assert.deepEqual(await scoped.run('omni-channel-abilities'), { changeChannels: false, send: true })
  const old = host({})
  assert.deepEqual(await old.run('omni-channel-abilities'), { changeChannels: true, send: true })
})

test('adding WhatsApp creates the channel, then shows the real code until omni says connected', async () => {
  let scans = 0
  const { run, calls } = host({
    'POST /instances': created,
    [`GET /instances/${CHANNEL}/status`]: () => (scans++ < 1 ? [200, { data: { state: 'qr', isConnected: false } }] : [200, { data: { state: 'connected', isConnected: true, profileName: 'Felipe', ownerIdentifier: '5511999999999@s.whatsapp.net' } }]),
    [`GET /instances/${CHANNEL}/qr`]: () => [200, { data: { qr: '2@real-baileys-qr,abc,def', expiresAt: '2026-10-23T20:00:00.000Z' } }],
  })
  assert.deepEqual(await run('omni-channel-create', { type: 'whatsapp-baileys', name: 'Sales' }), { id: CHANNEL, type: 'whatsapp-baileys', name: 'Sales' })
  assert.deepEqual(calls[0].body, { name: 'Sales', channel: 'whatsapp-baileys' })
  const waiting = await run('omni-channel-pairing', { id: CHANNEL })
  assert.equal(waiting.connected, false)
  assert.equal(waiting.qr, '2@real-baileys-qr,abc,def')
  const done = await run('omni-channel-pairing', { id: CHANNEL })
  assert.equal(done.connected, true)
  assert.equal(done.qr, null)
  assert.equal(done.detail, 'Felipe')
  // A connected channel is no longer this flow's to delete.
  assert.deepEqual(await run('omni-channel-cancel', { id: CHANNEL }), { removed: false })
  assert.equal(calls.some(call => call.method === 'DELETE'), false)
})

test('a phone number gets the code omni asks WhatsApp for', async () => {
  const { run, calls } = host({ [`POST /instances/${CHANNEL}/pair`]: () => [200, { data: { code: 'K7QX-4M2P', expiresIn: 60 } }] })
  assert.deepEqual(await run('omni-channel-phone-code', { id: CHANNEL, phone: '+55 11 91234-5678' }), { code: 'K7QX-4M2P', expiresIn: 60 })
  assert.deepEqual(calls[0].body, { phoneNumber: '+5511912345678' })
  await assert.rejects(run('omni-channel-phone-code', { id: CHANNEL, phone: 'call me' }), { code: 'bot/invalid' })
})

test('a token channel is created with its token; a missing token is refused before omni', async () => {
  const { run, calls } = host({ 'POST /instances': created })
  await assert.rejects(run('omni-channel-create', { type: 'telegram', name: 'Helper' }), { code: 'bot/invalid' })
  assert.equal(calls.length, 0)
  await run('omni-channel-create', { type: 'telegram', name: 'Helper', token: '123456:ABC-def_ghi' })
  assert.deepEqual(calls[0].body, { name: 'Helper', channel: 'telegram', token: '123456:ABC-def_ghi' })
  // Types the page cannot pair are not created here.
  await assert.rejects(run('omni-channel-create', { type: 'slack', name: 'Slack', token: 'xoxb-1234567890' }), { code: 'bot/invalid' })
})

test('cancelling deletes only a channel this flow created and that has not connected', async () => {
  const { run, calls } = host({ 'POST /instances': created, [`DELETE /instances/${CHANNEL}`]: () => [200, { success: true }] })
  const other = '99999999-2222-4333-8444-555555555555'
  assert.deepEqual(await run('omni-channel-cancel', { id: other }), { removed: false })
  await run('omni-channel-create', { type: 'whatsapp-baileys', name: 'Sales' })
  assert.deepEqual(await run('omni-channel-cancel', { id: CHANNEL }), { removed: true })
  assert.deepEqual(calls.filter(call => call.method === 'DELETE').map(call => call.path), [`/instances/${CHANNEL}`])
  // Once is enough.
  assert.deepEqual(await run('omni-channel-cancel', { id: CHANNEL }), { removed: false })
})

test('reconnect, resume, pause and a new token call omni\'s own routes', async () => {
  const ok = () => [200, { data: { status: 'connecting' } }]
  const { run, calls } = host({ [`POST /instances/${CHANNEL}/connect`]: ok, [`POST /instances/${CHANNEL}/disconnect`]: () => [200, { success: true }] })
  for (const action of ['reconnect', 'resume', 'pause']) await run('omni-channel-act', { id: CHANNEL, action })
  await run('omni-channel-act', { id: CHANNEL, action: 'token', token: '123456:NEW-token' })
  assert.deepEqual(calls.map(call => [call.method, call.path, call.body]), [
    ['POST', `/instances/${CHANNEL}/connect`, {}],
    ['POST', `/instances/${CHANNEL}/connect`, {}],
    ['POST', `/instances/${CHANNEL}/disconnect`, undefined],
    ['POST', `/instances/${CHANNEL}/connect`, { token: '123456:NEW-token' }],
  ])
  await assert.rejects(run('omni-channel-act', { id: CHANNEL, action: 'unknown' }), { code: 'bot/invalid' })
})

test('explicit delete uses the standard write endpoint for an existing instance, not pending cancellation', async () => {
  const { run, calls, rt } = host({ [`DELETE /instances/${CHANNEL}`]: () => [200, { success: true }] })
  assert.deepEqual(await run('omni-channel-cancel', { id: CHANNEL }), { removed: false })
  assert.deepEqual(await run('omni-channel-act', { id: CHANNEL, action: 'delete' }), { ok: true })
  assert.deepEqual(calls.map(({ method, path, body }) => [method, path, body]), [['DELETE', `/instances/${CHANNEL}`, undefined]])
  // The same registration as pause/create: not a read and no custom permission bypass.
  assert.equal(rt.extended.endpointOf('omni-channel-act').read, false)
  assert.equal(rt.extended.endpointOf('omni-channel-cancel').read, false)
  assert.equal(rt.extended.endpointOf('omni-channel-abilities').read, true)
  await assert.rejects(run('omni-channel-act', { id: '../bad', action: 'delete' }), { code: 'bot/invalid' })
  assert.equal(calls.length, 1)
})

test('delete propagates API failures and the existing permission model', async () => {
  const malformed = host({ [`DELETE /instances/${CHANNEL}`]: () => [200, { success: false }] })
  await assert.rejects(malformed.run('omni-channel-act', { id: CHANNEL, action: 'delete' }), { code: 'bot/invalid', message: 'Omni did not confirm instance deletion' })
  const unreachable = host({ [`DELETE /instances/${CHANNEL}`]: () => { throw new Error('Offline') } })
  await assert.rejects(unreachable.run('omni-channel-act', { id: CHANNEL, action: 'delete' }), { code: 'bot/refused', message: 'Could not reach your Omni. Try again in a moment.' })
  for (const status of [401, 403, 404, 500]) {
    const { run } = host({ [`DELETE /instances/${CHANNEL}`]: () => [status, { error: { message: 'Try again later' } }] })
    await assert.rejects(run('omni-channel-act', { id: CHANNEL, action: 'delete' }), {
      code: 'bot/refused', message: status === 401 || status === 403 ? FORBIDDEN_CHANGE : 'Try again later',
    })
  }
})

test('a reply goes to the chat\'s own instance and address; refusals say why', async () => {
  const { run, calls } = host({
    [`GET /chats/${CHAT}`]: () => [200, { data: { id: CHAT, instanceId: CHANNEL, externalId: '5511988887777@s.whatsapp.net' } }],
    'POST /messages/send': () => [200, { data: { messageId: 'x' } }],
  })
  assert.deepEqual(await run('omni-send', { chatId: CHAT, text: 'Oi!' }), { sent: true })
  assert.deepEqual(calls[1].body, { instanceId: CHANNEL, to: '5511988887777@s.whatsapp.net', text: 'Oi!' })
  await assert.rejects(run('omni-send', { chatId: CHAT, text: '   ' }), { code: 'bot/invalid' })

  const denied = host({ [`GET /chats/${CHAT}`]: () => [200, { data: { id: CHAT, instanceId: CHANNEL, externalId: 'x' } }], 'POST /messages/send': () => [403, { error: { code: 'FORBIDDEN' } }] })
  await assert.rejects(denied.run('omni-send', { chatId: CHAT, text: 'Oi!' }), { code: 'bot/refused', message: FORBIDDEN_SEND })
  const scoped = host({ 'POST /instances': () => [403, { error: { code: 'FORBIDDEN' } }] })
  await assert.rejects(scoped.run('omni-channel-create', { type: 'whatsapp-baileys', name: 'Sales' }), { code: 'bot/refused', message: FORBIDDEN_CHANGE })
  const taken = host({ 'POST /instances': () => [409, { error: { code: 'CONFLICT', message: 'An instance named Sales exists' } }] })
  await assert.rejects(taken.run('omni-channel-create', { type: 'whatsapp-baileys', name: 'Sales' }), { message: 'An instance named Sales exists' })
})

test('settings whitelist reads and PATCH only validated dirty fields on the same id', async () => {
  const { run, calls } = host({
    [`GET /instances/${CHANNEL}`]: () => [200, { data: { id: CHANNEL, name: 'Existing', channel: 'whatsapp-business', processAudio: false, metaAppId: '12345678', agentId: null, agentProviderId: null, metaAccessToken: 'must-not-return', unknown: 'ignored' } }],
    [`PATCH /instances/${CHANNEL}`]: () => [200, { data: { metaAccessToken: 'must-not-return' } }],
    'GET /agents?limit=200': () => [200, { items: [{ id: CHAT, name: 'Helper', apiKey: 'must-not-return' }] }],
  })
  assert.deepEqual(await run('omni-channel-settings', { id: CHANNEL }), { settings: { processAudio: false, metaAppId: '12345678', agentId: null, agentProviderId: null } })
  const patch = { processAudio: false, inboundMaxAgeMinutes: 0, triggerReactions: [], sessionReset: null, agentId: CHAT }
  assert.deepEqual(await run('omni-channel-settings-save', { id: CHANNEL, patch }), { ok: true })
  assert.deepEqual(calls[1], { method: 'PATCH', path: `/instances/${CHANNEL}`, body: patch, key: KEY })
  assert.deepEqual(await run('omni-channel-agents'), { items: [{ id: CHAT, name: 'Helper' }] })
  for (const patch of [{ surprise: 1 }, { agentProviderId: CHAT }, { metaAccessToken: 'secret' }, { processAudio: null }, { agentId: 'wrong' }]) {
    await assert.rejects(run('omni-channel-settings-save', { id: CHANNEL, patch }), { code: 'bot/invalid' })
  }
  assert.equal(calls.length, 3)
})

test('Business repair uses the existing id without creating or deleting even on failure', async () => {
  const fields = { id: CHANNEL, accessToken: 'fixture-reentered-token', phoneNumberId: '12345678', wabaId: '23456789', appId: '34567890' }
  for (const status of [200, 500, 403]) {
    const { run, calls } = host({ [`POST /instances/${CHANNEL}/whatsapp-business/connect`]: () => [status, { error: { message: fields.accessToken }, data: { token: fields.accessToken } }] })
    if (status === 200) assert.deepEqual(await run('omni-wab-repair', fields), { ok: true })
    else await assert.rejects(run('omni-wab-repair', fields), error => !error.message.includes(fields.accessToken) && (status !== 403 || error.message === FORBIDDEN_CHANGE))
    const { id: ignored, ...expected } = fields
    assert.deepEqual(calls, [{ method: 'POST', path: `/instances/${CHANNEL}/whatsapp-business/connect`, body: expected, key: KEY }])
    await assert.rejects(run('omni-wab-repair', { ...fields, accessToken: '' }), { code: 'bot/invalid' })
    assert.equal(calls.length, 1)
  }
})

test('settings preserve permission refusals and explain unsupported or invalid API fields', async () => {
  for (const status of [401, 403, 400, 404]) {
    const { run } = host({ [`PATCH /instances/${CHANNEL}`]: () => [status, { error: { message: 'Check the settings' } }] })
    await assert.rejects(run('omni-channel-settings-save', { id: CHANNEL, patch: { processAudio: false } }), error =>
      status === 400 ? /processAudio.*types.*update Omni/.test(error.message) : error.message === (status === 404 ? 'Check the settings' : FORBIDDEN_CHANGE))
  }
})

test('nothing the page gets back carries the key', async () => {
  const { run } = host({
    'POST /auth/validate': () => [200, { data: { scopes: ['*'], keyPrefix: 'omni_sk_1234…' } }],
    'POST /instances': created,
    [`GET /instances/${CHANNEL}/status`]: () => [200, { data: { state: 'qr' } }],
    [`GET /instances/${CHANNEL}/qr`]: () => [200, { data: { qr: 'code', expiresAt: null } }],
  })
  const replies = [
    await run('omni-channel-abilities'),
    await run('omni-channel-create', { type: 'whatsapp-baileys', name: 'Sales' }),
    await run('omni-channel-pairing', { id: CHANNEL }),
  ]
  assert.equal(JSON.stringify(replies).includes(KEY), false)
  assert.equal(JSON.stringify(replies).includes('omni_sk_'), false)
})
