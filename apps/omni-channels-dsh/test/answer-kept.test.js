// #1706: a person's first message in lid form, before Omni knows their phone, is kept and
// answered once their phone is known; never lost, never answered twice.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerIntake } from '../src/host/answer-intake.js'
import { install } from '../src/host/omni-events.js'
import { ANSWER_CLOCK, ANSWER_MASTER, answerBench, boot, CHAT, CHATS, INSTANCE, saved, signal, until } from './thread-fixture.js'

const PHONE = '5511988887777'
const LID = '100000000000001'
const reply = data => ({ ok: true, json: async () => ({ data }) })
// A person writing for the first time: Omni knows them only by their lid, no phone beside it.
const firstMessage = (journalSeq = 1, changes = {}) => ({
  id: `kept-${journalSeq}`, journalSeq, externalId: `WA-kept-${journalSeq}`, eventType: 'message.received',
  direction: 'inbound', instanceId: INSTANCE, chatUuid: CHAT, chatId: `${LID}@lid`,
  metadata: { from: LID }, textContent: `Where is my order? (${journalSeq})`,
  rawPayload: { upsertType: 'notify', addressingMode: 'lid', messageTimestamp: Math.floor(Date.now() / 1000), key: { id: `WA-kept-${journalSeq}`, remoteJid: `${LID}@lid`, fromMe: false } },
  ...changes,
})

// The answer bench with Omni's answers this needs: the chat's canonicalId (null until Omni
// knows the phone), the phone rule that admits the person, and the instance's allow rules.
function omniOf({ rules = [{ ruleType: 'allow', phonePattern: `+${PHONE}`, enabled: true }] } = {}) {
  return { canonical: null, rules, rule: undefined, chatReads: 0, rulesReads: 0, acks: [] }
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
      return reply({ ...CHATS[CHAT], externalId: `${LID}@lid`, canonicalId: omni.canonical })
    }
    if (path === '/access/check') return reply(args.body.platformUserId === PHONE ? { allowed: true, ...(omni.rule ? { rule: omni.rule } : {}) } : { allowed: false })
    if (path === `/access/rules?instanceId=${INSTANCE}&type=allow`) { omni.rulesReads += 1; return { ok: true, json: async () => ({ items: omni.rules }) } }
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
  return run
}
async function bench(t, options) {
  const omni = omniOf(options)
  const b = await attach(t, await answerBench(t, { clock: ANSWER_CLOCK }), omni)
  return Object.assign(b, { omniState: omni })
}
const kept = b => Object.values(b.team.state.omniAnswerKept ?? {})
const callsOf = b => {
  const child = b.channels.threads.byChat(CHAT)
  return child ? b.agentOf(child.sessionId).calls : []
}
// Moves the clock to the next re-check and waits for it to finish.
async function recheck(t, b, ms) {
  const reads = b.omniState.chatReads
  t.mock.timers.tick(ms)
  await until(() => b.omniState.chatReads > reads)
  await until(() => !kept(b).some(entry => entry.nextAt <= Date.now()))
}

test('kept answer: the first lid-only message is answered once when the phone resolves a moment later', async t => {
  const b = await bench(t)
  await b.deliver(firstMessage(1))
  // Refused for now, never lost: no child yet, and the message is saved before its ack.
  assert.equal(b.channels.threads.byChat(CHAT), undefined)
  assert.deepEqual(kept(b).map(entry => entry.row.externalId), ['WA-kept-1'])
  assert.deepEqual(Object.keys(saved(b.home).omniAnswerKept), ['kept-1'])
  // About 2 s later Omni still has no phone for them.
  await recheck(t, b, 2_000)
  assert.equal(b.channels.threads.byChat(CHAT), undefined)
  assert.equal(kept(b)[0].checks, 1)
  // Then it learns it: the chat's canonicalId names the phone, and the 10 s check admits them.
  b.omniState.canonical = `${PHONE}@s.whatsapp.net`
  t.mock.timers.tick(8_000)
  await until(() => kept(b).length === 0)
  await signal(t, b)
  await until(() => callsOf(b).length === 1)
  assert.match(JSON.stringify(callsOf(b)[0]), /Where is my order\? \(1\)/)
  // Once: later checks and minutes find nothing kept, and no second run is queued.
  t.mock.timers.tick(120_000)
  await until(() => b.team.state.subscriptionRuns.length >= 1)
  assert.equal(b.team.state.subscriptionRuns.length, 1)
  assert.equal(callsOf(b).length, 1)
  await until(() => Object.keys(saved(b.home).omniAnswerKept ?? {}).length === 0)
  assert.deepEqual(b.view().omniAnswerWaiting, {})
})

test('kept answer: a later admitted message from the chat hands the kept one over first, once', async t => {
  const b = await bench(t)
  await b.deliver(firstMessage(1))
  assert.equal(kept(b).length, 1)
  // Their next message carries the phone Omni resolved meanwhile.
  await b.deliver(firstMessage(2, { rawPayload: { ...firstMessage(2).rawPayload, resolvedSenderPhone: PHONE } }))
  assert.equal(kept(b).length, 0)
  await signal(t, b)
  await until(() => b.team.state.subscriptionRuns.length === 2)
  const order = b.team.state.subscriptionRuns.map(run => run.answerIdentity ?? run.event?.externalId).reverse()
  assert.deepEqual(order, ['WA-kept-1', 'WA-kept-2'])
  // The first one's re-check time comes and finds nothing to answer again.
  t.mock.timers.tick(30_000)
  await until(() => callsOf(b).length >= 1)
  assert.equal(b.team.state.subscriptionRuns.length, 2)
})

test('kept answer: two kept messages of one chat are answered in the journal\'s order, once each', async t => {
  const b = await bench(t)
  // Kept within the same clock tick: their ids sort the other way round ('kept-10' < 'kept-9').
  await b.deliver(firstMessage(9))
  await b.deliver(firstMessage(10))
  assert.equal(kept(b).length, 2)
  b.omniState.canonical = `${PHONE}@s.whatsapp.net`
  t.mock.timers.tick(2_000)
  await until(() => kept(b).length === 0)
  await signal(t, b)
  await until(() => b.team.state.subscriptionRuns.length === 2)
  assert.deepEqual(b.team.state.subscriptionRuns.map(run => run.answerIdentity ?? run.event?.externalId).reverse(), ['WA-kept-9', 'WA-kept-10'])
  t.mock.timers.tick(120_000)
  await until(() => callsOf(b).length >= 1)
  assert.equal(b.team.state.subscriptionRuns.length, 2)
})

test('kept answer: a kept message survives a restart and is answered once', async t => {
  const omni = omniOf()
  const b = await attach(t, await answerBench(t, { clock: ANSWER_CLOCK }), omni)
  await b.deliver(firstMessage(1))
  assert.deepEqual(Object.keys(saved(b.home).omniAnswerKept), ['kept-1'])
  // DSH is down past the saved re-check time (2 s after it was kept); Omni learns the phone meanwhile.
  await b.channels.save()
  await b.stop()
  omni.canonical = `${PHONE}@s.whatsapp.net`
  t.mock.timers.tick(5_000)
  // The next start on the same home, with the same permission presets the bench gave DSH: the
  // saved time is re-armed at start, and the overdue check runs at once.
  const next = await attach(t, await boot(t, b.home, { services: { permissionPresets: b.presets } }), omni)
  Object.assign(next, { omniState: omni, home: b.home })
  await until(() => { t.mock.timers.tick(0); return kept(next).length === 0 })
  await signal(t, next)
  await until(() => callsOf(next).length === 1)
  t.mock.timers.tick(60_000)
  await until(() => next.team.state.subscriptionRuns.length >= 1)
  assert.equal(next.team.state.subscriptionRuns.length, 1)
  assert.equal(callsOf(next).length, 1)
  await until(() => Object.keys(saved(b.home).omniAnswerKept ?? {}).length === 0)
})

test('kept answer: with person binding, the kept message binds by the rule that admits it at the re-check', async t => {
  const omni = omniOf()
  omni.rule = { id: 'rule-phone', ruleType: 'allow', instanceId: INSTANCE, platformUserId: null, phonePattern: `+${PHONE}`, personId: null, action: 'allow', metadata: { context: 'PHONE-RULE-CONTEXT' } }
  const run = await answerBench(t, { clock: ANSWER_CLOCK })
  await run.call('omni-answer-settings', { ...run.settings, personBinding: true })
  const b = Object.assign(await attach(t, run, omni), { omniState: omni })
  await b.deliver(firstMessage(1))
  omni.canonical = `${PHONE}@s.whatsapp.net`
  t.mock.timers.tick(2_000)
  await until(() => kept(b).length === 0)
  await signal(t, b)
  await until(() => callsOf(b).length === 1)
  assert.equal(b.channels.threads.byChat(CHAT).personRuleId, 'rule-phone')
})

for (const [label, rules, marked] of [
  ['with a phone allow rule shows staff one warning and the sidebar marker', [{ ruleType: 'allow', phonePattern: `+${PHONE}`, enabled: true }], true],
  ['with no phone allow rule stays refused with no staff noise', [{ ruleType: 'allow', platformUserId: 'someone-else', enabled: true }, { ruleType: 'allow', phonePattern: '+5511*', enabled: false }], false],
]) test(`kept answer: a sender never matched ${label}`, async t => {
  const b = await bench(t, { rules })
  await b.deliver(firstMessage(1))
  await recheck(t, b, 2_000)
  await recheck(t, b, 8_000)
  assert.equal(b.omniState.rulesReads, 0, 'the rules are read only at the end of the window')
  await recheck(t, b, 20_000)
  assert.equal(b.omniState.rulesReads, 1)
  const waiting = b.warned.filter(args => /is waiting: its sender is not matched yet/.test(args[0]))
  assert.equal(waiting.length, marked ? 1 : 0)
  assert.deepEqual(b.view().omniAnswerWaiting, marked ? { [ANSWER_MASTER]: 1 } : {})
  await until(() => saved(b.home).omniAnswerKept['kept-1'].waiting === marked)
  // Still kept and checked each minute, the warning never repeats, and no child is made.
  await recheck(t, b, 60_000)
  assert.equal(b.warned.filter(args => /is waiting/.test(args[0])).length, marked ? 1 : 0)
  assert.equal(b.channels.threads.byChat(CHAT), undefined)
  assert.equal(b.team.state.subscriptionRuns?.length ?? 0, 0)
})

test('kept answer: a kept message is dropped once older than the instance answers, by its platform timestamp', async t => {
  const b = await bench(t)
  // Sent 9 minutes before it arrived: one minute left of the instance's 10.
  await b.deliver(firstMessage(1, { rawPayload: { ...firstMessage(1).rawPayload, messageTimestamp: Math.floor((Date.now() - 9 * 60_000) / 1000) } }))
  await recheck(t, b, 2_000)
  await recheck(t, b, 8_000)
  await recheck(t, b, 20_000)
  assert.equal(kept(b)[0].waiting, true)
  // Dropped as soon as it is older than the instance's 10 minutes (here 60 s after it was kept),
  // not at its next minute check (90 s).
  assert.ok(kept(b)[0].nextAt > kept(b)[0].until + 1)
  t.mock.timers.tick(30_001)
  await until(() => kept(b).length === 0)
  assert.equal(b.warned.filter(args => /was dropped/.test(args[0])).length, 1)
  assert.deepEqual(b.view().omniAnswerWaiting, {})
  // Its phone resolving afterwards answers nothing.
  b.omniState.canonical = `${PHONE}@s.whatsapp.net`
  t.mock.timers.tick(120_000)
  await signal(t, b)
  assert.equal(b.channels.threads.byChat(CHAT), undefined)
  // The saved state follows: save() writes its snapshot asynchronously, after the in-memory drop.
  await until(() => Object.keys(saved(b.home).omniAnswerKept ?? {}).length === 0)
})

test('kept answer: the intake names why it refused, and keeps only a lid-only sender as unmatched', async () => {
  const reasons = []
  const admit = answerIntake({
    warn: () => {},
    omniRequest: async (method, path, args) => {
      if (path === '/access/check') return reply({ allowed: args.body.platformUserId === PHONE })
      if (path.startsWith('/instances/')) return reply({ channel: 'whatsapp-baileys', inboundMaxAgeMinutes: 10 })
      return reply({ instanceId: INSTANCE, chatType: 'dm', externalId: `${LID}@lid` })
    },
  })
  const why = row => admit(row, { refused: (reason, info) => reasons.push([reason, info.minutes]) })
  assert.equal(await why(firstMessage(1)), false)
  // A phone beside the lid: the rule answered for it, so that is a plain refusal.
  assert.equal(await why(firstMessage(2, { metadata: { from: '5511977776666' }, chatId: '5511977776666@s.whatsapp.net', rawPayload: { upsertType: 'notify' } })), false)
  assert.equal(await why(firstMessage(3, { rawPayload: { ...firstMessage(3).rawPayload, upsertType: 'append' } })), false)
  assert.equal(await why(firstMessage(4, { rawPayload: { ...firstMessage(4).rawPayload, messageTimestamp: Math.floor((Date.now() - 11 * 60_000) / 1000) } })), false)
  assert.equal(await why(firstMessage(5, { rawPayload: { ...firstMessage(5).rawPayload, resolvedSenderPhone: PHONE } })), true)
  assert.deepEqual(reasons, [['unmatched', 10], ['denied', 10], ['filtered', undefined], ['stale', 10]])
})
