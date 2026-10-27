import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KEY, channelOf, chatOf, initialsOf, install, messageOf, statusOf } from '../src/host/omni.js'
import { install as installHooks } from '@automagik/bots-dsh/src/host/extend.js'

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
  assert.equal(messageOf({ id: 'm', isFromMe: true, source: 'api', textContent: 'hi' }).fromMe, true)
  assert.equal(messageOf({ id: 'm', isFromMe: false, hasMedia: true, messageType: 'location' }).text, '[location]')
})

test('a media row carries its type, mime and Omni\'s text apart from the caption', () => {
  const picture = messageOf({ id: 'p', isFromMe: false, messageType: 'image', hasMedia: true, mediaMimeType: 'image/jpeg', textContent: 'look', imageDescription: 'A cat asleep on a sofa' })
  assert.deepEqual({ type: picture.type, hasMedia: picture.hasMedia, mime: picture.mime, caption: picture.caption, mediaText: picture.mediaText, text: picture.text, fromMe: picture.fromMe },
    { type: 'image', hasMedia: true, mime: 'image/jpeg', caption: 'look', mediaText: 'A cat asleep on a sofa', text: 'look', fromMe: false })
  // A captionless picture draws as the picture alone, never as "[image]".
  const bare = messageOf({ id: 'q', isFromMe: false, messageType: 'image', hasMedia: true, mediaMimeType: 'image/jpeg' })
  assert.equal(bare.text, '')
  assert.equal(bare.caption, null)
  const voice = messageOf({ id: 'v', isFromMe: false, messageType: 'audio', hasMedia: true, mediaMimeType: 'audio/ogg; codecs=opus', transcription: 'Oi, tudo bem?' })
  assert.deepEqual([voice.type, voice.mediaText, voice.text, voice.caption], ['audio', 'Oi, tudo bem?', '', null])
  // A failed processing run is no text of Omni's.
  assert.equal(messageOf({ id: 'f', messageType: 'audio', hasMedia: true, transcription: '[error: media processing failed — timeout]' }).mediaText, null)
  // A document shows by name; its extracted text does not ride every poll.
  const pdf = messageOf({ id: 'd', messageType: 'document', hasMedia: true, mediaMimeType: 'application/pdf', mediaMetadata: { fileName: 'invoice.pdf' }, documentExtraction: 'Invoice 42 …' })
  assert.deepEqual([pdf.fileName, pdf.mediaText], ['invoice.pdf', null])
  const plain = messageOf({ id: 't', isFromMe: false, messageType: 'text', textContent: 'hi', transcription: null })
  assert.deepEqual([plain.type, plain.hasMedia, plain.mime, plain.caption, plain.mediaText, plain.text], ['text', false, null, null, null, 'hi'])
})

const runtime = ({ url, key, answers = {} }) => {
  const asked = []
  globalThis.fetch = async (address, init) => {
    asked.push({ address: String(address), key: init.headers['x-api-key'], method: init.method ?? 'GET' })
    const path = String(address).replace(/^https:\/\/omni\.test\/api\/v2/, '')
    const answer = answers[path.split('?')[0]]
    if (answer === undefined) return new Response('{}', { status: 404 })
    if (typeof answer === 'number') return new Response('{}', { status: answer })
    if (typeof answer === 'function') return answer(init)
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

const MESSAGE = '0b6f3c1e-5a2d-4c8e-9f10-2a3b4c5d6e7f'
const PICTURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const mediaAnswers = (id = MESSAGE, message = {}) => ({
  [`/messages/${id}`]: { data: { id, chatId: 'c', messageType: 'image', hasMedia: true, mediaMimeType: 'image/jpeg', mediaMetadata: {}, ...message } },
  '/messages/media/download': { data: { messageId: id, mediaMimeType: 'image/jpeg', mediaLocalPath: `i1/2026-10/${id}.jpg`, cached: false } },
  [`/media/i1/2026-10/${id}.jpg`]: () => new Response(PICTURE, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
})

test('the media endpoint downloads a file once and serves the next call from its cache', async () => {
  const { rt, asked } = runtime({ url: 'https://omni.test', key: 'omni_sk_test', answers: mediaAnswers(MESSAGE, { mediaMetadata: { fileName: 'cat.jpg' } }) })
  assert.equal(rt.extended.endpointOf('omni-media').read, true)
  const first = await rt.omniMedia({ messageId: MESSAGE })
  assert.deepEqual(first, { ok: true, mime: 'image/jpeg', data: PICTURE.toString('base64'), name: 'cat.jpg' })
  assert.deepEqual(asked.map(call => `${call.method} ${call.address.replace('https://omni.test/api/v2', '')}`),
    [`GET /messages/${MESSAGE}`, 'POST /messages/media/download', `GET /media/i1/2026-10/${MESSAGE}.jpg`])
  assert.ok(asked.every(call => call.key === 'omni_sk_test'))
  // The next poll asks Omni nothing.
  assert.deepEqual(await rt.omniMedia({ messageId: MESSAGE }), first)
  assert.equal(asked.length, 3)
})

test('the media cache keeps its last 200 files', async () => {
  const ids = Array.from({ length: 201 }, (_, index) => `0b6f3c1e-5a2d-4c8e-9f10-${String(index).padStart(12, '0')}`)
  const { rt, asked } = runtime({ url: 'https://omni.test', key: 'omni_sk_test', answers: Object.assign({}, ...ids.map(id => mediaAnswers(id))) })
  for (const id of ids) assert.equal((await rt.omniMedia({ messageId: id })).ok, true)
  const before = asked.length
  await rt.omniMedia({ messageId: ids[200] })
  assert.equal(asked.length, before)
  await rt.omniMedia({ messageId: ids[0] })
  assert.equal(asked.length, before + 3)
})

test('the media endpoint refuses before any download what it cannot show', async () => {
  const unset = runtime({ url: undefined, key: undefined })
  assert.equal((await unset.rt.omniMedia({ messageId: MESSAGE })).ok, false)
  assert.deepEqual(unset.asked, [])
  const { rt, asked } = runtime({ url: 'https://omni.test', key: 'omni_sk_test', answers: mediaAnswers(MESSAGE, { hasMedia: false }) })
  await assert.rejects(rt.omniMedia({ messageId: '' }), { code: 'bot/invalid' })
  assert.deepEqual(await rt.omniMedia({ messageId: '../keys' }), { ok: false, reason: 'Unknown message' })
  assert.deepEqual(asked, [])
  const none = await rt.omniMedia({ messageId: MESSAGE })
  assert.equal(none.ok, false)
  assert.deepEqual(asked.map(call => call.method), ['GET'])
  // A stored path that climbs out of /media reaches no other route with the key.
  const climbing = runtime({ url: 'https://omni.test', key: 'omni_sk_test', answers: { ...mediaAnswers(), '/messages/media/download': { data: { mediaLocalPath: '../keys/x', mediaMimeType: 'image/jpeg' } } } })
  assert.equal((await climbing.rt.omniMedia({ messageId: MESSAGE })).ok, false)
  assert.equal(climbing.asked.length, 2)
  // Over the cache's bound, the file is refused from its stated size, unread.
  const large = runtime({ url: 'https://omni.test', key: 'omni_sk_test', answers: { ...mediaAnswers(), [`/media/i1/2026-10/${MESSAGE}.jpg`]: () => new Response(PICTURE, { status: 200, headers: { 'content-length': String(60 * 1024 * 1024) } }) } })
  assert.equal((await large.rt.omniMedia({ messageId: MESSAGE })).ok, false)
})

test('a new link or key empties the media cache', async () => {
  const { rt, asked } = runtime({ url: 'https://omni.test', key: 'omni_sk_test', answers: mediaAnswers() })
  await rt.omniMedia({ messageId: MESSAGE })
  await rt.omniMedia({ messageId: MESSAGE })
  assert.equal(asked.length, 3)
  rt.omniLink = () => ({ url: 'https://omni.test', key: 'omni_sk_other' })
  assert.equal((await rt.omniMedia({ messageId: MESSAGE })).ok, true)
  assert.equal(asked.length, 6)
  assert.equal(asked.at(-1).key, 'omni_sk_other')
  rt.omniLink = () => null
  assert.equal((await rt.omniMedia({ messageId: MESSAGE })).ok, true)
  assert.equal(asked.length, 9)
})

test('a file with no stated size is refused once it passes the bound, the rest unread', async () => {
  let pulls = 0
  const chunk = new Uint8Array(4 * 1024 * 1024)
  const endless = () => new Response(new ReadableStream({ pull(controller) { pulls += 1; controller.enqueue(chunk) } }), { status: 200 })
  const { rt } = runtime({ url: 'https://omni.test', key: 'omni_sk_test', answers: { ...mediaAnswers(), [`/media/i1/2026-10/${MESSAGE}.jpg`]: endless } })
  assert.deepEqual(await rt.omniMedia({ messageId: MESSAGE }), { ok: false, reason: 'The file is too large to show here' })
  assert.ok(pulls < 15, `read ${pulls} chunks`)
})
