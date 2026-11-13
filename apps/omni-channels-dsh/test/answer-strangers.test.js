// #1713: a person no allow rule lets in gets the answer bot's one reply, once a day per chat,
// and is kept as an access request staff read; with no reply set, nothing changes (#1706).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerIntake } from '../src/host/answer-intake.js'
import { install as installStrangers, REPLIED_MAX, REQUEST_TEXT_MAX, REQUESTS_MAX } from '../src/host/answer-strangers.js'
import { install } from '../src/host/omni-events.js'
import { STRANGER_REPLY_MAX } from '../src/host/threads.js'
import { ANSWER_CLOCK, ANSWER_MASTER, answerBench, boot, CHAT, CHATS, GROUP, guarded, INSTANCE, saved, signal, until } from './thread-fixture.js'

const DAY = 24 * 60 * 60_000
// Made-up ids: a phone an allow rule names, a phone no rule names, and a lid.
const PHONE = '5500000000001'
const STRANGER = '5500000000042'
const LID = '100000000000042'
const REPLY = 'Hello! This line answers invited people. Ask for an invite at the link on our page.'
const reply = data => ({ ok: true, json: async () => ({ data }) })
const now = () => Math.floor(Date.now() / 1000)
// A person whose phone Omni knows, and whom no allow rule names.
const stranger = (journalSeq = 1, changes = {}) => ({
  id: `stranger-${journalSeq}`, journalSeq, externalId: `WA-stranger-${journalSeq}`, eventType: 'message.received',
  direction: 'inbound', instanceId: INSTANCE, chatUuid: CHAT, chatId: `${STRANGER}@s.whatsapp.net`,
  metadata: { from: STRANGER }, textContent: `Can I join? (${journalSeq})`, contentType: 'text',
  rawPayload: { upsertType: 'notify', messageTimestamp: now(), key: { id: `WA-stranger-${journalSeq}`, remoteJid: `${STRANGER}@s.whatsapp.net`, fromMe: false } },
  ...changes,
})
// A person writing for the first time, known only by their lid.
const lidOnly = (journalSeq = 1) => ({
  ...stranger(journalSeq), id: `lid-${journalSeq}`, externalId: `WA-lid-${journalSeq}`, chatId: `${LID}@lid`, metadata: { from: LID },
  rawPayload: { upsertType: 'notify', addressingMode: 'lid', messageTimestamp: now(), key: { id: `WA-lid-${journalSeq}`, remoteJid: `${LID}@lid`, fromMe: false } },
})

// The answer bench's Omni, as answer-kept.test.js has it, with the chat's address, Omni's
// answer for a send, and the sends made.
function omniOf({ externalId = `${STRANGER}@s.whatsapp.net`, rules = [{ ruleType: 'allow', phonePattern: `+${PHONE}`, enabled: true }] } = {}) {
  return { externalId, canonical: null, rules, deny: {}, chatReads: 0, rulesReads: 0, acks: [], sends: [], sendStatus: 201, accessStatus: 200 }
}
async function attach(t, run, omni) {
  await run.channels.quiesceOmniEvents()
  const request = run.channels.omniRequest
  let queue = [], wake, closed = false
  run.warned = []
  run.channels.warn = (...args) => { run.warned.push(args) }
  run.channels.omniRequest = async (method, path, args) => {
    if (path === `/instances/${INSTANCE}`) return reply({ channel: 'whatsapp-baileys', inboundMaxAgeMinutes: 10 })
    if (path === `/chats/${CHAT}` && method === 'GET') {
      omni.chatReads += 1
      return reply({ ...CHATS[CHAT], externalId: omni.externalId, canonicalId: omni.canonical })
    }
    if (path === `/chats/${GROUP}` && method === 'GET') return reply(CHATS[GROUP])
    if (path === '/access/check') {
      if (omni.accessStatus !== 200) return { ok: false, status: omni.accessStatus, json: async () => ({}) }
      // An id with a rule of its own that refuses it (block or silent_block), as Omni's
      // evaluateMode answers it; any other id without a rule is the allowlist's default deny.
      const action = omni.deny[args.body.platformUserId]
      if (action) return reply({ allowed: false, rule: { id: `deny-${action}`, ruleType: 'deny', action, instanceId: INSTANCE } })
      return reply({ allowed: args.body.platformUserId === PHONE })
    }
    if (path === `/access/rules?instanceId=${INSTANCE}&type=allow`) { omni.rulesReads += 1; return { ok: true, json: async () => ({ items: omni.rules }) } }
    if (path === '/messages/send' && method === 'POST') {
      omni.sends.push(args.body)
      return { ok: omni.sendStatus < 300, status: omni.sendStatus, json: async () => ({ data: { messageId: 'sent-1' } }) }
    }
    if (path === '/automations?enabled=true') return { ok: true, json: async () => ({ items: [] }) }
    if (path === '/events/consumers' || method === 'DELETE' && path.startsWith('/events/consumers/')) return { ok: true }
    if (path.endsWith('/ack')) { omni.acks.push(args.body.cursor); return { ok: true } }
    if (path.endsWith('/stream')) {
      args.signal.addEventListener('abort', () => { closed = true; wake?.() }, { once: true })
      return { ok: true, body: (async function* () {
        while (!closed) {
          if (!queue.length) await new Promise(resolve => { wake = resolve })
          for (const row of queue.splice(0)) yield Buffer.from(`id: ${row.journalSeq}\ndata: ${JSON.stringify(row)}\n\n`)
        }
      })() }
    }
    return request(method, path, args)
  }
  install(run.channels)
  await run.channels.syncOmniEvents()
  t.after(() => run.channels.quiesceOmniEvents())
  run.deliver = async row => { queue.push(row); wake?.(); await until(() => omni.acks.includes(row.journalSeq)) }
  return Object.assign(run, { omniState: omni })
}
async function bench(t, { text = REPLY, ...options } = {}) {
  const run = await answerBench(t, { clock: ANSWER_CLOCK })
  if (text !== null) await run.call('omni-answer-settings', { ...run.settings, strangerReply: text })
  return attach(t, run, omniOf(options))
}
const kept = b => Object.values(b.team.state.omniAnswerKept ?? {})
const requests = b => Object.values(b.team.state.omniAnswerRequests?.[ANSWER_MASTER] ?? {})
const runs = b => b.team.state.subscriptionRuns?.length ?? 0
const staffWarnings = b => b.warned.filter(args => /is waiting|was dropped/.test(args[0]))
// Moves the clock to the next re-check and waits for it to finish.
async function recheck(t, b, ms) {
  const reads = b.omniState.chatReads
  t.mock.timers.tick(ms)
  await until(() => b.omniState.chatReads > reads)
  await until(() => !kept(b).some(entry => entry.nextAt <= Date.now()))
}

test('stranger reply: with no reply set, a sender no rule lets in is refused in silence and a lid-only one is kept as before', async t => {
  const b = await bench(t, { text: null })
  await b.deliver(stranger(1))
  assert.deepEqual([b.omniState.sends, requests(b), b.team.state.omniStrangerReplies ?? {}], [[], [], {}])
  b.omniState.externalId = `${LID}@lid`
  await b.deliver(lidOnly(2))
  await recheck(t, b, 2_000)
  await recheck(t, b, 8_000)
  await recheck(t, b, 20_000)
  // #1706 unchanged: still kept, marked for staff, and warned once.
  assert.deepEqual(kept(b).map(entry => [entry.row.id, entry.waiting]), [['lid-2', true]])
  assert.equal(staffWarnings(b).length, 1)
  assert.deepEqual(b.view().omniAnswerWaiting, { [ANSWER_MASTER]: 1 })
  assert.deepEqual(b.omniState.sends, [])
  assert.equal(b.channels.threads.byChat(CHAT), undefined)
})

test('stranger reply: a sender no rule lets in gets the reply once, in their chat, and one request row; no child is made', async t => {
  const b = await bench(t)
  await b.deliver(stranger(1))
  // Omni's send for the chat, to the chat's own address.
  assert.deepEqual(b.omniState.sends, [{ instanceId: INSTANCE, to: `${STRANGER}@s.whatsapp.net`, text: REPLY }])
  assert.deepEqual(requests(b).map(({ instanceId, chatUuid, senders, text, count }) => ({ instanceId, chatUuid, senders, text, count })),
    [{ instanceId: INSTANCE, chatUuid: CHAT, senders: [STRANGER], text: 'Can I join? (1)', count: 1 }])
  assert.equal(requests(b)[0].firstAt, requests(b)[0].lastAt)
  // Saved before the row was acked.
  assert.deepEqual(Object.keys(saved(b.home).omniStrangerReplies), [`${INSTANCE}:${CHAT}`])
  assert.equal(Object.values(saved(b.home).omniAnswerRequests[ANSWER_MASTER]).length, 1)
  await signal(t, b)
  assert.equal(b.channels.threads.byChat(CHAT), undefined)
  assert.equal(runs(b), 0)
  // A second message within the day: the row counts it, and nothing is sent.
  t.mock.timers.setTime(Date.now() + 60 * 60_000)
  await b.deliver(stranger(2))
  assert.equal(b.omniState.sends.length, 1)
  assert.deepEqual([requests(b).length, requests(b)[0].count, requests(b)[0].text, requests(b)[0].lastAt], [1, 2, 'Can I join? (1)', Date.now()])
  assert.ok(requests(b)[0].lastAt - requests(b)[0].firstAt >= 60 * 60_000)
  assert.equal(runs(b), 0)
})

test('stranger reply: the day\'s mark and the request row survive a restart; a day later the chat gets the reply again', async t => {
  const omni = omniOf()
  const run = await answerBench(t, { clock: ANSWER_CLOCK })
  await run.call('omni-answer-settings', { ...run.settings, strangerReply: REPLY })
  const b = await attach(t, run, omni)
  await b.deliver(stranger(1))
  assert.equal(omni.sends.length, 1)
  await b.channels.save()
  await b.stop()
  const next = await attach(t, await boot(t, b.home, { services: { permissionPresets: b.presets } }), omni)
  next.home = b.home
  t.mock.timers.setTime(Date.now() + DAY - 60_000)
  await next.deliver(stranger(2))
  assert.equal(omni.sends.length, 1)
  assert.deepEqual(requests(next).map(row => row.count), [2])
  t.mock.timers.setTime(Date.now() + 60_000)
  await next.deliver(stranger(3))
  assert.equal(omni.sends.length, 2)
  assert.deepEqual(requests(next).map(row => row.count), [3])
  await until(() => Object.values(saved(b.home).omniAnswerRequests[ANSWER_MASTER])[0].count === 3)
})

test('stranger reply: a check that failed, a message too old, a group, the number\'s own side and other gates get nothing', async t => {
  const b = await bench(t)
  b.omniState.accessStatus = 503
  await b.deliver(stranger(1))
  b.omniState.accessStatus = 200
  await b.deliver(stranger(2, { rawPayload: { ...stranger(2).rawPayload, messageTimestamp: now() - 11 * 60 } }))
  await b.deliver(stranger(3, { chatUuid: GROUP, chatId: CHATS[GROUP].externalId, chatType: 'group' }))
  await b.deliver(stranger(4, { rawPayload: { ...stranger(4).rawPayload, upsertType: 'append' } }))
  await b.deliver(stranger(5, { rawPayload: { ...stranger(5).rawPayload, isHistorySync: true } }))
  await b.deliver(stranger(6, { rawPayload: { ...stranger(6).rawPayload, isFromMe: true, key: { ...stranger(6).rawPayload.key, fromMe: true } } }))
  assert.deepEqual([b.omniState.sends, requests(b), kept(b)], [[], [], []])
  assert.equal(b.channels.threads.byChat(CHAT), undefined)
  // The intake never names these `denied`, and the reply takes the number's own side nowhere.
  const reasons = []
  const admit = answerIntake({
    warn: () => {},
    omniRequest: async (method, path) => (path === '/access/check' ? { ok: false } : path.startsWith('/instances/')
      ? reply({ channel: 'whatsapp-baileys', inboundMaxAgeMinutes: 10 }) : reply({ instanceId: INSTANCE, chatType: 'dm', externalId: `${STRANGER}@s.whatsapp.net` })),
  })
  await admit(stranger(7), { refused: why => reasons.push(why) })
  assert.deepEqual(reasons, ['failed'])
  assert.equal(await b.channels.answerStranger(stranger(8, { rawPayload: { ...stranger(8).rawPayload, isFromMe: true } }), ANSWER_MASTER), false)
})

test('stranger reply: a lid-only sender gets it only once the 30 s check still finds no rule, then leaves the queue with no warning', async t => {
  const b = await bench(t, { externalId: `${LID}@lid` })
  await b.deliver(lidOnly(1))
  assert.equal(kept(b).length, 1)
  await recheck(t, b, 2_000)
  await recheck(t, b, 8_000)
  assert.deepEqual([b.omniState.sends, kept(b).length], [[], 1])
  await recheck(t, b, 20_000)
  assert.deepEqual(b.omniState.sends, [{ instanceId: INSTANCE, to: `${LID}@lid`, text: REPLY }])
  assert.deepEqual([kept(b), staffWarnings(b), b.view().omniAnswerWaiting, b.omniState.rulesReads], [[], [], {}, 0])
  assert.deepEqual(requests(b).map(row => [row.senders, row.count]), [[[LID], 1]])
  await until(() => Object.keys(saved(b.home).omniAnswerKept ?? {}).length === 0)
  // Nothing more each minute after, and no child.
  t.mock.timers.tick(120_000)
  await signal(t, b)
  assert.equal(b.omniState.sends.length, 1)
  assert.equal(b.channels.threads.byChat(CHAT), undefined)
})

test('stranger reply: a re-check that finds a phone no rule allows replies at once and records both ids', async t => {
  const b = await bench(t, { externalId: `${LID}@lid` })
  await b.deliver(lidOnly(1))
  b.omniState.canonical = `${STRANGER}@s.whatsapp.net`
  await recheck(t, b, 2_000)
  assert.equal(b.omniState.sends.length, 1)
  assert.deepEqual([kept(b), staffWarnings(b)], [[], []])
  assert.deepEqual(requests(b).map(row => row.senders), [[LID, STRANGER]])
})

test('stranger reply: a rule that matches at a re-check admits the person as before, with no reply', async t => {
  const b = await bench(t, { externalId: `${LID}@lid` })
  await b.deliver(lidOnly(1))
  await recheck(t, b, 2_000)
  b.omniState.canonical = `${PHONE}@s.whatsapp.net`
  t.mock.timers.tick(8_000)
  await until(() => kept(b).length === 0)
  await signal(t, b)
  await until(() => b.agentOf(b.channels.threads.byChat(CHAT).sessionId).calls.length === 1)
  assert.deepEqual([b.omniState.sends, requests(b)], [[], []])
})

test('stranger reply: a failed send takes the day\'s mark back: no timer tries again, the person\'s next message does, and it is warned once', async t => {
  const b = await bench(t, { externalId: `${LID}@lid` })
  b.omniState.sendStatus = 500
  await b.deliver(lidOnly(1))
  await recheck(t, b, 2_000)
  await recheck(t, b, 8_000)
  await recheck(t, b, 20_000)
  // Tried once; the kept message leaves anyway, and the chat has no mark.
  assert.deepEqual([b.omniState.sends.length, kept(b).length, b.team.state.omniStrangerReplies], [1, 0, {}])
  await until(() => Object.keys(saved(b.home).omniStrangerReplies ?? {}).length === 0)
  t.mock.timers.tick(180_000)
  assert.equal(b.omniState.sends.length, 1)
  // Their next message tries again, and fails again: still one warning.
  await b.deliver(stranger(2))
  assert.equal(b.omniState.sends.length, 2)
  // Omni takes the next one; from then on the day's mark holds.
  b.omniState.sendStatus = 201
  await b.deliver(stranger(3))
  await b.deliver(stranger(4))
  assert.equal(b.omniState.sends.length, 3)
  assert.equal(b.warned.filter(args => /was not sent/.test(args[0])).length, 1)
  assert.deepEqual([kept(b), staffWarnings(b), requests(b).map(row => row.count)], [[], [], [4]])
})

for (const action of ['block', 'silent_block']) test(`stranger reply: a sender a ${action} rule refuses gets nothing, and no request row`, async t => {
  const b = await bench(t)
  b.omniState.deny[STRANGER] = action
  await b.deliver(stranger(1))
  assert.deepEqual([b.omniState.sends, requests(b), b.team.state.omniStrangerReplies ?? {}], [[], [], {}])
  assert.equal(b.channels.threads.byChat(CHAT), undefined)
})

test('stranger reply: a deny rule on one of the sender\'s ids and none on the other gets nothing, live or kept', async t => {
  const b = await bench(t, { externalId: `${LID}@lid` })
  b.omniState.deny[LID] = 'block'
  // Live: the lid with a phone beside it.
  await b.deliver({ ...lidOnly(1), rawPayload: { ...lidOnly(1).rawPayload, resolvedSenderPhone: STRANGER } })
  assert.deepEqual([b.omniState.sends, requests(b), kept(b)], [[], [], []])
  // Kept: a lid-only message is kept as before, and the phone its re-check finds has no rule.
  await b.deliver(lidOnly(2))
  assert.equal(kept(b).length, 1)
  await recheck(t, b, 2_000)
  await recheck(t, b, 8_000)
  b.omniState.canonical = `${STRANGER}@s.whatsapp.net`
  await recheck(t, b, 20_000)
  assert.deepEqual([b.omniState.sends, requests(b), kept(b)], [[], [], []])
  // Kept with the lid alone to the end of the window: no reply either, and #1706 marks it.
  b.omniState.canonical = null
  await b.deliver(lidOnly(3))
  await recheck(t, b, 2_000)
  await recheck(t, b, 8_000)
  await recheck(t, b, 20_000)
  assert.deepEqual([b.omniState.sends, requests(b), kept(b).map(entry => entry.waiting)], [[], [], [true]])
})

test('stranger reply: with answer mode switched off, a kept lid-only message gets no reply and stays kept as before', async t => {
  const b = await bench(t, { externalId: `${LID}@lid` })
  await b.deliver(lidOnly(1))
  await b.call('omni-answer-settings', { ...b.settings, enabled: false, strangerReply: REPLY })
  await recheck(t, b, 2_000)
  await recheck(t, b, 8_000)
  await recheck(t, b, 20_000)
  assert.deepEqual([b.omniState.sends, requests(b)], [[], []])
  assert.deepEqual(kept(b).map(entry => entry.waiting), [true])
})

test('stranger reply: the setting saves, clears with null or empty, and is kept by a save that leaves it out', async t => {
  const b = await answerBench(t)
  const setting = () => b.view().omniAnswers[ANSWER_MASTER].strangerReply
  assert.equal(setting(), null)
  await b.call('omni-answer-settings', { ...b.settings, strangerReply: `  ${REPLY}  ` })
  assert.equal(setting(), REPLY)
  await b.call('omni-answer-settings', b.settings)
  assert.equal(setting(), REPLY)
  await b.call('omni-answer-settings', { ...b.settings, strangerReply: '   ' })
  assert.equal(setting(), null)
  await b.call('omni-answer-settings', { ...b.settings, strangerReply: REPLY })
  await b.call('omni-answer-settings', { ...b.settings, strangerReply: null })
  assert.equal(setting(), null)
  assert.equal('strangerReply' in b.team.state.bots[ANSWER_MASTER].answer, false)
  await assert.rejects(b.call('omni-answer-settings', { ...b.settings, strangerReply: 'x'.repeat(STRANGER_REPLY_MAX + 1) }))
  await b.call('omni-answer-settings', { ...b.settings, strangerReply: 'x'.repeat(STRANGER_REPLY_MAX) })
  assert.equal(setting().length, STRANGER_REPLY_MAX)
})

test('stranger reply: staff read the requests on their route, newest first; no tool reads them and an answer child is refused', async t => {
  const b = await bench(t)
  await b.deliver(stranger(1))
  const answer = await b.call('omni-answer-requests', { botId: ANSWER_MASTER })
  assert.deepEqual([answer.count, answer.requests.map(row => [row.chatUuid, row.senders, row.count])], [1, [[CHAT, [STRANGER], 1]]])
  await assert.rejects(b.call('omni-answer-requests', { botId: 'm1' }), /channel bot/)
  await assert.rejects(b.call('omni-answer-requests', {}))
  // Only the route: no tool names them (the team's request_secret is another thing), and a
  // child's guard refuses anything by that name.
  assert.deepEqual([...b.ctx.registeredTools.keys()].filter(name => /request|stranger/i.test(name)), ['request_secret'])
  const child = await b.child(GROUP)
  assert.match(guarded(b.ctx, child.sessionId, 'omni-answer-requests'), /./)
})

test('stranger reply: the day\'s marks keep the newest 5000, the requests the newest 500 rows, and a first text 500 characters', async () => {
  const sends = []
  const endpoints = {}
  const state = { omniStrangerReplies: {}, omniAnswerRequests: { bot: {} } }
  const at = Date.now()
  for (let index = 0; index < REPLIED_MAX; index += 1) state.omniStrangerReplies[`i:old-${index}`] = at - REPLIED_MAX + index
  for (let index = 0; index < REQUESTS_MAX; index += 1) state.omniAnswerRequests.bot[`old-${index}`] = { instanceId: 'i', chatUuid: `old-${index}`, senders: ['x'], text: 'x', firstAt: at - 1_000 + index, lastAt: at - 1_000 + index, count: 1 }
  const rt = {
    state, ctx: { effect: fn => fn() }, hooks: { endpoint: (name, fn) => { endpoints[name] = fn } },
    load: async () => {}, save: async () => {}, warn: () => {},
    botOf: id => (id === 'bot' ? { kind: 'omni', answer: { enabled: true, strangerReply: REPLY } } : undefined),
    omniRequest: async (method, path, args) => {
      if (method === 'POST') { sends.push(args.body); return { ok: true } }
      return reply({ instanceId: 'i', chatType: 'dm', externalId: `${STRANGER}@s.whatsapp.net` })
    },
  }
  installStrangers(rt)
  const row = { instanceId: 'i', chatUuid: 'new', metadata: { from: STRANGER }, textContent: 'y'.repeat(REQUEST_TEXT_MAX + 50) }
  assert.equal(await rt.answerStranger(row, 'bot'), true)
  assert.equal(sends.length, 1)
  assert.equal(Object.keys(state.omniStrangerReplies).length, REPLIED_MAX)
  assert.equal('i:old-0' in state.omniStrangerReplies, false)
  assert.ok('i:new' in state.omniStrangerReplies)
  assert.equal(Object.keys(state.omniAnswerRequests.bot).length, REQUESTS_MAX)
  assert.equal('old-0' in state.omniAnswerRequests.bot, false)
  assert.equal(state.omniAnswerRequests.bot.new.text.length, REQUEST_TEXT_MAX)
  const listed = await endpoints['omni-answer-requests']({ botId: 'bot' })
  assert.deepEqual([listed.count, listed.requests[0].chatUuid, listed.requests[1].chatUuid], [REQUESTS_MAX, 'new', `old-${REQUESTS_MAX - 1}`])
  // A save that fails takes the day's mark back, so the message tried again gets the reply.
  rt.save = async () => { throw new Error('disk full') }
  await assert.rejects(rt.answerStranger({ ...row, chatUuid: 'retried' }, 'bot'), /disk full/)
  assert.equal('i:retried' in state.omniStrangerReplies, false)
  rt.save = async () => {}
  assert.equal(await rt.answerStranger({ ...row, chatUuid: 'retried' }, 'bot'), true)
  assert.deepEqual([sends.length, 'i:retried' in state.omniStrangerReplies], [2, true])
  // A bot with no reply set, or with answer mode off: nothing is noted or sent.
  rt.botOf = id => (id === 'bot' ? { kind: 'omni', answer: { enabled: false, strangerReply: REPLY } } : undefined)
  assert.equal(await rt.answerStranger({ ...row, chatUuid: 'other' }, 'bot'), false)
  rt.botOf = id => (id === 'bot' ? { kind: 'omni', answer: { enabled: true } } : undefined)
  assert.equal(await rt.answerStranger({ ...row, chatUuid: 'other' }, 'bot'), false)
  assert.deepEqual([sends.length, 'other' in state.omniAnswerRequests.bot], [2, false])
})
