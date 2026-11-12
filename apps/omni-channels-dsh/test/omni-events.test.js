import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/omni-events.js'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const row = (journalSeq = 1) => ({ id: `event-${journalSeq}`, eventType: 'message.received', direction: 'inbound', chatUuid: 'chat-1', journalSeq })
const sub = name => ({ name, on: true, sources: [{ kind: 'chat', id: 'chat-1' }], trigger: { kind: 'message' } })
const chunk = rows => Buffer.from(rows.map(value => `id: ${value.journalSeq}\ndata: ${JSON.stringify(value)}\n\n`).join(''))
const turn = () => new Promise(resolve => setImmediate(resolve))

function fixture(t, options = {}) {
  const disposers = [], calls = [], fired = [], acks = [], releases = []
  const lookupEntered = deferred(), streamEntered = deferred(), consumerEntered = deferred()
  const rt = {
    ctx: { effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') disposers.push(cleanup) } },
    state: { omniRetiredConsumers: true, subscriptions: { first: sub('first'), ...options.subscriptions } },
    hooks: { live: () => () => {} },
    load: options.load ?? (async () => {}), save: options.save ?? (async () => {}),
    omniConfigured: options.configured ?? (async () => true), warn: () => {},
    automationOwned: options.automationOwned,
    fireSubscription: async (subscription, event) => { fired.push([subscription.name, event.ref]); await options.fire?.(subscription, event) },
    ...options.rt,
    omniRequest: async (method, path, args) => {
      calls.push([method, path, args])
      if (path === '/automations?enabled=true') return { ok: true, json: async () => ({ items: [] }) }
      if (path.startsWith('/messages/by-external')) return await options.message?.(path) ?? { ok: true, json: async () => ({ data: null }) }
      if (path.includes('/chats/')) {
        lookupEntered.resolve()
        if (options.lookup) return options.lookup()
        return { ok: true, json: async () => ({ data: { name: 'chat' } }) }
      }
      if (path.endsWith('/ack')) {
        acks.push(args.body.cursor)
        return await options.ack?.(args.body.cursor) ?? { ok: true }
      }
      if (path.endsWith('/stream')) {
        streamEntered.resolve()
        if (options.stream) return options.stream(args)
        const end = deferred()
        releases.push(end.resolve)
        if (!args.signal.aborted) args.signal.addEventListener('abort', end.resolve, { once: true })
        else end.resolve()
        return { ok: true, body: (async function* () { yield chunk(options.rows ?? [row()]); await end.promise })() }
      }
      if (path === '/events/consumers') {
        consumerEntered.resolve()
        return await options.consumer?.() ?? { ok: true }
      }
      return { ok: true }
    },
  }
  install(rt)
  const dispose = () => disposers.at(-1)()
  t.after(async () => { for (const release of releases) release(); dispose(); await rt.quiesceOmniEvents?.() })
  return { rt, calls, fired, acks, lookupEntered, streamEntered, consumerEntered, dispose }
}

// All waits are explicit barriers; the test timeout is only a deadlock guard.
test('ordinary one-bot subscriptions do not list or test Omni automations', { timeout: 5000 }, async t => {
  const acked = deferred()
  const f = fixture(t, { ack: async () => { acked.resolve(); return { ok: true } } })
  await acked.promise
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(f.fired, [['first', 'event-1']])
  assert.equal(f.calls.some(([, path]) => path.startsWith('/automations')), false)
})

test('sanitized #1407 repro: suspended lookup cannot dispatch after synchronous disposal', { timeout: 5000 }, async t => {
  const lookup = deferred()
  const f = fixture(t, { lookup: async () => { await lookup.promise; return { ok: true, json: async () => ({ data: { name: 'mock' } }) } } })
  await f.lookupEntered.promise
  const disposed = f.dispose()
  assert.deepEqual(f.rt.omniEventsView().listening, [])
  lookup.resolve()
  await disposed
  await turn()
  assert.deepEqual(f.fired, [], 'no new fireSubscription after disposal during enrichment')
  assert.deepEqual(f.acks, [], 'cancelled row remains unacked for replay')
  assert.equal(f.rt.state.omniEventCursors?.messages, undefined)
})

for (const fails of [false, true]) test(`quiesce waits for lookup ignoring abort (${fails ? 'failure' : 'success'}) and is idempotent`, { timeout: 5000 }, async t => {
  const lookup = deferred()
  const f = fixture(t, { lookup: async () => { await lookup.promise; if (fails) throw Error('lookup failed'); return { ok: true, json: async () => ({ data: {} }) } } })
  await f.lookupEntered.promise
  assert.equal(typeof f.rt.quiesceOmniEvents, 'function', 'supported ingress-only boundary')
  const drain = f.rt.quiesceOmniEvents()
  assert.equal(f.dispose(), drain)
  assert.equal(f.rt.quiesceOmniEvents(), drain)
  let settled = false
  drain.then(() => { settled = true })
  await turn()
  assert.equal(settled, false, 'empty listening is not settled ingress')
  lookup.resolve()
  await drain
  assert.deepEqual(f.fired, [])
  assert.deepEqual(f.acks, [])
})

test('admitted row finishes captured subscribers, ack and save; buffered second row is cancelled', { timeout: 5000 }, async t => {
  const fire = deferred(), fired = deferred(), ack = deferred(), ackEntered = deferred(), save = deferred(), saveEntered = deferred()
  const f = fixture(t, {
    subscriptions: { second: sub('second') }, rows: [row(1), row(2)],
    fire: async subscription => { if (subscription.name === 'first') { fired.resolve(); await fire.promise } },
    ack: async () => { ackEntered.resolve(); await ack.promise; return { ok: true } },
    save: async () => { saveEntered.resolve(); await save.promise },
  })
  await fired.promise
  const drain = f.rt.quiesceOmniEvents()
  let settled = false
  drain.then(() => { settled = true })
  fire.resolve()
  await ackEntered.promise
  assert.deepEqual(f.fired, [['first', 'event-1'], ['second', 'event-1']])
  assert.equal(settled, false)
  ack.resolve()
  await saveEntered.promise
  assert.equal(settled, false)
  save.resolve()
  await drain
  assert.deepEqual(f.acks, [1])
  assert.equal(f.rt.state.omniEventCursors.messages, '1')
})

for (const stage of ['load', 'configured', 'retired', 'consumer', 'stream']) test(`stop while ${stage} is pending cannot reopen ingress`, { timeout: 5000 }, async t => {
  const gate = deferred(), entered = deferred()
  const wait = async () => { entered.resolve(); await gate.promise }
  const options = {}
  if (stage === 'load') options.load = wait
  if (stage === 'configured') options.configured = async () => { await wait(); return true }
  if (stage === 'consumer') options.consumer = async () => { await wait(); return { ok: true } }
  if (stage === 'stream') options.stream = async () => { await wait(); return { ok: true, body: (async function* () { yield chunk([row()]) })() } }
  const f = fixture(t, options)
  if (stage === 'retired') {
    f.rt.state.omniRetiredConsumers = false
    const request = f.rt.omniRequest
    f.rt.omniRequest = async (...args) => { if (args[0] === 'DELETE') { await wait(); return { ok: true } }; return request(...args) }
  }
  await entered.promise
  const drain = f.rt.quiesceOmniEvents()
  let settled = false
  drain.then(() => { settled = true })
  await turn()
  assert.equal(settled, false)
  gate.resolve()
  await drain
  await f.rt.syncOmniEvents()
  assert.deepEqual(f.rt.omniEventsView().listening, [])
  assert.deepEqual(f.fired, [])
  assert.deepEqual(f.acks, [])
  if (['load', 'configured', 'retired'].includes(stage)) assert.equal(f.calls.some(call => call[1] === '/events/consumers'), false)
  if (stage === 'consumer') assert.equal(f.calls.some(call => call[1].endsWith('/stream')), false)
})

test('reconfigure serializes old stopped run with replacement and concurrent sync calls', { timeout: 5000 }, async t => {
  const lookup = deferred()
  const f = fixture(t, { lookup: async () => { await lookup.promise; return { ok: true, json: async () => ({ data: {} }) } } })
  await f.lookupEntered.promise
  f.rt.state.subscriptions.first.on = false
  await f.rt.syncOmniEvents()
  f.rt.state.subscriptions.first.on = true
  const syncs = [f.rt.syncOmniEvents(), f.rt.syncOmniEvents(), f.rt.syncOmniEvents()]
  await turn()
  assert.equal(f.calls.filter(call => call[1] === '/events/consumers').length, 1, 'replacement must wait for old task')
  lookup.resolve()
  await Promise.all(syncs)
  await turn()
  assert.equal(f.calls.filter(call => call[1] === '/events/consumers').length, 2)
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(f.fired, [['first', 'event-1']], 'only replacement dispatches the replayed row')
  assert.deepEqual(f.acks, [1])
  const streams = f.calls.filter(call => call[1].endsWith('/stream'))
  assert.equal(streams[1][2].headers['last-event-id'], undefined, 'cancelled enrichment did not move the replay cursor')
})

test('reconfiguration retains an admitted old run through ack/save and quiesce', { timeout: 5000 }, async t => {
  const fire = deferred(), entered = deferred(), ack = deferred(), ackEntered = deferred(), save = deferred(), saveEntered = deferred()
  const f = fixture(t, {
    fire: async () => { entered.resolve(); await fire.promise },
    ack: async () => { ackEntered.resolve(); await ack.promise; return { ok: true } },
    save: async () => { saveEntered.resolve(); await save.promise },
  })
  await entered.promise
  f.rt.state.subscriptions.first.on = false
  await f.rt.syncOmniEvents()
  assert.deepEqual(f.rt.omniEventsView().listening, [])
  f.rt.state.subscriptions.first.on = true
  const replacement = f.rt.syncOmniEvents()
  await turn()
  assert.equal(f.calls.filter(call => call[1] === '/events/consumers').length, 1)
  const drain = f.rt.quiesceOmniEvents()
  let settled = false
  drain.then(() => { settled = true })
  fire.resolve()
  await ackEntered.promise
  assert.equal(settled, false)
  ack.resolve()
  await saveEntered.promise
  assert.equal(settled, false)
  save.resolve()
  await Promise.all([replacement, drain])
  assert.equal(f.calls.filter(call => call[1] === '/events/consumers').length, 1, 'stale replacement cannot reopen after stop')
  assert.deepEqual(f.acks, [1])
})

test('pending stream iterator ignoring abort remains accounted until settled', { timeout: 5000 }, async t => {
  const next = deferred(), entered = deferred()
  const f = fixture(t, { stream: async () => ({ ok: true, body: (async function* () { entered.resolve(); await next.promise; yield chunk([row()]) })() }) })
  await entered.promise
  const drain = f.rt.quiesceOmniEvents()
  let settled = false
  drain.then(() => { settled = true })
  await turn()
  assert.equal(settled, false)
  next.resolve()
  await drain
  assert.deepEqual(f.fired, [])
  assert.deepEqual(f.acks, [])
})

test('active path dispatches and acks, preserving dispatch-error policy', { timeout: 5000 }, async t => {
  const saved = deferred()
  const f = fixture(t, { subscriptions: { second: sub('second') }, fire: async () => { throw Error('dispatch failed') }, save: async () => saved.resolve() })
  await saved.promise
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(f.fired, [['first', 'event-1'], ['second', 'event-1']])
  assert.deepEqual(f.acks, [1])
  assert.equal(f.rt.state.omniEventCursors.messages, '1')
})

// A chat-thread worker runs each event in its chat's thread (subscriptions.js): the event
// names that chat and its channel by id, beside their names.
test('an event carries the ids of its chat and its channel, when the row has them', { timeout: 5000 }, async t => {
  const saved = deferred()
  const events = []
  const f = fixture(t, { rows: [{ ...row(), instanceId: 'instance-1' }], fire: async (_subscription, event) => { events.push(event) }, save: async () => saved.resolve() })
  await saved.promise
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(events.map(event => [event.chatId, event.instanceId, event.chat, event.ref]), [['chat-1', 'instance-1', 'chat', 'event-1']])
})

test('rejected ack leaves local cursor unchanged and abort interrupts backoff', { timeout: 5000 }, async t => {
  // Backoff cannot expire on its own: only abort may release it.
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const warned = deferred()
  const f = fixture(t, { ack: async () => ({ ok: false, status: 503 }) })
  f.rt.warn = () => warned.resolve()
  await warned.promise
  await f.rt.quiesceOmniEvents()
  assert.equal(f.rt.state.omniEventCursors?.messages, undefined)
  assert.deepEqual(f.acks, [1])
})

test('stale local cursor catches up through proven monotonic 400 without skipping replayed rows', { timeout: 5000 }, async t => {
  const saved = deferred(), warned = deferred()
  const f = fixture(t, {
    rows: [row(1), row(2)],
    ack: async cursor => cursor < 2 ? { ok: false, status: 400, json: async () => ({ error: {
      code: 'VALIDATION_ERROR', message: `ack cursor ${cursor} is behind the stored cursor 2 — acks are monotonic`,
    } }) } : { ok: true },
    save: async () => { if (f.rt.state.omniEventCursors.messages === '2') saved.resolve('saved') },
  })
  f.rt.state.omniEventCursors = { messages: '0' }
  f.rt.warn = () => warned.resolve('warned')
  assert.equal(await Promise.race([saved.promise, warned.promise]), 'saved', 'already-advanced server ack must not trap replay on the first row')
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(f.acks, [1, 2])
  assert.deepEqual(f.fired, [['first', 'event-1'], ['first', 'event-2']])
  assert.equal(f.rt.state.omniEventCursors.messages, '2')
  assert.equal(f.calls.find(call => call[1].endsWith('/stream'))[2].headers['last-event-id'], '0')
})

for (const error of [
  { code: 'VALIDATION_ERROR', message: 'invalid ack cursor' },
  { code: 'VALIDATION_ERROR', message: 'ack cursor 9 is behind the stored cursor 10 — acks are monotonic' },
  { code: 'VALIDATION_ERROR', message: 'ack cursor 1 is behind the stored cursor 0 — acks are monotonic' },
]) test(`unproven 400 does not advance cursor: ${error.message}`, { timeout: 5000 }, async t => {
  const warned = deferred()
  const f = fixture(t, { ack: async () => ({ ok: false, status: 400, json: async () => ({ error }) }) })
  f.rt.warn = () => warned.resolve()
  await warned.promise
  await f.rt.quiesceOmniEvents()
  assert.equal(f.rt.state.omniEventCursors?.messages, undefined)
})

for (const previous of [undefined, '0']) test(`rejected save stays accounted during drain and restores cursor ${previous}`, { timeout: 5000 }, async t => {
  const save = deferred(), entered = deferred()
  const f = fixture(t, {
    rows: [row(1), row(2)],
    save: async () => { entered.resolve(); await save.promise },
  })
  if (previous !== undefined) f.rt.state.omniEventCursors = { messages: previous }
  await entered.promise
  const drain = f.rt.quiesceOmniEvents()
  assert.equal(f.dispose(), drain)
  let settled = false
  drain.then(() => { settled = true })
  await turn()
  assert.equal(settled, false, 'a pending cursor save is still ingress work')
  save.reject(Error('mock disk failure'))
  await drain
  await turn()
  assert.deepEqual(f.fired, [['first', 'event-1']], 'no buffered row dispatch after stop')
  assert.deepEqual(f.acks, [1], 'server accepted row before the local save failed')
  assert.equal(f.rt.state.omniEventCursors.messages, previous, 'failed local save permits replay')
  assert.equal(f.rt.quiesceOmniEvents(), drain)
})

for (const failure of ['null', 'throw']) test(`unavailable ack (${failure}) cannot advance cursor`, { timeout: 5000 }, async t => {
  const warned = deferred()
  const f = fixture(t)
  const request = f.rt.omniRequest
  f.rt.omniRequest = async (...args) => {
    if (args[1].endsWith('/ack')) {
      if (failure === 'throw') throw Error('mock ack transport failure')
      return null
    }
    return request(...args)
  }
  f.rt.warn = () => warned.resolve()
  await warned.promise
  await f.rt.quiesceOmniEvents()
  assert.equal(f.rt.state.omniEventCursors?.messages, undefined)
  assert.deepEqual(f.fired, [['first', 'event-1']])
})

test('invalid external row is skipped, invalid lookup falls back without crashing', { timeout: 5000 }, async t => {
  const saved = deferred()
  const f = fixture(t, { rows: [{ ...row(), id: 42 }, row(2)], lookup: async () => ({ ok: true, json: async () => ({ data: { name: 42 } }) }), save: async () => saved.resolve() })
  await saved.promise
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(f.fired, [['first', 'event-2']])
  assert.deepEqual(f.acks, [2])
})


const ownMedia = (journalSeq = 1, contentType = 'audio') => ({
  ...row(journalSeq), direction: 'outbound', instanceId: 'instance-1', externalId: `media-${journalSeq}`,
  contentType, rawPayload: { upsertType: 'notify', isFromMe: true, key: { fromMe: true, id: `media-${journalSeq}` } },
})
const ownMessage = event => ({
  id: `message-${event.id}`, chatId: event.chatUuid, externalId: event.externalId, messageType: event.contentType,
  isFromMe: true, senderAgentId: null, rawPayload: event.rawPayload,
  transcription: 'Remember the appointment', mediaUrl: 'https://media.test/voice.ogg', mediaMimeType: 'audio/ogg',
})
const voice = (allowOutbound = true) => ({ ...sub('voice'), trigger: { kind: 'voice', allowOutbound } })

for (const contentType of ['audio', 'image', 'video', 'document', 'sticker']) {
  for (const optedIn of [false, true]) test(`own ${contentType}: default blocked, opt-in scoped (${optedIn})`, { timeout: 5000 }, async t => {
    const event = ownMedia(1, contentType), saved = deferred(), events = []
    const subscription = { ...voice(optedIn), trigger: { kind: contentType === 'audio' ? 'voice' : 'media', allowOutbound: optedIn } }
    const f = fixture(t, {
      subscriptions: { first: subscription }, rows: [event],
      message: async () => ({ ok: true, json: async () => ({ data: ownMessage(event) }) }),
      fire: async (_sub, value) => events.push(value), save: async () => saved.resolve(),
    })
    await saved.promise
    await f.rt.quiesceOmniEvents()
    assert.equal(events.length, optedIn ? 1 : 0)
    assert.deepEqual(f.acks, [1])
    if (optedIn) {
      assert.equal(events[0].text, 'Remember the appointment')
      assert.deepEqual([events[0].chatId, events[0].instanceId, events[0].message.externalId], ['chat-1', 'instance-1', event.externalId])
      assert.equal(events[0].message.mediaUrl, 'https://media.test/voice.ogg')
    } else assert.equal(f.calls.some(call => call[1].startsWith('/messages/by-external')), false)
  })
}

test('an opted-in automation cannot trigger again on its own agent audio or its delayed echo', { timeout: 5000 }, async t => {
  const human = ownMedia(1), sent = { ...ownMedia(2), eventType: 'message.sent' }, echo = ownMedia(3)
  const saved = deferred(), events = []
  const f = fixture(t, {
    subscriptions: { first: voice() }, rows: [human, sent, echo, { ...echo, id: 'replayed-echo', journalSeq: 4 }],
    message: async path => {
      const generated = path.includes(echo.externalId)
      return { ok: true, json: async () => ({ data: generated ? {
        ...ownMessage(echo), senderAgentId: 'this-automations-agent',
        rawPayload: { externalId: echo.externalId, isFromMe: true, mediaSource: 'url' },
      } : ownMessage(human) }) }
    },
    // This models the worker sending its reply after the admitted owner's audio.
    fire: async (_sub, event) => events.push(event),
    save: async () => { if (f.acks.at(-1) === 4) saved.resolve() },
  })
  await saved.promise
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(events.map(event => event.ref), [human.id])
  assert.deepEqual(f.acks, [1, 2, 3, 4])
  assert.equal(f.calls.filter(call => call[1].startsWith('/messages/by-external')).length, 3, 'message.sent never enters enrichment')
  assert.equal(f.calls.find(call => call[1] === '/events/consumers')[2].body.eventType, 'message.received')
})

for (const [label, change] of [
  ['unattributed API send', { rawPayload: { externalId: 'media-1', isFromMe: true, mediaSource: 'url' } }],
  ['agent-attributed receipt', { senderAgentId: 'agent-1' }],
  ['missing attribution field', { senderAgentId: undefined }],
  ['not own-device', { isFromMe: false }],
]) test(`outbound opt-in rejects ${label}`, { timeout: 5000 }, async t => {
  const event = ownMedia(), saved = deferred()
  const f = fixture(t, {
    subscriptions: { first: voice() }, rows: [event],
    message: async () => ({ ok: true, json: async () => ({ data: { ...ownMessage(event), ...change } }) }),
    save: async () => saved.resolve(),
  })
  await saved.promise
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(f.fired, [])
  assert.deepEqual(f.acks, [1])
})

for (const label of ['no-chat', 'no-external-id', 'missing', 'forbidden', 'not-found', 'malformed', 'invalid-json', 'foreign-chat', 'wrong-message', 'not-ready']) test(`permanent outbound refusal is warned and acked without blocking inbound: ${label}`, { timeout: 5000 }, async t => {
  const event = ownMedia(), saved = deferred(), warnings = []
  if (label === 'no-chat') event.chatUuid = null
  if (label === 'no-external-id') event.externalId = null
  const subscription = { ...voice(), sources: [{ kind: 'channel', id: 'instance-1' }] }
  const f = fixture(t, {
    subscriptions: { first: subscription, second: sub('inbound') }, rows: [event, row(2)], message: async () => {
      const message = { ...ownMessage(event) }
      if (label === 'foreign-chat') message.chatId = 'another-chat'
      if (label === 'wrong-message') message.externalId = 'another-message'
      if (label === 'not-ready') { message.transcription = null; message.mediaUrl = null }
      return {
        ok: !['forbidden', 'not-found'].includes(label), status: label === 'forbidden' ? 403 : label === 'not-found' ? 404 : 200,
        json: async () => {
          if (label === 'invalid-json') throw new SyntaxError('bad JSON')
          return label === 'malformed' ? { data: { senderAgentId: 7 } } : { data: label === 'missing' ? null : message }
        },
      }
    },
    save: async () => { if (f.acks.at(-1) === 2) saved.resolve() },
  })
  f.rt.warn = (...args) => warnings.push(args)
  await saved.promise
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(f.fired, [['inbound', 'event-2']])
  assert.deepEqual(f.acks, [1, 2])
  assert.equal(warnings.length, 1, 'refusal is observable without logging the content')
  assert.equal(f.rt.state.omniEventCursors.messages, '2')
})

for (const failure of ['network', 503, 429, 408, 'mixed']) test(`outbound ${failure} failure retries with increasing backoff across successful reconnects`, { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const event = ownMedia(), firstFailure = deferred(), secondFailure = deferred(), saved = deferred()
  const waits = []
  let attempts = 0
  const f = fixture(t, {
    subscriptions: { first: voice() }, rows: [event], message: async () => {
      attempts++
      if (attempts <= 2) {
        if (failure === 'network' || (failure === 'mixed' && attempts === 1)) throw new TypeError('fetch failed')
        return { ok: false, status: failure === 'mixed' ? 429 : failure }
      }
      return { ok: true, json: async () => ({ data: ownMessage(event) }) }
    },
    save: async () => saved.resolve(),
  })
  f.rt.warn = (_format, _stream, _error, seconds) => {
    waits.push(seconds)
    if (waits.length === 1) firstFailure.resolve()
    else secondFailure.resolve()
  }
  await firstFailure.promise
  assert.deepEqual(f.acks, [])
  t.mock.timers.tick(2000)
  await secondFailure.promise
  assert.deepEqual(waits, [2, 5], 'successful reconnect must not reset the failed cursor backoff')
  assert.deepEqual(f.acks, [])
  t.mock.timers.tick(2000)
  await turn()
  assert.equal(attempts, 2, 'second retry must wait the full five seconds')
  t.mock.timers.tick(3000)
  await saved.promise
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(f.fired, [['voice', event.id]])
  assert.deepEqual(f.acks, [1])
  assert.equal(attempts, 3)
})

for (const failure of ['network', 503, 429, 408, 'mixed']) test(`persistent outbound ${failure} failure is capped, warned and acked before the next inbound row`, { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const event = ownMedia(), firstFailure = deferred(), secondFailure = deferred(), saved = deferred()
  const waits = [], refusals = []
  let attempts = 0
  const f = fixture(t, {
    subscriptions: { first: voice(), second: sub('inbound') }, rows: [event, row(2)], message: async () => {
      attempts++
      if (failure === 'network' || (failure === 'mixed' && attempts === 1)) throw new TypeError('fetch failed')
      return { ok: false, status: failure === 'mixed' ? (attempts === 2 ? 429 : 408) : failure }
    },
    save: async () => { if (f.acks.at(-1) === 2) saved.resolve() },
  })
  f.rt.warn = (format, ...args) => {
    if (format.startsWith('ds-bot: refused')) { refusals.push(args); return }
    waits.push(args.at(-1))
    if (waits.length === 1) firstFailure.resolve()
    else secondFailure.resolve()
  }
  await firstFailure.promise
  assert.deepEqual(f.acks, [])
  t.mock.timers.tick(2000)
  await secondFailure.promise
  assert.deepEqual(f.acks, [])
  t.mock.timers.tick(5000)
  await saved.promise
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(waits, [2, 5])
  assert.equal(attempts, 3, 'the failed row has a hard three-attempt budget')
  assert.deepEqual(refusals, [[event.id, 'lookup retries exhausted']])
  assert.deepEqual(f.fired, [['inbound', 'event-2']])
  assert.deepEqual(f.acks, [1, 2])
  assert.equal(f.rt.state.omniEventCursors.messages, '2')
})

for (const source of ['journal', 'canonical', 'both']) {
  for (const proof of ['append', 'missing-type', 'history-sync']) test(`received-first echo/history refused with ${source} ${proof} marker`, { timeout: 5000 }, async t => {
    const event = ownMedia(), message = ownMessage(event), saved = deferred()
    // Received wins persistence: no senderAgentId, platform key present. Attribution
    // alone cannot distinguish this record from the owner's device notification.
    message.rawPayload = { ...event.rawPayload }
    for (const raw of [source !== 'canonical' && event.rawPayload, source !== 'journal' && message.rawPayload].filter(Boolean)) {
      if (proof === 'append') raw.upsertType = 'append'
      if (proof === 'missing-type') delete raw.upsertType
      if (proof === 'history-sync') raw.isHistorySync = true
    }
    const f = fixture(t, {
      subscriptions: { first: voice() }, rows: [event],
      message: async () => ({ ok: true, json: async () => ({ data: message }) }),
      save: async () => saved.resolve(),
    })
    await saved.promise
    await f.rt.quiesceOmniEvents()
    assert.deepEqual(f.fired, [])
    assert.deepEqual(f.acks, [1])
  })
}

// A media URL is useful without STT; do not promise to wait for a fresh transcript.
test('own live audio dispatches with a media reference while transcription is pending', { timeout: 5000 }, async t => {
  const event = ownMedia(), saved = deferred(), events = []
  const f = fixture(t, {
    subscriptions: { first: voice() }, rows: [event],
    message: async () => ({ ok: true, json: async () => ({ data: { ...ownMessage(event), transcription: null } }) }),
    fire: async (_sub, value) => events.push(value), save: async () => saved.resolve(),
  })
  await saved.promise
  await f.rt.quiesceOmniEvents()
  assert.equal(events[0].text, '')
  assert.equal(events[0].message.mediaUrl, 'https://media.test/voice.ogg')
})

test('a reaction keeps own-reaction semantics and resolves the audio target and transcription afresh', { timeout: 5000 }, async t => {
  const event = { ...ownMedia(), eventType: 'reaction.received', contentType: 'reaction', textContent: '🎧' }
  const saved = deferred(), events = []
  const f = fixture(t, {
    subscriptions: { first: { ...sub('reaction'), trigger: { kind: 'reaction', emoji: '🎧' } } }, rows: [event],
    message: async path => {
      assert.match(path, /chatId=chat-1&externalId=media-1$/)
      return { ok: true, json: async () => ({ data: { ...ownMessage(event), messageType: 'audio' } }) }
    },
    fire: async (_sub, value) => events.push(value), save: async () => saved.resolve(),
  })
  await saved.promise
  await f.rt.quiesceOmniEvents()
  assert.equal(events[0].text, 'Remember the appointment')
  assert.equal(events[0].message.type, 'audio')
  assert.equal(events[0].message.externalId, event.externalId)
})

test('inbound voice remains admitted with processed text, without opting in', { timeout: 5000 }, async t => {
  const event = { ...ownMedia(), direction: 'inbound', rawPayload: { isFromMe: false } }, saved = deferred(), events = []
  const f = fixture(t, {
    subscriptions: { first: voice(false) }, rows: [event],
    message: async () => ({ ok: true, json: async () => ({ data: ownMessage(event) }) }),
    fire: async (_sub, value) => events.push(value), save: async () => saved.resolve(),
  })
  await saved.promise
  await f.rt.quiesceOmniEvents()
  assert.equal(events[0].text, 'Remember the appointment')
})


test('outbound opt-in never widens other kinds, sources, disabled subscriptions or unmarked events', async () => {
  const { matches } = await import('../src/host/omni-events.js')
  const event = ownMedia()
  assert.equal(matches(voice(), event), true)
  assert.equal(matches(voice(), { ...event, rawPayload: {} }), false)
  assert.equal(matches(voice(), { ...event, eventType: 'message.sent' }), false)
  assert.equal(matches(voice(), { ...event, chatUuid: 'another-chat' }), false)
  assert.equal(matches({ ...voice(), on: false }, event), false)
  for (const kind of ['message', 'mention', 'keyword', 'reaction']) {
    assert.equal(matches({ ...voice(), trigger: { kind, allowOutbound: true, words: ['appointment'] } }, event), false)
  }
})


test('media enrichment keeps both the caption and transcription', { timeout: 5000 }, async t => {
  const event = ownMedia(), saved = deferred(), events = []
  const f = fixture(t, {
    subscriptions: { first: voice() }, rows: [event],
    message: async () => ({ ok: true, json: async () => ({ data: { ...ownMessage(event), textContent: 'Appointment note' } }) }),
    fire: async (_sub, value) => events.push(value), save: async () => saved.resolve(),
  })
  await saved.promise
  await f.rt.quiesceOmniEvents()
  assert.equal(events[0].text, 'Appointment note\nRemember the appointment')
})

test('external message identity reaches dispatch for text and media independently of journal refs', { timeout: 5000 }, async t => {
  const done = deferred(), events = []
  const input = [
    { ...row(1), instanceId: 'instance-1', externalId: 'WA-shared', textContent: 'invoice' },
    { ...row(2), instanceId: 'instance-2', externalId: 'WA-shared', textContent: 'invoice' },
    { ...row(3), instanceId: 'instance-1', externalId: 'WA-picture', contentType: 'image', textContent: 'invoice photo' },
  ]
  const f = fixture(t, { rows: input, fire: async (_sub, event) => events.push(event), save: async () => { if (events.length === 3) done.resolve() } })
  await done.promise
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(events.map(event => [event.ref, event.externalId]), [['event-1', 'WA-shared'], ['event-2', 'WA-shared'], ['event-3', 'WA-picture']])
})


test('SC1 two channels dispatch only to their owning subscription and recheck after enrichment', async t => {
  const owners = new Map([['line-1', 'first'], ['line-2', 'second']])
  const first = { ...sub('first'), ownerBotId: 'first', sources: [{ kind: 'channel', id: 'line-1' }] }
  const second = { ...sub('second'), ownerBotId: 'second', sources: [{ kind: 'channel', id: 'line-2' }] }
  const stale = { ...sub('stale'), ownerBotId: 'first', sources: [{ kind: 'channel', id: 'line-2' }] }
  const f = fixture(t, {
    subscriptions: { first, second, stale },
    rows: [{ ...row(1), instanceId: 'line-1' }, { ...row(2), instanceId: 'line-2' }],
    automationOwned: (subscription, event) => subscription.ownerBotId === owners.get(event.instanceId),
  })
  await f.rt.syncOmniEvents()
  for (let i = 0; i < 30 && f.acks.length < 2; i += 1) await turn()
  assert.deepEqual(f.fired, [['first', 'event-1'], ['second', 'event-2']])
  assert.deepEqual(f.acks, [1, 2])
})

test('SC1 an ownership change while journal enrichment waits prevents the stale dispatch', async t => {
  const barrier = deferred()
  let owner = 'first'
  const f = fixture(t, {
    rows: [{ ...row(), instanceId: 'line-1' }],
    lookup: () => barrier.promise,
    automationOwned: subscription => subscription.name === owner,
  })
  await f.lookupEntered.promise
  owner = 'second'
  barrier.resolve({ ok: true, json: async () => ({ data: { name: 'chat' } }) })
  for (let i = 0; i < 30 && !f.acks.length; i += 1) await turn()
  assert.deepEqual(f.fired, [])
  assert.deepEqual(f.acks, [1])
})


test('answer admission keeps the message stream alive without a user automation', async t => {
  const f = fixture(t)
  f.rt.state.subscriptions = {}
  f.rt.syncAnswerSubscriptions = () => { f.rt.state.subscriptions.answer = { ...sub('answer child'), answerBotId: 'owner' } }
  await f.streamEntered.promise
  for (let i = 0; i < 20 && f.acks.length === 0; i += 1) await turn()
  assert.deepEqual(f.fired, [['answer child', 'event-1']])
  assert.deepEqual(f.acks, [1])
})

// RFC-0001 SC7: staff take-over. A staff message is a journal row whose own-device receipt the
// canonical record proves too, in a chat an answer child serves; it pauses that child before the
// row is acked, and is nobody's message to answer. An Omni API send never passes.
const STAFF_AT = '2026-11-01T12:00:00.000Z'
const personRow = journalSeq => ({ ...row(journalSeq), instanceId: 'instance-1' })
const staffRow = (journalSeq = 1, raw = {}) => ({
  ...row(journalSeq), direction: 'outbound', instanceId: 'instance-1', externalId: `staff-${journalSeq}`, contentType: 'text',
  textContent: 'I will take it from here.', receivedAt: STAFF_AT,
  rawPayload: { upsertType: 'notify', isFromMe: true, key: { fromMe: true, id: `staff-${journalSeq}` }, ...raw },
})
const staffRecord = (event, change = {}) => ({
  id: `message-${event.id}`, chatId: event.chatUuid, externalId: event.externalId, messageType: 'text', textContent: event.textContent,
  isFromMe: true, senderAgentId: null, rawPayload: { ...event.rawPayload }, ...change,
})
// A business-app coexistence echo, as the channel records it: external id = key.id (the
// platform's message id), the same own-device evidence as a phone message (isFromMe,
// key.fromMe, key.id, upsertType notify), its own markers, no remoteJid and no history flag.
// Persistence keeps that rawPayload and isFromMe, with no agent attribution.
const echoRow = journalSeq => staffRow(journalSeq, { coexistence: 'smb_message_echoes', noAgentDispatch: true, messageTimestamp: 1794484800 })
const answerSub = () => ({ ...sub('answer'), answerBotId: 'answer-bot', sources: [{ kind: 'channel', id: 'instance-1' }] })
function staffFixture(t, { rows, message, pause, save, threadOf, subscriptions = {} }) {
  const pauses = [], saved = deferred()
  const last = rows.at(-1).journalSeq
  const f = fixture(t, {
    subscriptions: { first: answerSub(), ...subscriptions }, rows,
    message: message ?? (async path => {
      const event = rows.find(item => path.endsWith(`externalId=${item.externalId}`))
      return { ok: true, json: async () => ({ data: staffRecord(event) }) }
    }),
    save: async () => { await save?.(); if (f.acks.at(-1) === last) saved.resolve() },
    rt: {
      answerStaffThread: threadOf ?? (event => (event.chatUuid === 'chat-1' && event.instanceId === 'instance-1' ? 'child-1' : undefined)),
      pauseAnswer: async input => { pauses.push({ ...input, acked: [...f.acks] }); await pause?.(input) },
    },
  })
  return { ...f, pauses, saved: saved.promise }
}

for (const [label, make] of [['phone or linked-device text', staffRow], ['business-app coexistence echo', echoRow]]) test(`SC7 a ${label} pauses its chat's child before the ack and is nobody's to answer`, { timeout: 5000 }, async t => {
  const event = make(1)
  const f = staffFixture(t, { rows: [event] })
  await f.saved
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(f.pauses, [{ threadId: 'child-1', receiptId: 'staff-1', staffAt: Date.parse(STAFF_AT), acked: [] }])
  assert.deepEqual(f.fired, [], 'the answer child is not handed the staff message')
  assert.deepEqual(f.acks, [1])
  assert.equal(f.calls.filter(call => call[1].startsWith('/messages/by-external')).length, 1)
})

test('SC7 a receipt time ahead of this host\'s clock is taken as now, so it cannot stretch the pause', { timeout: 5000 }, async t => {
  const event = { ...staffRow(1), receivedAt: new Date(Date.now() + 3_600_000).toISOString() }
  const before = Date.now()
  const f = staffFixture(t, { rows: [event] })
  await f.saved
  await f.rt.quiesceOmniEvents()
  assert.ok(f.pauses[0].staffAt >= before && f.pauses[0].staffAt <= Date.now())
})

test('SC7 a receipt claiming the own side, even marked inbound, never reaches an answer child as the person\'s message', { timeout: 5000 }, async t => {
  const event = { ...staffRow(1), direction: 'inbound' }
  const f = staffFixture(t, { rows: [event, personRow(2)] })
  await f.saved
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(f.pauses.map(pause => pause.receiptId), ['staff-1'])
  assert.deepEqual(f.fired, [['answer', 'event-2']])
})

for (const [label, journal, canonical] of [
  ['append echo in the journal', { upsertType: 'append' }, {}],
  ['history replay in the journal', { isHistorySync: true }, {}],
  ['missing receipt type in the journal', { upsertType: undefined }, {}],
  ['mismatched key id in the journal', { key: { fromMe: true, id: 'another' } }, {}],
  ['not from me in the journal', { isFromMe: false }, {}],
  ['append echo in the canonical record', {}, { rawPayload: { upsertType: 'append', isFromMe: true, key: { fromMe: true, id: 'staff-1' } } }],
  ['history replay in the canonical record', {}, { rawPayload: { upsertType: 'notify', isHistorySync: true, isFromMe: true, key: { fromMe: true, id: 'staff-1' } } }],
  ['agent-attributed API send', {}, { senderAgentId: 'agent-1' }],
  ['unattributed API send', {}, { rawPayload: { externalId: 'staff-1', isFromMe: true, mediaSource: 'url' } }],
  ['missing attribution field', {}, { senderAgentId: undefined }],
  ['canonical not from me', {}, { isFromMe: false }],
  ['record of another chat', {}, { chatId: 'another-chat' }],
]) test(`SC7 no own-device proof, no pause: ${label}`, { timeout: 5000 }, async t => {
  const event = staffRow(1, journal)
  if (journal.upsertType === undefined && 'upsertType' in journal) delete event.rawPayload.upsertType
  const warnings = []
  const f = staffFixture(t, { rows: [event, personRow(2)], message: async () => ({ ok: true, json: async () => ({ data: staffRecord(staffRow(1), canonical) }) }) })
  f.rt.warn = (...args) => warnings.push(args)
  await f.saved
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(f.pauses, [])
  assert.deepEqual(f.fired, [['answer', 'event-2']])
  assert.deepEqual(f.acks, [1, 2])
  const looked = f.calls.some(call => call[1].startsWith('/messages/by-external'))
  // A journal row without its own proof is never looked up; a canonical refusal is warned once.
  assert.equal(looked, Object.keys(journal).length === 0)
  assert.equal(warnings.length, Object.keys(journal).length === 0 ? 1 : 0)
})

test('SC7 an own-device row in a chat no answer child serves is not looked up and pauses nothing', { timeout: 5000 }, async t => {
  const f = staffFixture(t, { rows: [staffRow(1)], threadOf: () => undefined })
  await f.saved
  await f.rt.quiesceOmniEvents()
  assert.deepEqual([f.pauses, f.fired, f.acks], [[], [], [1]])
  assert.equal(f.calls.some(call => call[1].startsWith('/messages/by-external')), false)
})

for (const failure of [503, 404, 'not recorded yet']) test(`SC7 a canonical lookup ${failure} is retried, then the proven receipt pauses once`, { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const event = staffRow(1), failed = deferred()
  let attempts = 0
  const f = staffFixture(t, { rows: [event], message: async () => {
    attempts += 1
    if (attempts === 1) { failed.resolve(); return typeof failure === 'number' ? { ok: false, status: failure } : { ok: true, status: 200, json: async () => ({ data: null }) } }
    return { ok: true, json: async () => ({ data: staffRecord(event) }) }
  } })
  await failed.promise
  await turn()
  assert.deepEqual([f.pauses, f.acks], [[], []], 'not acked while the record could still prove it')
  t.mock.timers.tick(2000)
  await f.saved
  await f.rt.quiesceOmniEvents()
  assert.equal(attempts, 2)
  assert.deepEqual(f.pauses.map(pause => pause.receiptId), ['staff-1'])
  assert.deepEqual(f.acks, [1])
})

test('SC7 a lookup that keeps failing is capped at three attempts, warned and acked without a pause', { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const warnings = [], waits = []
  let attempts = 0
  // Not recorded yet (200 with null data), then 404, then a server error: one budget for all.
  const f = staffFixture(t, { rows: [staffRow(1), personRow(2)], message: async () => {
    attempts += 1
    return attempts === 1 ? { ok: true, status: 200, json: async () => ({ data: null }) } : { ok: false, status: attempts === 2 ? 404 : 503 }
  } })
  const waited = [deferred(), deferred()]
  f.rt.warn = (format, ...args) => {
    if (format.includes('not proven')) { warnings.push(args); return }
    waits.push(args.at(-1))
    waited[waits.length - 1]?.resolve()
  }
  await waited[0].promise
  t.mock.timers.tick(2000)
  await waited[1].promise
  t.mock.timers.tick(5000)
  await f.saved
  await f.rt.quiesceOmniEvents()
  assert.equal(attempts, 3)
  assert.deepEqual(warnings, [['event-1', 'lookup retries exhausted']])
  assert.deepEqual([f.pauses, f.fired, f.acks], [[], [['answer', 'event-2']], [1, 2]])
})

test('SC7 a pause that fails to save leaves the row unacked; the replay pauses and acks it', { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const failed = deferred()
  let tries = 0
  const f = staffFixture(t, { rows: [staffRow(1)], pause: async () => { tries += 1; if (tries === 1) { failed.resolve(); throw new Error('disk full') } } })
  await failed.promise
  await turn()
  assert.deepEqual(f.acks, [])
  t.mock.timers.tick(2000)
  await f.saved
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(f.pauses.map(pause => [pause.receiptId, pause.acked]), [['staff-1', []], ['staff-1', []]])
  assert.deepEqual(f.acks, [1])
})

test('SC7 a staff voice note pauses the child and still reaches an opted-in automation, from one lookup', { timeout: 5000 }, async t => {
  const event = { ...staffRow(1), contentType: 'audio' }, events = []
  const f = staffFixture(t, {
    rows: [event], subscriptions: { voice: voice() },
    message: async () => ({ ok: true, json: async () => ({ data: { ...staffRecord(event), messageType: 'audio', textContent: null, transcription: 'On my way.', mediaUrl: 'https://media.test/staff.ogg' } }) }),
  })
  f.rt.fireSubscription = async (subscription, value) => { f.fired.push([subscription.name, value.ref]); events.push(value) }
  await f.saved
  await f.rt.quiesceOmniEvents()
  assert.deepEqual(f.pauses.map(pause => pause.receiptId), ['staff-1'])
  assert.deepEqual(f.fired, [['voice', 'event-1']])
  assert.equal(events[0].text, 'On my way.')
  assert.equal(f.calls.filter(call => call[1].startsWith('/messages/by-external')).length, 1)
})
