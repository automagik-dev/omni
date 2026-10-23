import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canSend, canWrite, omniActions, omniStore } from '../src/client/omni-store.js'

const fresh = omniStore.getSnapshot()
const CHANNEL = { id: 'ch-1', type: 'whatsapp-baileys', name: 'Sales', detail: '+55', status: 'connected', answeredBy: 'You', health: { lastEventAt: null } }
const CHAT = { id: 'chat-1', channelId: 'ch-1', name: 'Marina', initials: 'MA', preview: 'Oi', at: 1, unread: 0 }

// A page linked to an Omni, with what its key may do.
const live = (abilities = { changeChannels: true, send: true }) => omniStore.set({
  ...fresh, preview: false, source: { kind: 'live', origin: 'omni.example.com' }, abilities,
  channels: [CHANNEL], chats: [CHAT], messages: { 'chat-1': [] }, chatId: 'chat-1', sendError: null,
})
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

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
