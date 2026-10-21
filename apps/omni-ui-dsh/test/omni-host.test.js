import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KEY, channelOf, chatOf, initialsOf, install, messageOf, statusOf } from '../src/host/omni.js'
import { install as installHooks } from '../src/host/extend.js'

test('omni connection states fold into the four the view shows', () => {
  assert.equal(statusOf({ isActive: true }, { state: 'connected' }), 'connected')
  for (const state of ['connecting', 'qr', 'reconnecting']) assert.equal(statusOf({ isActive: true }, { state }), 'connecting')
  for (const state of ['disconnected', 'error', 'unknown']) assert.equal(statusOf({ isActive: true }, { state }), 'attention')
  assert.equal(statusOf({ isActive: true }, null), 'attention')
  assert.equal(statusOf({ isActive: false }, { state: 'connected' }), 'paused')
})

test('an instance becomes a channel with its owner number, problem, and health times', () => {
  const instance = { id: 'i1', channel: 'whatsapp-baileys', name: 'sales', isActive: true, agentId: 'a1', profileName: null, ownerIdentifier: '5511912345678:7@s.whatsapp.net', lastMessageAt: '2026-10-20T06:00:00.000Z', lastSeenAt: null, profilePicUrl: null }
  const live = channelOf(instance, { state: 'connected' })
  assert.equal(live.detail, '+5511912345678')
  assert.equal(live.status, 'connected')
  assert.equal(live.problem, undefined)
  assert.equal(live.answeredBy, 'Omni')
  assert.equal(live.health.lastEventAt, Date.parse('2026-10-20T06:00:00.000Z'))
  assert.equal(live.health.week, null)
  const broken = channelOf({ ...instance, agentId: null }, { state: 'error', message: 'Session closed' })
  assert.equal(broken.problem, 'Session closed')
  assert.equal(broken.answeredBy, 'You')
})

test('chats keep their unread count and mark previews the user sent', () => {
  const chat = chatOf({ id: 'c1', instanceId: 'i1', name: 'Marina Lopes', chatType: 'dm', lastMessagePreview: 'ok\nthanks', lastMessageFromMe: true, lastMessageAt: '2026-10-20T06:00:00.000Z', unreadCount: 3 })
  assert.deepEqual({ ...chat }, { id: 'c1', channelId: 'i1', name: 'Marina Lopes', initials: 'ML', kind: 'direct', preview: 'You: ok thanks', at: Date.parse('2026-10-20T06:00:00.000Z'), unread: 3, avatarUrl: null })
  assert.equal(chatOf({ id: 'c2', instanceId: 'i1', name: null, externalId: '5511999990000@s.whatsapp.net', chatType: 'group' }).name, '+5511999990000')
  assert.equal(initialsOf('#support'), '#')
  assert.equal(initialsOf('🦞 BuildWithFriends'), 'BU')
  assert.equal(initialsOf(''), '?')
})

test('messages say who wrote them: the contact, Omni through the API, or the user on the phone', () => {
  assert.equal(messageOf({ id: 'm', isFromMe: false, senderDisplayName: 'Ana', textContent: 'hi' }).author, 'Ana')
  assert.equal(messageOf({ id: 'm', isFromMe: true, source: 'api', textContent: 'hi' }).from, 'omni')
  assert.equal(messageOf({ id: 'm', isFromMe: true, source: 'realtime', textContent: 'hi' }).from, 'you')
  assert.equal(messageOf({ id: 'm', isFromMe: false, hasMedia: true, messageType: 'image' }).text, '[image]')
})

const runtime = ({ url, key, answers = {} }) => {
  const asked = []
  globalThis.fetch = async (address, init) => {
    asked.push({ address: String(address), key: init.headers['x-api-key'] })
    const path = String(address).replace(/^https:\/\/omni\.test\/api\/v2/, '')
    const answer = answers[path.split('?')[0]]
    if (answer === undefined) return new Response('{}', { status: 404 })
    if (typeof answer === 'number') return new Response('{}', { status: answer })
    return new Response(JSON.stringify(answer), { status: 200 })
  }
  const rt = { config: url === undefined ? {} : { omni: { url } }, ctx: { effect: run => run(), get: name => (name === 'credentials' ? { resolve: async ref => (ref === KEY && key ? { value: key } : undefined) } : undefined) } }
  installHooks(rt)
  install(rt)
  return { rt, asked }
}

test('without a URL or a key the host reports what is missing and calls nothing', async () => {
  const { rt, asked } = runtime({ url: undefined, key: undefined })
  assert.deepEqual(await rt.omniEndpoint('omni-overview', {}), { configured: false, missing: ['omni.url', KEY] })
  assert.deepEqual(asked, [])
})

test('the overview reads instances, their status, and chats with the key, and one failed status does not empty the page', async () => {
  const { rt, asked } = runtime({ url: 'https://omni.test/', key: 'omni_sk_test', answers: {
    '/instances': { items: [{ id: 'a', channel: 'slack', name: 'team', isActive: true }, { id: 'b', channel: 'telegram', name: 'bot', isActive: true }] },
    '/instances/a/status': { data: { state: 'connected' } },
    '/instances/b/status': 500,
    '/chats': { items: [{ id: 'c', instanceId: 'a', name: 'general', chatType: 'channel' }] },
  } })
  const view = await rt.omniEndpoint('omni-overview', {})
  assert.equal(view.configured, true)
  assert.equal(view.origin, 'omni.test')
  assert.deepEqual(view.channels.map(channel => channel.status), ['connected', 'attention'])
  assert.equal(view.chats[0].kind, 'group')
  assert.ok(asked.every(call => call.key === 'omni_sk_test'))
  assert.ok(asked.every(call => call.address.startsWith('https://omni.test/api/v2/')))
})

test('messages need a chat id shaped like omni ids, and a refused key says which key', async () => {
  const { rt } = runtime({ url: 'https://omni.test', key: 'omni_sk_test', answers: { '/instances': 401 } })
  await assert.rejects(rt.omniEndpoint('omni-messages', { chatId: '../keys' }), /Unknown chat/)
  await assert.rejects(rt.omniEndpoint('omni-overview', {}), new RegExp(`did not accept the key in ${KEY}`))
})
