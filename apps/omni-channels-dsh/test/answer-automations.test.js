import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerAutomationMatcher } from '../src/host/answer-automations.js'
import { install } from '../src/host/omni-events.js'
import { answerBench, ANSWER_CLOCK, ANSWER_MASTER, CHAT, INSTANCE, MESSAGES, signal, until, use } from './thread-fixture.js'

const automation = (id = 'code', extra = {}) => ({ id, enabled: true, triggerEventType: 'message.received', triggerConditions: [{ field: 'instanceId', operator: 'eq', value: INSTANCE }], ...extra })
const row = (journalSeq = 1) => ({ id: `00000000-0000-4000-8000-${String(journalSeq).padStart(12, '0')}`, journalSeq, eventType: 'message.received', direction: 'inbound', instanceId: INSTANCE, chatUuid: CHAT, textContent: 'Sign-in code: 123456', metadata: { from: '5511988887777' }, rawPayload: { upsertType: 'notify' } })
const response = value => ({ ok: true, json: async () => value })
const result = (eventId, matched = true) => response({ eventId, matched, dryRun: true })

test('only enabled message automations applicable to this instance reach Omni; OR rules retain possible matches', async () => {
  const calls = []
  const items = [automation('other', { triggerConditions: [{ field: 'instanceId', operator: 'eq', value: 'other' }] }),
    automation('disabled', { enabled: false }), automation('reaction', { triggerEventType: 'reaction.received' }),
    automation('not-here', { triggerConditions: [{ field: 'instanceId', operator: 'neq', value: INSTANCE }] }),
    automation('here'), automation('global', { triggerConditions: null }),
    automation('or-text', { conditionLogic: 'or', triggerConditions: [{ field: 'instanceId', operator: 'eq', value: 'other' }, { field: 'content.text', operator: 'regex', value: 'code' }] })]
  const match = answerAutomationMatcher({ warn: () => assert.fail('no warnings'), omniRequest: async (method, path, args) => {
    calls.push([method, path, args])
    return method === 'GET' ? response({ items }) : result(args.body.eventId, false)
  } })
  assert.equal(await match(row()), false)
  assert.deepEqual(calls.filter(([method]) => method === 'POST').map(([, path]) => path), ['/automations/here/test', '/automations/global/test', '/automations/or-text/test'])
  assert.deepEqual(calls[1][2].body, { eventId: row().id }, 'use the journal id, never reconstructed/truncated text')
})

for (const failure of ['network', 403, 500, 'malformed', 'wrong-event']) test(`dry-run ${failure} fails open and warns once per instance`, async () => {
  const warnings = []
  const match = answerAutomationMatcher({ warn: (...args) => warnings.push(args), omniRequest: async method => {
    if (method === 'GET') return response({ items: [automation('global', { triggerConditions: [] })] })
    if (failure === 'network') throw new TypeError('fetch failed')
    if (failure === 'malformed') return response({ matched: 'true' })
    if (failure === 'wrong-event') return result('another-event')
    return { ok: false, status: failure }
  } })
  for (const event of [row(), row(2), { ...row(3), instanceId: 'other' }]) assert.equal(await match(event), false)
  assert.deepEqual(warnings.map(args => args.at(-1)), [INSTANCE, 'other'])
})

test('one unavailable automation does not hide an actual match from another', async () => {
  const warnings = []
  const match = answerAutomationMatcher({ warn: (...args) => warnings.push(args), omniRequest: async (method, path, args) => {
    if (method === 'GET') return response({ items: [automation('unavailable'), automation('matches')] })
    return path.includes('/unavailable/') ? { ok: false, status: 500 } : result(args.body.eventId)
  } })
  assert.equal(await match(row()), true)
  assert.equal(warnings.length, 1)
})

test('list cache coalesces messages, refreshes after 30 seconds, and retries a failed refresh without using stale rules', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: ANSWER_CLOCK })
  let lists = 0, failing = false, items = [automation()]
  const match = answerAutomationMatcher({ warn: () => {}, omniRequest: async (method, path, args) => {
    if (method !== 'GET') return result(args.body.eventId)
    lists += 1
    if (failing) return { ok: false, status: 403 }
    return response({ items })
  } })
  assert.deepEqual(await Promise.all([match(row()), match(row(2))]), [true, true])
  assert.equal(lists, 1)
  items = []
  t.mock.timers.tick(29_999)
  assert.equal(await match(row(3)), true)
  t.mock.timers.tick(1)
  assert.equal(await match(row(4)), false, 'deleted/disabled rules no longer suppress replies')
  assert.equal(lists, 2)
  failing = true
  t.mock.timers.tick(30_000)
  assert.equal(await match(row(5)), false)
  assert.equal(await match(row(6)), false)
  assert.equal(lists, 3, 'list failures are cached too')
  failing = false; items = [automation()]
  t.mock.timers.tick(30_000)
  assert.equal(await match(row(7)), true)
  assert.equal(lists, 4)
})

// Real answer subscription -> threads -> standing runs, fed through journal ingress.
// The plugin's normal consumers are unconfigured in the fake API; this isolated
// stream uses the same runtime without starting a service or touching live Omni.
async function ingress(t, b, { items = [automation()], test: dryRun = (_id, eventId) => result(eventId), allowed = true } = {}) {
  await b.channels.quiesceOmniEvents()
  const disposers = [], calls = [], warnings = [], acks = []
  let push
  const waiters = []
  const rt = Object.assign(Object.create(b.channels), {
    ctx: { effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) } },
    omniConfigured: async () => true,
    warn: (...args) => warnings.push(args),
    omniRequest: async (method, path, args) => {
      calls.push([method, path, args])
      if (path === `/instances/${INSTANCE}`) return response({ data: { channel: 'whatsapp-baileys', inboundMaxAgeMinutes: 10 } })
      if (path === '/access/check') return response({ data: { allowed } })
      if (path.startsWith('/automations?')) return response({ items })
      if (path.startsWith('/automations/')) return dryRun(path.split('/')[2], args.body.eventId)
      if (path.endsWith('/ack')) { acks.push(args.body.cursor); return response({}) }
      if (path.endsWith('/stream')) return { ok: true, body: new ReadableStream({
        start(controller) {
          push = events => controller.enqueue(Buffer.from(events.map(event => `id: ${event.journalSeq}\ndata: ${JSON.stringify(event)}\n\n`).join('')))
          args.signal.addEventListener('abort', () => controller.close(), { once: true })
          for (const ready of waiters) ready()
        },
      }) }
      if (path === '/events/consumers' || method === 'DELETE') return response({})
      return b.channels.omniRequest(method, path, args)
    },
  })
  install(rt)
  t.after(() => disposers.at(-1)())
  if (!push) await new Promise(resolve => waiters.push(resolve))
  return { rt, calls, warnings, async send(event) { push([event]); await until(() => acks.includes(event.journalSeq)) } }
}

test('an intake-refused sender never reaches automation matching, a child or staff pause', async t => {
  const b = await answerBench(t)
  const f = await ingress(t, b, { allowed: false, test: () => assert.fail('refused message reached automation matching') })
  b.channels.pauseAnswer = () => assert.fail('refused message paused staff')
  await f.send(row())
  assert.equal(b.made.length, 0)
  assert.equal(b.channels.threads.byChat(CHAT), undefined)
  assert.equal(f.calls.some(([, path]) => path.startsWith('/automations')), false)
})

test('matched first message creates no child or draft; unmatched message wakes one, matched later message stays in history', async t => {
  const b = await answerBench(t)
  const f = await ingress(t, b, { test: (_id, eventId) => result(eventId, eventId !== row(2).id) })
  const skipped = row()
  MESSAGES[skipped.id] = { id: skipped.id, chatId: CHAT, isFromMe: false, messageType: 'text', textContent: skipped.textContent, platformTimestamp: new Date().toISOString() }
  t.after(() => { delete MESSAGES[skipped.id] })
  await f.send(row())
  assert.equal(b.made.length, 0)
  assert.equal(b.channels.threads.byChat(CHAT), undefined)
  assert.equal(b.team.state.subscriptionRuns?.length ?? 0, 0)
  assert.equal(b.omni.sent.length, 0)
  await f.send(row(2))
  await signal(t, b)
  const child = b.channels.threads.byChat(CHAT)
  await until(() => b.agentOf(child.sessionId).calls.length === 1)
  const runs = b.team.state.subscriptionRuns.length
  await f.send(row(3))
  await signal(t, b)
  assert.equal(b.made.length, 1)
  assert.equal(b.agentOf(child.sessionId).calls.length, 1, 'matched event never wakes the existing child')
  assert.equal(b.team.state.subscriptionRuns.length, runs, 'no queued run or draft for a matched event')
  assert.equal(b.omni.sent.length, 0)
  const history = await use(b, 'thread_history', child.sessionId, { chatId: CHAT })
  assert.match(history, /Sign-in code: 123456/, 'a skipped message is still readable from chat history')
  assert.equal(f.calls.filter(([, path]) => path.startsWith('/automations?')).length, 1)
})

test('plugin-owned subscriptions and receipt consumers never count as Omni automation matches', async t => {
  const b = await answerBench(t)
  b.team.state.subscriptions.local = { id: 'local', ownerBotId: ANSWER_MASTER, name: 'Local observer', on: true, sources: [{ kind: 'chat', id: CHAT, channelId: INSTANCE }], trigger: { kind: 'message' }, worker: { kind: 'thread' }, askFirst: true, outputs: {}, createdAt: 1 }
  const f = await ingress(t, b, { items: [] })
  await f.send(row())
  assert.ok(b.channels.threads.byChat(CHAT), 'answer subscription must not match itself')
  assert.ok(b.team.state.subscriptionRuns.some(run => run.subId === `answer:${ANSWER_MASTER}`))
  assert.ok(b.team.state.subscriptionRuns.some(run => run.subId === 'local'))
  assert.ok(f.calls.some(([, path]) => path === '/events/consumers'))
  assert.equal(f.calls.some(([, path]) => path.startsWith('/automations/') && path.endsWith('/test')), false)
})

test('a dry-run error answers normally and warns only once across messages', async t => {
  const b = await answerBench(t)
  const f = await ingress(t, b, { test: () => { throw new TypeError('network failed') } })
  await f.send(row())
  await f.send(row(2))
  assert.ok(b.channels.threads.byChat(CHAT))
  assert.equal(b.team.state.subscriptionRuns.filter(run => run.subId === `answer:${ANSWER_MASTER}`).length, 2)
  assert.equal(f.warnings.length, 1)
})

test('ordinary subscriptions still run on a matched answer-mode message', async t => {
  const b = await answerBench(t)
  b.team.state.subscriptions.local = { id: 'local', ownerBotId: ANSWER_MASTER, name: 'Local observer', on: true, sources: [{ kind: 'chat', id: CHAT, channelId: INSTANCE }], trigger: { kind: 'message' }, worker: { kind: 'thread' }, askFirst: true, outputs: {}, createdAt: 1 }
  const f = await ingress(t, b)
  await f.send(row())
  assert.ok(b.team.state.subscriptionRuns.some(run => run.subId === 'local'))
  assert.equal(b.team.state.subscriptionRuns.some(run => run.subId === `answer:${ANSWER_MASTER}`), false)
})
