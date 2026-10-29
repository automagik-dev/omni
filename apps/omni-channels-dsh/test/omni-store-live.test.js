import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canSend, canWrite, loadMessages, omniActions, omniStore, refreshLive } from '../src/client/omni-store.js'

const fresh = omniStore.getSnapshot()
const CHANNEL = { id: 'ch-1', type: 'whatsapp-baileys', name: 'Sales', detail: '+55', status: 'connected', answeredBy: 'You', health: { lastEventAt: null } }
const CHAT = { id: 'chat-1', channelId: 'ch-1', name: 'Marina', initials: 'MA', preview: 'Oi', at: 1, unread: 0 }

// A page linked to an Omni, with what its key may do.
const live = (abilities = { changeChannels: true, send: true }) => omniStore.set({
  ...fresh, preview: false, source: { kind: 'live', origin: 'omni.example.com' }, abilities,
  channels: [CHANNEL], chats: [CHAT], messages: { 'chat-1': [] }, chatId: 'chat-1', sendError: null,
})
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const overview = (channels = [], chats = []) => ({ configured: true, origin: 'omni.example.com', channels, chats })
const deletingState = () => {
  live()
  omniStore.set(state => ({ ...state, filter: CHANNEL.id, seen: { [CHAT.id]: 1, other: 2 }, page: { view: 'channel', channelId: CHANNEL.id }, messages: { [CHAT.id]: [{ id: 'm' }], other: [] } }))
}

test('the preview changes its sample; a linked Omni only as far as its key allows', () => {
  omniStore.set(fresh)
  assert.equal(canWrite(omniStore.getSnapshot()), true)
  assert.equal(canSend(omniStore.getSnapshot()), true)
  live({ changeChannels: false, send: true })
  assert.equal(canWrite(omniStore.getSnapshot()), false)
  assert.equal(canSend(omniStore.getSnapshot()), true)
  live({ changeChannels: true, send: false })
  assert.equal(canWrite(omniStore.getSnapshot()), true)
  assert.equal(canSend(omniStore.getSnapshot()), false)
  omniStore.set({ ...fresh, preview: false, source: { kind: 'live' } })
  assert.equal(canWrite(omniStore.getSnapshot()), false)
})

test('a live reply shows at once, goes through the host, and comes back with the chat', async () => {
  live()
  const calls = []
  const call = async (endpoint, body) => {
    calls.push([endpoint, body])
    if (endpoint === 'omni-messages') return { messages: [{ id: 'm-1', from: 'you', text: 'Oi!', at: 2 }] }
    return { sent: true }
  }
  const omni = omniActions(() => {}, call)
  omni.sendText('chat-1', '  Oi!  ')
  const shown = omniStore.getSnapshot().messages['chat-1']
  assert.equal(shown.length, 1)
  assert.equal(shown[0].sending, true)
  await settle()
  await settle()
  assert.deepEqual(calls.map(([endpoint]) => endpoint), ['omni-send', 'omni-messages'])
  assert.deepEqual(calls[0][1], { chatId: 'chat-1', text: 'Oi!' })
  assert.deepEqual(omniStore.getSnapshot().messages['chat-1'].map(message => message.id), ['m-1'])
})

test('a refused reply is taken back and says why, keeping the text to put back', async () => {
  live()
  const omni = omniActions(() => {}, async () => { throw new Error('This device\'s key can\'t send messages; ask your Omni\'s owner.') })
  omni.sendText('chat-1', 'Oi!')
  await settle()
  const state = omniStore.getSnapshot()
  assert.deepEqual(state.messages['chat-1'], [])
  assert.equal(state.chats[0].preview, 'Oi')
  assert.deepEqual(state.sendError, { chatId: 'chat-1', text: 'Oi!', message: 'This device\'s key can\'t send messages; ask your Omni\'s owner.' })
})

test('a key that cannot send sends nothing', () => {
  live({ changeChannels: true, send: false })
  const calls = []
  omniActions(() => {}, async (...args) => { calls.push(args) }).sendText('chat-1', 'Oi!')
  assert.deepEqual(calls, [])
  assert.deepEqual(omniStore.getSnapshot().messages['chat-1'], [])
})

test('pause, resume and reconnect ask the host, then read the channels again', async () => {
  live()
  const calls = []
  const overview = status => ({ configured: true, origin: 'omni.example.com', channels: [{ ...CHANNEL, status }], chats: [CHAT] })
  let next = 'paused'
  const call = async (endpoint, body) => {
    calls.push([endpoint, body])
    return endpoint === 'omni-overview' ? overview(next) : { ok: true }
  }
  const omni = omniActions(() => {}, call)
  omni.pause('ch-1')
  assert.equal(omniStore.getSnapshot().channels[0].busy, 'pause')
  for (let round = 0; round < 4; round += 1) await settle()
  assert.equal(omniStore.getSnapshot().channels[0].status, 'paused')
  assert.equal(omniStore.getSnapshot().channels[0].busy, undefined)
  next = 'connected'
  omni.resume('ch-1')
  for (let round = 0; round < 4; round += 1) await settle()
  omni.reconnect('ch-1', '123456:NEW-token')
  for (let round = 0; round < 4; round += 1) await settle()
  assert.deepEqual(calls.filter(([endpoint]) => endpoint === 'omni-channel-act').map(([, body]) => body), [
    { id: 'ch-1', action: 'pause' }, { id: 'ch-1', action: 'resume' }, { id: 'ch-1', action: 'token', token: '123456:NEW-token' },
  ])
})

test('a refused change shows on the channel', async () => {
  live()
  const omni = omniActions(() => {}, async () => { throw new Error('This device\'s key can\'t change channels; ask your Omni\'s owner.') })
  omni.pause('ch-1')
  for (let round = 0; round < 3; round += 1) await settle()
  const channel = omniStore.getSnapshot().channels[0]
  assert.equal(channel.status, 'connected')
  assert.equal(channel.actionError, 'This device\'s key can\'t change channels; ask your Omni\'s owner.')
})

test('delete waits for success, deduplicates across action objects and polls, then cleans only matching data', async () => {
  deletingState()
  const gate = deferred()
  const calls = []
  const call = async (endpoint, body) => {
    calls.push([endpoint, body])
    return endpoint === 'omni-channel-act' ? gate.promise : overview()
  }
  const omni = omniActions(() => assert.fail('must not change selected panel'), call)
  const pending = omni.deleteInstance(CHANNEL.id)
  await omniActions(() => {}, call).deleteInstance(CHANNEL.id)
  await refreshLive(async () => overview([], []))
  assert.equal(omniStore.getSnapshot().channels[0].busy, 'delete')
  assert.equal(omniStore.getSnapshot().chats.length, 1)
  assert.equal(omniStore.getSnapshot().messages[CHAT.id].length, 1)
  gate.resolve({ ok: true })
  await pending
  const state = omniStore.getSnapshot()
  assert.deepEqual(calls, [['omni-channel-act', { id: CHANNEL.id, action: 'delete' }], ['omni-overview', undefined], ['omni-link-info', undefined]])
  assert.deepEqual(state.channels, [])
  assert.deepEqual(state.chats, [])
  assert.deepEqual(state.messages, { other: [] })
  assert.deepEqual(state.seen, { other: 2 })
  assert.equal(state.filter, null)
  assert.equal(state.chatId, null)
  assert.equal(state.page.view, 'overview')
})

test('delete failure retains details, chats and caches and allows retry', async () => {
  deletingState()
  const before = omniStore.getSnapshot()
  let fail = true
  const omni = omniActions(() => {}, async endpoint => {
    if (endpoint === 'omni-channel-act') { if (fail) throw new Error('Offline'); return { ok: true } }
    return overview()
  })
  await omni.deleteInstance(CHANNEL.id)
  const after = omniStore.getSnapshot()
  assert.equal(after.channels[0].deleteError, 'Offline')
  assert.equal(after.channels[0].busy, undefined)
  for (const key of ['chats', 'messages', 'seen', 'filter', 'chatId', 'page']) assert.deepEqual(after[key], before[key])
  fail = false
  await omni.deleteInstance(CHANNEL.id)
  assert.equal(omniStore.getSnapshot().channels.length, 0)
})

test('delete cannot bypass permissions, preview, missing channel or an existing busy action', async () => {
  const calls = []
  const omni = omniActions(() => {}, async (...args) => calls.push(args))
  live({ changeChannels: false })
  await omni.deleteInstance(CHANNEL.id)
  omniStore.set(fresh)
  await omni.deleteInstance('wa-sales')
  live()
  await omni.deleteInstance('missing')
  omniStore.set(state => ({ ...state, channels: [{ ...CHANNEL, busy: 'pause' }] }))
  await omni.deleteInstance(CHANNEL.id)
  omni.remove(CHANNEL.id)
  assert.equal(omniStore.getSnapshot().channels.length, 1)
  assert.deepEqual(calls, [])
})

test('successful delete preserves navigation elsewhere and reports refresh failure separately', async () => {
  deletingState()
  const gate = deferred()
  const omni = omniActions(() => assert.fail('must not navigate'), async endpoint => {
    if (endpoint === 'omni-channel-act') return gate.promise
    throw new Error('Overview unavailable')
  })
  const pending = omni.deleteInstance(CHANNEL.id)
  const otherPage = { view: 'channel', channelId: 'other' }
  omniStore.set(state => ({ ...state, page: otherPage, chatId: 'other-chat', filter: 'other' }))
  gate.resolve({ ok: true })
  await pending
  const state = omniStore.getSnapshot()
  assert.deepEqual(state.page, otherPage)
  assert.equal(state.chatId, 'other-chat')
  assert.equal(state.filter, 'other')
  assert.equal(state.channels.length, 0)
  assert.match(state.source.error, /Instance deleted, but refresh failed: Overview unavailable/)
})

test('successful delete refresh preserves another channel detail, chat, filter and caches', async () => {
  deletingState()
  const gate = deferred()
  const otherChannel = { ...CHANNEL, id: 'other' }
  const otherChat = { ...CHAT, id: 'other-chat', channelId: 'other' }
  const omni = omniActions(() => assert.fail('must not navigate'), async endpoint => {
    if (endpoint === 'omni-channel-act') return gate.promise
    if (endpoint === 'omni-messages') return { messages: [{ id: 'other-message' }] }
    return overview([otherChannel], [otherChat])
  })
  const pending = omni.deleteInstance(CHANNEL.id)
  omniStore.set(state => ({ ...state, channels: [...state.channels, otherChannel], chats: [...state.chats, otherChat], page: { view: 'channel', channelId: 'other' }, filter: 'other', chatId: 'other-chat', seen: { ...state.seen, 'other-chat': 2 } }))
  gate.resolve({ ok: true })
  await pending
  const state = omniStore.getSnapshot()
  assert.deepEqual(state.page, { view: 'channel', channelId: 'other' })
  assert.equal(state.chatId, 'other-chat')
  assert.equal(state.filter, 'other')
  assert.deepEqual(state.seen, { other: 2, 'other-chat': 2 })
  assert.deepEqual(state.messages, { other: [], 'other-chat': [{ id: 'other-message' }] })
})

test('overview and message reads started before deletion cannot resurrect data after success', async () => {
  deletingState()
  const poll = deferred()
  const messages = deferred()
  const oldPoll = refreshLive(() => poll.promise)
  const oldMessages = loadMessages(() => messages.promise, CHAT.id)
  await omniActions(() => {}, async endpoint => endpoint === 'omni-channel-act' ? { ok: true } : overview()).deleteInstance(CHANNEL.id)
  poll.resolve(overview([CHANNEL], [CHAT]))
  messages.resolve({ messages: [{ id: 'stale' }] })
  await Promise.all([oldPoll, oldMessages])
  assert.deepEqual(omniStore.getSnapshot().channels, [])
  assert.equal(omniStore.getSnapshot().messages[CHAT.id], undefined)
})

test('the preview still changes only its sample, without the host', () => {
  omniStore.set(fresh)
  const calls = []
  const omni = omniActions(() => {}, async (...args) => { calls.push(args) })
  omni.pause('wa-sales')
  assert.equal(omniStore.getSnapshot().channels.find(channel => channel.id === 'wa-sales').status, 'paused')
  omni.sendText('c-marina', 'Oi')
  assert.deepEqual(calls, [])
  omniStore.set(fresh)
})
