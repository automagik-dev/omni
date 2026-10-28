// The DSH-bot worker (wish omni-chat-threads, Group 16; design row 19), against the real Bot
// team (the release apps/automagik.json pins) on a fake DSH, and against a stand-in of it
// without the DSH-bot calls: an automation hands its events to one of the owner's DSH bots,
// in a new Session under it for each event or in one ongoing Session, only while the team
// offers DSH bots.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { DSH_BOT_GONE, DSH_BOT_NEEDS_TEAM } from '../src/host/dsh-bots.js'
import { ONGOING_RENEWED } from '../src/host/standing-runs.js'
import { SESSION_NEEDS_TEAM, THREAD_NEEDS_TEAM } from '../src/host/subscriptions.js'
import { boot, CHAT, eventFor, gateOf, homeFor, resetFetch, restart, signal, teamState, turn, until, watchedOmni } from './thread-fixture.js'

afterEach(resetFetch)

// Two DSH bots and the tasks record, as the team keeps them in state.agents.
const agents = () => ({
  coder: { id: 'coder', kind: 'dsh', name: 'Coder', workDir: import.meta.dirname, sessions: [], createdAt: 1 },
  writer: { id: 'writer', kind: 'dsh', name: 'Writer', sessions: [], createdAt: 2 },
  tasks: { id: 'tasks', kind: 'tasks', name: 'Tasks', sessions: [], createdAt: 3 },
})
// DSH's permission presets, recording every switch: nothing here may make one.
function presets() {
  const switched = []
  return {
    switched,
    set: (session, name) => { switched.push([session.id, name]) },
    catalog: () => ({ options: ['read-only', 'workspace-write'].map(value => ({ value, name: value })), defaultPreset: 'workspace-write' }),
    current: () => 'workspace-write',
  }
}
// One DSH start on a home linked to a fake Omni that lists its chats, with the DSH bots; the
// team's restart pass (its timer mocked, once per test) over unless `signal` is false.
const mocked = new WeakSet()
async function bench(t, { home, omni, signal: over = true, ...options } = {}) {
  if (!mocked.has(t)) t.mock.timers.enable({ apis: ['setTimeout'] })
  mocked.add(t)
  const linked = omni ?? watchedOmni(t)
  const place = home ?? homeFor(t, linked, teamState({ agents: agents() }))
  const preset = presets()
  const run = await boot(t, place, { services: { permissionPresets: preset }, ...options })
  if (over && !options.mask) await signal(t, run)
  return { run, home: place, omni: linked, presets: preset }
}
const tool = (run, name, args, agentId = 'm1') => run.ctx.registeredTools.get(name).execute(args, { agent: { id: agentId } })
const save = (run, args) => tool(run, 'save_automation', { sources: `chat:${CHAT}`, trigger: 'message', ...args })
const subsOf = run => Object.values(run.channels.state.subscriptions ?? {})
const runById = (run, id) => (run.channels.state.subscriptionRuns ?? []).find(item => item.id === id)
const fire = (run, sub, text) => run.channels.fireSubscription(sub, eventFor(text))
const postedTo = (run, sessionId) => run.agentOf(sessionId).calls
const sessionsOf = (run, agentId) => run.team.state.agents[agentId].sessions
const workerText = run => run.ctx.registeredTools.get('save_automation').parameters.properties.worker.description
const ownerMessage = text => ({ content: [{ type: 'text', text }], source: { kind: 'user' } })

test('without the DSH-bot calls no DSH bot is offered and a dshbot worker is refused with its own reason; with the floor release\'s calls, two DSH bots and the Tasks record, only the two bots are offered (:208)', async (t) => {
  const omni = watchedOmni(t)
  const home = homeFor(t, omni, teamState({ agents: agents() }))
  const without = await bench(t, { home, omni, dshBots: false })
  assert.equal(without.run.channels.omniDshBots.ready(), false)
  assert.doesNotMatch(await tool(without.run, 'find_chats', {}), /dshbot/)
  assert.doesNotMatch(workerText(without.run), /dshbot/)
  for (const worker of ['dshbot:Coder', 'dshbot:coder', 'dshbot:Nobody']) {
    assert.equal(await save(without.run, { worker }), `Not saved: ${DSH_BOT_NEEDS_TEAM}`, worker)
  }
  // Its reason is its own, not the thread's or the session worker's.
  assert.equal(new Set([DSH_BOT_NEEDS_TEAM, THREAD_NEEDS_TEAM, SESSION_NEEDS_TEAM]).size, 3)
  assert.deepEqual(subsOf(without.run), [])
  await without.run.stop()

  const { run } = await bench(t, { home, omni })
  const offered = (await tool(run, 'find_chats', {})).split('\n').filter(line => line.includes('dshbot:'))
  assert.deepEqual(offered, [
    `worker dshbot:Coder · a DSH bot working in ${import.meta.dirname} · as "new" or "ongoing"`,
    'worker dshbot:Writer · a DSH bot · as "new" or "ongoing"',
  ])
  assert.deepEqual((await tool(run, 'find_chats', { search: 'writ' })).split('\n').filter(line => line.includes('dshbot:')), ['worker dshbot:Writer · a DSH bot · as "new" or "ongoing"'])
  assert.match(workerText(run), /"dshbot:<name>"/)
  // The Tasks record is no DSH bot.
  assert.match(await save(run, { worker: 'dshbot:Tasks' }), /^Not saved: No DSH bot "Tasks"\./)
  assert.match(await save(run, { worker: 'dshbot:coder' }), /^Saved .*→ the DSH bot "Coder" \(a new session each time\)/)
  const [sub] = subsOf(run)
  assert.deepEqual(sub.worker, { kind: 'dshbot', agentId: 'coder', mode: 'new' })
  // `as` alone switches its mode, by the saved bot.
  assert.match(await save(run, { id: sub.id, as: 'ongoing' }), /→ the DSH bot "Coder" \(one ongoing session\)/)
  assert.deepEqual(subsOf(run)[0].worker, { kind: 'dshbot', agentId: 'coder', mode: 'ongoing' })
  assert.match(await save(run, { worker: 'dshbot:Writer', as: 'ongoing' }), /^Saved /)
  assert.deepEqual(subsOf(run)[1].worker, { kind: 'dshbot', agentId: 'writer', mode: 'ongoing' })
  assert.match(await tool(run, 'list_automations', {}), /any new message in Marina → the DSH bot "Writer" \(one ongoing session\)/)
  // The calls are read from the team itself: a property of this plugin's runtime (whose
  // prototype is the team) never hides them.
  Object.defineProperty(run.channels, 'dshBots', { value: undefined, configurable: true })
  assert.equal(run.channels.omniDshBots.ready(), true)
  assert.deepEqual(run.channels.omniDshBots.now().map(bot => bot.name), ['Coder', 'Writer'])
  assert.deepEqual((await run.channels.omniDshBots.list()).map(bot => bot.id), ['coder', 'writer'])
  delete run.channels.dshBots
})

test('on a team stand-in without the hook a DSH bot is not offered either, and a saved dshbot automation pauses with the reason (:195, DSH-bot part)', async (t) => {
  const omni = watchedOmni(t)
  const home = homeFor(t, omni, teamState({ agents: agents() }))
  const first = await bench(t, { home, omni })
  assert.match(await save(first.run, { worker: 'dshbot:Coder' }), /^Saved /)
  const masked = await restart(t, first.run, home, { mask: true })
  await until(() => subsOf(masked).every(sub => sub.on === false))
  assert.deepEqual(subsOf(masked).map(sub => sub.pausedReason), [DSH_BOT_NEEDS_TEAM])
  assert.doesNotMatch(workerText(masked), /dshbot/)
  assert.equal(await save(masked, { worker: 'dshbot:Coder' }), `Not saved: ${DSH_BOT_NEEDS_TEAM}`)
  assert.doesNotMatch(await tool(masked, 'find_chats', {}), /dshbot/)
})

test('"new" makes one Session per event under that DSH bot, none under the Omni row or in Tasks; each run is a standing run with no botId or task that ends with its own turn\'s words, and its Session keeps its bot\'s preset and model (:208, :192 record part)', async (t) => {
  const { run, presets: preset } = await bench(t)
  assert.match(await save(run, { worker: 'dshbot:Coder' }), /^Saved /)
  const [sub] = subsOf(run)
  const a = await fire(run, sub, 'Um')
  const b = await fire(run, sub, 'Dois')
  const [one, two] = [a.sessionId ?? a.target.id, b.sessionId ?? b.target.id]
  assert.notEqual(one, two)
  assert.deepEqual([sessionsOf(run, 'coder'), sessionsOf(run, 'writer'), sessionsOf(run, 'tasks')], [[one, two], [], []])
  assert.deepEqual(run.channels.omniRows.list(), [])
  await until(() => postedTo(run, one).length === 1 && postedTo(run, two).length === 1)
  assert.deepEqual([postedTo(run, one)[0].source, postedTo(run, two)[0].source], [{ kind: 'omni-run', runId: a.id }, { kind: 'omni-run', runId: b.id }])
  for (const record of [runById(run, a.id), runById(run, b.id)]) {
    assert.deepEqual([record.standing, record.status, Object.hasOwn(record, 'botId'), Object.hasOwn(record, 'task')], [true, 'working', false, false], record.id)
    // The floor release's indexSessions maps no such Session to the Omni Bot.
    assert.equal(run.team.selfOf(record.sessionId), undefined, record.id)
  }
  assert.equal(runById(run, a.id).summary, 'Handed to its session.')
  turn(run, one, 1, postedTo(run, one)[0], 'Feito um.')
  turn(run, two, 1, postedTo(run, two)[0], 'Feito dois.')
  await until(() => runById(run, b.id).status === 'done')
  assert.deepEqual([runById(run, a.id).summary, runById(run, b.id).summary], ['Feito um.', 'Feito dois.'])
  assert.deepEqual([preset.switched, run.selected.filter(([id]) => id === one || id === two)], [[], []])
})

test('"ongoing" puts every event in one Session under that DSH bot, one after another, and ask-first makes non-read tools ask in their turns only; once the owner archives it the next event gets a new Session and the board says so (:208)', async (t) => {
  const { run, presets: preset } = await bench(t)
  assert.match(await save(run, { worker: 'dshbot:Writer', as: 'ongoing' }), /^Saved /)
  const [sub] = subsOf(run)
  const first = await fire(run, sub, 'Um')
  const second = await fire(run, sub, 'Dois')
  const sessionId = subsOf(run)[0].ongoingSessionId
  assert.deepEqual(sessionsOf(run, 'writer'), [sessionId])
  assert.deepEqual([runById(run, first.id).sessionId, runById(run, second.id).status], [sessionId, 'queued'])
  await until(() => postedTo(run, sessionId).length === 1)
  turn(run, sessionId, 1, postedTo(run, sessionId)[0], undefined, null)
  assert.equal((await gateOf(run, 'bash', sessionId)).kind, 'ask')
  assert.deepEqual(await gateOf(run, 'read', sessionId), { kind: 'allow' })
  run.emit(sessionId, 'assistant/message', { message: { content: [{ type: 'text', text: 'Anotado.' }] } })
  run.emit(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  await until(() => postedTo(run, sessionId).length === 2)
  assert.equal(postedTo(run, sessionId)[1].source.runId, second.id)
  turn(run, sessionId, 2, postedTo(run, sessionId)[1], 'Ela traz.')
  await until(() => runById(run, second.id).status === 'done')
  assert.deepEqual([runById(run, first.id).summary, runById(run, second.id).summary], ['Anotado.', 'Ela traz.'])
  // The owner's own turn there keeps the bot's rules: nothing asks.
  turn(run, sessionId, 3, ownerMessage('and the docs?'), undefined, null)
  assert.deepEqual(await gateOf(run, 'bash', sessionId), { kind: 'allow' })
  run.emit(sessionId, 'turn/end', { turn: 3, reason: { kind: 'completed' } })
  assert.deepEqual(preset.switched, [])

  // The owner archived it: a new Session under the same bot, the board told why.
  run.archived.push(sessionId)
  const third = await fire(run, sub, 'Três')
  const renewed = subsOf(run)[0].ongoingSessionId
  assert.notEqual(renewed, sessionId)
  assert.deepEqual(sessionsOf(run, 'writer'), [sessionId, renewed])
  assert.equal(runById(run, third.id).note, ONGOING_RENEWED.archived)
  await until(() => postedTo(run, renewed).length === 1)
  assert.equal(runById(run, third.id).summary, 'Handed to the DSH bot\'s ongoing session.')
  assert.equal(run.view().subscriptionRuns.find(item => item.id === third.id).note, ONGOING_RENEWED.archived)

  // With ask-first off, its tagged turns follow the bot's own rules.
  assert.match(await save(run, { id: sub.id, ask_first: false }), /^Saved /)
  turn(run, renewed, 1, postedTo(run, renewed)[0], 'Ok.')
  await until(() => runById(run, third.id).status === 'done')
  const fourth = await fire(run, subsOf(run)[0], 'Quatro')
  await until(() => postedTo(run, renewed).length === 2)
  turn(run, renewed, 2, postedTo(run, renewed)[1], undefined, null)
  assert.deepEqual(await gateOf(run, 'bash', renewed), { kind: 'allow' })
  assert.equal(runById(run, fourth.id).askFirst, false)
})

test('losing the DSH bot pauses its automations, the board saying why, and their waiting events end; losing the team\'s calls pauses them at the next start; neither takes an event or turns on again (:208)', async (t) => {
  const omni = watchedOmni(t)
  const home = homeFor(t, omni, teamState({ agents: agents() }))
  const { run } = await bench(t, { home, omni, signal: false })
  assert.match(await save(run, { worker: 'dshbot:Writer', as: 'ongoing' }), /^Saved /)
  assert.match(await save(run, { worker: 'dshbot:Coder' }), /^Saved /)
  const [writes, codes] = subsOf(run)
  // Before the team's pass is over the event waits.
  const waiting = await fire(run, writes, 'Um')
  assert.equal(runById(run, waiting.id).status, 'queued')
  // The owner deletes Writer: the team says its DSH bots changed.
  delete run.team.state.agents.writer
  await run.team.save()
  await until(() => subsOf(run).find(sub => sub.id === writes.id).on === false)
  assert.deepEqual(subsOf(run).map(sub => [sub.on, sub.pausedReason]), [[false, DSH_BOT_GONE], [true, undefined]])
  assert.deepEqual([runById(run, waiting.id).status, runById(run, waiting.id).summary], ['failed', `Not handed over: ${DSH_BOT_GONE}`])
  assert.equal(run.view().subscriptions.find(sub => sub.id === writes.id).pausedReason, DSH_BOT_GONE)
  await assert.rejects(fire(run, { ...writes, on: true }, 'Dois'), { message: `${writes.name} is paused: ${DSH_BOT_GONE}` })
  assert.equal((await run.call('automation-set-on', { id: writes.id, on: true }).catch(error => error)).message, `${writes.name} stays paused: ${DSH_BOT_GONE}`)
  assert.match(await save(run, { worker: 'dshbot:Writer' }), /^Not saved: No DSH bot "Writer"\./)

  // The next start's team has no DSH-bot calls.
  const without = await restart(t, run, home, { dshBots: false })
  await until(() => subsOf(without).find(sub => sub.id === codes.id).on === false)
  assert.equal(subsOf(without).find(sub => sub.id === codes.id).pausedReason, DSH_BOT_NEEDS_TEAM)
  const made = without.made.length
  await assert.rejects(without.channels.fireSubscription({ ...codes, on: true }, eventFor('Três')), { message: `${codes.name} is paused: ${DSH_BOT_NEEDS_TEAM}` })
  assert.equal(without.made.length, made)
})
