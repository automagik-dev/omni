import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { stripWrittenCalls, writesToolCall } from '../src/host/turns.js'

// Omni in its own chat 'a'; Writer, the admin of group 'r1', speaks there from 'gb'.
const seed = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: {
    a: { id: 'a', name: 'Omni', role: 'Boss', sessionId: 'a', createdAt: 1 },
    b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', createdAt: 2 },
  },
  rooms: { r1: { id: 'r1', name: 'Ops', members: ['a', 'b'], mode: 'admin', admin: 'b', named: true, sessions: { b: 'gb' }, log: [], seq: 0, seen: {} } },
  agents: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
  prefs: {},
  revision: 0,
})

// One Omni host on `home`; a second start on the same home is a restart.
// Hosts by home: a home is removed only after its hosts stopped and their writes landed.
const started = new Map()

async function start(home) {
  const ctx = fakeContext()
  const agents = new Map()
  const agentOf = (sessionId) => {
    if (!agents.has(sessionId)) {
      const calls = []
      const inbox = { nextStep: [], nextTurn: [], remove: () => false }
      const keep = (message) => { calls.push(message) }
      agents.set(sessionId, { session: { id: sessionId }, calls, inbox, followup: keep, steer: keep, cancel() {} })
    }
    return agents.get(sessionId)
  }
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async path => ({ id: 'w1', path }), archiveSession: async () => {} },
    sessionController: { create: async () => ({ sessionId: 's1' }), resolveAgent: async sessionId => ({ agent: agentOf(sessionId) }), selectModel: async () => {} },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => { route = options; return register(options) }
  apply(ctx, { home })
  let seq = 0
  const emit = (id, type, data) => {
    for (const listener of ctx.listeners.get('session/event') ?? []) {
      if (listener.length >= 2) listener({ id }, { type, seq: ++seq, data })
    }
  }
  const tool = (name, args, sessionId, exec = {}) => ctx.registeredTools.get(name).execute(args, { agent: { id: sessionId }, ...exec })
  const askApproval = sessionId => ctx.listeners.get('approval/request')[0]({ agent: { session: { id: sessionId } }, toolName: 'pwsh', reason: 'escalate sandbox' }, () => 'from-dsh')
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  await tool('list_bots', {}, 'a')
  const host = { ctx, agentOf, emit, tool, call, askApproval, stop: () => ctx.dispose() }
  started.set(home, [...(started.get(home) ?? []), host])
  return host
}

const freshHome = (t) => {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-follow-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(seed()))
  t.after(async () => {
    await Promise.all((started.get(home) ?? []).map(host => host.stop()))
    started.delete(home)
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })
  return home
}
const settle = async (check) => {
  const until = Date.now() + 3000
  while (!check() && Date.now() < until) await new Promise(resolve => setImmediate(resolve))
  assert.ok(check(), 'condition not reached')
}
const text = message => message.content.map(block => block.text ?? '').join('\n')
const notes = (home) => {
  try { return JSON.parse(readFileSync(join(home, 'inflight.json'), 'utf8')) } catch { return { turns: {}, queued: {} } }
}
const inflight = home => notes(home).turns ?? {}
// A message as DSH would replay it: the turn starts and takes it up.
const run = (host, sessionId, turn, message) => {
  host.emit(sessionId, 'turn/start', { turn })
  host.emit(sessionId, 'user/message', { content: message.content, source: message.source })
}

// Starts a round in 'r1' and opens Writer's turn in 'gb'.
async function openRoomTurn(t, host) {
  let result
  const stop = new AbortController()
  t.after(() => stop.abort())
  void host.tool('group_relay', {}, 'r1', { callId: 'c1', signal: stop.signal }).then((value) => { result = JSON.parse(value) })
  await settle(() => host.agentOf('gb').calls.length === 1)
  run(host, 'gb', 1, host.agentOf('gb').calls[0])
  return () => result
}

test('a group turn cut off by a restart is picked up once, and the group is told', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const home = freshHome(t)
  const first = await start(home)
  await openRoomTurn(t, first)
  void first.askApproval('gb')
  await settle(() => inflight(home).gb?.approval !== undefined)
  assert.deepEqual([inflight(home).gb.botId, inflight(home).gb.roomId, inflight(home).gb.trigger.role], ['b', 'r1', 'room'])
  await first.stop()

  const second = await start(home)
  t.mock.timers.tick(3000)
  await settle(() => second.agentOf('gb').calls.length === 1)
  const post = second.agentOf('r1').calls[0]
  assert.deepEqual([post.source.role, post.source.resumed, post.source.quiet, post.source.senderSessionId], ['post', true, true, 'b'])
  const resumed = second.agentOf('gb').calls[0]
  assert.deepEqual([resumed.source.role, resumed.source.resumed, resumed.source.roomId], ['room', true, 'r1'])
  assert.match(text(resumed), /^\[Group chat "Ops" · picking up after a restart\]/)
  assert.match(text(resumed), /approval to run pwsh \(escalate sandbox\)/)
  await settle(() => Object.keys(inflight(home)).length === 0)

  // The group shows the event, and the admin reads it on its next turn.
  second.emit('r1', 'user/message', { content: post.content, source: post.source })
  const relay = JSON.parse(await second.tool('group_relay', {}, 'r1', { callId: 'c2', signal: new AbortController().signal }))
  assert.deepEqual(relay.replies.map(reply => [reply.kind, reply.name]), [['resumed', 'Writer']])
  const state = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  assert.equal(state.rooms.r1.log.at(-1).kind, 'resumed')

  // Cut off again while picking it up: the group hears it, and the turn stays stopped.
  run(second, 'gb', 2, resumed)
  await settle(() => inflight(home).gb?.resumed === true)
  await second.stop()
  const third = await start(home)
  t.mock.timers.tick(3000)
  await settle(() => third.agentOf('r1').calls.length === 1)
  assert.equal(third.agentOf('r1').calls[0].source.again, true)
  assert.equal(third.agentOf('gb').calls.length, 0)
})

test('a request cut off by a restart goes on under the same exchange; own-chat work resumes in the chat', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const home = freshHome(t)
  const first = await start(home)
  run(first, 'b', 1, { content: [{ type: 'text', text: '[Message from Omni]\nDraft the plan' }], source: { kind: 'bot', form: 'relay', role: 'request', exchangeId: 'x1', senderName: 'Omni', senderSessionId: 'a', hop: 0 } })
  run(first, 'a', 1, { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
  await settle(() => inflight(home).b?.trigger !== undefined && inflight(home).a !== undefined)
  await first.stop()

  const second = await start(home)
  t.mock.timers.tick(3000)
  await settle(() => second.agentOf('b').calls.length === 1 && second.agentOf('a').calls.length === 1)
  const request = second.agentOf('b').calls[0]
  assert.deepEqual([request.source.role, request.source.exchangeId, request.source.senderSessionId, request.source.resumed], ['request', 'x1', 'a', true])
  assert.match(text(request), /^\[Message from Omni · DeepSeek Harness restarted while you were working on it\]/)
  const own = second.agentOf('a').calls[0]
  assert.deepEqual([own.source.role, own.source.resumed], ['resume', true])
  assert.match(text(own), /^\[DeepSeek Harness restarted while you were working\]/)
  const state = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  assert.equal(state.exchanges.length, 0)
})

test('when only Omni restarts, a turn still running or finished meanwhile is not picked up', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const home = freshHome(t)
  const first = await start(home)
  run(first, 'b', 1, { content: [{ type: 'text', text: '[Message from Omni]\nDraft the plan' }], source: { kind: 'bot', form: 'relay', role: 'request', exchangeId: 'x1', senderName: 'Omni', senderSessionId: 'a', hop: 0 } })
  run(first, 'a', 1, { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
  await settle(() => inflight(home).b?.trigger !== undefined && inflight(home).a !== undefined)
  await first.stop()

  // DSH went on: Writer is still at work, and Omni's turn ends before the pick-up.
  const second = await start(home)
  second.agentOf('b').status = 'running'
  second.emit('a', 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  t.mock.timers.tick(3000)
  // One read per check: two reads can see the old notes and the cleared ones.
  await settle(() => {
    const noted = inflight(home)
    return noted.b?.trigger?.exchangeId === 'x1' && noted.a === undefined
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual([second.agentOf('a').calls.length, second.agentOf('b').calls.length], [0, 0])

  // Writer's turn stays noted, so a real restart still picks it up.
  second.emit('b', 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'disposed' } } })
  await second.stop()
  const third = await start(home)
  t.mock.timers.tick(3000)
  await settle(() => third.agentOf('b').calls.length === 1)
  assert.deepEqual([third.agentOf('b').calls[0].source.exchangeId, third.agentOf('a').calls.length], ['x1', 0])
})

test('a finished turn leaves nothing to pick up', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const home = freshHome(t)
  const first = await start(home)
  run(first, 'a', 1, { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
  first.emit('a', 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  await settle(() => Object.keys(inflight(home)).length === 0 && existsSync(join(home, 'inflight.json')))
  await first.stop()
  const second = await start(home)
  t.mock.timers.tick(3000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(second.agentOf('a').calls.length, 0)
})

test('a turn DSH stops as it shuts down stays noted; one the user stops does not', async (t) => {
  const home = freshHome(t)
  const host = await start(home)
  run(host, 'a', 1, { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
  run(host, 'b', 1, { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })
  host.emit('a', 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'disposed' } } })
  host.emit('b', 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
  await settle(() => inflight(home).a !== undefined && inflight(home).b === undefined)
})

// A Tasks Session as DSH reopens it: `events` is its log, newest last.
const withLog = (host, sessionId, events) => {
  const agent = host.agentOf(sessionId)
  agent.session = { id: sessionId, seq: events.length, eventAt: seq => events[seq] }
  agent.status = 'idle'
  return agent
}
const taskTeam = (home, extra = {}) => {
  const state = JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({ ...state, agents: { t: { id: 't', name: 'Tasks', sessions: ['cut', 'done', 'old'], createdAt: 1 } }, ...extra }))
}

test('a restart heals the Tasks it cut off: each goes on once, finished and old ones stay', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const home = freshHome(t)
  taskTeam(home)
  const host = await start(home)
  const now = Date.now()
  withLog(host, 'cut', [{ type: 'turn/start', time: now - 60_000 }, { type: 'turn/end', time: now - 1000, data: { reason: { kind: 'interrupted' } } }])
  withLog(host, 'done', [{ type: 'turn/start', time: now - 60_000 }, { type: 'turn/end', time: now - 1000, data: { reason: { kind: 'completed' } } }])
  withLog(host, 'old', [{ type: 'turn/end', time: now - 2 * 24 * 60 * 60 * 1000, data: { reason: { kind: 'interrupted' } } }])
  t.mock.timers.tick(3000)
  await settle(() => host.agentOf('cut').calls.length === 1)
  const note = host.agentOf('cut').calls[0]
  assert.equal(note.source.kind, 'user')
  assert.match(text(note), /^\[DeepSeek Harness restarted\]\nDeepSeek Harness restarted while you were working on this/)
  assert.match(text(note), /Check what is already done/)
  assert.deepEqual([host.agentOf('done').calls.length, host.agentOf('old').calls.length], [0, 0])
  await host.stop()

  // Cut again and again: picked up twice in a day, then left stopped.
  for (let round = 2; round <= 3; round += 1) {
    const again = await start(home)
    withLog(again, 'cut', [{ type: 'turn/end', time: Date.now(), data: { reason: { kind: 'aborted', reason: { kind: 'disposed' } } } }])
    t.mock.timers.tick(3000)
    if (round === 2) await settle(() => again.agentOf('cut').calls.length === 1)
    else for (let wait = 0; wait < 20; wait += 1) await new Promise(resolve => setImmediate(resolve))
    assert.equal(again.agentOf('cut').calls.length, round === 2 ? 1 : 0)
    assert.equal(JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')).restartResumes.cut.count, 2)
    await again.stop()
  }
})

test('a task a restart cut stays running and reports only when it really ends', async (t) => {
  const home = freshHome(t)
  taskTeam(home, { tasks: { cut: { title: 'Ranking', from: 'a', at: Date.now(), status: 'working' } } })
  const host = await start(home)
  host.emit('cut', 'turn/end', { turn: 1, reason: { kind: 'interrupted' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')).tasks.cut.status, 'working')
  assert.equal(host.agentOf('a').calls.length, 0)
  host.emit('cut', 'assistant/message', { message: { content: [{ type: 'text', text: 'Top 30 ready.' }] } })
  host.emit('cut', 'turn/end', { turn: 2, reason: { kind: 'completed' } })
  await settle(() => host.agentOf('a').calls.length === 1)
  assert.match(text(host.agentOf('a').calls[0]), /^\[Task "Ranking" finished/)
})

test('a message a shutdown cancelled is sent again once; one still waiting, taken up or withdrawn is not', async (t) => {
  const home = freshHome(t)
  const first = await start(home)
  const send = message => first.tool('message_bot', { to: 'Writer', message, when: 'queue' }, 'a')
  await send('Draft the plan')
  await send('Check the numbers')
  await send('Read the notes')
  await send('Never mind')
  const [plan, numbers, notesMessage, withdrawn] = first.agentOf('b').calls
  // Taken up by a turn, or withdrawn while Omni runs (the user stopped the Bot).
  first.emit('b', 'user/message', { content: notesMessage.content, source: notesMessage.source })
  for (const listener of first.ctx.listeners.get('agent/inbox/discarded')) listener({ message: withdrawn })
  await settle(() => (notes(home).queued.b ?? []).length === 2)
  await first.stop()

  t.mock.timers.enable({ apis: ['setTimeout'] })
  const second = await start(home)
  // A hard stop keeps the inbox: that message runs when the Session wakes.
  second.agentOf('b').inbox.nextTurn.push(numbers)
  t.mock.timers.tick(3000)
  await settle(() => second.agentOf('b').calls.length === 1)
  const [again] = second.agentOf('b').calls
  assert.deepEqual([again.source.exchangeId, again.source.role, text(again)], [plan.source.exchangeId, 'request', text(plan)])
  // The resend is the same exchange, not a new one.
  assert.equal((await second.call('exchange', { a: 'a', b: 'b' })).value.length, 4)
})

const WRITTEN = 'Checking now.\n<tool_call>\n<function=pwsh>\n<parameter=command>\nGet-ChildItem E:\\\n</parameter>\n</function>\n</tool_call>'

test('a tool call written as text gets one more turn on the same round slot', async (t) => {
  const home = freshHome(t)
  const host = await start(home)
  const result = await openRoomTurn(t, host)
  host.emit('gb', 'assistant/message', { message: { content: [{ type: 'text', text: WRITTEN }] } })
  host.emit('gb', 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  await settle(() => host.agentOf('gb').calls.length === 2)
  const retry = host.agentOf('gb').calls[1]
  assert.deepEqual([retry.source.role, retry.source.retried, retry.source.exchangeId], ['room', true, host.agentOf('gb').calls[0].source.exchangeId])
  assert.match(text(retry), /^\[Group chat "Ops" · your tool call did not run\]/)
  assert.equal(result(), undefined)

  // Written again: the text goes on without the call.
  run(host, 'gb', 2, retry)
  host.emit('gb', 'assistant/message', { message: { content: [{ type: 'text', text: WRITTEN }] } })
  host.emit('gb', 'turn/end', { turn: 2, reason: { kind: 'completed' } })
  await settle(() => result() !== undefined)
  assert.deepEqual(result().replies.map(reply => reply.text), ['Checking now.'])
  assert.equal(host.agentOf('gb').calls.length, 2)
})

test('in its own chat, a Bot that wrote a tool call as text is asked to make it', async (t) => {
  const home = freshHome(t)
  const host = await start(home)
  run(host, 'b', 1, { content: [{ type: 'text', text: 'move the docs' }], source: { kind: 'user' } })
  // A call made for real, with or without text around it, is no retry.
  host.emit('b', 'assistant/message', { message: { content: [{ type: 'text', text: 'On it.' }, { type: 'tool-call', id: 'k1', name: 'pwsh', arguments: '{}' }] } })
  host.emit('b', 'assistant/message', { message: { content: [{ type: 'text', text: WRITTEN }] } })
  host.emit('b', 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  await settle(() => host.agentOf('b').calls.length === 1)
  const retry = host.agentOf('b').calls[0]
  assert.deepEqual([retry.source.role, retry.source.retried], ['retry', true])
  assert.match(text(retry), /^\[Your last reply wrote a tool call as text, so nothing ran\]/)
})

test('a written tool call is told apart from text about one', () => {
  assert.equal(writesToolCall(WRITTEN), true)
  assert.equal(writesToolCall('<function=read>\n<parameter=path>a.md</parameter></function>'), true)
  assert.equal(writesToolCall('Models such as Step write `<tool_call>` tags in their template.'), false)
  assert.equal(writesToolCall(undefined), false)
  assert.equal(stripWrittenCalls(WRITTEN), 'Checking now.')
})
