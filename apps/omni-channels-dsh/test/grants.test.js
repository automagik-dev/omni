import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { askText, covers, decide, sensitive } from '../src/host/grants.js'
import { sensitiveCall } from '../src/host/omni-api.js'
import { SOURCE_ROUTES } from '../src/host/omni-routes.js'
import { applyBoth, fakeContext } from './team.js'

const OMNI = 'https://omni.example.com'
const GROUP = '11111111-1111-4111-8111-111111111111'
const FAMILY = '22222222-2222-4222-8222-222222222222'
const PERSON = '33333333-3333-4333-8333-333333333333'
const SELF = '44444444-4444-4444-8444-444444444444'
const OLD = '55555555-5555-4555-8555-555555555555'
const PHOTO = '66666666-6666-4666-8666-666666666666'
const LIST = '77777777-7777-4777-8777-777777777777'

const CHATS = {
  [GROUP]: { id: GROUP, instanceId: 'wa-1', name: '🦞BuildWithFriends', chatType: 'group', externalId: '120363@g.us', lastMessagePreview: 'ship it' },
  [FAMILY]: { id: FAMILY, instanceId: 'wa-1', name: 'Family', chatType: 'group', externalId: '120999@g.us', lastMessagePreview: 'dinner?' },
  [PERSON]: { id: PERSON, instanceId: 'wa-1', name: 'Marina', chatType: 'dm', externalId: '5511888887777@s.whatsapp.net', lastMessagePreview: 'see you' },
  [SELF]: { id: SELF, instanceId: 'wa-1', name: 'Me', chatType: 'dm', externalId: '5511999990000@s.whatsapp.net' },
  [LIST]: { id: LIST, instanceId: 'wa-1', name: 'Clientes', chatType: 'broadcast', externalId: '1700000000@broadcast' },
}
const MESSAGES = {
  [OLD]: { id: OLD, chatId: GROUP, externalId: 'WA-OLD', isFromMe: true, textContent: 'wrong link' },
  [PHOTO]: { id: PHOTO, chatId: GROUP, externalId: 'WA-PHOTO', isFromMe: false, hasMedia: true, messageType: 'image', textContent: '' },
}

// A fake omni answering the reads the tools make, and recording every change.
function fakeOmni({ mediaPath = 'wa-1/2026/photo.jpg' } = {}) {
  const changes = []
  const reads = []
  const reply = (status, value) => new Response(value instanceof Uint8Array ? value : JSON.stringify(value), { status })
  const fetch = async (address, init = {}) => {
    const url = new URL(String(address))
    const path = url.pathname.replace('/api/v2', '')
    const method = init.method ?? 'GET'
    if (method === 'GET') reads.push(path)
    if (method !== 'GET') {
      // The events module's own housekeeping (its consumers) is not what these tests watch.
      if (!path.startsWith('/events/consumers')) changes.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined })
      if (path === '/messages/media/download') return reply(200, { data: { mediaLocalPath: mediaPath, mediaMimeType: 'image/jpeg' } })
      return reply(200, { data: { ok: true } })
    }
    if (path === '/openapi.json') return reply(200, { paths: {} })
    if (path === '/instances/wa-1') return reply(200, { data: { id: 'wa-1', name: 'Pessoal', ownerIdentifier: '5511999990000:12@s.whatsapp.net' } })
    if (path === '/chats') return reply(200, { items: Object.values(CHATS), meta: {} })
    const chat = /^\/chats\/([^/]+)(\/messages)?$/.exec(path)
    if (chat && CHATS[chat[1]]) {
      return chat[2] ? reply(200, { items: [{ id: 'm1', textContent: `hello from ${CHATS[chat[1]].name}`, senderDisplayName: 'Ana', createdAt: '2026-10-22T08:00:00Z' }] }) : reply(200, { data: CHATS[chat[1]] })
    }
    const message = /^\/messages\/([^/]+)$/.exec(path)
    if (message && MESSAGES[message[1]]) return reply(200, { data: MESSAGES[message[1]] })
    if (path === '/media/wa-1/2026/photo.jpg') return reply(200, new Uint8Array([0xff, 0xd8, 0xff]))
    return reply(404, { error: { message: 'Not found' } })
  }
  return { fetch, changes, reads }
}

// The Main Bot Omni and Digest, a Bot of one group, on a DSH linked to the fake omni.
function setup(t, extra = {}, omniOptions = {}) {
  const home = mkdtempSync(join(tmpdir(), 'omni-grants-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({
    version: 1, mainBotIds: ['m1'], revision: 1,
    bots: {
      m1: { id: 'm1', name: 'Omni', role: 'Orchestrator', instructions: '', createdAt: 1 },
      digest: { id: 'digest', name: 'Digest', role: 'Digest', instructions: '', createdAt: 2 },
    },
    rooms: {}, agents: {}, exchanges: [], exchangeTurns: {},
    ...extra,
  }))
  const realFetch = globalThis.fetch
  const omni = fakeOmni(omniOptions)
  globalThis.fetch = omni.fetch
  const ctx = fakeContext({ services: { credentials: { resolve: async ref => (ref === 'OMNI_API_KEY' ? { value: 'omni_sk_test' } : undefined) } } })
  const notes = []
  Object.assign(ctx, {
    sessionController: { resolveAgent: async sessionId => ({ agent: { session: { id: sessionId }, followup: message => notes.push({ sessionId, text: message.content[0].text }), steer: () => {} } }) },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => { route = options; return register(options) }
  const { team } = applyBoth(ctx, { home, omni: { url: OMNI } })
  t.after(async () => {
    globalThis.fetch = realFetch
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  const as = agentId => async (name, args) => {
    let concluded = false
    const text = await ctx.registeredTools.get(name).execute(args, { agent: { id: agentId }, callId: `call-${name}-${Math.random()}`, concludeTurn: () => { concluded = true } })
    return { text, concluded }
  }
  const call = async (endpoint, payload) => (await (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json())
  const view = async () => (await call('state', {})).value
  const pending = async botId => (await view()).omniConsents?.[botId]?.filter(entry => entry.status === 'pending') ?? []
  const answer = async (botId, choice) => {
    const [entry] = await pending(botId)
    assert.ok(entry, `a card for ${botId}`)
    const result = await call('omni-consent-answer', { id: entry.id, answer: choice })
    assert.equal(result.ok, true, JSON.stringify(result.error))
    return entry
  }
  return { ctx, team, home, omni, notes, as, call, view, pending, answer }
}

test('grants cover their Bot, action and chat; a channel grant covers its chats; expired ones nothing', () => {
  const group = { type: 'group', id: GROUP, name: 'g', channelId: 'wa-1' }
  const grant = { botId: 'digest', resource: { type: 'group', id: GROUP }, actions: ['read', 'send'], approval: 'auto' }
  assert.equal(covers(grant, { botId: 'digest', resource: group, action: 'read' }), true)
  assert.equal(covers(grant, { botId: 'digest', resource: group, action: 'delete' }), false)
  assert.equal(covers(grant, { botId: 'other', resource: group, action: 'read' }), false)
  assert.equal(covers(grant, { botId: 'digest', resource: { ...group, id: FAMILY }, action: 'read' }), false)
  assert.equal(covers({ ...grant, expiresAt: 10 }, { botId: 'digest', resource: group, action: 'read', now: 11 }), false)
  const channel = { botId: 'digest', resource: { type: 'channel', id: 'wa-1' }, actions: ['read'] }
  assert.equal(covers(channel, { botId: 'digest', resource: { ...group, id: FAMILY }, action: 'read' }), true)
  assert.equal(covers(channel, { botId: 'digest', resource: { ...group, channelId: 'tg-1' }, action: 'read' }), false)

  assert.equal(sensitive('send', { type: 'chat' }), true)
  assert.equal(sensitive('send', { type: 'group' }), false)
  assert.equal(sensitive('send', { type: 'self' }), false)
  assert.equal(sensitive('delete', { type: 'group' }), true)
  assert.equal(decide({ main: true, grants: [], botId: 'm1', resource: group, action: 'send' }), 'allow')
  assert.equal(decide({ main: true, grants: [], botId: 'm1', resource: { type: 'chat', id: PERSON }, action: 'send' }), 'confirm')
  assert.equal(decide({ main: false, grants: [], botId: 'digest', resource: group, action: 'read' }), 'consent')
  assert.equal(decide({ main: false, grants: [grant], botId: 'digest', resource: group, action: 'read' }), 'allow')
  assert.equal(decide({ main: false, grants: [{ ...grant, approval: 'confirm' }], botId: 'digest', resource: group, action: 'read' }), 'confirm')
  assert.match(askText({ action: 'send', resource: { name: 'Family' }, preview: { text: 'oi' } }), /send "oi" to "Family"/)
})

test("omni_call asks before every write but the quiet ones, which reach no person and destroy nothing", () => {
  assert.equal(sensitiveCall('POST', '/messages/send', { to: '5511888887777' }), 'send')
  assert.equal(sensitiveCall('POST', '/messages/send/media', { to: '5511888887777@s.whatsapp.net' }), 'send')
  assert.equal(sensitiveCall('POST', '/messages/send', { to: '120363@g.us' }), null)
  // A broadcast list lands in each person's own chat; Status is everyone's.
  assert.equal(sensitiveCall('POST', '/messages/send', { to: '1700000000@broadcast' }), 'send')
  assert.equal(sensitiveCall('POST', '/messages/send', { to: 'status@broadcast' }), 'send')
  assert.equal(sensitiveCall('POST', '/scheduled-messages', { to: '5511888887777', text: 'x' }), 'send')
  assert.equal(sensitiveCall('POST', '/instances/wa-1/whatsapp-templates/promo/send', {}), 'send')
  assert.equal(sensitiveCall('DELETE', '/automations/a1', undefined), 'delete')
  assert.equal(sensitiveCall('POST', '/instances/wa-1/groups/120363@g.us/leave', {}), 'delete')
  assert.equal(sensitiveCall('POST', '/instances/wa-1/logout', {}), 'disconnect')
  assert.equal(sensitiveCall('PATCH', '/instances/wa-1', { isActive: false }), 'disconnect')
  assert.equal(sensitiveCall('POST', '/keys', { name: 'x' }), 'change')
  // Each can make Omni message someone, or post their messages somewhere, later.
  assert.equal(sensitiveCall('POST', '/automations', { actions: [{ type: 'send_message' }] }), 'change')
  assert.equal(sensitiveCall('POST', '/automations/a1/enable', {}), 'change')
  assert.equal(sensitiveCall('PATCH', '/providers/p1', { baseUrl: 'https://example.com' }), 'change')
  assert.equal(sensitiveCall('POST', '/webhook-sources', {}), 'change')
  assert.equal(sensitiveCall('GET', '/chats', undefined), null)
  // Every write route omni declares: these, and only these, run without a card.
  const quiet = SOURCE_ROUTES.filter(route => route.method !== 'GET' && sensitiveCall(route.method, route.path.replace(/\{[^}]+\}/g, 'x'), {}) === null).map(route => `${route.method} ${route.path}`)
  assert.deepEqual(quiet, [
    'POST /access/check', 'POST /auth/validate', 'POST /batch-jobs/estimate',
    'POST /chats/{id}/archive', 'POST /chats/{id}/hide', 'POST /chats/{id}/label', 'POST /chats/{id}/mute', 'POST /chats/{id}/pin', 'POST /chats/{id}/read',
    'POST /chats/{id}/unarchive', 'POST /chats/{id}/unhide', 'POST /chats/{id}/unmute', 'POST /chats/{id}/unpin', 'POST /chats/sync-names',
    'POST /events/schemas/{eventType}/validate', 'POST /events/search',
    'POST /instances/{id}/check-number', 'POST /instances/{id}/connect', 'POST /instances/{id}/sync', 'POST /instances/{id}/sync/profile',
    'POST /media/film', 'POST /media/imagine', 'POST /media/music', 'POST /media/stt', 'POST /media/tts', 'POST /media/vision',
    'POST /messages/{id}/read', 'POST /messages/{id}/star', 'POST /messages/media/download', 'POST /messages/read', 'POST /messages/send-self', 'POST /messages/send/presence',
  ])
  assert.ok(SOURCE_ROUTES.filter(route => route.method === 'DELETE').every(route => sensitiveCall('DELETE', route.path, undefined) === 'delete'))
})

test('a dedicated Bot reads and posts in its own group after two clicks, without the Main Bot', async (t) => {
  const { as, answer, pending, notes, omni, view } = setup(t)
  const digest = as('digest')

  // Click one: read.
  const asked = await digest('omni_messages', { chat: GROUP })
  assert.match(asked.text, /^consent_required: you have no permission to read the messages of "🦞BuildWithFriends"/)
  assert.equal(asked.concluded, true)
  const [card] = await pending('digest')
  assert.deepEqual([card.kind, card.action, card.resource.type, card.resource.name], ['grant', 'read', 'group', '🦞BuildWithFriends'])
  assert.ok(card.callId, 'drawn at its call in the Bot\'s own chat')
  await answer('digest', 'always')
  assert.match(notes.at(-1).text, /^\[Omni permission card\]/)
  assert.match(notes.at(-1).text, /allowed, from now on, that you read the messages of "🦞BuildWithFriends"\. It ran; the result: .*hello from 🦞BuildWithFriends/)
  assert.match((await digest('omni_messages', { chat: GROUP })).text, /hello from 🦞BuildWithFriends/)

  // Click two: send, which runs the exact text the card showed.
  const send = await digest('omni_send', { chat: GROUP, text: 'Bom dia! Resumo de ontem…' })
  assert.match(send.text, /^consent_required/)
  assert.equal((await pending('digest'))[0].preview.text, 'Bom dia! Resumo de ontem…')
  await answer('digest', 'always')
  assert.deepEqual(omni.changes.at(-1), { method: 'POST', path: '/messages/send', body: { instanceId: 'wa-1', to: '120363@g.us', text: 'Bom dia! Resumo de ontem…' } })
  // From then on, no card.
  const again = await digest('omni_send', { chat: GROUP, text: 'Resumo de hoje' })
  assert.equal(again.concluded, false)
  assert.match(again.text, /"status":200/)
  assert.equal(omni.changes.at(-1).body.text, 'Resumo de hoje')
  const grants = (await view()).omniGrants
  assert.deepEqual(grants.map(grant => [grant.botId, grant.resource.id, grant.actions, grant.approval]), [['digest', GROUP, ['read', 'send'], 'auto']])
})

test('a Bot reads no other chat without a new card, and No sends nothing', async (t) => {
  const { as, answer, pending, notes, omni } = setup(t, {
    omniGrants: [{ id: 'g1', botId: 'digest', resource: { type: 'group', id: GROUP, name: '🦞BuildWithFriends', channelId: 'wa-1' }, actions: ['read', 'send'], approval: 'auto', grantedBy: 'user', createdAt: 1 }],
  })
  const digest = as('digest')
  assert.match((await digest('omni_messages', { chat: FAMILY })).text, /^consent_required: you have no permission to read the messages of "Family"/)
  await answer('digest', 'deny')
  assert.match(notes.at(-1).text, /The user said no: you may not read the messages of "Family"/)
  assert.match((await digest('omni_send', { chat: FAMILY, text: 'oi' })).text, /^consent_required/)
  await answer('digest', 'deny')
  assert.deepEqual(omni.changes, [])
  assert.equal((await pending('digest')).length, 0)
  // Its chat list names chats, but not what was said in them.
  const list = JSON.parse((await digest('omni_chats', {})).text)
  assert.ok(list.data.items.every(item => item.preview === undefined))
  assert.ok(JSON.parse((await as('m1')('omni_chats', {})).text).data.items.some(item => item.preview === 'ship it'))
})

test('sending as the user to a person asks every time, grant or not, Main Bot included; their own chat does not', async (t) => {
  const { as, answer, pending, omni, call } = setup(t, {
    omniGrants: [
      { id: 'g1', botId: 'digest', resource: { type: 'chat', id: PERSON, name: 'Marina', channelId: 'wa-1' }, actions: ['send'], approval: 'auto', grantedBy: 'user', createdAt: 1 },
      { id: 'g2', botId: 'digest', resource: { type: 'self', id: SELF, name: 'Me', channelId: 'wa-1' }, actions: ['send'], approval: 'auto', grantedBy: 'user', createdAt: 1 },
    ],
  })
  const asked = await as('digest')('omni_send', { chat: PERSON, text: 'Oi Marina, tudo certo pra amanhã?' })
  assert.match(asked.text, /^confirmation_required: send "Oi Marina, tudo certo pra amanhã\?" to "Marina"/)
  const [card] = await pending('digest')
  assert.deepEqual([card.kind, card.resource.name, card.preview.text], ['confirm', 'Marina', 'Oi Marina, tudo certo pra amanhã?'])
  // Always is not offered for what asks every time.
  assert.equal((await call('omni-consent-answer', { id: card.id, answer: 'always' })).ok, false)
  await answer('digest', 'once')
  assert.deepEqual(omni.changes.at(-1).body, { instanceId: 'wa-1', to: '5511888887777@s.whatsapp.net', text: 'Oi Marina, tudo certo pra amanhã?' })
  // The same answer twice runs nothing twice.
  assert.equal((await call('omni-consent-answer', { id: card.id, answer: 'once' })).ok, false)
  assert.equal(omni.changes.length, 1)

  assert.equal((await as('digest')('omni_send', { chat: SELF, text: 'lembrete' })).concluded, false)
  assert.match((await as('m1')('omni_send', { chat: PERSON, text: 'oi' })).text, /^confirmation_required/)
  assert.match((await as('m1')('omni_send', { chat: GROUP, text: 'oi grupo' })).text, /"status":200/)
})

test('revoking a permission brings the card back on the next use', async (t) => {
  const { as, call, view } = setup(t, {
    omniGrants: [{ id: 'g1', botId: 'digest', resource: { type: 'group', id: GROUP, name: '🦞BuildWithFriends', channelId: 'wa-1' }, actions: ['read'], approval: 'auto', grantedBy: 'user', createdAt: 1 }],
  })
  const digest = as('digest')
  assert.match((await digest('omni_messages', { chat: GROUP })).text, /hello from/)
  assert.equal((await call('omni-grant-approval', { id: 'g1', approval: 'confirm' })).ok, true)
  assert.match((await digest('omni_messages', { chat: GROUP })).text, /^confirmation_required/)
  assert.equal((await call('omni-grant-revoke', { id: 'g1' })).ok, true)
  assert.deepEqual((await view()).omniGrants, [])
  assert.match((await digest('omni_messages', { chat: GROUP })).text, /^consent_required/)
})

test('deleting always asks and shows the message; the Main Bot\'s omni_call deletes and sends to people ask too', async (t) => {
  const { as, answer, pending, omni } = setup(t, {
    omniGrants: [{ id: 'g1', botId: 'digest', resource: { type: 'group', id: GROUP, name: '🦞BuildWithFriends', channelId: 'wa-1' }, actions: ['read', 'send', 'delete'], approval: 'auto', grantedBy: 'user', createdAt: 1 }],
  })
  const asked = await as('digest')('omni_delete', { chat: GROUP, message: OLD })
  assert.match(asked.text, /^confirmation_required: delete a message in "🦞BuildWithFriends" needs/)
  assert.doesNotMatch(asked.text, /wrong link/, 'what the message says stays on the card')
  assert.equal((await pending('digest'))[0].preview.text, 'wrong link')
  await answer('digest', 'once')
  assert.deepEqual(omni.changes.at(-1), { method: 'POST', path: '/messages/delete-channel', body: { instanceId: 'wa-1', channelId: '120363@g.us', messageId: 'WA-OLD', fromMe: true } })
  // A message of another chat is refused before anything is asked.
  assert.match((await as('digest')('omni_delete', { chat: FAMILY, message: OLD })).text, /not in this chat/)

  const main = as('m1')
  const body = { instanceId: 'wa-1', to: '5511888887777', text: 'Oi!', mediaUrl: 'https://example.com/a.jpg' }
  assert.match((await main('omni_call', { method: 'POST', path: '/messages/send', body: JSON.stringify(body) })).text, /^confirmation_required/)
  const [card] = await pending('m1')
  assert.deepEqual(card.preview, { method: 'POST', path: '/messages/send', channel: 'Pessoal', to: '5511888887777', text: 'Oi!', body: JSON.stringify(body, null, 2) })
  const before = omni.changes.length
  await answer('m1', 'once')
  assert.deepEqual(omni.changes.slice(before), [{ method: 'POST', path: '/messages/send', body }])
  // A call too long to show whole is not asked about, and does not run.
  const long = await main('omni_call', { method: 'POST', path: '/messages/send', body: JSON.stringify({ instanceId: 'wa-1', to: '5511888887777', text: 'x'.repeat(13_000) }) })
  assert.match(long.text, /too long to show the user on a card/)
  assert.equal(omni.changes.length, before + 1)
})

test('opening media saves the file for the Bot to read', async (t) => {
  const { as, answer, notes, home } = setup(t)
  assert.match((await as('digest')('omni_media', { chat: GROUP, message: PHOTO })).text, /^consent_required: you have no permission to open a media file in "🦞BuildWithFriends"/)
  await answer('digest', 'once')
  const path = /"path":"([^"]+)"/.exec(notes.at(-1).text)?.[1]
  assert.ok(path?.startsWith(join(home, 'media', 'digest')), `${path} | ${notes.at(-1).text.slice(0, 300)}`)
  assert.deepEqual([...readFileSync(path)], [0xff, 0xd8, 0xff])
})

test('opening media refuses a stored path that climbs out of /media, asking no other route', async (t) => {
  const { as, answer, notes, home, omni } = setup(t, {}, { mediaPath: '../keys/x' })
  await as('digest')('omni_media', { chat: GROUP, message: PHOTO })
  await answer('digest', 'once')
  assert.match(notes.at(-1).text, /omni named a file outside its media/)
  assert.ok(!omni.reads.some(path => path.startsWith('/keys') || path.startsWith('/media')), omni.reads.join(' '))
  assert.equal(existsSync(join(home, 'media', 'digest')), false)
})

test("an automation run's Main Bot only reads; another Bot's run asks before anything else, and asks in its own chat", async (t) => {
  const { as, pending } = setup(t, {
    subscriptionRuns: [{ sessionId: 'run-1', botId: 'm1', task: 'x' }, { sessionId: 'run-2', botId: 'digest', task: 'y' }, { sessionId: 'digest', botId: 'digest', task: 'z' }],
    omniGrants: [{ id: 'g1', botId: 'digest', resource: { type: 'group', id: GROUP, name: '🦞BuildWithFriends', channelId: 'wa-1' }, actions: ['read', 'send'], approval: 'auto', grantedBy: 'user', createdAt: 1 }],
  })
  assert.match((await as('run-1')('omni_send', { chat: GROUP, text: 'x' })).text, /only reads omni/)
  assert.match((await as('run-2')('omni_messages', { chat: GROUP })).text, /hello from/)
  const asked = await as('run-2')('omni_send', { chat: GROUP, text: 'post this' })
  assert.match(asked.text, /^confirmation_required: .* asked on a card in your own chat/)
  const [card] = await pending('digest')
  assert.equal(card.callId, undefined, 'not drawn at the call: the dock of the Bot\'s chat carries it')
  // The Bot's own chat is not an event run, even where an automation once ran in it.
  assert.equal((await as('digest')('omni_send', { chat: GROUP, text: 'ok' })).concluded, false)
})

test('Bots other than an Omni Bot or a Main Bot get none of their omni tools', async (t) => {
  const { as } = setup(t)
  for (const [name, args] of [['omni_call', { method: 'GET', path: '/chats' }], ['omni_endpoints', { search: 'send' }], ['omni_channels', {}], ['omni_connect', { channel: 'wa-1' }]]) {
    assert.match((await as('digest')(name, args)).text, /Only an Omni Bot or a Main Bot/, name)
  }
})

test('an Omni Bot that is not a Main Bot operates all of Omni, as a Main Bot does', async (t) => {
  const { as, pending } = setup(t, {
    bots: {
      m1: { id: 'm1', name: 'Sage', role: 'Orchestrator', instructions: '', createdAt: 1 },
      keeper: { id: 'keeper', name: 'Channel keeper', role: 'Omni', kind: 'omni', instructions: '', createdAt: 2 },
      digest: { id: 'digest', name: 'Digest', role: 'Digest', instructions: '', createdAt: 3 },
    },
  })
  const keeper = as('keeper')
  for (const [name, args] of [['omni_call', { method: 'GET', path: '/chats' }], ['omni_endpoints', { search: 'send' }], ['omni_channels', {}]]) {
    assert.doesNotMatch((await keeper(name, args)).text, /Only an Omni Bot or a Main Bot/, name)
  }
  // No grant card: it reads and posts in a group straight away, and sees each chat's last message.
  const read = await keeper('omni_messages', { chat: GROUP })
  assert.equal(read.concluded, false)
  assert.match(read.text, /hello from 🦞BuildWithFriends/)
  assert.equal((await keeper('omni_send', { chat: GROUP, text: 'ok' })).concluded, false)
  assert.deepEqual(await pending('keeper'), [])
  assert.match((await keeper('omni_chats', {})).text, /"preview"/)
  assert.doesNotMatch((await as('digest')('omni_chats', {})).text, /"preview"/)
  // Sending as the user to a person still asks, as it does for a Main Bot.
  assert.match((await keeper('omni_send', { chat: PERSON, text: 'oi' })).text, /^confirmation_required/)
})

test('a broadcast list is people: sending there confirms every time', async (t) => {
  const { as, pending } = setup(t, {
    omniGrants: [{ id: 'g1', botId: 'digest', resource: { type: 'chat', id: LIST, name: 'Clientes', channelId: 'wa-1' }, actions: ['send'], approval: 'auto', grantedBy: 'user', createdAt: 1 }],
  })
  assert.match((await as('digest')('omni_send', { chat: LIST, text: 'promo' })).text, /^confirmation_required/)
  assert.equal((await pending('digest'))[0].resource.type, 'chat')
})

test('Always on the whole channel covers its other chats; limit is kept', async (t) => {
  const { as, answer, view } = setup(t)
  const digest = as('digest')
  assert.match((await digest('omni_messages', { chat: GROUP, limit: 3 })).text, /^consent_required/)
  const card = await answer('digest', 'channel')
  assert.equal(card.call.args.limit, 3)
  const [grant] = (await view()).omniGrants
  assert.deepEqual([grant.resource.type, grant.resource.id, grant.resource.name, grant.actions], ['channel', 'wa-1', 'Pessoal', ['read']])
  assert.match((await digest('omni_messages', { chat: FAMILY })).text, /hello from Family/)
})

test('a card answered just before a restart is settled as interrupted, and its Bot is told', async (t) => {
  const running = { id: 'c1', sessionId: 'digest', botId: 'digest', kind: 'grant', action: 'send', resource: { type: 'group', id: GROUP, name: '🦞BuildWithFriends' }, call: { tool: 'omni_send', args: {} }, preview: { text: 'x' }, status: 'running', askedAt: 1 }
  const { view, notes } = setup(t, { omniConsents: { digest: [running] } })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal((await view()).omniConsents.digest[0].status, 'interrupted')
  assert.match(notes.at(-1).text, /restarted while it ran what the user allowed: send "x" to "🦞BuildWithFriends"\. It may or may not have happened/)
})
