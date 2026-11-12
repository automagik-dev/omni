// RFC-0001 SC6: an answer child's training and sending, through the answer bot's own queued
// run (subscriptions.js answer admission, standing-runs.js) and DSH's tool pipeline as
// dsh-tools runs it: tools/pre-execute, the approval/request waterfall ending in DSH's card,
// the guards, then the tool body, all carrying one call id. The answer run asks first for
// everything else; a child's own-chat send follows only its sending mode.
//
// DSH's approval outcomes are allowed-once, rejected, cancelled and unavailable, and a
// pre-execute gate cannot rewrite a call's arguments, so a live card never edits a draft. An
// edited draft (sent text differs from the approved one) is proven at rt.recordAnswerDraft.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { answerBench, ANSWER_MASTER, CHAT, CHATS, GROUP, guarded, MESSAGE_IDS, preExecute, resetFetch, restart, signal, until } from './thread-fixture.js'

afterEach(resetFetch)

let calls = 0
// One thread_say through DSH's pipeline in the child's Session; `answer` is staff's answer on
// the card, when one shows. `callId` is DSH's call identity, passed to the card and the body.
async function say(b, child, text, { answer = 'allowed-once', callId = `call-${(calls += 1)}`, chatId } = {}) {
  const agent = b.agentOf(child.sessionId)
  const args = { text, ...(chatId ? { chatId } : {}) }
  const exec = { name: 'thread_say', arguments: args, agent, callId }
  const gates = [...(b.ctx.listeners.get('tools/pre-execute') ?? [])]
  const gate = index => (index < gates.length ? gates[index](exec, () => gate(index + 1)) : Promise.resolve({ kind: 'allow' }))
  const decision = await gate(0)
  let card = false
  if (decision.kind === 'ask') {
    const approvals = [...(b.ctx.listeners.get('approval/request') ?? [])].reverse()
    const request = { agent, toolName: 'thread_say', callId, reason: decision.reason }
    const step = index => (index < approvals.length ? Promise.resolve(approvals[index](request, () => step(index + 1))) : Promise.resolve().then(() => { card = true; return answer }))
    if (await step(0) !== 'allowed-once') return { card, decision, callId, result: null }
  } else if (decision.kind !== 'allow') {
    return { card, decision, callId, result: null }
  }
  const refused = guarded(b.ctx, child.sessionId, 'thread_say')
  if (refused !== undefined) return { card, decision, callId, result: `Error: ${refused}` }
  return { card, decision, callId, result: await b.ctx.registeredTools.get('thread_say').execute(args, { agent, callId }) }
}
// The child's queued answer run, handed over and in its tagged turn, which asks first.
async function answering(t, b, settings = {}) {
  if (Object.keys(settings).length) await b.call('omni-answer-settings', { ...b.settings, ...settings })
  const sub = b.team.state.subscriptions[`answer:${ANSWER_MASTER}`]
  await b.channels.fireSubscription(sub, b.incoming())
  await signal(t, b)
  const child = b.channels.threads.byChat(CHAT)
  await until(() => b.agentOf(child.sessionId).calls.length === 1)
  const message = b.agentOf(child.sessionId).calls[0]
  b.emit(child.sessionId, 'turn/start', { turn: 1 }, Date.now())
  b.emit(child.sessionId, 'user/message', { content: message.content, source: message.source })
  assert.equal(b.channels.standingRuns.asksFirst(child.sessionId), true, 'the answer run asks first')
  return child
}
const stateOf = (b, child) => {
  const row = b.view().omniThreads.find(item => item.id === child.id)
  return [row.sendingMode, row.approvedStreak]
}

test('SC6 a new child asks before every send; staff switching it to sending removes only that ask', async t => {
  const b = await answerBench(t)
  // The owner's global default lets ordinary threads send; it never skips a child's training.
  await b.call('omni-thread-defaults-save', { threadSends: 'allow' })
  const child = await answering(t, b)
  assert.equal(child.sendingMode, 'training')
  for (const text of ['Hi! Let me check your order.', 'It ships tomorrow.']) {
    const sent = await say(b, child, text)
    assert.equal(sent.card, true, text)
    assert.match(sent.decision.reason, new RegExp(`^Send into "Marina" as you\\?\\n\\n${text}`))
    assert.match(sent.result, /^Sent into the chat/)
  }
  assert.equal((await say(b, child, 'Not this one.', { answer: 'rejected' })).result, null)
  assert.equal(b.omni.sent.length, 2)

  assert.deepEqual(await b.call('set_child_sending', { threadId: child.id, mode: 'sending' }), { threadId: child.id, sendingMode: 'sending', approvedStreak: 0 })
  assert.deepEqual(stateOf(b, child), ['sending', 0])
  // Sending: no card, although the answer run still asks first for everything else.
  const free = await say(b, child, 'Your tracking code is on its way.')
  assert.equal(free.card, false)
  assert.equal(free.decision.kind, 'allow')
  assert.match(free.result, /^Sent into the chat/)
  assert.equal(b.channels.standingRuns.asksFirst(child.sessionId), true)
  assert.deepEqual(b.omni.sent.at(-1).body, { instanceId: CHATS[CHAT].instanceId, to: CHATS[CHAT].externalId, text: 'Your tracking code is on its way.' })
  // Unrelated outcomes stand: a later gate's ask or deny, the chat lock, reactions, the preset.
  assert.equal((await preExecute(b, 'thread_say', child.sessionId, { text: 'x' }, { kind: 'ask', reason: 'an ask rule' })).kind, 'ask')
  assert.deepEqual(await preExecute(b, 'thread_say', child.sessionId, { text: 'x' }, { kind: 'deny', reason: 'a deny rule' }), { kind: 'deny', reason: 'a deny rule' })
  assert.equal((await say(b, child, 'Elsewhere.', { chatId: GROUP })).decision.kind, 'deny')
  assert.equal((await preExecute(b, 'thread_react', child.sessionId, { messageId: MESSAGE_IDS.text, emoji: '🎉' })).kind, 'ask')
  for (const name of ['shell', 'write', 'omni_send', 'thread_ask_omni']) assert.equal((await preExecute(b, name, child.sessionId, { text: 'x' })).kind, 'deny', name)
  assert.equal(b.presets.current(b.agentOf(child.sessionId).session), 'read-only')
  assert.equal(b.omni.sent.length, 3)
  const prompt = () => b.ctx.sections.get('omni-thread').text({ agent: { id: child.sessionId } })
  assert.match(prompt(), /send in your own chat without asking first/)

  // Back to training: the ask returns and the streak starts over.
  await b.call('set_child_sending', { threadId: child.id, mode: 'training' })
  assert.equal((await say(b, child, 'Back to asking.')).card, true)
  assert.match(prompt(), /You are in training/)
  await assert.rejects(b.call('set_child_sending', { threadId: child.id, mode: 'auto' }))
  await assert.rejects(b.call('set_child_sending', { threadId: child.id, mode: 'sending', by: 'model' }))
})

test('SC6 N approved unchanged drafts in a row graduate a child; N-1 do not', async t => {
  const b = await answerBench(t)
  const events = []
  b.ctx.on('omni/answer-sending', event => events.push(event))
  const child = await answering(t, b, { graduateAfter: 3 })
  for (const text of ['One.', 'Two.']) assert.equal((await say(b, child, text)).card, true)
  assert.deepEqual(stateOf(b, child), ['training', 2])
  assert.deepEqual(events, [])
  assert.equal((await say(b, child, 'Three.')).card, true)
  assert.deepEqual(stateOf(b, child), ['sending', 3])
  assert.deepEqual(events, [{ threadId: child.id, botId: ANSWER_MASTER, mode: 'sending', cause: 'graduation' }])
  assert.equal((await say(b, child, 'Four, without a card.')).card, false)
  assert.equal(b.omni.sent.length, 4)
})

test('SC6 with graduation off (the default) any number of approved drafts never changes the mode', async t => {
  const off = await answerBench(t)
  const trainee = await answering(t, off)
  assert.equal(off.view().omniAnswers[ANSWER_MASTER].graduateAfter, null)
  for (let index = 0; index < 6; index += 1) assert.equal((await say(off, trainee, `Draft ${index}.`)).card, true)
  assert.deepEqual(stateOf(off, trainee), ['training', 6])
})

test('SC6 a rejected or edited draft ends the streak; cancelled, unavailable and failed sends count for nothing', async t => {
  const b = await answerBench(t)
  const child = await answering(t, b, { graduateAfter: 3 })
  await say(b, child, 'One.')
  await say(b, child, 'Two.')
  assert.deepEqual(stateOf(b, child), ['training', 2])
  assert.equal((await say(b, child, 'Rejected.', { answer: 'rejected' })).card, true)
  assert.deepEqual(stateOf(b, child), ['training', 0])
  await say(b, child, 'One again.')
  await say(b, child, 'Two again.')
  for (const answer of ['cancelled', 'unavailable']) assert.equal((await say(b, child, `${answer}.`, { answer })).result, null)
  assert.deepEqual(stateOf(b, child), ['training', 2])
  // A send Omni refuses was approved but never went out.
  const real = globalThis.fetch
  globalThis.fetch = async (address, init) => (String(address).endsWith('/messages/send') ? new Response('{}', { status: 500 }) : real(address, init))
  assert.match((await say(b, child, 'Omni is down.')).result, /^Not sent/)
  globalThis.fetch = real
  assert.deepEqual(stateOf(b, child), ['training', 2])
  // Edited: what went out differs from what staff approved.
  assert.deepEqual(await b.channels.recordAnswerDraft({ threadId: child.id, draftId: 'edited-1', approvedText: 'As approved.', sentText: 'As changed.', outcome: 'sent' }), { counted: true, sendingMode: 'training', approvedStreak: 0 })
  await say(b, child, 'One.')
  await say(b, child, 'Two.')
  assert.deepEqual((await b.channels.recordAnswerDraft({ threadId: child.id, draftId: 'edited-2', approvedText: 'Same.', sentText: 'Same.', outcome: 'edited' })).approvedStreak, 0)
  for (const text of ['A.', 'B.', 'C.']) await say(b, child, text)
  assert.deepEqual(stateOf(b, child), ['sending', 3])
  await assert.rejects(b.channels.recordAnswerDraft({ threadId: child.id, draftId: 'x', approvedText: 'a', sentText: 'a', outcome: 'approved' }))
})

test('SC6 a retried send and a replayed approval of one draft count once, also after a restart', async t => {
  const b = await answerBench(t)
  const child = await answering(t, b, { graduateAfter: 2 })
  const first = await say(b, child, 'Only once.', { callId: 'call-retried' })
  assert.equal(first.card, true)
  assert.deepEqual(stateOf(b, child), ['training', 1])
  // DSH replays the approval and retries the body under the same call id.
  const approvals = [...b.ctx.listeners.get('approval/request')].reverse()
  const request = { agent: b.agentOf(child.sessionId), toolName: 'thread_say', callId: 'call-retried', reason: first.decision.reason }
  const replay = index => (index < approvals.length ? Promise.resolve(approvals[index](request, () => replay(index + 1))) : Promise.resolve('allowed-once'))
  assert.equal(await replay(0), 'allowed-once')
  assert.match(await b.ctx.registeredTools.get('thread_say').execute({ text: 'Only once.' }, { agent: b.agentOf(child.sessionId), callId: 'call-retried' }), /^Sent into the chat/)
  assert.deepEqual(stateOf(b, child), ['training', 1])
  // The draft is kept by the host's own id for that card; recording it again counts nothing.
  const [counted] = b.channels.threads.byId(child.id).countedDrafts
  assert.equal(b.channels.threads.byId(child.id).countedDrafts.length, 1)
  assert.equal((await b.channels.recordAnswerDraft({ threadId: child.id, draftId: counted, approvedText: 'Only once.', sentText: 'Only once.', outcome: 'sent' })).counted, false)
  // A call with no identity is never counted.
  const exec = { name: 'thread_say', arguments: { text: 'No id.' }, agent: b.agentOf(child.sessionId) }
  const gates = [...b.ctx.listeners.get('tools/pre-execute')]
  const gate = index => (index < gates.length ? gates[index](exec, () => gate(index + 1)) : Promise.resolve({ kind: 'allow' }))
  assert.equal((await gate(0)).kind, 'ask')
  await b.ctx.registeredTools.get('thread_say').execute({ text: 'No id.' }, { agent: b.agentOf(child.sessionId) })
  assert.deepEqual(stateOf(b, child), ['training', 1])
  // A provider that issues the same call id again in a later turn makes a new card and draft.
  assert.equal((await say(b, child, 'A later answer.', { callId: 'call-retried' })).card, true)
  assert.deepEqual(stateOf(b, child), ['sending', 2])

  // The mode, the streak and the counted drafts are kept across a restart.
  const again = await restart(t, b, b.home, { services: { permissionPresets: b.presets } })
  const kept = again.channels.threads.byId(child.id)
  assert.deepEqual([kept.sendingMode, kept.approvedStreak, kept.countedDrafts.length], ['sending', 2, 2])
  assert.equal((await again.channels.recordAnswerDraft({ threadId: child.id, draftId: counted, approvedText: 'Only once.', sentText: 'Only once.', outcome: 'sent' })).counted, false)
  assert.equal(again.channels.answerNeedsApproval(child.id), false)
})
