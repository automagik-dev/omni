// #1704 person binding: persons A and B on one answer bot, each admitted by their own Omni access
// rule. Each child binds to its person's rule, carries that person's context and capability, and
// never reaches the other's. Fed through the durable SSE ingress, as answer-intake.test.js is.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerIntake } from '../src/host/answer-intake.js'
import { install } from '../src/host/omni-events.js'
import { PERSON_COLLECTIVE, PERSON_CONTEXT_MAX, PERSON_HELD, PERSON_NO_HOST, PERSON_UNLIMITED_READS, personOfRule } from '../src/host/person-binding.js'
import { answerBench, ANSWER_CLOCK, ANSWER_MASTER, CHAT, CHATS, ELSEWHERE, guarded, INSTANCE, OTHER_INSTANCE, preExecute, restart, saved, signal, until } from './thread-fixture.js'

const reply = data => ({ ok: true, json: async () => ({ data }) })
const FOREIGN = /Only the answer child of the person this tool was given to/
const CHAT_B = '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c06'
const FROM_A = '5511988887777'
const FROM_B = '5511966665555'
const ruleOf = (id, platformUserId, metadata, extra = {}) => ({ id, ruleType: 'allow', instanceId: INSTANCE, platformUserId, phonePattern: null, personId: null, action: 'allow', metadata, ...extra })
const rulesFor = () => ({
  a: ruleOf('rule-a', FROM_A, { context: 'A-CONTEXT: prefers morning calls.', capability: { name: 'orders-a', secrets: ['ORDERS_A_TOKEN'] } }),
  b: ruleOf('rule-b', FROM_B, { context: 'B-CONTEXT: writes in Spanish.', capability: 'orders-b' }),
})
const row = (seq, chatUuid, from) => ({
  id: `person-${seq}`, journalSeq: seq, externalId: `WA-person-${seq}`, eventType: 'message.received',
  direction: 'inbound', instanceId: INSTANCE, chatUuid, chatId: CHATS[chatUuid].externalId,
  metadata: { from }, textContent: `Message ${seq}`,
  rawPayload: { upsertType: 'notify', messageTimestamp: Math.floor(Date.now() / 1000) },
})

// The Bot team's mount call as contract v1 states it: tools prefixed mcp__<name>__ registered in
// that one Session's agent scope (`scopes`), idempotent, unmount ends it.
function fakeHost(rt, { state = 'ready', prefix } = {}) {
  const scopes = new Map(), calls = []
  rt.mountCapability = async (sessionId, name, grant) => {
    calls.push(['mount', sessionId, name, grant])
    const own = scopes.get(sessionId) ?? new Set()
    if (state === 'ready') own.add(`mcp__${name}__lookup`)
    scopes.set(sessionId, own)
    return { sessionId, name, state, toolPrefix: prefix ?? `mcp__${name}__`, ...(state === 'error' ? { error: 'server exited' } : {}) }
  }
  rt.unmountCapability = async (sessionId, name) => {
    calls.push(['unmount', sessionId, name])
    const own = scopes.get(sessionId) ?? new Set()
    const had = [...own].filter(tool => tool.startsWith(`mcp__${name}__`))
    for (const tool of had) own.delete(tool)
    return had.length > 0
  }
  return { scopes, calls, mounts: () => calls.filter(call => call[0] === 'mount'), unmounts: () => calls.filter(call => call[0] === 'unmount') }
}

// The answer bench, with Person B's DM on the same line and a fake Omni whose access check
// answers each sender's own rule (`rules`, editable), fed through the SSE ingress.
async function bench(t, { personBinding = true, host = {} } = {}) {
  const before = CHATS[CHAT_B]
  CHATS[CHAT_B] = { id: CHAT_B, instanceId: INSTANCE, externalId: `${FROM_B}@s.whatsapp.net`, chatType: 'dm', name: 'Person B' }
  t.after(() => { if (before) CHATS[CHAT_B] = before; else delete CHATS[CHAT_B] })
  const b = await answerBench(t, { clock: ANSWER_CLOCK })
  const rules = rulesFor()
  const checks = []
  const warned = []
  b.channels.warn = (...args) => { warned.push(args) }
  const fake = fakeHost(b.channels, host)
  if (personBinding) await b.call('omni-answer-settings', { ...b.settings, personBinding: true })
  const wire = async run => {
    await run.channels.quiesceOmniEvents()
    const request = run.channels.omniRequest, acks = []
    let queue = [], wake, closed = false
    run.channels.omniRequest = async (method, path, args) => {
      if (path === `/instances/${INSTANCE}`) return reply({ channel: 'whatsapp-baileys', inboundMaxAgeMinutes: 10 })
      if (path === '/access/check') {
        checks.push(args.body.platformUserId)
        const rule = Object.values(rules).find(item => item.platformUserId === args.body.platformUserId || (item.phonePattern && args.body.platformUserId.startsWith(item.phonePattern.replace('*', ''))))
        return reply(rule ? { allowed: true, rule } : { allowed: false })
      }
      if (path === '/automations?enabled=true') return { ok: true, json: async () => ({ items: [] }) }
      if (path === '/events/consumers' || method === 'DELETE' && path.startsWith('/events/consumers/')) return { ok: true }
      if (path.endsWith('/ack')) { acks.push(args.body.cursor); return { ok: true } }
      if (path.endsWith('/stream')) {
        args.signal.addEventListener('abort', () => { closed = true; wake?.() }, { once: true })
        return { ok: true, body: (async function* () {
          while (!closed) {
            if (!queue.length) await new Promise(resolve => { wake = resolve })
            for (const item of queue.splice(0)) yield Buffer.from(`id: ${item.journalSeq}\ndata: ${JSON.stringify(item)}\n\n`)
          }
        })() }
      }
      return request(method, path, args)
    }
    install(run.channels)
    await run.channels.syncOmniEvents()
    t.after(() => run.channels.quiesceOmniEvents())
    return async item => { queue.push(item); wake?.(); await until(() => acks.includes(item.journalSeq)) }
  }
  const deliver = await wire(b)
  const prompt = sessionId => b.ctx.sections.get('omni-thread').text({ agent: { id: sessionId } })
  const childOf = chatId => b.channels.threads.byChat(chatId)
  const calls = chatId => b.agentOf(childOf(chatId).sessionId).calls.length
  // The answer runs for a chat's child, queued or started: one per message that reached it.
  const runsOf = chatId => b.team.state.subscriptionRuns.filter(run => run.target?.id === childOf(chatId)?.id || run.sessionId === childOf(chatId)?.sessionId)
  const runs = chatId => runsOf(chatId).length
  return { ...b, rules, checks, warned, fake, deliver, prompt, childOf, calls, runs, runsOf, wire }
}

// Persons A and B each write once; both children answer.
async function twoPersons(t, options) {
  const b = await bench(t, options)
  await b.deliver(row(1, CHAT, FROM_A))
  await b.deliver(row(2, CHAT_B, FROM_B))
  await signal(t, b)
  await until(() => b.calls(CHAT) === 1 && b.calls(CHAT_B) === 1)
  return { b, a: b.childOf(CHAT), bee: b.childOf(CHAT_B) }
}

test('person binding: B\'s message matches only B\'s rule and binds only B\'s child; each child holds its own person', async t => {
  const { b, a, bee } = await twoPersons(t)
  assert.deepEqual(b.checks, [FROM_A, FROM_B])
  assert.equal(a.personRuleId, 'rule-a')
  assert.equal(bee.personRuleId, 'rule-b')
  assert.notEqual(a.id, bee.id)
  // The rule id rides only on the answer run's event; the person's words do not.
  assert.doesNotMatch(JSON.stringify(b.team.state.subscriptionRuns), /CONTEXT|orders-|ORDERS_/)
  await b.channels.save()
  assert.match(JSON.stringify(saved(b.home)), /"personRuleId":"rule-a"/)
  assert.doesNotMatch(JSON.stringify(saved(b.home)), /CONTEXT/)
})

test('person binding: A\'s context reaches only A\'s instructions, never B\'s or the shared ones', async t => {
  const { b, a, bee } = await twoPersons(t)
  assert.match(b.prompt(a.sessionId), /## About this person[^\n]*\nA-CONTEXT: prefers morning calls\./)
  assert.doesNotMatch(b.prompt(a.sessionId), /B-CONTEXT/)
  assert.match(b.prompt(bee.sessionId), /B-CONTEXT: writes in Spanish\./)
  // Each child is told of its own person's tools only.
  assert.match(b.prompt(a.sessionId), /## This person's own tools\n[^\n]*"mcp__orders-a__"/)
  assert.doesNotMatch(b.prompt(a.sessionId), /mcp__orders-b__/)
  assert.match(b.prompt(bee.sessionId), /"mcp__orders-b__"/)
  assert.doesNotMatch(b.prompt(bee.sessionId), /mcp__orders-a__/)
  assert.doesNotMatch(b.prompt(bee.sessionId), /A-CONTEXT/)
  assert.doesNotMatch(b.channels.botOf(ANSWER_MASTER).instructions, /CONTEXT/)
  assert.doesNotMatch(String(b.channels.botOf(ANSWER_MASTER).answer.sharedNotes), /CONTEXT/)
  assert.equal(b.prompt(ANSWER_MASTER), '')
})

test('person binding: each capability mounts into its own child\'s Session only; B never lists or calls A\'s tools', async t => {
  const { b, a, bee } = await twoPersons(t)
  // Mounted again before each event (idempotent), always into the child's own Session.
  const mounted = [...new Set(b.fake.mounts().map(call => JSON.stringify(call.slice(1))))].sort()
  assert.deepEqual(mounted, [[a.sessionId, 'orders-a', { secrets: ['ORDERS_A_TOKEN'] }], [bee.sessionId, 'orders-b', { secrets: [] }]].map(call => JSON.stringify(call)).sort())
  const mounts = b.fake.mounts().length
  // B's registry (its agent scope) and contained list lack A's tools.
  assert.deepEqual([...b.fake.scopes.get(a.sessionId)], ['mcp__orders-a__lookup'])
  assert.deepEqual([...b.fake.scopes.get(bee.sessionId)], ['mcp__orders-b__lookup'])
  const served = new Set(b.ctx.tools.schemas().map(schema => schema.name))
  for (const entry of b.restricts) assert.ok(entry.filter.allow.every(name => served.has(name)), 'restrict() names only global tools')
  const allowOf = child => b.restricts.filter(entry => entry.sessionId === child.sessionId).at(-1).filter.allow
  assert.ok(!allowOf(bee).some(name => name.startsWith('mcp__')))
  // The guard admits each child's own mount by its exact prefix, and nothing of the other's.
  assert.equal(guarded(b.ctx, a.sessionId, 'mcp__orders-a__lookup'), undefined)
  assert.equal(guarded(b.ctx, bee.sessionId, 'mcp__orders-b__lookup'), undefined)
  assert.match(guarded(b.ctx, bee.sessionId, 'mcp__orders-a__lookup'), FOREIGN, 'a forged call from B to A\'s tool')
  assert.match(guarded(b.ctx, a.sessionId, 'mcp__orders-b__lookup'), FOREIGN)
  for (const name of ['mcp__orders-a__', 'mcp__orders-ab__lookup', 'mcp__other__lookup']) assert.match(guarded(b.ctx, a.sessionId, name), /Answer children/, name)
  assert.equal((await preExecute(b, 'mcp__orders-a__lookup', bee.sessionId)).kind, 'deny')
  assert.equal((await preExecute(b, 'mcp__orders-a__lookup', a.sessionId)).kind, 'allow')
  // The pre-execute pass does not mount again for the same agent.
  assert.equal(b.fake.mounts().length, mounts)
})

test('person binding: no Session but A\'s own child may call A\'s mounted tools: not the bot\'s own, not an ordinary thread', async t => {
  const { b, a } = await twoPersons(t)
  const ordinary = await b.channels.threads.ensure(OTHER_INSTANCE, ELSEWHERE)
  assert.equal(ordinary.ok, true)
  assert.equal(ordinary.thread.answerChild, undefined)
  // The bot's own chat, any other Session DSH runs, and an ordinary chat thread.
  const callers = [b.channels.chatOf?.(ANSWER_MASTER), 'bot-own-session', ordinary.thread.sessionId].filter(id => typeof id === 'string' && id !== a.sessionId)
  assert.ok(callers.length >= 2)
  for (const sessionId of callers) {
    assert.match(guarded(b.ctx, sessionId, 'mcp__orders-a__lookup'), FOREIGN, sessionId)
    assert.match(guarded(b.ctx, sessionId, 'mcp__orders-b__lookup'), FOREIGN, sessionId)
    assert.deepEqual(await preExecute(b, 'mcp__orders-a__lookup', sessionId), { kind: 'deny', reason: 'Only the answer child of the person this tool was given to may use it.' }, sessionId)
    // A bot's own MCP tools, mounted for no person, are not this guard's business.
    assert.equal(guarded(b.ctx, sessionId, 'mcp__crm__lookup'), undefined, sessionId)
  }
  assert.equal(guarded(b.ctx, a.sessionId, 'mcp__orders-a__lookup'), undefined)
  // Once A's capability leaves, its name is nobody's.
  await b.call('omni-answer-settings', { ...b.settings, personBinding: false })
  for (const sessionId of callers) assert.equal(guarded(b.ctx, sessionId, 'mcp__orders-a__lookup'), undefined, sessionId)
})

test('person binding: a message for A\'s chat admitted by B\'s rule is held, warned once, and never rebinds', async t => {
  const { b, a } = await twoPersons(t)
  const before = b.team.state.subscriptionRuns.length
  await b.deliver(row(3, CHAT, FROM_B))
  await b.deliver(row(4, CHAT, FROM_B))
  assert.equal(b.team.state.subscriptionRuns.length, before, 'no run, failed or not')
  assert.equal(b.calls(CHAT), 1)
  assert.equal(b.childOf(CHAT).personRuleId, 'rule-a')
  assert.equal(b.warned.filter(args => /bound to one person/.test(args[0])).length, 1)
  assert.match(b.prompt(a.sessionId), /A-CONTEXT/)
  // answerFor holds as well, should a message reach it some other way.
  await assert.rejects(b.channels.threads.answerFor({ ownerBotId: ANSWER_MASTER, channelId: INSTANCE, chatId: CHAT, personRuleId: 'rule-b' }), { message: PERSON_HELD })
  await assert.rejects(b.channels.threads.answerFor({ ownerBotId: ANSWER_MASTER, channelId: INSTANCE, chatId: CHAT }), { message: PERSON_HELD })
  // A's own next message still reaches A's child.
  await b.deliver(row(5, CHAT, FROM_A))
  assert.equal(b.runs(CHAT), 2)
})

test('person binding: a bound child whose rule no longer admits its person gets nothing', async t => {
  const { b } = await twoPersons(t)
  delete b.rules.a
  t.mock.timers.tick(30_001)
  await b.deliver(row(3, CHAT, FROM_A))
  assert.equal(b.runs(CHAT), 1)
  // A wildcard now admits the sender: still not A's rule, so still held.
  b.rules.wide = ruleOf('rule-wide', null, { context: 'WIDE' }, { phonePattern: '5511*' })
  await b.deliver(row(4, CHAT, FROM_A))
  assert.equal(b.runs(CHAT), 1)
  assert.equal(b.childOf(CHAT).personRuleId, 'rule-a')
})

test('person binding: the binding survives a restart, and the context and capability return with the person\'s next message', async t => {
  const { b } = await twoPersons(t)
  await b.channels.quiesceOmniEvents()
  const again = await restart(t, b, b.home, { services: { permissionPresets: b.presets } })
  const fake = fakeHost(again.channels)
  const child = again.channels.threads.byChat(CHAT)
  assert.equal(child.personRuleId, 'rule-a')
  assert.equal(child.personMounted, 'orders-a')
  const prompt = () => again.ctx.sections.get('omni-thread').text({ agent: { id: child.sessionId } })
  assert.doesNotMatch(prompt(), /A-CONTEXT/, 'in memory only until the rule is read again')
  const deliver = await b.wire(again)
  const runs = () => again.team.state.subscriptionRuns.length
  const before = runs()
  await deliver(row(3, CHAT, FROM_B))
  assert.equal(runs(), before, 'held after the restart too')
  assert.equal(again.channels.threads.byChat(CHAT).personRuleId, 'rule-a', 'B\'s rule still cannot reach A\'s child')
  assert.equal(fake.mounts().length, 0)
  await deliver(row(4, CHAT, FROM_A))
  assert.equal(runs(), before + 1)
  assert.ok(fake.mounts().length > 0)
  for (const call of fake.mounts()) assert.deepEqual(call.slice(1), [child.sessionId, 'orders-a', { secrets: ['ORDERS_A_TOKEN'] }])
  assert.match(prompt(), /A-CONTEXT/)
  assert.equal(again.channels.threads.byChat(CHAT).personRuleId, 'rule-a')
})

test('person binding: a changed rule is read again after 30 seconds; its capability moves with it', async t => {
  const { b, a } = await twoPersons(t)
  b.rules.a = { ...b.rules.a, metadata: { context: 'A-CONTEXT: now evenings.', capability: 'billing-a' } }
  await b.deliver(row(3, CHAT, FROM_A))
  assert.equal(b.runs(CHAT), 2)
  assert.match(b.prompt(a.sessionId), /prefers morning calls/, 'the 30 s cache still holds')
  t.mock.timers.tick(30_001)
  await b.deliver(row(4, CHAT, FROM_A))
  assert.equal(b.runs(CHAT), 3)
  assert.match(b.prompt(a.sessionId), /now evenings/)
  assert.deepEqual(b.fake.unmounts().map(call => call.slice(1)), [[a.sessionId, 'orders-a']])
  assert.deepEqual(b.fake.mounts().at(-1).slice(1), [a.sessionId, 'billing-a', { secrets: [] }])
  assert.match(guarded(b.ctx, a.sessionId, 'mcp__orders-a__lookup'), /Answer children/)
  assert.equal(guarded(b.ctx, a.sessionId, 'mcp__billing-a__lookup'), undefined)
  assert.equal(b.childOf(CHAT).personMounted, 'billing-a')
  // A rule that names no capability any more takes it away.
  b.rules.a = { ...b.rules.a, metadata: { context: 'A-CONTEXT: now evenings.' } }
  t.mock.timers.tick(30_001)
  await b.deliver(row(5, CHAT, FROM_A))
  assert.equal(b.runs(CHAT), 4)
  assert.deepEqual(b.fake.unmounts().at(-1).slice(1), [a.sessionId, 'billing-a'])
  assert.equal(b.childOf(CHAT).personMounted, undefined)
  assert.match(guarded(b.ctx, a.sessionId, 'mcp__billing-a__lookup'), /Answer children/)
})

test('person binding: switching it off unmounts every child\'s capability and drops the context; the binding stays', async t => {
  const { b, a, bee } = await twoPersons(t)
  await b.call('omni-answer-settings', { ...b.settings, personBinding: false })
  assert.deepEqual(b.fake.unmounts().map(call => call.slice(1)).sort(), [[a.sessionId, 'orders-a'], [bee.sessionId, 'orders-b']].sort())
  assert.doesNotMatch(b.prompt(a.sessionId), /A-CONTEXT/)
  assert.match(guarded(b.ctx, a.sessionId, 'mcp__orders-a__lookup'), /Answer children/)
  assert.equal(b.childOf(CHAT).personRuleId, 'rule-a')
  // Off, a message for A's chat from B's rule is not held: as before person binding.
  await b.deliver(row(3, CHAT, FROM_B))
  assert.equal(b.runs(CHAT), 2)
  assert.equal(b.childOf(CHAT).personRuleId, 'rule-a')
})

test('person binding: removing a child unmounts its capability; a refused unmount warns and the removal goes on', async t => {
  const { b, a, bee } = await twoPersons(t)
  await b.channels.threads.remove(a.id)
  assert.deepEqual(b.fake.unmounts().map(call => call.slice(1)), [[a.sessionId, 'orders-a']])
  b.channels.unmountCapability = async () => { throw Object.assign(new Error('another dsh holds the team'), { code: 'bot/refused' }) }
  await b.channels.threads.remove(bee.id)
  assert.equal(b.childOf(CHAT_B), undefined)
  assert.equal(b.warned.filter(args => /did not leave/.test(args[0])).length, 1)
})

for (const [label, host, reason] of [
  ['the host has no mount call', null, PERSON_NO_HOST],
  ['the server needs approval', { state: 'needs-approval' }, /not approved/],
  ['the server failed', { state: 'error' }, /server exited/],
  ['the host answers another prefix', { prefix: 'mcp__' }, /tool prefix/],
]) test(`person binding: when ${label}, the child answers without the capability and warns once`, async t => {
  const b = await bench(t, { host: host ?? {} })
  if (host === null) { delete b.channels.mountCapability; delete b.channels.unmountCapability }
  await b.deliver(row(1, CHAT, FROM_A))
  await signal(t, b)
  await until(() => b.calls(CHAT) === 1)
  await b.deliver(row(2, CHAT, FROM_A))
  assert.equal(b.runs(CHAT), 2)
  const child = b.childOf(CHAT)
  assert.equal(child.personRuleId, 'rule-a')
  assert.match(b.prompt(child.sessionId), /A-CONTEXT/)
  const warnings = b.warned.filter(args => /answers without capability/.test(args[0]))
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0][2], 'orders-a')
  if (typeof reason === 'string') assert.equal(warnings[0][3], reason)
  else assert.match(warnings[0][3], reason)
  for (const name of ['mcp__orders-a__lookup', 'mcp__anything']) assert.match(guarded(b.ctx, child.sessionId, name), /Answer children/)
  assert.equal(child.personMounted, undefined)
  assert.doesNotMatch(b.prompt(child.sessionId), /own tools|mcp__/)
})

test('person binding: an unbound child binds once, on its first message a one-person rule admits', async t => {
  const b = await bench(t, { personBinding: false })
  b.rules.a = ruleOf('rule-wide', null, { context: 'WIDE' }, { phonePattern: '5511*' })
  await b.deliver(row(1, CHAT, FROM_A))
  await signal(t, b)
  await until(() => b.calls(CHAT) === 1)
  assert.equal(b.childOf(CHAT).personRuleId, undefined, 'off: nothing binds')
  assert.equal(b.fake.mounts().length, 0)
  await b.call('omni-answer-settings', { ...b.settings, personBinding: true })
  t.mock.timers.tick(30_001)
  await b.deliver(row(2, CHAT, FROM_A))
  assert.equal(b.runs(CHAT), 2)
  assert.equal(b.childOf(CHAT).personRuleId, undefined, 'a wildcard names no one person')
  assert.doesNotMatch(b.prompt(b.childOf(CHAT).sessionId), /WIDE|About this person/)
  b.rules.a = rulesFor().a
  t.mock.timers.tick(30_001)
  await b.deliver(row(3, CHAT, FROM_A))
  assert.equal(b.runs(CHAT), 3)
  assert.equal(b.childOf(CHAT).personRuleId, 'rule-a')
  b.rules.a = ruleOf('rule-a2', FROM_A, { context: 'A2' })
  t.mock.timers.tick(30_001)
  await b.deliver(row(4, CHAT, FROM_A))
  assert.equal(b.runs(CHAT), 3, 'another one-person rule is held, never rebound')
  assert.equal(b.childOf(CHAT).personRuleId, 'rule-a')
})

test('person binding: off by default, a bot binds nothing, mounts nothing and tells no child about anyone', async t => {
  const b = await bench(t, { personBinding: false })
  assert.equal(b.view().omniAnswers[ANSWER_MASTER].personBinding, false)
  assert.equal('personBinding' in b.channels.botOf(ANSWER_MASTER).answer, false)
  await b.deliver(row(1, CHAT, FROM_A))
  await b.deliver(row(2, CHAT_B, FROM_B))
  await signal(t, b)
  await until(() => b.calls(CHAT) === 1 && b.calls(CHAT_B) === 1)
  for (const chatId of [CHAT, CHAT_B]) {
    const child = b.childOf(chatId)
    assert.equal(child.personRuleId, undefined)
    assert.doesNotMatch(b.prompt(child.sessionId), /CONTEXT|About this person/)
  }
  assert.equal(b.fake.calls.length, 0)
  assert.ok(b.team.state.subscriptionRuns.every(run => !('personRuleId' in (run.event ?? {}))))
})

test('person binding: staff enable it only with isolated visibility and no unlimited read tool, in the settings call only', async t => {
  const b = await bench(t, { personBinding: false })
  await assert.rejects(b.call('omni-answer-settings', { ...b.settings, visibility: 'collective', personBinding: true }), { message: PERSON_COLLECTIVE })
  for (const tool of ['read', 'read_image', 'glob', 'grep']) {
    await assert.rejects(b.call('omni-answer-settings', { ...b.settings, allowedTools: [tool], personBinding: true }), { message: PERSON_UNLIMITED_READS }, tool)
  }
  assert.equal(b.view().omniAnswers[ANSWER_MASTER].personBinding, false)
  assert.equal((await b.call('omni-answer-settings', { ...b.settings, personBinding: true })).personBinding, true)
  // While it is on, a save that widens reads or visibility (an earlier client leaves it out) is refused.
  await assert.rejects(b.call('omni-answer-settings', { ...b.settings, visibility: 'collective' }), { message: PERSON_COLLECTIVE })
  await assert.rejects(b.call('omni-answer-settings', { ...b.settings, allowedTools: ['grep'] }), { message: PERSON_UNLIMITED_READS })
  assert.equal(b.view().omniAnswers[ANSWER_MASTER].personBinding, true)
  assert.equal(b.view().omniAnswers[ANSWER_MASTER].visibility, 'isolated')
  // No model tool sets it.
  assert.ok(![...b.ctx.registeredTools.keys()].some(name => /person|binding/i.test(name)))
})

test('person binding: binding refuses while a read tool could leave the chat, even when the settings were saved earlier', async t => {
  const { b } = await twoPersons(t)
  b.channels.botOf(ANSWER_MASTER).answer.allowedTools = ['read']
  const bot = b.channels.botOf(ANSWER_MASTER)
  delete b.childOf(CHAT_B).personRuleId
  await assert.rejects(b.channels.threads.answerFor({ ownerBotId: bot.id, channelId: INSTANCE, chatId: CHAT_B, personRuleId: 'rule-b' }), { message: PERSON_UNLIMITED_READS })
  assert.equal(b.childOf(CHAT_B).personRuleId, undefined)
})

// The intake's own answer: the admitting rule, cached with the decision.
function policy(check) {
  const calls = []
  const admit = answerIntake({
    warn() {},
    omniRequest: async (method, path, args) => {
      calls.push(path)
      if (path === '/access/check') return check(args.body)
      return path.startsWith('/instances/') ? reply({ channel: 'whatsapp-baileys', inboundMaxAgeMinutes: 10 }) : reply({ instanceId: INSTANCE, chatType: 'dm', externalId: `${FROM_A}@s.whatsapp.net` })
    },
  })
  return { admit, checks: () => calls.filter(path => path === '/access/check').length }
}

test('person intake: the allow rule that admitted a message rides with the decision and its 30 s cache', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: ANSWER_CLOCK })
  let rule = rulesFor().a
  const p = policy(() => reply({ allowed: true, rule }))
  const message = row(1, CHAT, FROM_A)
  const first = await p.admit(message, { detail: true })
  assert.deepEqual(first, { person: { ruleId: 'rule-a', context: 'A-CONTEXT: prefers morning calls.', capability: { name: 'orders-a', secrets: ['ORDERS_A_TOKEN'] } } })
  assert.equal(await p.admit(message), true, 'without detail, the answer stays a boolean')
  rule = rulesFor().b
  assert.deepEqual(await p.admit(message, { detail: true }), first)
  assert.equal(p.checks(), 1)
  t.mock.timers.tick(30_000)
  assert.equal((await p.admit(message, { detail: true })).person.ruleId, 'rule-b')
  assert.deepEqual(await p.admit({ ...message, rawPayload: { ...message.rawPayload, isFromMe: true } }, { detail: true }), { staff: true })
})

for (const [label, answer] of [
  ['access control is off (no rule)', { allowed: true }],
  ['a wildcard pattern', { allowed: true, rule: ruleOf('w', null, { context: 'x' }, { phonePattern: '5511*' }) }],
  ['an exact id beside a wildcard pattern', { allowed: true, rule: ruleOf('w', FROM_A, { context: 'x' }, { phonePattern: '*' }) }],
  ['a rule with no sender', { allowed: true, rule: ruleOf('w', null, { context: 'x' }) }],
  ['a rule in an unknown shape', { allowed: true, rule: 'rule-a' }],
]) test(`person intake: a message admitted by ${label} admits as before and binds nothing`, async () => {
  const p = policy(() => reply(answer))
  assert.deepEqual(await p.admit(row(1, CHAT, FROM_A), { detail: true }), { person: null })
  assert.equal(await p.admit(row(1, CHAT, FROM_A)), true)
})

test('person rule: context is text cut to a child\'s notes size, and a capability is a name or a name with its secrets', () => {
  const of = metadata => personOfRule(ruleOf('r', FROM_A, metadata))
  assert.equal(of({ context: `  ${'x'.repeat(PERSON_CONTEXT_MAX + 10)}  ` }).context.length, PERSON_CONTEXT_MAX)
  assert.equal(of({ context: 42 }).context, '')
  assert.equal(of(null).capability, null)
  assert.deepEqual(of({ capability: ' crm ' }).capability, { name: 'crm', secrets: [] })
  assert.deepEqual(of({ capability: { name: 'crm', secrets: ['B', 'A', 'B'] } }).capability, { name: 'crm', secrets: ['A', 'B'] })
  for (const capability of ['', 7, { secrets: ['A'] }, { name: 'crm', secrets: 'A' }]) assert.equal(of({ capability }).capability, null, JSON.stringify(capability))
  assert.equal(personOfRule({ ...ruleOf('r', FROM_A, {}), ruleType: 'deny' }), null)
})
