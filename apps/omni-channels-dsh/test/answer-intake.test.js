import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerIntake } from '../src/host/answer-intake.js'
import { install } from '../src/host/omni-events.js'
import { answerBench, ANSWER_CLOCK, CHAT, INSTANCE, signal, until } from './thread-fixture.js'

const reply = data => ({ ok: true, json: async () => ({ data }) })
const person = (journalSeq = 1, changes = {}) => ({
  id: `intake-${journalSeq}`, journalSeq, externalId: `WA-intake-${journalSeq}`, eventType: 'message.received',
  direction: 'inbound', instanceId: INSTANCE, chatUuid: CHAT, chatId: '5511988887777@s.whatsapp.net',
  metadata: { from: '5511988887777' }, textContent: 'Where is my order?',
  rawPayload: { upsertType: 'notify', messageTimestamp: Math.floor(Date.now() / 1000) }, ...changes,
})

// Real team + channels + standing queue, fed through the durable SSE ingress. No
// one-bot fixtures or their API answers are widened for answer mode.
async function bench(t, { channel = 'whatsapp-baileys', access = () => true } = {}) {
  const b = await answerBench(t, { clock: ANSWER_CLOCK })
  await b.channels.quiesceOmniEvents()
  const request = b.channels.omniRequest, acks = []
  let queue = [], wake, closed = false
  b.channels.omniRequest = async (method, path, args) => {
    if (path === `/instances/${INSTANCE}`) return reply({ channel, inboundMaxAgeMinutes: 10 })
    if (path === '/access/check') return reply({ allowed: access(args.body.platformUserId) })
    if (path === '/automations?enabled=true') return { ok: true, json: async () => ({ items: [] }) }
    if (path === '/events/consumers' || method === 'DELETE' && path.startsWith('/events/consumers/')) return { ok: true }
    if (path.endsWith('/ack')) { acks.push(args.body.cursor); return { ok: true } }
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
  install(b.channels)
  await b.channels.syncOmniEvents()
  t.after(() => b.channels.quiesceOmniEvents())
  return { ...b, acks, async deliver(row) { queue.push(row); wake?.(); await until(() => acks.includes(row.journalSeq)) } }
}

for (const [label, changes, options] of [
  ['refused sender', {}, { access: () => false }],
  ['access check error', {}, { access: () => { throw new Error('access unavailable') } }],
  ['group JID', { chatId: '120000@g.us' }],
  ['non-DM chat type', { chatType: 'group' }],
  ['status broadcast', { chatId: 'status@broadcast' }],
  ['own message', { rawPayload: { upsertType: 'notify', isFromMe: true } }],
  ['explicit history', { rawPayload: { upsertType: 'notify', isHistorySync: true } }],
  ['initial QR history without upsertType', { rawPayload: { messageTimestamp: ANSWER_CLOCK / 1000 } }],
  ['append echo', { rawPayload: { upsertType: 'append' } }],
  ['stale platform timestamp', { rawPayload: { upsertType: 'notify', messageTimestamp: (ANSWER_CLOCK - 600_001) / 1000 } }],
  ['Cloud API history marker', { rawPayload: { isHistorySync: true, coexistence: 'history', messageTimestamp: ANSWER_CLOCK / 1000 } }, { channel: 'whatsapp-business' }],
]) test(`answer intake: ${label} creates no child and cannot wake or pause an existing child`, async t => {
  let allow = false
  const b = await bench(t, options?.access ? { access: id => allow ? true : options.access(id) } : options)
  await b.deliver(person(1, changes))
  assert.deepEqual([b.made.length, b.omni.children().length, b.channels.threads.byChat(CHAT)], [0, 0, undefined])
  allow = true
  // Refresh the intake lookups before sending the allowed DM.
  t.mock.timers.tick(30_001)
  await b.deliver(person(2, { rawPayload: { upsertType: 'notify' } }))
  await signal(t, b)
  const child = b.channels.threads.byChat(CHAT)
  await until(() => b.agentOf(child.sessionId).calls.length === 1)
  const before = JSON.stringify([child.paused, child.lastStaffAt, child.staffReceipts])
  // A different sender avoids reusing the allowed DM's access decision.
  allow = false
  await b.deliver(person(3, { ...changes, metadata: { from: '5511977776666', ...changes.metadata } }))
  assert.equal(b.made.length, 1)
  assert.equal(b.omni.children().length, 1)
  assert.equal(b.team.state.subscriptionRuns.length, 1, 'no second queue admission')
  assert.equal(b.agentOf(child.sessionId).calls.length, 1)
  assert.equal(JSON.stringify([child.paused, child.lastStaffAt, child.staffReceipts]), before, 'filtered messages do not pause the child')
})

test('answer intake: Cloud API live DMs without Baileys notify proof are answered', async t => {
  const b = await bench(t, { channel: 'whatsapp-business' })
  await b.deliver(person(1, { rawPayload: {} }))
  await signal(t, b)
  await until(() => b.agentOf(b.channels.threads.byChat(CHAT).sessionId).calls.length === 1)
  assert.match(JSON.stringify(b.agentOf(b.channels.threads.byChat(CHAT).sessionId).calls[0]), /Answer the person in your own chat/)
})

function policy({ check = () => reply({ allowed: true }), instance = () => reply({ channel: 'whatsapp-baileys', inboundMaxAgeMinutes: 10 }), chat = () => reply({ instanceId: INSTANCE, chatType: 'dm', externalId: '5511988887777@s.whatsapp.net' }) } = {}) {
  const calls = [], warnings = []
  const admit = answerIntake({
    warn: (...args) => warnings.push(args),
    omniRequest: async (method, path, args) => {
      calls.push([method, path, args?.body])
      if (path === '/access/check') return check(args.body)
      return path.startsWith('/instances/') ? instance() : chat()
    },
  })
  return { admit, calls, warnings, checks: () => calls.filter(call => call[1] === '/access/check') }
}

test('answer intake: LID access follows dispatcher primary, participantAlt, resolved phone order', async () => {
  const p = policy({ check: body => reply({ allowed: body.platformUserId === '5511966665555' }) })
  assert.equal(await p.admit(person(1, { metadata: { from: '123456789@lid' }, rawPayload: { upsertType: 'notify', key: { participantAlt: '5511988887777@s.whatsapp.net' }, resolvedSenderPhone: '5511966665555' } })), true)
  assert.deepEqual(p.checks().map(call => call[2]), ['123456789@lid', '5511988887777', '5511966665555'].map(platformUserId => ({ instanceId: INSTANCE, platformUserId, channel: 'whatsapp-baileys' })))
})

for (const failure of ['transport', 'http', 'malformed']) test(`answer intake: ${failure} access error fails closed and warns once per instance`, async () => {
  const p = policy({ check: () => { if (failure === 'transport') throw Error('offline'); return failure === 'http' ? { ok: false, status: 503 } : reply({ allowed: 'yes' }) } })
  for (const from of ['5511988887777', '5511977776666']) assert.equal(await p.admit(person(1, { metadata: { from } })), false)
  assert.equal(p.warnings.length, 1)
  assert.equal(p.warnings[0][1], INSTANCE)
})

for (const failure of ['transport', 'http', 'malformed']) test(`answer intake: ${failure} access errors are not cached for the same sender`, async () => {
  let failing = true
  const p = policy({ check: () => {
    if (!failing) return reply({ allowed: true })
    if (failure === 'transport') throw Error('offline')
    return failure === 'http' ? { ok: false, status: 503 } : reply({ allowed: 'yes' })
  } })
  assert.equal(await p.admit(person()), false)
  assert.equal(await p.admit(person(2)), false)
  assert.equal(p.checks().length, 2)
  assert.equal(p.warnings.length, 1)
  failing = false
  assert.equal(await p.admit(person(3)), true)
  assert.equal(p.checks().length, 3)
})

test('answer intake: a person admitted by an access rule is allowed on their next message within 30 seconds', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: ANSWER_CLOCK })
  let allowed = false
  const p = policy({ check: () => reply({ allowed }) })
  assert.equal(await p.admit(person()), false)
  allowed = true
  t.mock.timers.tick(1_000)
  assert.equal(await p.admit(person(2)), true)
  assert.equal(p.checks().length, 2)
  assert.equal(p.calls.filter(call => call[1].startsWith('/instances/')).length, 1)
  assert.equal(p.calls.filter(call => call[1].startsWith('/chats/')).length, 1)
})

test('answer intake: allowed senders are cached within 30 seconds and rechecked at expiry', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: ANSWER_CLOCK })
  const p = policy()
  assert.equal(await p.admit(person()), true)
  t.mock.timers.tick(29_999)
  assert.equal(await p.admit(person(2)), true)
  assert.equal(p.checks().length, 1)
  t.mock.timers.tick(1)
  assert.equal(await p.admit(person(3)), true)
  assert.equal(p.checks().length, 2)
})

test('answer intake: instance, chat and allowed sender decisions refresh after 30 seconds', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: ANSWER_CLOCK })
  let allowed = false, minutes = 10
  const p = policy({ check: () => reply({ allowed }), instance: () => reply({ channel: 'whatsapp-baileys', inboundMaxAgeMinutes: minutes }) })
  assert.equal(await p.admit(person()), false)
  allowed = true
  assert.equal(await p.admit(person()), true)
  assert.equal(p.checks().length, 2)
  t.mock.timers.tick(30_000)
  assert.equal(await p.admit(person()), true)
  assert.equal(p.checks().length, 3)
  assert.equal(p.calls.filter(call => call[1].startsWith('/instances/')).length, 2)
  assert.equal(p.calls.filter(call => call[1].startsWith('/chats/')).length, 2)
  allowed = false
  assert.equal(await p.admit(person()), true, 'the allowed decision is briefly cached too')
  t.mock.timers.tick(30_000)
  assert.equal(await p.admit(person()), false, 'a revoked sender is refused after refresh')
  minutes = 0
  allowed = true
  t.mock.timers.tick(30_000)
  assert.equal(await p.admit(person(2, { rawPayload: { upsertType: 'notify', messageTimestamp: 1 } })), true)
  minutes = -1
  t.mock.timers.tick(30_000)
  assert.equal(await p.admit(person(3, { rawPayload: { upsertType: 'notify', messageTimestamp: 1 } })), true)
})

for (const [label, timestamp, accepted] of [
  ['seconds boundary', (ANSWER_CLOCK - 600_000) / 1000, true],
  ['milliseconds stale', ANSWER_CLOCK - 600_001, false],
  ['string seconds stale', String((ANSWER_CLOCK - 601_000) / 1000), false],
  ['protobuf Long stale', { low: (ANSWER_CLOCK - 601_000) / 1000, high: 0 }, false],
  ['unsigned post-2038 Long', { low: 2300000000 | 0, high: 0 }, true],
  ['missing timestamp', undefined, true],
]) test(`answer intake: platform age matches the dispatcher for ${label}`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: ANSWER_CLOCK })
  assert.equal(await policy().admit(person(1, { rawPayload: { upsertType: 'notify', messageTimestamp: timestamp } })), accepted)
})

for (const chat of [
  { instanceId: INSTANCE, chatType: 'group', externalId: 'group' },
  { instanceId: INSTANCE, chatType: 'dm', externalId: 'status@broadcast' },
  { instanceId: INSTANCE, chatType: 'dm', externalId: '12000@g.us' },
]) test(`answer intake: canonical chat ${chat.chatType}/${chat.externalId} is refused`, async () => {
  const p = policy({ chat: () => reply(chat) })
  assert.equal(await p.admit(person()), false)
  assert.equal(p.checks().length, 0)
})

test('answer intake: a history-marked own receipt cannot reach the staff pause path', async t => {
  const b = await bench(t)
  await b.deliver(person())
  const child = b.channels.threads.byChat(CHAT), pauses = []
  b.channels.pauseAnswer = async value => pauses.push(value)
  await b.deliver(person(2, { direction: 'outbound', rawPayload: { upsertType: 'notify', isHistorySync: true, isFromMe: true, key: { fromMe: true, id: 'WA-intake-2' } } }))
  assert.equal(b.channels.threads.byChat(CHAT).id, child.id)
  assert.deepEqual(pauses, [])
})
