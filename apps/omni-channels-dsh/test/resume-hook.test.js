import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime as createTeam } from '@automagik/bots-dsh'
import { createRuntime } from '../index.js'
import { install, isResumeMessage, NEEDS_NEWER_TEAM, TEAM_CONTRACT } from '../src/host/resume-hook.js'
import { decideUnbound, NOT_PICKED_UP } from '../src/host/standing-recovery.js'
import { fakeContext } from './team.js'
import { boot, homeFor, record, teamState, flush as threadFlush, until } from './thread-fixture.js'

const flush = async () => {
  for (let round = 0; round < 20; round += 1) await new Promise(resolve => setImmediate(resolve))
}

// A Bot team before the hook (below the floor): the real-team tests then check the
// not-ready path. Every such branch calls this.

// The adapter alone on a stand-in team: its hook records what registers, and `settle`
// resolves resumesDone with an outcome the real pass cannot produce on demand, after asking
// every registration for its Sessions, as the real pass does. `over`: the pass was over
// before the plugin registered, with that outcome. `signal: false`: a hook with no
// resumesDone. `hostReadOnly`: what rt.readOnly() says.
function standIn({ hook = true, signal = true, refuse, over, hostReadOnly } = {}) {
  const ctx = fakeContext()
  const warned = []
  const registered = []
  const unregistered = []
  let settle
  const rt = {
    ctx,
    warn: (format, ...args) => warned.push([format, ...args]),
    readOnly: () => hostReadOnly,
    ...(hook ? {
      resumable: {
        register(entry) {
          if (refuse) throw new Error(refuse)
          registered.push(entry)
          return () => unregistered.push(entry.id)
        },
      },
      ...(signal ? { resumesDone: over ? Promise.resolve(over) : new Promise((resolve) => { settle = resolve }) } : {}),
    } : {}),
  }
  install(rt)
  const emit = (id, type) => { for (const listener of ctx.listeners.get('session/event') ?? []) listener({ id }, { type }) }
  const answer = (outcome) => {
    for (const entry of registered) entry.sessions()
    settle(outcome)
  }
  return { rt, ctx, warned, registered, unregistered, emit, settle: answer }
}
// What a recovery was given, its Sets as sorted lists.
const plain = given => ({ ...given, resumed: [...given.resumed].sort(), resent: [...given.resent].sort() })

test('the plugin registers once with the hook; no recovery runs before the team says its resumes are done, however long that takes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'setImmediate', 'Date'] })
  const { rt, registered, settle } = standIn()
  assert.equal(registered.length, 1)
  assert.equal(registered[0].id, 'omni-channels')
  assert.deepEqual([rt.teamResume.ready, rt.teamResume.reason], [true, null])
  const given = []
  rt.teamResume.addRecovery(outcome => given.push(['first', plain(outcome)]))
  rt.teamResume.addRecovery(async (outcome) => {
    await Promise.resolve()
    given.push(['second', plain(outcome)])
  })
  // A week of timers, and still nothing.
  for (let hour = 0; hour < 7 * 24; hour += 1) t.mock.timers.tick(60 * 60 * 1000)
  t.mock.timers.reset()
  await flush()
  assert.deepEqual(given, [])
  settle({ resumed: ['thread'], resent: ['row'] })
  await flush()
  const outcome = { readOnly: null, failed: null, resumed: ['thread'], resent: ['row'], late: false }
  assert.deepEqual(given, [['first', outcome], ['second', outcome]])
  // Once each: nothing more runs later.
  await flush()
  assert.equal(given.length, 2)
})

test('picked up means resumed or sent again; { failed } counts only those, like a pass', async () => {
  const { rt, settle } = standIn()
  let seen
  rt.teamResume.addRecovery((outcome) => { seen = outcome })
  settle({ failed: 'DS Bot stopped before the restart pass ended', resumed: ['a'], resent: ['b'] })
  await flush()
  assert.equal(seen.failed, 'DS Bot stopped before the restart pass ended')
  assert.deepEqual(['a', 'b', 'c'].map(id => rt.teamResume.pickedUp(seen, id)), [true, true, false])
})

test('a bad entry in the team\'s lists drops only itself, so the Sessions it did resume stay picked up', async () => {
  const { rt, settle } = standIn()
  let seen
  rt.teamResume.addRecovery((outcome) => { seen = outcome })
  settle({ resumed: ['a', 7, '', null], resent: [{ id: 'x' }, 'b'] })
  await flush()
  assert.deepEqual(plain(seen), { readOnly: null, failed: null, resumed: ['a'], resent: ['b'], late: false })
})

test('{ readOnly } runs no recovery and writes nothing, also for one added later', async () => {
  const { rt, settle } = standIn()
  const state = { subscriptionRuns: [{ id: 'run', status: 'working', sessionId: 's' }] }
  const before = JSON.stringify(state)
  let saved = 0
  rt.save = async () => { saved += 1 }
  const ran = []
  rt.teamResume.addRecovery(outcome => ran.push(outcome))
  settle({ readOnly: 'Omni is open in another dsh', resumed: [], resent: [] })
  await flush()
  rt.teamResume.addRecovery(outcome => ran.push(outcome))
  await flush()
  assert.deepEqual([ran, saved, JSON.stringify(state)], [[], 0, before])
})

test('a recovery added after the pass reads every Session as not resumed', async () => {
  const { rt, settle } = standIn()
  settle({ resumed: ['thread'], resent: ['row'] })
  await flush()
  let seen
  rt.teamResume.addRecovery((outcome) => { seen = outcome })
  await flush()
  assert.deepEqual(plain(seen), { readOnly: null, failed: null, resumed: [], resent: [], late: true })
  assert.equal(rt.teamResume.pickedUp(seen, 'thread'), false)
})

test('a plugin that registers after the pass reads its Sessions as not resumed', async () => {
  const { rt, registered } = standIn({ over: { resumed: ['thread'], resent: ['row'] } })
  assert.equal(registered.length, 1)
  let seen
  rt.teamResume.addRecovery((outcome) => { seen = outcome })
  await flush()
  assert.deepEqual(plain(seen), { readOnly: null, failed: null, resumed: [], resent: [], late: true })
})

test('a hook with no resumesDone signal is no hook: not ready, nothing registers, no recovery runs', async () => {
  const { rt, registered } = standIn({ signal: false })
  assert.deepEqual([rt.teamResume.ready, rt.teamResume.reason, registered], [false, NEEDS_NEWER_TEAM, []])
  const ran = []
  rt.teamResume.addRecovery(outcome => ran.push(outcome))
  await flush()
  assert.deepEqual(ran, [])
})

test('a host that only reads the team runs no recovery, whatever the outcome says', async () => {
  const { rt, settle } = standIn({ hostReadOnly: 'Omni is open in another dsh' })
  const ran = []
  rt.teamResume.addRecovery(outcome => ran.push(outcome))
  settle({ resumed: ['thread'], resent: [] })
  await flush()
  rt.teamResume.addRecovery(outcome => ran.push(outcome))
  await flush()
  assert.deepEqual(ran, [])
})

test('turned off while a recovery runs, the plugin runs none of the ones after it', async () => {
  const { rt, ctx, settle } = standIn()
  const ran = []
  let release
  rt.teamResume.addRecovery(async () => {
    ran.push('first')
    await new Promise((resolve) => { release = resolve })
  })
  rt.teamResume.addRecovery(() => ran.push('second'))
  settle({ resumed: [], resent: [] })
  await flush()
  assert.deepEqual(ran, ['first'])
  await ctx.dispose()
  release()
  await flush()
  assert.deepEqual(ran, ['first'])
})

test('sessions() is every source\'s Sessions once, as plain ids; onResume calls each binder, and one that throws is logged', () => {
  const { rt, registered, warned } = standIn()
  const { sessions, onResume } = registered[0]
  rt.teamResume.addSessions(() => ['thread', 'row'])
  rt.teamResume.addSessions(() => ['row', '', 7, null, 'run'])
  rt.teamResume.addSessions(() => { throw new Error('state not read') })
  rt.teamResume.addSessions(() => 'not a list')
  assert.deepEqual(sessions(), ['thread', 'row', 'run'])
  assert.match(warned[0][0], /a source of restart resumes failed/)
  const bound = []
  rt.teamResume.addResumeBinder(id => bound.push(['first', id]))
  rt.teamResume.addResumeBinder(() => { throw new Error('no run') })
  rt.teamResume.addResumeBinder(id => bound.push(['third', id]))
  onResume({ sessionId: 'thread' })
  assert.deepEqual(bound, [['first', 'thread'], ['third', 'thread']])
  assert.deepEqual(warned.at(-1).slice(1), ['thread', 'no run'])
})

test('running is a turn started since this start and not ended', () => {
  const { rt, emit } = standIn()
  assert.equal(rt.teamResume.running('s'), false)
  emit('s', 'turn/start')
  assert.equal(rt.teamResume.running('s'), true)
  emit('s', 'turn/end')
  assert.equal(rt.teamResume.running('s'), false)
})

test('a resume the team posts is told by its source: a delivery\'s, or the plain follow-up', () => {
  assert.equal(isResumeMessage({ source: { kind: 'ds-bot', role: 'resume', resumed: true } }), true)
  assert.equal(isResumeMessage({ source: { kind: 'user', resumed: true } }), true)
  assert.equal(isResumeMessage({ source: { kind: 'user' } }), false)
  assert.equal(isResumeMessage({ source: { kind: 'user', resume: true } }), false)
  assert.equal(isResumeMessage(undefined), false)
  assert.equal(TEAM_CONTRACT.resumeMarker({ resumed: 'yes' }), false)
})

test('against a team with no hook: not ready with one reason, nothing registers, no recovery runs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const { rt, ctx } = standIn({ hook: false })
  assert.deepEqual([rt.teamResume.ready, rt.teamResume.reason], [false, NEEDS_NEWER_TEAM])
  const ran = []
  rt.teamResume.addRecovery(outcome => ran.push(outcome))
  t.mock.timers.tick(24 * 60 * 60 * 1000)
  await flush()
  assert.deepEqual(ran, [])
  await ctx.dispose()
})

test('a hook that refuses the registration leaves the plugin not ready, with the reason', () => {
  const { rt, warned } = standIn({ refuse: 'ds-bot: resumable omni-channels is already registered' })
  assert.equal(rt.teamResume.ready, false)
  assert.match(rt.teamResume.reason, /already registered/)
  assert.equal(warned.length, 1)
})

test('turned off before the signal, the plugin leaves the hook and runs no recovery', async () => {
  const { rt, ctx, unregistered, settle } = standIn()
  const ran = []
  rt.teamResume.addRecovery(outcome => ran.push(outcome))
  await ctx.dispose()
  assert.deepEqual(unregistered, ['omni-channels'])
  settle({ resumed: [], resent: [] })
  await flush()
  assert.deepEqual(ran, [])
})

// The real Bot team with this plugin on it, on a home with Omni (the Omni Bot runs
// automations), Ops, and a working automation run for each, as DSH composes them. Agents are
// stand-ins whose Session log is `events`. `mask` hides the hook, as a team before it has none.
// `late`: the plugin is installed only after the team's pass is over. `during`: it is
// installed from inside the pass, at its first resolveAgent, and handed to `during`.
async function start(t, { mask = false, late = false, during } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'omni-resume-'))
  const at = Date.now() - 60_000
  writeFileSync(join(home, 'state.json'), JSON.stringify({
    version: 1, mainBotIds: ['m1'], revision: 1,
    bots: {
      m1: { id: 'm1', name: 'Omni', role: 'Orchestrator', instructions: '', createdAt: 1 },
      b2: { id: 'b2', name: 'Ops', role: 'Ops', instructions: '', createdAt: 2 },
    },
    rooms: {}, agents: {}, exchanges: [], exchangeTurns: {},
    subscriptions: {},
    subscriptionRuns: [
      { id: 'run-1', subId: 'sub-1', at, status: 'working', task: true, botId: 'm1', sessionId: 'run-omni', summary: 'Handing it to Omni…' },
      { id: 'run-2', subId: 'sub-2', at, status: 'working', task: true, botId: 'b2', sessionId: 'run-ops', summary: 'Handing it to Ops…' },
    ],
  }))
  const ctx = fakeContext()
  let installing
  let channels
  const install = () => (channels = createRuntime(ctx, base))
  const agents = new Map()
  const agentOf = (sessionId) => {
    if (!agents.has(sessionId)) {
      const calls = []
      const keep = (message) => { calls.push(message) }
      agents.set(sessionId, { session: { id: sessionId, seq: 0, eventAt: () => undefined }, status: 'idle', calls, inbox: { nextStep: [], nextTurn: [], remove: () => false }, followup: keep, steer: keep, cancel() {} })
    }
    return agents.get(sessionId)
  }
  // A Session whose last turn a restart cut a second ago.
  const cut = (sessionId) => {
    const events = [{ type: 'turn/start', time: Date.now() - 60_000 }, { type: 'turn/end', time: Date.now() - 1000, data: { reason: { kind: 'interrupted' } } }]
    agentOf(sessionId).session = { id: sessionId, seq: events.length, eventAt: seq => events[seq] }
  }
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async path => ({ id: 'w1', path }), archiveSession: async () => {} },
    sessionController: {
      create: async () => ({ sessionId: 's1' }),
      resolveAgent: async (sessionId) => {
        const handOver = installing
        installing = undefined
        handOver?.(install())
        return { agent: agentOf(sessionId) }
      },
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  const team = createTeam(ctx, { home })
  const callsOfTeam = ctx.calls.length
  const registrations = []
  const register = team.resumable.register
  team.resumable.register = (entry) => {
    registrations.push({ id: entry.id, callsBefore: ctx.calls.slice(callsOfTeam) })
    return register(entry)
  }
  const base = mask ? Object.create(team, { resumable: { value: undefined }, resumesDone: { value: undefined } }) : team
  if (late) {
    for (const id of ['run-omni', 'run-ops']) cut(id)
    t.mock.timers.tick(3000)
    await team.resumesDone
  }
  if (during) installing = during
  else install()
  const emit = (id, type, data) => { for (const listener of ctx.listeners.get('session/event') ?? []) if (listener.length >= 2) listener({ id }, { type, data }) }
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })
  return { ctx, team, get channels() { return channels }, home, registrations, agentOf, cut, emit }
}
const runsOf = home => Object.fromEntries(JSON.parse(readFileSync(join(home, 'state.json'), 'utf8')).subscriptionRuns.map(run => [run.sessionId, run.status]))

// The floor: the Bot team Omni pins is the release TEAM_CONTRACT names, the one this plugin's
// peer range starts at, and it has the hook, so every test here runs the real one.
test('the pinned Bot team is the release TEAM_CONTRACT names, and it has the hook', async (t) => {
  const pin = JSON.parse(readFileSync(new URL('../../automagik.json', import.meta.url), 'utf8'))
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(TEAM_CONTRACT.release, pin.version)
  assert.match(pkg.peerDependencies['@automagik/bots-dsh'], new RegExp(`^>=${TEAM_CONTRACT.release.replaceAll('.', '\\.')} `))
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'omni-floor-'))
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })
  const team = createTeam(ctx, { home })
  for (const path of [TEAM_CONTRACT.register, TEAM_CONTRACT.dshBotsList, TEAM_CONTRACT.dshBotsCreate, TEAM_CONTRACT.dshBotsChanged]) {
    assert.equal(typeof path.split('.').reduce((value, key) => value?.[key], team), 'function', path)
  }
  assert.equal(typeof team.resumesDone?.then, 'function')
})

test('the plugin registers with the Bot team once, before any other work', async (t) => {
  const { channels, registrations } = await start(t)
  // Nothing of the plugin's came before it but the adapter's own listener and effect.
  assert.deepEqual(registrations, [{ id: 'omni-channels', callsBefore: ['on session/event', 'effect ds-bot: restart resumes'] }])
  assert.equal(channels.teamResume.ready, true)
  // The adapter is the plugin's own, not the team's.
  for (const name of ['teamResume', 'threadKeys', 'threads', 'omniRows', 'standingRuns', 'omniDshBots']) assert.equal(name in Object.getPrototypeOf(channels), false, name)
  assert.equal(typeof Object.getPrototypeOf(channels).createTaskSession, 'function')
})

test('a restart cuts an Omni Bot run, a Bot run and a thread: the team resumes each once, telling the plugin first, and recovery waits for that', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { channels, team, home, agentOf, cut, emit } = await start(t)
  const recovered = []
  channels.teamResume.addRecovery(outcome => recovered.push(outcome))
  const bound = []
  channels.teamResume.addSessions(() => ['thread'])
  channels.teamResume.addResumeBinder(sessionId => bound.push([sessionId, agentOf(sessionId).calls.length]))
  for (const id of ['run-omni', 'run-ops', 'thread']) cut(id)
  t.mock.timers.tick(2999)
  await flush()
  assert.deepEqual(recovered, [])
  t.mock.timers.tick(1)
  const done = await team.resumesDone
  assert.deepEqual([...done.resumed].sort(), ['run-omni', 'run-ops', 'thread'])
  await flush()
  assert.equal(recovered.length, 1)
  assert.deepEqual(['run-omni', 'run-ops', 'thread', 'm1'].map(id => channels.teamResume.pickedUp(recovered[0], id)), [true, true, true, false])
  // The thread's binder ran before its post, and only for the Session the plugin listed.
  assert.deepEqual(bound, [['thread', 0]])
  // Each run went on once as its Bot's run, in its own Session, through rt.deliver; the
  // thread as the plain follow-up. Each is told as a resume; the Bots' chats got nothing.
  for (const id of ['run-omni', 'run-ops']) {
    assert.deepEqual(agentOf(id).calls.map(message => [message.source.role, isResumeMessage(message)]), [['resume', true]], id)
  }
  assert.deepEqual(agentOf('thread').calls.map(message => message.source), [{ kind: 'user', resumed: true }])
  assert.deepEqual([agentOf('m1').calls.length, agentOf('b2').calls.length], [0, 0])
  // The runs stayed working through the cut, and finish with the resumed turn's end.
  assert.deepEqual(runsOf(home), { 'run-omni': 'working', 'run-ops': 'working' })
  emit('run-omni', 'turn/end', { reason: { kind: 'completed' } })
  emit('run-ops', 'turn/end', { reason: { kind: 'error', error: { message: 'model down' } } })
  await channels.save()
  assert.deepEqual(runsOf(home), { 'run-omni': 'done', 'run-ops': 'failed' })
})

test('on a team stand-in with no hook the whole plugin loads: not ready, nothing registers, no recovery runs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { channels, team, registrations, cut } = await start(t, { mask: true })
  assert.deepEqual([channels.teamResume.ready, channels.teamResume.reason], [false, NEEDS_NEWER_TEAM])
  const recovered = []
  channels.teamResume.addSessions(() => ['thread'])
  channels.teamResume.addRecovery(outcome => recovered.push(outcome))
  cut('thread')
  t.mock.timers.tick(3000)
  assert.deepEqual((await team.resumesDone).resumed.includes('thread'), false)
  await flush()
  assert.deepEqual([registrations, recovered], [[], []])
})

test('registered after the team\'s pass, the plugin reads the runs the team resumed as not resumed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { channels, team, agentOf } = await start(t, { late: true })
  const recovered = []
  channels.teamResume.addRecovery(outcome => recovered.push(outcome))
  await flush()
  // The team found and resumed the runs on its own, before the plugin was there to hear.
  assert.deepEqual([...(await team.resumesDone).resumed].sort(), ['run-omni', 'run-ops'])
  assert.equal(agentOf('run-omni').calls.length, 1)
  assert.deepEqual(recovered.map(plain), [{ readOnly: null, failed: null, resumed: [], resent: [], late: true }])
})

test('installed during the team\'s pass, after it asked for Sessions, the plugin reads every one as not resumed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const recovered = []
  const plugin = await start(t, { during: channels => channels.teamResume.addRecovery(outcome => recovered.push(outcome)) })
  for (const id of ['run-omni', 'run-ops']) plugin.cut(id)
  t.mock.timers.tick(3000)
  // The team resumed the runs it found itself; the plugin came in after it read the owners.
  assert.deepEqual([...(await plugin.team.resumesDone).resumed].sort(), ['run-omni', 'run-ops'])
  await flush()
  assert.deepEqual(plugin.registrations.map(entry => entry.id), ['omni-channels'])
  assert.deepEqual(recovered.map(plain), [{ readOnly: null, failed: null, resumed: [], resent: [], late: true }])
  assert.equal(plugin.channels.teamResume.pickedUp(recovered[0], 'run-omni'), false)
})

// Asks (Group 10) across a restart, on the real Bot team's pass: a thread, and an ask run of
// the Omni Bot's for it, as the last start left them.
const ASK_AT = Date.now() - 60_000
const askState = (status = 'working') => teamState({
  omniThreads: { thr: record('thr', 'thread-session') },
  subscriptions: {},
  subscriptionRuns: [{ id: 'ask-1', ask: true, threadId: 'thr', sessionId: 'ask-session', botId: 'm1', task: true, status, at: ASK_AT }],
})
const askRecord = run => (run.channels.state.subscriptionRuns ?? []).find(item => item.id === 'ask-1')
const textsOf = (run, sessionId) => run.agentOf(sessionId).calls.map(message => message.content.map(block => block.text).join(''))
// The ask Session's turn answers and ends, as DSH ends a finished turn.
async function answered(run, words, sessionId = 'ask-session') {
  run.emit(sessionId, 'turn/start', { turn: 2 }, Date.now())
  run.emit(sessionId, 'assistant/message', { message: { content: [{ type: 'text', text: words }] } })
  run.emit(sessionId, 'turn/end', { reason: { kind: 'completed' } })
  await until(() => run.agentOf('thread-session').calls.length > 0)
}

test('an ask cut by a restart is resumed once as the Omni Bot through rt.deliver, never as a plain follow-up, though its Session is also in sessions(); its answer still arrives (:189, :193)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const home = homeFor(t, undefined, askState())
  const run = await boot(t, home)
  // The team finds it itself, as the Omni Bot's run, and the plugin lists it too.
  assert.deepEqual(run.registered[0].sessions(), ['ask-session'])
  assert.deepEqual(run.team.taskOwners.get('ask-session'), { botId: 'm1' })
  run.cut('ask-session')
  t.mock.timers.tick(3000)
  const done = await run.team.resumesDone
  await threadFlush()
  assert.equal(done.resumed.includes('ask-session'), true)
  // Once, as a delivery to the Omni Bot in the ask's own Session, marked as the team's resume.
  const posts = run.agentOf('ask-session').calls.map(message => message.source)
  assert.equal(posts.length, 1)
  assert.deepEqual([posts[0].kind, posts[0].role, isResumeMessage({ source: posts[0] })], ['bot', 'resume', true])
  assert.deepEqual([run.agentOf('m1').calls, run.agentOf('thread-session').calls], [[], []])
  assert.equal(askRecord(run).status, 'working')
  // The resumed turn's end answers the thread, and the ask is gone.
  await answered(run, 'Chegou ontem.')
  assert.equal(textsOf(run, 'thread-session').length, 1)
  assert.match(textsOf(run, 'thread-session')[0], /^\[Answer from Omni \(the Omni Bot\) · to the question you asked it with thread_ask_omni.*\]\nChegou ontem\.$/)
  assert.equal(askRecord(run), undefined)
  assert.deepEqual(run.archiving, [['ask-session', { stopActivity: true }]])
})

test('an ask cut and not picked up posts one "cut by a restart" message in its thread on the signal, and is archived and gone (:201)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const home = homeFor(t, undefined, askState())
  const run = await boot(t, home)
  const flushed = []
  run.ctx.sessions.flush = async (session) => { flushed.push(session.id) }
  // Its Session's log shows no cut turn: the team does not resume it, and it is not running.
  t.mock.timers.tick(3000)
  const done = await run.team.resumesDone
  await until(() => run.agentOf('thread-session').calls.length > 0)
  assert.deepEqual([done.resumed.includes('ask-session'), done.resent.includes('ask-session')], [false, false])
  assert.deepEqual(textsOf(run, 'thread-session'), ['[Answer from Omni (the Omni Bot) · your question was cut by a restart of DeepSeek Harness, and its answer is lost; ask again if it still matters]'])
  assert.deepEqual(flushed, ['thread-session'])
  assert.deepEqual(run.agentOf('ask-session').calls, [])
  assert.deepEqual(run.archiving, [['ask-session', { stopActivity: true }]])
  assert.equal(askRecord(run), undefined)
  assert.deepEqual(run.registered[0].sessions(), [])
  // Saved gone: the next start posts nothing more.
  await run.channels.save()
  await run.stop()
  const next = await boot(t, home)
  t.mock.timers.tick(3000)
  await next.team.resumesDone
  await threadFlush()
  assert.deepEqual(next.agentOf('thread-session').calls, [])
})

test('MEDIUM-2: an ask whose Session is in resent and not in resumed is not ended as lost and posts no "cut" message; its answer still arrives', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const home = homeFor(t, undefined, teamState({ omniThreads: { thr: record('thr', 'thread-session') }, subscriptions: {} }))
  const first = await boot(t, home)
  // Asked; DSH goes down before any turn took the question.
  assert.match(await first.channels.askOmni(first.channels.threads.byId('thr'), 'Quem mandou o orçamento?'), /^Asked Omni\./)
  const sessionId = first.made.at(-1)
  await first.channels.save()
  await first.stop()
  const run = await boot(t, home)
  t.mock.timers.tick(3000)
  const done = await run.team.resumesDone
  await threadFlush()
  // The team sent the dropped question again rather than resuming a turn.
  assert.deepEqual([done.resumed.includes(sessionId), done.resent.includes(sessionId)], [false, true])
  const sent = run.agentOf(sessionId).calls
  assert.deepEqual(sent.map(message => [message.source.role, message.source.kind]), [['task', 'bot']])
  assert.match(sent[0].content[0].text, /Quem mandou o orçamento\?/)
  // Not ended as lost: no message in the thread, the record still works, its gate holds.
  assert.deepEqual(run.agentOf('thread-session').calls, [])
  const working = (run.channels.state.subscriptionRuns ?? []).find(item => item.sessionId === sessionId)
  assert.equal(working.status, 'working')
  assert.deepEqual(run.archiving, [])
  // Its answer still arrives.
  run.emit(sessionId, 'turn/start', { turn: 1 }, Date.now())
  run.emit(sessionId, 'assistant/message', { message: { content: [{ type: 'text', text: 'A Marina.' }] } })
  run.emit(sessionId, 'turn/end', { reason: { kind: 'completed' } })
  await until(() => run.agentOf('thread-session').calls.length > 0)
  assert.match(textsOf(run, 'thread-session')[0], /\nA Marina\.$/)
  assert.equal((run.channels.state.subscriptionRuns ?? []).some(item => item.sessionId === sessionId), false)
})

test('a stopping ask is never resumed and never listed; on the signal it is archived and dropped, and its thread hears nothing (:201)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const home = homeFor(t, undefined, askState('stopping'))
  const run = await boot(t, home)
  assert.deepEqual(run.registered[0].sessions(), [])
  run.cut('ask-session')
  t.mock.timers.tick(3000)
  const done = await run.team.resumesDone
  await until(() => askRecord(run) === undefined)
  assert.equal(done.resumed.includes('ask-session'), false)
  assert.deepEqual([run.agentOf('ask-session').calls, run.agentOf('thread-session').calls], [[], []])
  assert.deepEqual(run.archiving, [['ask-session', { stopActivity: true }]])
  assert.equal(askRecord(run), undefined)
})

test('an ask ended after a restart that sent its question again leaves nothing to send: the next restart delivers nothing, and nothing reaches the Omni Bot\'s chat', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const home = homeFor(t, undefined, teamState({ omniThreads: { thr: record('thr', 'thread-session') }, subscriptions: {} }))
  // First start: asked, and DSH goes down before a turn takes the question.
  const first = await boot(t, home)
  assert.match(await first.channels.askOmni(first.channels.threads.byId('thr'), 'Quem mandou o orçamento?'), /^Asked Omni\./)
  const sessionId = first.made.at(-1)
  await first.channels.save()
  await first.stop()
  // Second start: the team sends the question again; the chat is removed before a turn takes it.
  const second = await boot(t, home)
  t.mock.timers.tick(3000)
  assert.equal((await second.team.resumesDone).resent.includes(sessionId), true)
  await threadFlush()
  await second.channels.threads.remove('thr')
  await until(() => (second.channels.state.subscriptionRuns ?? []).length === 0)
  assert.deepEqual(second.team.unreadOf(sessionId), [])
  await second.channels.save()
  await second.stop()
  // Third start: nothing is sent again, to the ask's Session or the Omni Bot's own chat.
  const third = await boot(t, home)
  t.mock.timers.tick(3000)
  const done = await third.team.resumesDone
  await threadFlush()
  assert.deepEqual([done.resent, third.agentOf('m1').calls, third.agentOf(sessionId).calls], [[], [], []])
})

test('a stopping ask whose turn began before this start stays a tombstone while its live agent runs, and settles when that turn ends', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const home = homeFor(t, undefined, askState('stopping'))
  const run = await boot(t, home)
  // DSH went on while the plugin reloaded: the ask Session's agent still runs its turn.
  run.agentOf('ask-session').status = 'running'
  t.mock.timers.tick(3000)
  await run.team.resumesDone
  // Archived, then its live agent read: it still runs, so the record stays.
  await until(() => run.archiving.length > 0 && run.resolved.includes('ask-session'))
  await threadFlush()
  assert.equal(askRecord(run)?.status, 'stopping')
  assert.equal((await run.channels.teamResume.running('ask-session')), false)
  // The turn ends: the stop holds now, and the record goes.
  run.agentOf('ask-session').status = 'idle'
  run.emit('ask-session', 'turn/end', { reason: { kind: 'aborted', reason: { kind: 'user' } } })
  await until(() => askRecord(run) === undefined)
  assert.equal(askRecord(run), undefined)
})

// Standing-Session runs across a restart (Group 13): the hook's source and binder on the real
// Bot team's pass; the scenarios are in subscriptions.test.js.
test('decideUnbound: taken waits for its turn; neither pending nor taken fails; pending waits while its Session is picked up or running, and is woken otherwise', () => {
  const seen = []
  for (const pending of [false, true]) for (const taken of [false, true]) for (const pickedUp of [false, true]) for (const running of [false, true]) {
    seen.push([pending, taken, pickedUp, running, decideUnbound({ pending, taken, pickedUp, running })])
  }
  const expected = seen.map(([pending, taken, pickedUp, running]) => [pending, taken, pickedUp, running, taken ? 'wait' : !pending ? 'fail' : pickedUp || running ? 'wait' : 'wake'])
  assert.deepEqual(seen, expected)
  assert.equal(seen.filter(row => row[4] === 'wake').length, 1)
  assert.equal(NOT_PICKED_UP, 'Stopped by a DSH restart and not picked up')
})

test('the hook lists the Session of every working standing run, never a queued, ended or archived one; the team\'s pass tells the plugin before it posts a resume there, and the run, picked up, stays working', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const at = Date.now() - 60_000
  const home = homeFor(t, undefined, teamState({
    subscriptions: {},
    subscriptionRuns: [
      { id: 'run-a', subId: 's', standing: true, sessionId: 'thread-a', status: 'working', turnId: '4', at },
      { id: 'run-q', subId: 's', standing: true, target: { kind: 'thread', id: 'thr' }, status: 'queued', event: {}, at },
      { id: 'run-b', subId: 's', standing: true, sessionId: 'thread-b', status: 'done', turnId: '2', at, endedAt: at },
      { id: 'run-c', subId: 's', standing: true, sessionId: 'thread-c', status: 'working', turnId: null, at },
    ],
  }))
  const run = await boot(t, home)
  run.archived.push('thread-c')
  assert.deepEqual(run.registered[0].sessions(), ['thread-a'])
  const marked = []
  for (const id of ['thread-a', 'thread-b']) {
    run.cut(id)
    const agent = run.agentOf(id)
    const post = agent.followup
    agent.followup = (message) => {
      marked.push([id, run.channels.state.subscriptionRuns.find(item => item.sessionId === id)?.resuming, isResumeMessage(message)])
      post(message)
    }
  }
  t.mock.timers.tick(3000)
  const done = await run.team.resumesDone
  await threadFlush()
  assert.deepEqual([done.resumed, marked], [['thread-a'], [['thread-a', true, true]]])
  assert.equal(run.channels.state.subscriptionRuns.find(item => item.id === 'run-a').status, 'working')
})
