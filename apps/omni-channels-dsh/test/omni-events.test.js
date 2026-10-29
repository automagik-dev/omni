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
    fireSubscription: async (subscription, event) => { fired.push([subscription.name, event.ref]); await options.fire?.(subscription, event) },
    omniRequest: async (method, path, args) => {
      calls.push([method, path, args])
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
