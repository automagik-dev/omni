// The owner's DSH bots (wish omni-chat-threads, Group 16; design row 19), against the real Bot
// team (the release apps/automagik.json pins) on a fake DSH, and against a stand-in of it
// without the DSH-bot calls. They are hand-off targets only (handoff.test.js): an automation
// that handed its events to one runs each event in the thread of its chat now.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { RETIRED_QUEUED, THREAD_NEEDS_TEAM, WORKER_MOVED } from '../src/host/subscriptions.js'
import { boot, CHAT, eventFor, gateOf, homeFor, INSTANCE, resetFetch, saved, signal, teamState, until, watchedOmni } from './thread-fixture.js'

afterEach(resetFetch)

// Two DSH bots and the tasks record, as the team keeps them in state.agents.
const agents = () => ({
  coder: { id: 'coder', kind: 'dsh', name: 'Coder', workDir: import.meta.dirname, sessions: ['dsh-session'], createdAt: 1 },
  writer: { id: 'writer', kind: 'dsh', name: 'Writer', sessions: [], createdAt: 2 },
  tasks: { id: 'tasks', kind: 'tasks', name: 'Tasks', sessions: [], createdAt: 3 },
})
// One DSH start on a home linked to a fake Omni that lists its chats, with the DSH bots; the
// team's restart pass (its timer mocked, once per test) over unless `signal` is false.
const mocked = new WeakSet()
async function bench(t, { home, omni, signal: over = true, state = {}, ...options } = {}) {
  if (!mocked.has(t)) t.mock.timers.enable({ apis: ['setTimeout'] })
  mocked.add(t)
  const linked = omni ?? watchedOmni(t)
  const place = home ?? homeFor(t, linked, teamState({ agents: agents(), ...state }))
  const run = await boot(t, place, options)
  if (over && !options.mask) await signal(t, run)
  return { run, home: place, omni: linked }
}
const tool = (run, name, args, agentId = 'm1') => run.ctx.registeredTools.get(name).execute(args, { agent: { id: agentId } })
const subsOf = run => Object.values(run.channels.state.subscriptions ?? {})
const runById = (run, id) => (run.channels.state.subscriptionRuns ?? []).find(item => item.id === id)

test('the adapter reads the team\'s DSH bots from the team itself, never the Tasks record; without the team\'s calls none is found; no automation offers one (:208)', async (t) => {
  const omni = watchedOmni(t)
  const home = homeFor(t, omni, teamState({ agents: agents() }))
  const without = await bench(t, { home, omni, dshBots: false })
  assert.deepEqual([without.run.channels.omniDshBots.ready(), without.run.channels.omniDshBots.find('Coder')], [false, undefined])
  await without.run.stop()

  const { run } = await bench(t, { home, omni })
  assert.equal(run.channels.omniDshBots.ready(), true)
  assert.deepEqual([run.channels.omniDshBots.find('coder')?.name, run.channels.omniDshBots.find('WRITER')?.id, run.channels.omniDshBots.find('Tasks')], ['Coder', 'writer', undefined])
  // The calls are read from the team itself: a property of this plugin's runtime (whose
  // prototype is the team) never hides them.
  Object.defineProperty(run.channels, 'dshBots', { value: undefined, configurable: true })
  assert.equal(run.channels.omniDshBots.ready(), true)
  assert.equal(run.channels.omniDshBots.find('Writer')?.id, 'writer')
  delete run.channels.dshBots
  // No worker names one.
  assert.doesNotMatch(await tool(run, 'find_chats', {}), /dshbot|DSH bot/)
  assert.doesNotMatch(run.ctx.registeredTools.get('save_automation').parameters.properties.worker.description, /dshbot|DSH bot/)
  assert.match(await tool(run, 'save_automation', { sources: `chat:${CHAT}`, trigger: 'message', worker: 'dshbot:Coder' }), /^Not saved: No Bot named "dshbot:Coder"/)
  assert.deepEqual(subsOf(run), [])
})

// A saved DSH-bot automation of each mode, from before: its worker, its one ongoing Session,
// a run working there and an event waiting for it.
const at = Date.now() - 60_000
const dshSub = (id, mode, extra = {}) => ({
  id, name: `${mode} on Coder`, on: true, sources: [{ kind: 'chat', id: CHAT, name: 'Marina', type: 'whatsapp-baileys', chatKind: 'direct', channelId: INSTANCE }],
  trigger: { kind: 'message' }, worker: { kind: 'dshbot', agentId: 'coder', mode }, outputs: { react: false, replyToMe: false }, askFirst: true, createdAt: 1, updatedAt: 1, ...extra,
})
const before = () => ({
  subscriptions: {
    'sub-new': dshSub('sub-new', 'new'),
    'sub-on': dshSub('sub-on', 'ongoing', { ongoingSessionId: 'dsh-session' }),
    'sub-gone': dshSub('sub-gone', 'new', { on: false, pausedReason: 'Its DSH bot was deleted. Save the automation with another DSH bot.' }),
  },
  subscriptionRuns: [
    { id: 'run-dsh', subId: 'sub-on', standing: true, sessionId: 'dsh-session', status: 'working', turnId: '4', askFirst: true, at },
    { id: 'run-wait', subId: 'sub-on', standing: true, target: { kind: 'dshbot', id: 'sub-on' }, status: 'queued', event: eventFor('Esperando'), at },
  ],
})

test('saved DSH-bot automations, new and ongoing, move to their chat\'s thread at start, saying so once; the DSH bot keeps its Session, never archived; a run working there still ends with its own turn, gated; the event waiting for it ends, saying why; the next event runs in the chat\'s thread (:208)', async (t) => {
  // Before the team's pass is over: the run's turn, begun before this start, still runs.
  const { run, home } = await bench(t, { state: before(), signal: false })
  await until(() => subsOf(run).every(sub => sub.worker.kind === 'thread'))
  assert.deepEqual(subsOf(run).map(sub => [sub.id, sub.worker, sub.note, sub.on, sub.pausedReason, Object.hasOwn(sub, 'ongoingSessionId')]), [
    ['sub-new', { kind: 'thread' }, WORKER_MOVED.dshbot, true, undefined, false],
    ['sub-on', { kind: 'thread' }, WORKER_MOVED.dshbot, true, undefined, false],
    ['sub-gone', { kind: 'thread' }, WORKER_MOVED.dshbot, false, undefined, false],
  ])
  // The DSH bot's Session is the owner's: still the bot's, never archived.
  assert.deepEqual([run.team.state.agents.coder.sessions, run.archiving], [['dsh-session'], []])
  assert.deepEqual([runById(run, 'run-wait').status, runById(run, 'run-wait').summary, runById(run, 'run-wait').event], ['failed', RETIRED_QUEUED, undefined])
  // The run working in it goes on: its own turn is gated, and its end finishes it.
  assert.equal(runById(run, 'run-dsh').status, 'working')
  assert.equal((await gateOf(run, 'bash', 'dsh-session')).kind, 'ask')
  assert.deepEqual(await gateOf(run, 'read', 'dsh-session'), { kind: 'allow' })
  run.emit('dsh-session', 'assistant/message', { message: { content: [{ type: 'text', text: 'Went on.' }] } })
  run.emit('dsh-session', 'turn/end', { turn: 4, reason: { kind: 'completed' } })
  await until(() => runById(run, 'run-dsh').status === 'done')
  assert.equal(runById(run, 'run-dsh').summary, 'Went on.')
  await signal(t, run)
  // Its next event runs in Marina's thread, made for it; nothing goes to the DSH bot.
  const event = await run.channels.fireSubscription(subsOf(run)[0], eventFor('Oi'))
  const marina = run.channels.threads.byChat(CHAT)
  await until(() => run.agentOf(marina.sessionId).calls.length === 1)
  assert.deepEqual([run.agentOf(marina.sessionId).calls[0].source, runById(run, event.id).sessionId], [{ kind: 'omni-run', runId: event.id }, marina.sessionId])
  assert.deepEqual(run.team.state.agents.coder.sessions, ['dsh-session'])
  await run.channels.save()
  assert.deepEqual(saved(home).subscriptions['sub-on'].worker, { kind: 'thread' })
})

test('on a team stand-in without the DSH-bot calls or the hook, a saved DSH-bot automation still moves; with no hook it then pauses with the thread\'s reason', async (t) => {
  const omni = watchedOmni(t)
  const home = homeFor(t, omni, teamState({ agents: agents(), ...before() }))
  const { run } = await bench(t, { home, omni, mask: true, dshBots: false })
  await until(() => subsOf(run).every(sub => sub.worker.kind === 'thread' && sub.on === false))
  assert.deepEqual(subsOf(run).map(sub => [sub.note, sub.pausedReason ?? null]), [[WORKER_MOVED.dshbot, THREAD_NEEDS_TEAM], [WORKER_MOVED.dshbot, THREAD_NEEDS_TEAM], [WORKER_MOVED.dshbot, null]])
})
