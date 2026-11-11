import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boot, CHAT, ELSEWHERE, GROUP, homeFor, INSTANCE, OTHER_INSTANCE, watchedOmni, flush, saved } from './thread-fixture.js'

async function bench(t) {
  const omni = watchedOmni(t, { instanceIds: [INSTANCE, OTHER_INSTANCE] })
  const fetchOmni = globalThis.fetch
  globalThis.fetch = (address, init) => String(address).includes('/openapi.json') ? Promise.resolve(new Response(JSON.stringify({ paths: { '/automations': { post: { summary: 'Create automation' } } } }), { status: 200 })) : fetchOmni(address, init)
  const home = homeFor(t, omni)
  const presets = new Map()
  const run = await boot(t, home, { services: { permissionPresets: { catalog: () => ({ options: [{ value: 'read-only' }], defaultPreset: 'read-only' }), current: session => presets.get(session.id) ?? 'read-only', set: (session, preset) => presets.set(session.id, preset) } } })
  await flush()
  const tool = (name, args, sessionId = 'm1') => run.ctx.registeredTools.get(name).execute(args, { agent: { id: sessionId } })
  const propose = (name = 'Service', channelIds = [OTHER_INSTANCE]) => tool('propose_answer_bot', { name, channelIds }).then(JSON.parse)
  return { ...run, omni, home, tool, propose }
}

test('SC2 tool proposals do not create or move anything; owner confirmation commits once and survives restart', async t => {
  const b = await bench(t)
  const initial = Object.keys(b.team.state.bots)
  const proposal = await b.propose()
  assert.deepEqual(Object.keys(b.team.state.bots), initial)
  assert.equal(b.channels.channelOwner(OTHER_INSTANCE), 'm1')
  assert.equal(b.ctx.registeredTools.has('confirm_answer_bot'), false)
  await assert.rejects(b.call('confirm_answer_bot', { ...proposal, confirmed: true }), /unrecognized|Unrecognized/)
  const { botId } = await b.call('confirm_answer_bot', proposal)
  assert.equal(b.team.botOf(botId).kind, 'omni')
  assert.equal(b.channels.eventsBotId(), 'm1')
  assert.equal(b.channels.channelOwner(INSTANCE), 'm1')
  assert.equal(b.channels.channelOwner(OTHER_INSTANCE), botId)
  await assert.rejects(b.call('confirm_answer_bot', proposal), /already answered/)
  assert.equal(saved(b.home).omniOwnership.channels[OTHER_INSTANCE], botId)
  await b.stop()
  const again = await boot(t, b.home)
  assert.equal(again.channels.channelOwner(OTHER_INSTANCE), botId)
  assert.equal(again.channels.channelOwner(INSTANCE), 'm1')
})

test('SC2 cancellation, stale proposals and a failed save leave no bot or channel move', async t => {
  const b = await bench(t)
  const cancelled = await b.propose('Cancelled')
  await b.call('cancel_answer_bot', cancelled)
  await assert.rejects(b.call('confirm_answer_bot', cancelled), /already answered/)
  const stale = await b.propose('Stale')
  const accepted = await b.propose('Accepted')
  const { botId } = await b.call('confirm_answer_bot', accepted)
  await assert.rejects(b.call('confirm_answer_bot', stale), /ownership changed/)
  const failed = await b.propose('Failed', [INSTANCE])
  const before = Object.keys(b.team.state.bots)
  const originalSave = b.team.save
  b.team.save = async () => { throw new Error('disk full') }
  try { await assert.rejects(b.call('confirm_answer_bot', failed), /disk full/) } finally { b.team.save = originalSave }
  assert.deepEqual(Object.keys(b.team.state.bots), before)
  assert.equal(b.channels.channelOwner(INSTANCE), 'm1')
  assert.equal(b.channels.channelOwner(OTHER_INSTANCE), botId)
  assert.equal(b.team.state.omniBotProposals[failed.proposalId].status, 'pending')
})

test('SC1 channels route automations and threads to their owner; default reads but cannot mutate handed-over chats', async t => {
  const b = await bench(t)
  const { botId } = await b.call('confirm_answer_bot', await b.propose())
  for (const [actor, channel, chat] of [['m1', INSTANCE, CHAT], [botId, OTHER_INSTANCE, ELSEWHERE]]) {
    assert.match(await b.tool('save_automation', { sources: `chat:${chat}`, trigger: 'message', worker: 'me', react: false }, actor), /^Saved /)
    const sub = b.view().subscriptions.find(item => item.ownerBotId === actor)
    assert.equal(sub.sources[0].channelId, channel)
    const run = await b.channels.fireSubscription(sub, { instanceId: channel, chatId: chat, text: 'hello' })
    assert.equal(run.botId, actor)
    const made = await b.channels.threads.add(channel, chat)
    assert.equal(made.thread.ownerBotId, actor)
    assert.equal(b.view().omniThreads.find(item => item.id === made.thread.id).ownerBotId, actor)
  }
  assert.equal(b.channels.canChannel('m1', OTHER_INSTANCE, 'read'), true)
  assert.equal(b.channels.canChannel('m1', OTHER_INSTANCE, 'write'), false)
  assert.equal(b.channels.canChannel('m1', OTHER_INSTANCE, 'automate'), false)
  for (const [tool, args] of [['omni_send', { chat: ELSEWHERE, text: 'wrong' }], ['omni_react', { chat: ELSEWHERE, message: '6a1b2c3d-5555-4a5b-8c6d-7e8f9a0b1c05', emoji: '👍' }], ['omni_delete', { chat: ELSEWHERE, message: '6a1b2c3d-5555-4a5b-8c6d-7e8f9a0b1c05' }]]) {
    assert.match(await b.tool(tool, args), /no authority/)
  }
  assert.match(await b.tool('omni_messages', { chat: ELSEWHERE }), /200/)
  assert.match(await b.tool('save_automation', { sources: `channel:${OTHER_INSTANCE}`, trigger: 'message' }), /only channels you own/)
  assert.match(await b.tool('create_thread', { chats: [{ channelId: INSTANCE, chatId: GROUP }], title: 'Wrong', notes: '' }, botId), /only on channels you own/)
  assert.match(await b.tool('omni_send', { chat: CHAT, text: 'wrong' }, botId), /no authority/)
  assert.equal(b.omni.sent.length, 0)
})

test('SC1 raw-call quiet writes, encoded paths, global changes and pending approvals cannot bypass ownership', async t => {
  const b = await bench(t)
  assert.match(await b.tool('omni_send', { chat: ELSEWHERE, text: 'pending' }), /confirmation_required/)
  const pending = b.team.state.omniConsents.m1.at(-1)
  const { botId } = await b.call('confirm_answer_bot', await b.propose())
  await assert.rejects(b.call('omni-consent-answer', { id: pending.id, answer: 'once' }), /no authority/)
  for (const args of [
    { method: 'POST', path: '/messages/send', body: JSON.stringify({ instanceId: OTHER_INSTANCE, to: 'x@g.us', text: 'wrong' }) },
    { method: 'POST', path: `/instances/${OTHER_INSTANCE}/connect` },
    { method: 'POST', path: '/automations', body: JSON.stringify({ instanceId: INSTANCE }) },
  ]) assert.match(await b.tool('omni_call', args), /belongs to another bot|cannot be scoped/)
  assert.match(await b.channels.omniRawOwnership('m1', 'POST', `/instances/%2e%2e/instances/${OTHER_INSTANCE}/connect`, {}), /another bot/)
  assert.match(await b.channels.omniRawOwnership(botId, 'POST', `/instances/${INSTANCE}/connect`, {}), /another bot/)
  assert.equal(b.omni.sent.length, 0)
})

test('SC2 transfers reject split multi-channel threads and support handing a channel to an existing dedicated bot', async t => {
  const b = await bench(t)
  const result = await b.channels.threads.create([{ channelId: INSTANCE, chatId: CHAT }, { channelId: OTHER_INSTANCE, chatId: ELSEWHERE }], 'Together', '')
  assert.equal(result.ok, true)
  const partial = await b.propose()
  await assert.rejects(b.call('confirm_answer_bot', partial), /split thread/)
  assert.equal(Object.keys(b.team.state.bots).length, 1)
  const { botId } = await b.call('confirm_answer_bot', await b.propose('Together owner', [INSTANCE, OTHER_INSTANCE]))
  assert.equal(result.thread.ownerBotId, botId)
  assert.equal(b.channels.channelOwner(INSTANCE), botId)
  await b.channels.threads.remove(result.thread.id)
  const back = await b.propose('Omni', [INSTANCE])
  const returned = await b.call('confirm_answer_bot', back)
  assert.equal(returned.botId, 'm1')
  assert.equal(b.channels.channelOwner(INSTANCE), 'm1')
  assert.equal(Object.keys(b.team.state.bots).length, 2)
})

test('SC1 a run waiting for its session cannot dispatch after the channel changes owner', async t => {
  const b = await bench(t)
  assert.match(await b.tool('save_automation', { sources: `channel:${OTHER_INSTANCE}`, trigger: 'message', worker: 'me', react: false }), /^Saved /)
  const sub = b.team.state.subscriptions[b.view().subscriptions[0].id]
  const proposal = await b.propose()
  const create = b.channels.createSession
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const barrier = new Promise(resolve => { release = resolve })
  let first = true
  b.channels.createSession = async (...args) => {
    if (first) { first = false; entered(); await barrier }
    return create(...args)
  }
  const pending = b.channels.fireSubscription(sub, { instanceId: OTHER_INSTANCE, chatId: ELSEWHERE, text: 'waiting' })
  await started
  const { botId } = await b.call('confirm_answer_bot', proposal)
  release()
  const result = await pending
  assert.equal(result.status, 'failed')
  assert.match(result.summary, /ownership changed/)
  assert.equal(b.agentOf(result.sessionId).calls.length, 0)
  assert.equal(b.channels.channelOwner(OTHER_INSTANCE), botId)
})

test('SC1 queued events are cancelled at hand-over and the old automation record cannot dispatch', async t => {
  const b = await bench(t)
  assert.match(await b.tool('save_automation', { sources: `chat:${ELSEWHERE}`, trigger: 'message', worker: 'thread', react: false }), /^Saved /)
  const sub = b.team.state.subscriptions[b.view().subscriptions[0].id]
  const thread = b.channels.threads.byChat(ELSEWHERE)
  await b.channels.subscriptionEndpoint('automation-set-on', { id: sub.id, on: false })
  const queued = await b.channels.standingRuns.enqueue({ kind: 'thread', id: thread.id }, sub, { instanceId: OTHER_INSTANCE, chatId: ELSEWHERE, text: 'queued' })
  assert.equal(queued.status, 'queued')
  const { botId } = await b.call('confirm_answer_bot', await b.propose())
  assert.equal(queued.status, 'failed')
  assert.match(queued.summary, /ownership changed/)
  await assert.rejects(b.channels.fireSubscription(sub, { instanceId: OTHER_INSTANCE, chatId: ELSEWHERE }), /ownership changed/)
  assert.equal(thread.ownerBotId, botId)
  assert.equal(b.agentOf(thread.sessionId).calls.length, 0)
})
