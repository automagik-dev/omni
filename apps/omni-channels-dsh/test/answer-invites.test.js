// #1716: a person whose first message carries a valid invite code is let in with no manual step:
// Redeem against the code list staff upload, one allow rule, the message admitted in the same pass.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RATE_MAX } from '../src/host/answer-invites.js'
import { codesIn, INVITE_CODES_MAX, normalizeCode } from '../src/host/invite-codes.js'
import { inviteRedeem } from '../src/host/invite-redeem.js'
import { install } from '../src/host/omni-events.js'
import { ANSWER_CHAT_TOOLS, INVITE_WELCOME_MAX } from '../src/host/threads.js'
import { ANSWER_CLOCK, ANSWER_MASTER, answerBench, CHAT, CHATS, INSTANCE, saved, signal, until, use } from './thread-fixture.js'

const DAY = 24 * 60 * 60_000
// Made-up ids and codes: a phone an allow rule names, a phone no rule names, a lid, and codes
// of the invite shape.
const PHONE = '5500000000001'
const STRANGER = '5500000000042'
const LID = '100000000000042'
const CODE = 'INV-7K2QX9MD0'
const OTHER = 'INV-3N8RW4HT5'
const LATE = 'INV-9P6VY2JC8'
const SPARE = 'INV-5G4ZB7KA2'
const WELCOME = 'Welcome! You are in. Ask us anything here.'
const reply = data => ({ ok: true, json: async () => ({ data }) })
const now = () => Math.floor(Date.now() / 1000)
const inDays = days => new Date(ANSWER_CLOCK + days * DAY).toISOString()
// A person writing for the first time, known only by their lid.
const lidOnly = (journalSeq, text) => ({
  id: `lid-${journalSeq}`, journalSeq, externalId: `WA-lid-${journalSeq}`, eventType: 'message.received',
  direction: 'inbound', instanceId: INSTANCE, chatUuid: CHAT, chatId: `${LID}@lid`, metadata: { from: LID }, textContent: text, contentType: 'text',
  rawPayload: { upsertType: 'notify', addressingMode: 'lid', messageTimestamp: now(), key: { id: `WA-lid-${journalSeq}`, remoteJid: `${LID}@lid`, fromMe: false } },
})
// A person whose phone Omni knows, and whom no allow rule names.
const stranger = (journalSeq, text, from = STRANGER) => ({
  id: `stranger-${journalSeq}`, journalSeq, externalId: `WA-stranger-${journalSeq}`, eventType: 'message.received',
  direction: 'inbound', instanceId: INSTANCE, chatUuid: CHAT, chatId: `${from}@s.whatsapp.net`, metadata: { from }, textContent: text, contentType: 'text',
  rawPayload: { upsertType: 'notify', messageTimestamp: now(), key: { id: `WA-stranger-${journalSeq}`, remoteJid: `${from}@s.whatsapp.net`, fromMe: false } },
})

// Omni as the answer bench needs it: an allowlist with one phone, the rules written, the ids a
// rule of their own refuses (`deny`), and the sends made.
function omniOf({ externalId = `${LID}@lid` } = {}) {
  return { externalId, rules: [], deny: {}, denyOnce: new Set(), checks: [], posts: [], sends: [], acks: [], chatReads: 0, ruleStatus: 201, sendStatus: 201 }
}
async function attach(t, run, omni) {
  await run.channels.quiesceOmniEvents()
  const request = run.channels.omniRequest
  let queue = [], wake, closed = false
  run.warned = []
  run.channels.warn = (...args) => { run.warned.push(args) }
  run.channels.omniRequest = async (method, path, args) => {
    if (path === `/instances/${INSTANCE}`) return reply({ channel: 'whatsapp-baileys', inboundMaxAgeMinutes: 10 })
    if (path === `/chats/${CHAT}` && method === 'GET') { omni.chatReads += 1; return reply({ ...CHATS[CHAT], externalId: omni.externalId, canonicalId: null }) }
    if (path === '/access/check') {
      const id = args.body.platformUserId
      omni.checks.push(id)
      const action = omni.deny[id]
      if (action) return reply({ allowed: false, rule: { id: `deny-${action}`, ruleType: 'deny', action, instanceId: INSTANCE } })
      if (omni.denyOnce.delete(id)) return reply({ allowed: false })
      const rule = omni.rules.find(rule => rule.platformUserId === id)
      if (rule) return reply({ allowed: true, rule })
      return reply({ allowed: id === PHONE })
    }
    if (path === '/access/rules' && method === 'POST') {
      omni.posts.push(args.body)
      if (omni.ruleStatus >= 300) return { ok: false, status: omni.ruleStatus, json: async () => ({}) }
      const rule = { id: `rule-${omni.rules.length + 1}`, phonePattern: null, personId: null, enabled: true, priority: 0, ...args.body }
      omni.rules.push(rule)
      return { ok: true, status: 201, json: async () => ({ data: rule }) }
    }
    if (path === `/access/rules?instanceId=${INSTANCE}&type=allow`) return { ok: true, json: async () => ({ items: [{ ruleType: 'allow', phonePattern: `+${PHONE}`, enabled: true }, ...omni.rules] }) }
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
  let acked = 0
  run.deliver = async row => { const before = acked; queue.push(row); wake?.(); await until(() => omni.acks.length > before); acked = omni.acks.length }
  return Object.assign(run, { omniState: omni })
}
// The bench with the code list uploaded; `settings` change the answer settings first.
async function bench(t, { settings = {}, omni: options, entries = defaultEntries() } = {}) {
  const run = await answerBench(t, { clock: ANSWER_CLOCK })
  if (Object.keys(settings).length > 0) await run.call('omni-answer-settings', { ...run.settings, ...settings })
  const b = await attach(t, run, omniOf(options))
  if (entries.length > 0) await b.call('omni-invite-codes-add', { entries })
  return b
}
const defaultEntries = () => [
  { code: CODE, project: 'proj-a', expiresAt: inDays(7), context: 'Invited to proj-a by its team.', capability: 'proj-a-tools', inviteId: 'invite-a' },
  { code: OTHER, project: 'proj-b', expiresAt: inDays(7) },
  { code: LATE, project: 'proj-a', expiresAt: inDays(-1) },
  { code: SPARE, project: 'proj-c', expiresAt: inDays(7) },
]
const kept = b => Object.values(b.team.state.omniAnswerKept ?? {})
const stateOf = (b, code) => b.channels.state.omniInviteCodes?.[code]
const runs = b => b.team.state.subscriptionRuns?.length ?? 0
const callsOf = b => {
  const child = b.channels.threads.byChat(CHAT)
  return child ? b.agentOf(child.sessionId).calls : []
}
const ALL_CODES = [CODE, OTHER, LATE, SPARE]
const noCodeIn = (label, text) => { for (const code of ALL_CODES) assert.equal(String(text).toUpperCase().includes(code), false, `${label} names a code`) }

test('invite detection: only INV- and 9 Crockford characters, O read as 0 and I/L as 1 in the tail only, at most 2', () => {
  assert.deepEqual(codesIn('hi inv-7k2qx9mdo, here it is'), ['INV-7K2QX9MD0'])
  assert.deepEqual(codesIn('(INV-3N8RWLHTI).'), ['INV-3N8RW1HT1'])
  // Never the prefix: "lNV-" is not "INV-", and a U stays a U, which no code has.
  assert.deepEqual(codesIn('lnv-7K2QX9MD0 INV-7K2QX9MDU INV-UUUUUUUUU'), [])
  // Ordinary words, order numbers, phones, other prefixes and lengths never trigger.
  assert.deepEqual(codesIn('Order 123456789 and #A1B2C3D4E5, call 5500000000001, ref INV-12345678, INV-1234567890, XINV-7K2QX9MD0, INV-7K2QX9MD0X, INV_7K2QX9MD0, invitation 2026'), [])
  // At most two per message, in their order, each once.
  assert.deepEqual(codesIn(`${OTHER} ${OTHER.toLowerCase()} ${CODE} ${SPARE}`), [OTHER, CODE])
  assert.equal(normalizeCode(' inv-7k2qx9mdo '), CODE)
  assert.equal(normalizeCode('INV-7K2QX9MD'), undefined)
})

test('invite codes: Redeem uses a code once, before its expiry, and a retry from the same sender answers the same ok', async t => {
  const b = await bench(t, { entries: [] })
  await b.call('omni-invite-codes-add', { entries: defaultEntries() })
  const redeem = inviteRedeem(b.channels)
  const first = await redeem({ code: 'inv-7k2qx9mdo', channel: 'whatsapp', sender: { lid: LID } })
  assert.deepEqual(first, { ok: true, project: 'proj-a', inviteId: 'invite-a', context: 'Invited to proj-a by its team.', capability: 'proj-a-tools' })
  // Saved before ok was answered.
  assert.deepEqual(saved(b.home).omniInviteCodes[CODE].used, { by: { lid: LID }, at: Date.now() })
  // The same sender again, by any id they share: the same ok. Another sender: used.
  assert.deepEqual(await redeem({ code: CODE, channel: 'whatsapp', sender: { lid: LID } }), first)
  assert.deepEqual(await redeem({ code: CODE, channel: 'whatsapp', sender: { lid: LID, phone: STRANGER } }), first)
  assert.deepEqual(await redeem({ code: CODE, channel: 'whatsapp', sender: { phone: STRANGER } }), { ok: false, reason: 'used' })
  assert.deepEqual(await redeem({ code: LATE, channel: 'whatsapp', sender: { lid: LID } }), { ok: false, reason: 'expired' })
  assert.deepEqual(await redeem({ code: 'INV-222222222', channel: 'whatsapp', sender: { lid: LID } }), { ok: false, reason: 'unknown' })
  // A phone-only sender redeems another code; the same phone again is the same ok.
  const other = await redeem({ code: OTHER, channel: 'whatsapp', sender: { phone: STRANGER } })
  assert.equal(other.ok, true)
  assert.deepEqual(await redeem({ code: OTHER, channel: 'whatsapp', sender: { lid: LID, phone: STRANGER } }), other)
  // An open code passes its expiry and is expired from then on.
  t.mock.timers.setTime(Date.parse(inDays(7)))
  assert.deepEqual(await redeem({ code: SPARE, channel: 'whatsapp', sender: { lid: LID } }), { ok: false, reason: 'expired' })
  assert.deepEqual((await b.call('omni-invite-codes', {})).codes.map(row => [row.code, row.project, row.state]),
    [[SPARE, 'proj-c', 'expired'], [LATE, 'proj-a', 'expired'], [OTHER, 'proj-b', 'used'], [CODE, 'proj-a', 'used']])
})

test('invite codes: a Redeem whose save fails answers no ok and leaves the code open', async t => {
  const b = await bench(t)
  const redeem = inviteRedeem(b.channels)
  const save = b.channels.save
  b.channels.save = () => Promise.reject(new Error('disk full'))
  await assert.rejects(redeem({ code: CODE, channel: 'whatsapp', sender: { lid: LID } }), /not saved: disk full/)
  assert.equal(stateOf(b, CODE).used, undefined)
  b.channels.save = save
  // Still open: another sender can have it.
  assert.equal((await redeem({ code: CODE, channel: 'whatsapp', sender: { phone: STRANGER } })).ok, true)
})

test('invite codes: the upload normalises codes, gives each an invite id, keeps the newest 5000 and leaves a used code as it is', async t => {
  const b = await bench(t, { entries: [] })
  const added = await b.call('omni-invite-codes-add', { entries: [{ code: 'inv-7k2qx9mdo', project: 'proj-a', expiresAt: inDays(7) }, { code: OTHER, project: 'proj-b', expiresAt: inDays(3), context: 'A note.' }] })
  assert.deepEqual(added, { added: 2, updated: 0, used: 0, count: 2 })
  assert.match(stateOf(b, CODE).inviteId, /^[0-9a-f-]{36}$/)
  assert.equal(saved(b.home).omniInviteCodes[CODE].project, 'proj-a')
  // An open code uploaded again takes the new fields and keeps its id.
  const otherId = stateOf(b, OTHER).inviteId
  assert.deepEqual(await b.call('omni-invite-codes-add', { entries: [{ code: OTHER, project: 'proj-b2', expiresAt: inDays(30) }] }), { added: 0, updated: 1, used: 0, count: 2 })
  assert.deepEqual([stateOf(b, OTHER).project, stateOf(b, OTHER).expiresAt, stateOf(b, OTHER).inviteId, stateOf(b, OTHER).context], ['proj-b2', inDays(30), otherId, undefined])
  // A used code uploaded again is left as it is: its person's retry gets the same ok.
  const redeem = inviteRedeem(b.channels)
  const first = await redeem({ code: CODE, channel: 'whatsapp', sender: { lid: LID } })
  const record = structuredClone(stateOf(b, CODE))
  assert.deepEqual(await b.call('omni-invite-codes-add', { entries: [{ code: CODE, project: 'proj-z', expiresAt: inDays(30), context: 'Another note.' }] }), { added: 0, updated: 0, used: 1, count: 2 })
  assert.deepEqual(stateOf(b, CODE), record)
  assert.deepEqual(await redeem({ code: CODE, channel: 'whatsapp', sender: { lid: LID } }), first)
  // One bad entry changes nothing, and the refusal names it by its place, never the code.
  const bad = 'INV-7K2QX9MDU'
  const refusal = await b.call('omni-invite-codes-add', { entries: [{ code: SPARE, project: 'proj-c', expiresAt: inDays(7) }, { code: bad, project: 'proj-c', expiresAt: inDays(7) }] }).then(() => null, error => error.message)
  assert.match(refusal, /^Entry 2: the code is not an invite code/)
  assert.equal(refusal.includes(bad), false)
  assert.equal(stateOf(b, SPARE), undefined)
  await assert.rejects(b.call('omni-invite-codes-add', { entries: [{ code: SPARE, project: 'proj-c', expiresAt: '2026-11-30' }] }), /Entry 1: expiresAt/)
  await assert.rejects(b.call('omni-invite-codes-add', { entries: [{ code: SPARE, project: 'proj-c', expiresAt: inDays(7), context: 'x'.repeat(8001) }] }), /Entry 1: context/)
  // A save that fails puts the list back.
  const save = b.channels.save
  b.channels.save = () => Promise.reject(new Error('disk full'))
  await assert.rejects(b.call('omni-invite-codes-add', { entries: [{ code: SPARE, project: 'proj-c', expiresAt: inDays(7) }] }), /disk full/)
  assert.deepEqual(Object.keys(b.channels.state.omniInviteCodes), [CODE, OTHER])
  b.channels.save = save
  // The newest INVITE_CODES_MAX stay: the oldest go first.
  const many = Array.from({ length: INVITE_CODES_MAX }, (_, index) => ({ code: `INV-${String(index).padStart(9, '0')}`, project: 'proj-d', expiresAt: inDays(7) }))
  assert.deepEqual(await b.call('omni-invite-codes-add', { entries: many }), { added: INVITE_CODES_MAX, updated: 0, used: 0, count: INVITE_CODES_MAX })
  assert.equal(stateOf(b, OTHER), undefined)
  assert.equal(stateOf(b, CODE), undefined)
  assert.equal((await b.call('omni-invite-codes', {})).codes[0].code, `INV-${String(INVITE_CODES_MAX - 1).padStart(9, '0')}`)
})

test('invite admission: a lid-only sender with a valid code is let in at once, by one rule on the lid, and the person is bound', async t => {
  const b = await bench(t, { settings: { personBinding: true } })
  // Typed by hand: lower case, and the letter O for the last zero.
  await b.deliver(lidOnly(1, 'Hi! My code is inv-7k2qx9mdo'))
  // One rule, keyed on the lid, with the invite's metadata; nothing kept, nothing sent.
  assert.deepEqual(b.omniState.posts, [{
    instanceId: INSTANCE, ruleType: 'allow', action: 'allow', platformUserId: LID, reason: 'invite',
    metadata: { source: 'invite', project: 'proj-a', inviteId: 'invite-a', context: 'Invited to proj-a by its team.', capability: 'proj-a-tools' },
  }])
  assert.deepEqual(kept(b), [])
  assert.deepEqual(b.omniState.sends, [])
  assert.deepEqual(saved(b.home).omniInviteCodes[CODE].used.by, { lid: LID })
  // The child takes the code message, bound to the person by that rule; no re-check was waited for.
  await signal(t, b)
  await until(() => callsOf(b).length === 1)
  assert.match(JSON.stringify(callsOf(b)[0]), /My code is inv-7k2qx9mdo/)
  assert.equal(b.channels.threads.byChat(CHAT).personRuleId, 'rule-1')
  noCodeIn('a warning', JSON.stringify(b.warned))
})

test('invite admission: a replay writes no second rule, and an id Omni already lets in gets none', async t => {
  const b = await bench(t)
  const row = lidOnly(1, `code ${CODE}`)
  await b.deliver(row)
  assert.equal(b.omniState.rules.length, 1)
  // The same row again (a restart before its ack), and the code again: the rule admits them.
  await b.deliver({ ...row, journalSeq: 2 })
  await b.deliver(lidOnly(3, `code ${CODE} again`))
  assert.equal(b.omniState.posts.length, 1)
  // A sender refused a moment ago whom Omni lets in by now: Redeem, then no rule written.
  b.omniState.rules.push({ id: 'rule-staff', ruleType: 'allow', instanceId: INSTANCE, platformUserId: STRANGER, phonePattern: null, metadata: {} })
  b.omniState.denyOnce.add(STRANGER)
  b.omniState.externalId = `${STRANGER}@s.whatsapp.net`
  await b.deliver(stranger(4, `here: ${OTHER}`))
  assert.equal(b.omniState.posts.length, 1)
  assert.deepEqual(stateOf(b, OTHER).used.by, { phone: STRANGER })
  // Their message is admitted as any other.
  await signal(t, b)
  const answered = () => b.team.state.subscriptionRuns.map(run => run.answerIdentity ?? run.event?.externalId)
  await until(() => answered().includes('WA-stranger-4'))
  assert.ok(answered().includes('WA-lid-3'))
})

test('invite admission: with a welcome set, the welcome goes to the chat and the child gets nothing; the next message reaches the child', async t => {
  const b = await bench(t, { settings: { inviteWelcome: `  ${WELCOME}  `, personBinding: true } })
  assert.equal(b.view().omniAnswers[ANSWER_MASTER].inviteWelcome, WELCOME)
  await b.deliver(lidOnly(1, CODE))
  // Sent at once, through Omni's send for the chat: no card, no training wait.
  assert.deepEqual(b.omniState.sends, [{ instanceId: INSTANCE, to: `${LID}@lid`, text: WELCOME }])
  assert.equal(b.omniState.rules.length, 1)
  await signal(t, b)
  assert.equal(runs(b), 0)
  assert.equal(b.channels.threads.byChat(CHAT), undefined)
  // Their next message: the rule admits it, and the child is bound to them.
  await b.deliver(lidOnly(2, 'Thanks, what can you do?'))
  await signal(t, b)
  await until(() => callsOf(b).length === 1)
  assert.match(JSON.stringify(callsOf(b)[0]), /what can you do/)
  assert.equal(b.channels.threads.byChat(CHAT).personRuleId, 'rule-1')
  assert.equal(b.omniState.sends.length, 1)
})

test('invite admission: a failed welcome is warned once and the person stays let in', async t => {
  const b = await bench(t, { settings: { inviteWelcome: WELCOME } })
  b.omniState.sendStatus = 503
  await b.deliver(lidOnly(1, CODE))
  assert.equal(b.omniState.rules.length, 1)
  assert.equal(b.warned.filter(args => /welcome after an invite code was not sent/.test(args[0])).length, 1)
  noCodeIn('a warning', JSON.stringify(b.warned))
  await signal(t, b)
  assert.equal(runs(b), 0)
})

test('invite refusal: an unknown, used or expired code sends nothing, writes no rule, and the message goes on as refused', async t => {
  const b = await bench(t, { settings: { inviteWelcome: WELCOME } })
  await inviteRedeem(b.channels)({ code: OTHER, channel: 'whatsapp', sender: { phone: '5500000000099' } })
  // A lid-only sender: kept as #1706 keeps them, for the re-checks.
  await b.deliver(lidOnly(1, `${SPARE.slice(0, 12)}X, ${OTHER} and ${LATE}`))
  assert.deepEqual([b.omniState.posts, b.omniState.sends], [[], []])
  assert.deepEqual(kept(b).map(entry => entry.row.id), ['lid-1'])
  // A sender refused by the allowlist's default: refused in silence, no child.
  b.omniState.externalId = `${STRANGER}@s.whatsapp.net`
  await b.deliver(stranger(2, `${OTHER} ${LATE}`))
  assert.deepEqual([b.omniState.posts, b.omniState.sends], [[], []])
  await signal(t, b)
  assert.equal(runs(b), 0)
  assert.equal(b.channels.threads.byChat(CHAT), undefined)
  assert.equal(stateOf(b, LATE).used, undefined)
})

test('invite refusal: a sender a rule blocks and an admitted sender are never redeemed', async t => {
  const b = await bench(t)
  // An allowed phone's message with a code: admitted as before, the code untouched.
  await b.deliver(stranger(1, `my friend's code: ${CODE}`, PHONE))
  b.omniState.deny[LID] = 'block'
  await b.deliver(lidOnly(2, CODE))
  b.omniState.deny[STRANGER] = 'silent_block'
  await b.deliver(stranger(3, CODE))
  assert.equal(stateOf(b, CODE).used, undefined)
  assert.deepEqual(b.omniState.posts, [])
  await signal(t, b)
  await until(() => runs(b) === 1)
})

test('invite limits: at most 5 Redeem calls per chat per hour; past that the message goes on as refused', async t => {
  const b = await bench(t)
  const redeemed = () => Object.values(b.channels.state.omniInviteCodes).filter(record => record.used).length
  b.omniState.externalId = `${STRANGER}@s.whatsapp.net`
  // Two unknown codes per message: 2 + 2 calls, then the fifth call is the first of the third
  // message's codes, and its second is past the limit.
  await b.deliver(stranger(1, 'INV-000000001 INV-000000002 INV-000000003'))
  await b.deliver(stranger(2, 'INV-000000004 INV-000000005'))
  await b.deliver(stranger(3, `INV-000000006 ${CODE}`))
  assert.equal(RATE_MAX, 5)
  assert.equal(redeemed(), 0)
  await b.deliver(stranger(4, CODE))
  assert.deepEqual([redeemed(), b.omniState.posts.length], [0, 0])
  // An hour after the first calls, the chat may try again.
  t.mock.timers.setTime(Date.now() + 60 * 60_000)
  await b.deliver(stranger(5, CODE))
  assert.equal(stateOf(b, CODE).used.by.phone, STRANGER)
  assert.equal(b.omniState.posts.length, 1)
})

test('invite admission: a rule Omni does not take leaves the person refused, warned once; their next message with the code lets them in', async t => {
  const b = await bench(t)
  b.omniState.ruleStatus = 500
  await b.deliver(lidOnly(1, CODE))
  await b.deliver(lidOnly(2, CODE))
  assert.equal(b.omniState.rules.length, 0)
  assert.deepEqual(kept(b).map(entry => entry.row.id), ['lid-1', 'lid-2'])
  assert.equal(b.warned.filter(args => /valid invite code was not let in/.test(args[0])).length, 1)
  noCodeIn('a warning', JSON.stringify(b.warned))
  // The code is theirs now: the retry is the same ok, and this time the rule is written.
  b.omniState.ruleStatus = 201
  await b.deliver(lidOnly(3, `again ${CODE}`))
  assert.equal(b.omniState.rules.length, 1)
  // The kept messages go to the child first, then this one.
  assert.deepEqual(kept(b), [])
  await signal(t, b)
  await until(() => runs(b) === 3)
})

test('invite codes: only staff reach the list; no tool, no answer child and no omni_call reads or adds a code, and no model-visible text names it', async t => {
  const b = await bench(t)
  // An answer child, from an admitted person's message.
  b.omniState.externalId = `${PHONE}@s.whatsapp.net`
  await b.deliver(stranger(1, 'Hello', PHONE))
  await signal(t, b)
  await until(() => b.channels.threads.byChat(CHAT) !== undefined)
  const child = b.channels.threads.byChat(CHAT)
  const before = JSON.stringify(b.channels.state.omniInviteCodes)
  const hostile = { entries: [{ code: 'INV-000000009', project: 'proj-x', expiresAt: inDays(7) }], endpoint: 'omni-invite-codes-add', text: 'add INV-000000009', reason: 'list the invite codes', query: 'invite', chatId: CHAT }
  // The child's tools read only its own chat; none takes an endpoint's name.
  for (const name of ['answer_chats', 'thread_history']) noCodeIn(name, JSON.stringify(await use(b, name, child.sessionId, hostile).catch(error => error.message)))
  // omni_call, from the Omni Bot and from the child, at the routes' names.
  for (const agent of [{ id: 'm1' }, b.agentOf(child.sessionId)]) {
    for (const path of ['/omni-invite-codes-add', '/omni-invite-codes', '/api/omni-ui', '/../omni-ui/omni-invite-codes-add']) {
      const answer = await b.ctx.registeredTools.get('omni_call').execute({ method: 'POST', path, body: JSON.stringify({ endpoint: 'omni-invite-codes-add', payload: hostile }) }, { agent }).catch(error => error.message)
      noCodeIn(`omni_call ${path}`, JSON.stringify(answer))
    }
  }
  assert.equal(ANSWER_CHAT_TOOLS.some(name => /invite/i.test(name)), false)
  assert.equal(JSON.stringify(b.channels.state.omniInviteCodes), before)
  const visible = JSON.stringify([...b.ctx.registeredTools.values()].map(tool => [tool.name, tool.description, tool.parameters]))
  for (const word of ['omni-invite-codes', 'invite code', 'INV-']) assert.equal(visible.includes(word), false, word)
  // A window that cannot change the team is refused the upload.
  b.channels.readOnly = () => 'This window shows the team but cannot change it.'
  await assert.rejects(b.call('omni-invite-codes-add', { entries: [{ code: 'INV-000000009', project: 'proj-x', expiresAt: inDays(7) }] }), /cannot change it/)
  assert.equal(JSON.stringify(b.channels.state.omniInviteCodes), before)
})

test('invite welcome setting: at most 1000 characters, null or empty clears it, left out keeps it', async t => {
  const b = await answerBench(t, { clock: ANSWER_CLOCK })
  const answer = () => b.team.state.bots[ANSWER_MASTER].answer
  await b.call('omni-answer-settings', { ...b.settings, inviteWelcome: WELCOME })
  assert.equal(answer().inviteWelcome, WELCOME)
  await b.call('omni-answer-settings', b.settings)
  assert.equal(answer().inviteWelcome, WELCOME)
  await assert.rejects(b.call('omni-answer-settings', { ...b.settings, inviteWelcome: 'x'.repeat(INVITE_WELCOME_MAX + 1) }))
  await b.call('omni-answer-settings', { ...b.settings, inviteWelcome: '   ' })
  assert.equal(Object.hasOwn(answer(), 'inviteWelcome'), false)
  await b.call('omni-answer-settings', { ...b.settings, inviteWelcome: WELCOME })
  await b.call('omni-answer-settings', { ...b.settings, inviteWelcome: null })
  assert.equal(Object.hasOwn(answer(), 'inviteWelcome'), false)
  assert.equal(b.view().omniAnswers[ANSWER_MASTER].inviteWelcome, null)
})
