// #1715: staff type and send their own message from the phone pane (omni-phone-send, thread-tools.js).
// It goes from the thread's channel to its chat on the link key, never through the thread's model,
// a tool or a card; it counts as staff answering from their own phone (the take-over pauses an
// answer child) and never as the child's send. Sent in place of a draft waiting on its card, it
// goes out as typed, the draft counts as edited, and the draft is never sent after it.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { STAFF_PAUSED } from '../src/host/thread-tools.js'
import { answerBench, ANSWER_MASTER, CHAT, CHATS, guarded, INSTANCE, logOf, resetFetch, signal, until, use } from './thread-fixture.js'

afterEach(resetFetch)

const SEND = 'omni-phone-send'
const DRAFT = 'Your order left today and arrives in 3 to 5 business days.'
const TYPED = 'Your order left today.\nIt arrives on Friday, and the tracking code is in your email.'
const rowOf = (b, child) => b.view().omniThreads.find(row => row.id === child.id)
const sentTexts = b => b.omni.sent.map(item => item.body.text)

// The child's queued answer run, handed over and in its tagged turn (as standing-runs.test.js):
// where a child drafts for real, with the Session log a draft's id reads its turn from.
async function answering(t, b) {
  const sub = b.team.state.subscriptions[`answer:${ANSWER_MASTER}`]
  await b.channels.fireSubscription(sub, b.incoming())
  await signal(t, b)
  const child = b.channels.threads.byChat(CHAT)
  await until(() => b.agentOf(child.sessionId).calls.length === 1)
  const message = b.agentOf(child.sessionId).calls[0]
  b.emit(child.sessionId, 'turn/start', { turn: 1 }, Date.now())
  b.emit(child.sessionId, 'user/message', { content: message.content, source: message.source })
  logOf(b, child.sessionId, [{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: { content: message.content, source: message.source } }])
  return child
}

let calls = 0
// One thread_say through DSH's pipeline in the child's Session (as standing-runs.test.js say):
// DSH's gates, the approval waterfall ending in the card (staff's `answer`, after `onCard`), the
// guard, then the body.
async function say(b, child, text, { answer = 'allowed-once', onCard } = {}) {
  const agent = b.agentOf(child.sessionId)
  const callId = `call-${(calls += 1)}`
  const exec = { name: 'thread_say', arguments: { text }, agent, callId }
  const gates = [...(b.ctx.listeners.get('tools/pre-execute') ?? [])]
  const gate = index => (index < gates.length ? gates[index](exec, () => gate(index + 1)) : Promise.resolve({ kind: 'allow' }))
  const decision = await gate(0)
  let card = false
  if (decision.kind === 'ask') {
    const approvals = [...(b.ctx.listeners.get('approval/request') ?? [])].reverse()
    const request = { agent, toolName: 'thread_say', callId, reason: decision.reason }
    // An Error for `answer`: the card is torn down as a stopped turn tears it down (it rejects).
    const step = index => (index < approvals.length ? Promise.resolve(approvals[index](request, () => step(index + 1))) : Promise.resolve().then(async () => { card = true; await onCard?.(); if (answer instanceof Error) throw answer; return answer }))
    const outcome = await step(0).catch(error => error)
    if (outcome instanceof Error) return { card, decision, result: null, error: outcome }
    if (outcome !== 'allowed-once') return { card, decision, result: null }
  } else if (decision.kind !== 'allow') {
    return { card, decision, result: null }
  }
  const refused = guarded(b.ctx, child.sessionId, 'thread_say')
  if (refused !== undefined) return { card, decision, result: `Error: ${refused}` }
  return { card, decision, result: await b.ctx.registeredTools.get('thread_say').execute({ text }, { agent, callId }) }
}

// Every draft the streak is told of, with what it answered.
function recorded(b) {
  const seen = []
  const record = b.channels.recordAnswerDraft
  b.channels.recordAnswerDraft = async (input) => {
    const answer = await record(input)
    seen.push({ outcome: input.outcome, approvedText: input.approvedText, sentText: input.sentText, counted: answer.counted })
    return answer
  }
  return seen
}

// Omni's POST /messages/send answers `status` (or cannot be reached: 0); every other call is Omni's.
function failingSend(status, message) {
  const real = globalThis.fetch
  const tried = []
  globalThis.fetch = async (address, init = {}) => {
    if ((init.method ?? 'GET') === 'POST' && new URL(String(address)).pathname.endsWith('/messages/send')) {
      tried.push(JSON.parse(init.body).text)
      if (status === 0) throw new TypeError('fetch failed')
      return new Response(JSON.stringify({ error: { code: 'CHANNEL_NOT_CONNECTED', message } }), { status })
    }
    return real(address, init)
  }
  return tried
}

test('the phone pane\'s send goes from the thread\'s channel to its chat on the link key, as typed with its ends trimmed', async t => {
  const b = await answerBench(t)
  const child = await b.child()
  const answer = await b.call(SEND, { threadId: child.id, text: `  ${TYPED}\n ` })
  assert.equal(answer.sent, true)
  assert.equal(typeof answer.messageId, 'string')
  assert.equal(answer.draft, null)
  // The chat and the channel come from Omni's own row for the thread's chat, never from the body.
  assert.deepEqual(b.omni.sent, [{ path: '/messages/send', body: { instanceId: INSTANCE, to: CHATS[CHAT].externalId, text: TYPED }, key: b.omni.link.text }])
  assert.ok(b.omni.asked.includes(`GET /chats/${CHAT}`))
  // The longest message there is goes too.
  await b.call(SEND, { threadId: child.id, text: 'x'.repeat(4096) })
  assert.equal(b.omni.sent.length, 2)
})

test('the phone pane\'s send refuses an empty or too long message, a thread that is gone, and any field but the thread, the text and the draft', async t => {
  const b = await answerBench(t)
  const child = await b.child()
  for (const text of ['', '   \n\t ', 'x'.repeat(4097), 42]) await assert.rejects(b.call(SEND, { threadId: child.id, text }), { message: 'Write a message of 1 to 4096 characters.' })
  await assert.rejects(b.call(SEND, { threadId: child.id }), { message: 'Write a message of 1 to 4096 characters.' })
  for (const body of [{ threadId: 'not-a-thread', text: 'hi' }, { threadId: child.id, text: 'hi', to: CHATS[CHAT].externalId }, { threadId: child.id, text: 'hi', instanceId: INSTANCE }, { threadId: child.id, text: 'hi', by: 'model' }]) {
    await assert.rejects(b.call(SEND, body), { message: 'Pick a thread, and send only its message.' }, JSON.stringify(body))
  }
  await assert.rejects(b.call(SEND, { threadId: '99999999-9999-4999-8999-999999999999', text: 'hi' }), { message: 'That chat is not a thread any more.' })
  assert.deepEqual(b.omni.sent, [])
})

test('the phone pane\'s send is staff\'s alone: no tool reaches it, and an answer child is refused it', async t => {
  const b = await answerBench(t)
  const child = await b.child()
  // An endpoint of the owner's own interface: no model holds a tool for it.
  assert.deepEqual([...b.ctx.registeredTools.keys()].filter(name => /phone|staff_send|send_as/.test(name)), [])
  assert.match(guarded(b.ctx, child.sessionId, SEND), /./)
  assert.deepEqual(b.omni.sent, [])
})

test('a phone pane message counts as staff answering from their own phone: it pauses the answer child and clears its call for a person', async t => {
  const b = await answerBench(t)
  const child = await b.child()
  assert.match(await use(b, 'thread_needs_staff', child.sessionId, { reason: 'Wants to talk to a person.' }), /^The team was told/)
  const answer = await b.call(SEND, { threadId: child.id, text: TYPED })
  assert.equal(answer.paused, true)
  const thread = b.channels.threads.byId(child.id)
  assert.equal(thread.paused, true)
  assert.deepEqual(thread.staffReceipts, [answer.messageId])
  assert.equal(b.channels.answerMayDispatch(child.id), false)
  assert.equal(rowOf(b, child).paused, true)
  assert.equal(rowOf(b, child).needsStaff, undefined)
  assert.equal(thread.needsStaff, undefined)
})

test('a phone pane message is not the child\'s send: the streak does not move, and the paused child sends nothing after it', async t => {
  const b = await answerBench(t)
  const seen = recorded(b)
  const child = await answering(t, b)
  await b.call(SEND, { threadId: child.id, text: TYPED })
  assert.deepEqual(seen, [])
  assert.deepEqual([rowOf(b, child).approvedStreak, b.channels.threads.byId(child.id).countedDrafts], [0, undefined])
  // The child's own draft after it raises no card and sends nothing.
  const held = await say(b, child, DRAFT)
  assert.deepEqual([held.card, held.decision.kind, held.decision.reason], [false, 'deny', STAFF_PAUSED])
  assert.deepEqual(sentTexts(b), [TYPED])
  assert.deepEqual(seen, [])
})

test('a draft waiting on its card shows on the thread\'s row; edited and sent from the pane, it goes out as typed and counts as edited, once', async t => {
  const b = await answerBench(t)
  const seen = recorded(b)
  const child = await answering(t, b)
  assert.equal(rowOf(b, child).waitingDraft, undefined)
  let shown
  let replaced
  const said = await say(b, child, DRAFT, {
    answer: 'rejected',
    onCard: async () => {
      shown = rowOf(b, child).waitingDraft
      const answer = await b.call(SEND, { threadId: child.id, text: TYPED, draftId: shown.id })
      assert.deepEqual([answer.sent, answer.draft, answer.paused], [true, 'edited', true])
      replaced = rowOf(b, child).waitingDraft
    },
  })
  assert.deepEqual(Object.keys(shown).sort(), ['id', 'text'])
  assert.equal(shown.text, DRAFT)
  // Still waiting on its card, the draft says staff replaced it, so the pane asks them to reject it.
  assert.deepEqual(replaced, { id: shown.id, text: DRAFT, replaced: true })
  assert.deepEqual([said.card, said.result], [true, null])
  assert.deepEqual(sentTexts(b), [TYPED])
  // Counted once, as edited; staff's reject on its card after that counts nothing again.
  assert.deepEqual(seen, [{ outcome: 'edited', approvedText: DRAFT, sentText: TYPED, counted: true }, { outcome: 'rejected', approvedText: DRAFT, sentText: '', counted: false }])
  assert.deepEqual(b.channels.threads.byId(child.id).countedDrafts, [shown.id])
  assert.equal(rowOf(b, child).approvedStreak, 0)
  assert.equal(rowOf(b, child).waitingDraft, undefined)
})

for (const resumed of [false, true]) {
  test(`a draft staff replaced from the pane is never sent, even when they allow its card later (${resumed ? 'child resumed' : 'child paused'})`, async t => {
    const b = await answerBench(t)
    const child = await answering(t, b)
    const said = await say(b, child, DRAFT, {
      onCard: async () => {
        await b.call(SEND, { threadId: child.id, text: TYPED, draftId: rowOf(b, child).waitingDraft.id })
        if (resumed) await b.call('resume_answer_child', { threadId: child.id })
      },
    })
    assert.equal(said.result, resumed ? 'Not sent: staff already sent their own message in place of this draft. Send nothing more about it.' : STAFF_PAUSED)
    assert.deepEqual(sentTexts(b), [TYPED])
    assert.equal(b.channels.threads.byId(child.id).approvedStreak, 0)
  })
}

for (const [status, reason] of [[503, 'Omni answered 503: instance not connected. Nothing was sent.'], [0, 'Omni did not answer, so this message may have gone out. Check the chat before sending it again.']]) {
  test(`a failed phone pane send (${status === 0 ? 'Omni unreachable' : `Omni answers ${status}`}) says why, sends nothing twice, and leaves the child and its waiting draft as they were`, async t => {
    const b = await answerBench(t)
    const seen = recorded(b)
    const child = await answering(t, b)
    const tried = failingSend(status, 'instance not connected')
    let after
    await say(b, child, DRAFT, {
      answer: 'cancelled',
      onCard: async () => {
        const draftId = rowOf(b, child).waitingDraft.id
        await assert.rejects(b.call(SEND, { threadId: child.id, text: TYPED, draftId }), { message: reason })
        after = rowOf(b, child)
      },
    })
    assert.deepEqual(tried, [TYPED], 'tried once, never again by itself')
    assert.deepEqual(b.omni.sent, [])
    assert.deepEqual([after.paused, after.waitingDraft.text, after.waitingDraft.replaced], [undefined, DRAFT, undefined])
    assert.equal(b.channels.answerMayDispatch(child.id), true)
    assert.deepEqual(seen, [])
  })
}

test('two phone pane sends at once into one chat send one message; the other is refused', async t => {
  const b = await answerBench(t)
  const child = await b.child()
  const both = await Promise.allSettled([b.call(SEND, { threadId: child.id, text: 'first' }), b.call(SEND, { threadId: child.id, text: 'second' })])
  assert.deepEqual(both.map(result => result.status), ['fulfilled', 'rejected'])
  assert.equal(both[1].reason.message, 'The message before this one is still being sent.')
  assert.deepEqual(sentTexts(b), ['first'])
  // Once it answered, the next one goes.
  await b.call(SEND, { threadId: child.id, text: 'third' })
  assert.deepEqual(sentTexts(b), ['first', 'third'])
})

test('a card torn down with its turn leaves no waiting draft behind for the thread\'s next card', async t => {
  const b = await answerBench(t)
  const child = await answering(t, b)
  let shown
  const stopped = await say(b, child, DRAFT, { answer: new Error('approval request was aborted'), onCard: () => { shown = rowOf(b, child).waitingDraft } })
  assert.equal(shown.text, DRAFT)
  assert.equal(stopped.error.message, 'approval request was aborted')
  assert.equal(rowOf(b, child).waitingDraft, undefined)
  // The thread's next card, for a reaction, shows no draft.
  const agent = b.agentOf(child.sessionId)
  const approvals = [...b.ctx.listeners.get('approval/request')].reverse()
  let during
  const request = { agent, toolName: 'thread_react', callId: 'call-react', reason: 'React?' }
  const step = index => (index < approvals.length ? Promise.resolve(approvals[index](request, () => step(index + 1))) : Promise.resolve().then(() => { during = b.channels.threads.byId(child.id).status === 'waiting' ? rowOf(b, child) : null; return 'rejected' }))
  assert.equal(await step(0), 'rejected')
  assert.ok(during, 'the reaction card was up')
  assert.equal(during.waitingDraft, undefined)
})
