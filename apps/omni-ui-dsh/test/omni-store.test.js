import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CHANNELS_PANEL, CHAT_PANEL, CHANNEL_TYPES, SUBS_PANEL, emptyDraft, guessDraft, healthSummary, omniActions, omniStore, subOf, subsActions, unreadOf, visibleChats, waitingRuns,
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

test('describing a subscription drafts its trigger, sources, and reply', () => {
  reset()
  const state = omniStore.getSnapshot()
  const react = guessDraft('React 📌 on Grupo Obras and send it to me', state)
  assert.deepEqual(react.trigger, { kind: 'reaction', emoji: '📌' })
  assert.deepEqual(react.sources.map(source => source.id), ['c-obras'])
  assert.equal(react.outputs.replyToMe, true)
  assert.deepEqual(guessDraft('every voice note in my notes', state).trigger, { kind: 'voice' })
  assert.deepEqual(guessDraft('when #ci-alerts says "red build"', state).trigger, { kind: 'keyword', words: ['red build'] })
})

test('a subscription needs a source to save, and saving opens it', () => {
  reset()
  const selected = []
  const subs = subsActions(id => selected.push(id))
  subs.openSubs('edit')
  assert.deepEqual(omniStore.getSnapshot().subs.draft, emptyDraft())
  assert.deepEqual(selected, [SUBS_PANEL])
  subs.save()
  assert.equal(omniStore.getSnapshot().subs.view, 'edit')
  subs.editDraft({ name: ' Pins ', sources: [{ kind: 'chat', id: 'c-obras', name: 'Grupo Obras', type: 'whatsapp-baileys', chatKind: 'group' }] })
  subs.save()
  const state = omniStore.getSnapshot()
  assert.equal(state.subs.view, 'detail')
  assert.equal(subOf(state, state.subs.id).name, 'Pins')
  assert.equal(state.subscriptions.length, fresh.subscriptions.length + 1)
})

test('editing keeps the subscription id, and approving or declining settles a waiting run', () => {
  reset()
  const subs = subsActions(() => {})
  subs.openSubs('edit', 's-ci')
  subs.editDraft({ name: 'CI' })
  subs.save()
  assert.equal(subOf(omniStore.getSnapshot(), 's-ci').name, 'CI')
  assert.equal(omniStore.getSnapshot().subscriptions.length, fresh.subscriptions.length)
  assert.equal(waitingRuns(omniStore.getSnapshot()), 1)
  subs.approve('r1')
  assert.equal(omniStore.getSnapshot().runs.find(run => run.id === 'r1').status, 'working')
  assert.equal(waitingRuns(omniStore.getSnapshot()), 0)
  subs.toggle('s-ci')
  assert.equal(subOf(omniStore.getSnapshot(), 's-ci').on, false)
  subs.remove('s-ci')
  assert.equal(omniStore.getSnapshot().runs.some(run => run.subId === 's-ci'), false)
})
