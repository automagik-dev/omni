import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CHANNELS_PANEL, CHAT_PANEL, CHANNEL_TYPES, healthSummary, omniActions, omniStore, runsOf, unreadOf, visibleChats, waitingRuns,
} from '../src/client/omni-store.js'

const fresh = omniStore.getSnapshot()
const reset = () => omniStore.set(fresh)

test('every sample channel and chat names a known type and channel', () => {
  const state = omniStore.getSnapshot()
  for (const channel of state.channels) assert.ok(CHANNEL_TYPES[channel.type], channel.type)
  for (const chat of state.chats) assert.ok(state.channels.some(channel => channel.id === chat.channelId), chat.id)
})

test('the Chats section lists the newest chat first and filters by channel', () => {
  reset()
  const all = visibleChats(omniStore.getSnapshot())
  assert.deepEqual(all.map(chat => chat.at), all.map(chat => chat.at).toSorted((a, b) => b - a))
  const selected = []
  const omni = omniActions(id => selected.push(id))
  omni.setFilter('slack-namastex')
  const slack = visibleChats(omniStore.getSnapshot())
  assert.ok(slack.length > 0)
  assert.ok(slack.every(chat => chat.channelId === 'slack-namastex'))
  assert.deepEqual(selected, [])
})

test('opening a chat clears its unread count and selects the chat panel', () => {
  reset()
  const selected = []
  const omni = omniActions(id => selected.push(id))
  const before = unreadOf(omniStore.getSnapshot(), 'wa-sales')
  omni.openChat('c-marina')
  const state = omniStore.getSnapshot()
  assert.equal(state.chatId, 'c-marina')
  assert.equal(state.chats.find(chat => chat.id === 'c-marina').unread, 0)
  assert.equal(unreadOf(state, 'wa-sales'), before - 2)
  assert.deepEqual(selected, [CHAT_PANEL])
})

test('a sent reply lands in the chat and becomes its preview; blank text sends nothing', () => {
  reset()
  const omni = omniActions(() => {})
  omni.sendText('c-marina', '   ')
  assert.equal(omniStore.getSnapshot().messages['c-marina'].length, fresh.messages['c-marina'].length)
  omni.sendText('c-marina', ' Segue o orçamento ')
  const state = omniStore.getSnapshot()
  assert.equal(state.messages['c-marina'].at(-1).text, 'Segue o orçamento')
  assert.equal(state.messages['c-marina'].at(-1).from, 'you')
  assert.equal(state.chats.find(chat => chat.id === 'c-marina').preview, 'You: Segue o orçamento')
})

test('health counts connected channels and the ones that need the user', () => {
  reset()
  assert.deepEqual(healthSummary(omniStore.getSnapshot()), { total: 4, connected: 3, attention: 1, messagesToday: 199 })
  omniActions(() => {}).pause('wa-personal')
  assert.equal(healthSummary(omniStore.getSnapshot()).connected, 2)
})

test('the Channels page opens on the asked view, and disconnecting drops the channel, its chats, and a filter on it', () => {
  reset()
  const selected = []
  const omni = omniActions(id => selected.push(id))
  omni.openChannels('channel', 'tg-helper')
  assert.deepEqual(omniStore.getSnapshot().page, { view: 'channel', channelId: 'tg-helper', type: null, step: 0 })
  assert.deepEqual(selected, [CHANNELS_PANEL])
  omni.setFilter('tg-helper')
  omni.remove('tg-helper')
  const state = omniStore.getSnapshot()
  assert.equal(state.channels.some(channel => channel.id === 'tg-helper'), false)
  assert.equal(state.chats.some(chat => chat.channelId === 'tg-helper'), false)
  assert.equal(state.filter, null)
  assert.equal(state.page.view, 'overview')
})

test('finishing the connect flow adds a connected channel and shows its health', () => {
  reset()
  omniActions(() => {}).finishConnect('telegram', 'Support')
  const state = omniStore.getSnapshot()
  const added = state.channels.at(-1)
  assert.equal(added.type, 'telegram')
  assert.equal(added.name, 'Support')
  assert.equal(added.status, 'connected')
  assert.deepEqual(state.page, { view: 'channel', channelId: added.id, type: null, step: 0 })
})

test('runs come from the team view, newest first; a working run waits while its Session has an approval open', () => {
  const roster = { subscriptionRuns: [{ id: 'a', subId: 's', at: 1, status: 'done', sessionId: 'x' }, { id: 'b', subId: 's', at: 3, status: 'working', sessionId: 'y' }, { id: 'c', subId: 't', at: 2, status: 'working', sessionId: 'z' }] }
  assert.deepEqual(runsOf(roster).map(run => run.id), ['b', 'c', 'a'])
  assert.deepEqual(runsOf(roster, 's').map(run => run.id), ['b', 'a'])
  assert.equal(waitingRuns(roster, new Set(['y', 'x'])), 1, 'a finished run no longer waits')
  assert.equal(waitingRuns(roster), 0)
  assert.equal(waitingRuns({}), 0)
})

test('a scheduled task\'s timing reads as words on the Automations page', async () => {
  const { whenText } = await import('../src/client/automation-time.js')
  assert.equal(whenText({ kind: 'every', everySeconds: 3600 }), 'Every hour')
  assert.equal(whenText({ kind: 'every', everySeconds: 7200 }), 'Every 2 hours')
  assert.equal(whenText({ kind: 'every', everySeconds: 900 }), 'Every 15 min')
  assert.equal(whenText({ kind: 'daily', time: '09:00' }), 'Every day at 09:00')
  assert.equal(whenText({ kind: 'weekly', time: '09:00', weekdays: [5, 1, 2, 3, 4] }), 'Weekdays at 09:00')
  assert.equal(whenText({ kind: 'weekly', time: '18:30', weekdays: [1, 3] }), 'Mon, Wed at 18:30')
  assert.equal(whenText({ kind: 'cron', expression: '0 9 * * 1' }), 'Custom (0 9 * * 1)')
})
