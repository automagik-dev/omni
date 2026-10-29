import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime as createTeam } from '@automagik/bots-dsh'
import { createRuntime } from '../index.js'
import { START_TASK_REFUSAL } from '../src/host/grants.js'
import { HANDOFF_NEEDS_TEAM } from '../src/host/handoff.js'
import { HANDOFF_TOOL } from '../src/host/omni-rules.js'
import { install, isResumeMessage, NEEDS_NEWER_TEAM, TEAM_CONTRACT } from '../src/host/resume-hook.js'
import { decideUnbound, NOT_PICKED_UP } from '../src/host/standing-recovery.js'
import { THREAD_NEEDS_TEAM, WORKER_MOVED } from '../src/host/subscriptions.js'
import { CUT_WINDOW_MS, THREAD_TOOLS } from '../src/host/threads.js'
import { all, bundleClient, byLabel, column, mount, one, plain as asValue, react, text } from './client-stand-in.js'
import { omni as teamClient } from './omni-client.js'
import { fakeContext, teamFile } from './team.js'
import { askedOf, boot, CHAT, dsh, eventFor, gateOf, guarded, homeFor, INSTANCE, logOf, MESSAGE_IDS, MESSAGES, record, restart, signal, teamState, flush as threadFlush, turn, until, watchedOmni } from './thread-fixture.js'

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
  for (const path of [TEAM_CONTRACT.register, TEAM_CONTRACT.dshBotsList, TEAM_CONTRACT.dshBotsCreate]) {
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

// Session rows under the Omni row (Group 14): the hook's row source on the real Bot team's pass.
// An automation of a worker since retired ("a new session each time", "one ongoing session").
const sessionSub = (id, mode, extra = {}) => ({
  id, name: `${mode} worker`, on: true, sources: [{ kind: 'chat', id: 'c1', name: 'Marina', type: 'whatsapp-baileys', chatKind: 'direct', channelId: 'i1' }],
  trigger: { kind: 'message' }, worker: { kind: 'session', mode }, outputs: { react: false, replyToMe: false }, askFirst: true, createdAt: 1, updatedAt: 1, ...extra,
})
const row = (sessionId, kind, extra = {}) => ({ sessionId, kind, title: sessionId, turnOpenAt: null, at: 1, ...extra })

test('with 500 kept idle rows whose last turns ended cleanly or opened more than 24 h ago, the hook lists none and the team\'s pass resolves none of them; a row with a turn opened in the last 24 h and every working run\'s Session are listed (:191)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const at = Date.now() - 60_000
  const omniRows = {}
  for (let index = 0; index < 500; index += 1) {
    // Half ended their last turn cleanly; half opened one more than 24 h ago.
    const turnOpenAt = index % 2 === 0 ? null : Date.now() - CUT_WINDOW_MS - 60_000
    omniRows[`idle-${index}`] = row(`idle-${index}`, 'handoff', { reportTo: 'm1', reported: true, turnOpenAt, at: index })
  }
  omniRows['open-row'] = row('open-row', 'handoff', { reportTo: 'm1', reported: true, turnOpenAt: at, at: 600 })
  omniRows['working-row'] = row('working-row', 'handoff', { reportTo: 'm1', reported: true, at: 601 })
  const home = homeFor(t, undefined, teamState({
    subscriptions: {},
    omniRows,
    subscriptionRuns: [{ id: 'run-w', subId: 'sub-gone', standing: true, sessionId: 'working-row', status: 'working', turnId: '1', at }],
  }))
  const run = await boot(t, home)
  for (const id of Object.keys(omniRows)) run.cut(id)
  assert.deepEqual(run.registered[0].sessions().sort(), ['open-row', 'working-row'])
  t.mock.timers.tick(3000)
  const done = await run.team.resumesDone
  await threadFlush()
  assert.equal(run.resolved.filter(id => id.startsWith('idle-')).length, 0)
  // Following the Omni Bot's model again at start opened none of them either.
  assert.equal(run.selected.filter(([id]) => id.startsWith('idle-')).length, 0)
  assert.deepEqual([...done.resumed].sort(), ['open-row', 'working-row'])
  assert.equal(run.channels.omniRows.list().length, 502)
})

test('against a team stand-in with no hook a saved "new session" or "ongoing session" automation moves to its chat\'s thread and pauses with the thread\'s reason at start; its row is archived, never resumed, and nothing registers (:195)', async (t) => {
  const home = homeFor(t, undefined, teamState({
    subscriptions: { 'sub-new': sessionSub('sub-new', 'new'), 'sub-on': sessionSub('sub-on', 'ongoing') },
    omniRows: { kept: row('kept', 'run', { subId: 'sub-new', turnOpenAt: Date.now() - 60_000 }) },
  }))
  const run = await boot(t, home, { mask: true })
  await until(() => Object.values(run.channels.state.subscriptions).every(sub => sub.on === false) && run.archived.includes('kept'))
  assert.deepEqual(Object.values(run.channels.state.subscriptions).map(sub => [sub.id, sub.worker, sub.note, sub.pausedReason]), [
    ['sub-new', { kind: 'thread' }, WORKER_MOVED.session, THREAD_NEEDS_TEAM],
    ['sub-on', { kind: 'thread' }, WORKER_MOVED.ongoing, THREAD_NEEDS_TEAM],
  ])
  assert.deepEqual([run.registered, run.channels.teamResume.ready], [[], false])
  assert.doesNotMatch(run.ctx.registeredTools.get('save_automation').parameters.properties.worker.description, /session|thread/)
  assert.deepEqual([run.view().omniRows, Object.keys(run.channels.state.omniRows)], [[], []])
})

test('the hook lists every unreported hand-off\'s Session, also one whose open turn was never saved, and never a reported or archived one (:191, hand-off part)', async (t) => {
  const home = homeFor(t, undefined, teamState({
    omniRows: {
      'handoff-open': row('handoff-open', 'handoff', { reportTo: 'm1', reported: false }),
      'handoff-done': row('handoff-done', 'handoff', { reportTo: 'm1', reported: true }),
      'handoff-gone': row('handoff-gone', 'handoff', { reportTo: 'm1', reported: false }),
    },
  }))
  const run = await boot(t, home)
  run.archived.push('handoff-gone')
  assert.deepEqual(run.registered[0].sessions(), ['handoff-open'])
})

// Group 16 (design row 19, Decision 39): a DSH bot's Session is the team's to find (through
// state.agents) and the plugin's to list while its run works; it is one candidate, resumed
// once, the team's way, and the plugin still binds its resumed turn through onResume.
test('a cut DSH-bot run is bound after a restart: its Session is in state.agents and in the hook\'s list, the team resumes it once, its own way, onResume is still called for it, a non-read tool in that resumed turn asks with ask-first on, and the turn\'s end finishes the run (:193, :189 DSH-bot part)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const at = Date.now() - 60_000
  const home = homeFor(t, undefined, teamState({
    agents: { coder: { id: 'coder', kind: 'dsh', name: 'Coder', sessions: ['dsh-session'], createdAt: 1 } },
    subscriptions: { 'sub-dsh': sessionSub('sub-dsh', 'ongoing', { worker: { kind: 'dshbot', agentId: 'coder', mode: 'ongoing' }, ongoingSessionId: 'dsh-session' }) },
    subscriptionRuns: [{ id: 'run-dsh', subId: 'sub-dsh', standing: true, sessionId: 'dsh-session', status: 'working', turnId: '4', askFirst: true, at }],
  }))
  const run = await boot(t, home)
  // The run's own turn, cut by the restart.
  logOf(run, 'dsh-session', [
    { type: 'turn/start', time: at, data: { turn: 4 } },
    { type: 'user/message', data: { content: [{ type: 'text', text: 'event' }], source: { kind: 'omni-run', runId: 'run-dsh' } } },
    { type: 'turn/end', time: Date.now() - 1000, data: { turn: 4, reason: { kind: 'interrupted' } } },
  ])
  assert.deepEqual([run.team.state.agents.coder.sessions, run.registered[0].sessions()], [['dsh-session'], ['dsh-session']])
  t.mock.timers.tick(3000)
  const done = await run.team.resumesDone
  await threadFlush()
  // Once, as a plain Session's resume, never through a Bot; the plugin was told before it went.
  assert.deepEqual(done.resumed, ['dsh-session'])
  const [resume] = run.agentOf('dsh-session').calls
  assert.deepEqual(run.agentOf('dsh-session').calls.map(message => message.source), [{ kind: 'user', resumed: true }])
  assert.deepEqual(run.agentOf('m1').calls, [])
  const runOf = () => run.channels.state.subscriptionRuns.find(item => item.id === 'run-dsh')
  assert.deepEqual([runOf().status, runOf().resuming], ['working', true])
  // The resumed turn is the run's: bound, and its non-read tools ask.
  turn(run, 'dsh-session', 5, resume, undefined, null)
  assert.deepEqual([runOf().turnId, runOf().resuming], ['5', undefined])
  assert.equal((await gateOf(run, 'bash', 'dsh-session')).kind, 'ask')
  assert.deepEqual(await gateOf(run, 'read', 'dsh-session'), { kind: 'allow' })
  run.emit('dsh-session', 'assistant/message', { message: { content: [{ type: 'text', text: 'Went on.' }] } })
  run.emit('dsh-session', 'turn/end', { turn: 5, reason: { kind: 'completed' } })
  await threadFlush()
  assert.deepEqual([runOf().status, runOf().summary], ['done', 'Went on.'])
  assert.equal(run.registered[0].sessions().includes('dsh-session'), false)
})

// Group 17: the old-team sweep (:195), every part at once on one home. A first start on the
// floor release, with the hook, adds a chat and saves an automation of each kind that needs it;
// the next start is on a stand-in of a team without the hook (`mask`). The host half runs
// against the real team under this plugin; the client half draws this plugin's own tree and
// phone pane (client-stand-in.js) from that start's real view, their `call` answered by that
// start's own endpoints, so the rows the owner sees are the ones this host makes.
test('the old-team sweep: on a team stand-in with no rt.resumable or rt.resumesDone, no + and the reason on the rows, a row that never opens its Session, the five thread tools refusing with no Omni request, no thread, session or DSH-bot worker and the saved ones paused, the hand-off refused, no Tasks agent, nothing registered, no recovery; the routes, the phone pane and an Omni Bot automation still work (:195)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const omni = watchedOmni(t)
  const coder = { id: 'coder', kind: 'dsh', name: 'Coder', workDir: import.meta.dirname, sessions: [], createdAt: 1 }
  const home = homeFor(t, omni, teamState({ agents: { coder } }))
  // DSH's permission presets, each Session's own.
  const presetOf = new Map()
  const presets = {
    set: (session, name) => { presetOf.set(session.id, name) },
    catalog: () => ({ options: ['read-only', 'workspace-write'].map(value => ({ value, name: value })), defaultPreset: 'workspace-write' }),
    current: session => presetOf.get(session.id) ?? 'workspace-write',
  }
  const services = { permissionPresets: presets }
  const tool = (run, name, args) => run.ctx.registeredTools.get(name).execute(args, { agent: { id: 'm1' } })
  const save = (run, worker) => tool(run, 'save_automation', { sources: `chat:${CHAT}`, trigger: 'message', worker })

  const first = await boot(t, home, { services })
  await signal(t, first)
  const added = await first.channels.threads.add(INSTANCE, CHAT)
  assert.equal(added.ok, true, added.reason)
  const { thread } = added
  assert.match(await save(first, 'thread'), /^Saved /)
  const saved = Object.values(first.channels.state.subscriptions)
  // The thread's automation has a run working in the thread when DSH stops, its turn open.
  const working = await first.channels.fireSubscription(saved[0], eventFor('Oi'))
  await until(() => first.agentOf(thread.sessionId).calls.length === 1)
  first.emit(thread.sessionId, 'turn/start', { turn: 1 }, Date.now())

  const run = await restart(t, first, home, { mask: true, services })
  const asked = askedOf(omni).length
  const recovered = []
  run.channels.teamResume.addRecovery(outcome => recovered.push(outcome))
  run.cut(thread.sessionId)
  await until(() => Object.values(run.channels.state.subscriptions).every(sub => sub.on === false))

  // Not ready, with the one reason; nothing registers, and the team's pass, over, runs no
  // recovery here: the run it left stays as it was, its Session posted nothing and not woken.
  assert.deepEqual([run.channels.teamResume.ready, run.channels.teamResume.reason, run.registered], [false, NEEDS_NEWER_TEAM, []])
  const flushed = []
  run.ctx.sessions.flush = async session => flushed.push(session.id)
  t.mock.timers.tick(24 * 60 * 60 * 1000)
  assert.equal((await run.team.resumesDone).resumed.includes(thread.sessionId), false)
  await threadFlush()
  const runOf = id => run.channels.state.subscriptionRuns.find(item => item.id === id)
  assert.deepEqual([recovered, flushed, runOf(working.id).status, run.agentOf(thread.sessionId).calls], [[], [], 'working', []])

  // The worker list does not offer the chat thread, the saved one is paused with its reason on
  // the board, and saving one again is refused with it.
  const board = run.view().subscriptions
  assert.deepEqual(board.map(sub => [sub.id, sub.on, sub.pausedReason]), saved.map(sub => [sub.id, false, THREAD_NEEDS_TEAM]))
  const offered = run.ctx.registeredTools.get('save_automation').parameters.properties.worker.description
  assert.doesNotMatch(offered, /thread|session|dshbot/)
  assert.doesNotMatch(await tool(run, 'find_chats', {}), /thread:|dshbot:/)
  assert.equal(await save(run, 'thread'), `Not saved: ${THREAD_NEEDS_TEAM}`)

  // The hand-off refuses with its own reason, start_task stays refused, and nothing reaches Tasks.
  assert.equal(await tool(run, HANDOFF_TOOL, { title: 'Fix the build', instructions: 'Run the tests.' }), `Not handed off: ${HANDOFF_NEEDS_TEAM}`)
  assert.equal(guarded(run.ctx, 'm1', 'start_task'), START_TASK_REFUSAL)

  // An automation whose worker is the Omni Bot still runs: its event reaches the Omni Bot.
  assert.match(await save(run, 'me'), /^Saved /)
  const omniBot = Object.values(run.channels.state.subscriptions).at(-1)
  const ran = await run.channels.fireSubscription(omniBot, eventFor('Chegou'))
  await until(() => run.agentOf(ran.sessionId).calls.length === 1)
  assert.deepEqual([runOf(ran.id).status, runOf(ran.id).botId], ['working', 'm1'])
  assert.match(run.agentOf(ran.sessionId).calls[0].content.map(block => block.text).join(''), /Chegou/)
  assert.deepEqual(run.channels.state.agents, { coder })
  // The Omni Bot still reads Omni's routes on the link key.
  assert.match(await tool(run, 'find_chats', {}), new RegExp(`chat:${CHAT} · .*Marina`))

  // Each thread tool, in the thread's Session, refuses with the reason and asks Omni nothing:
  // every fetch is counted, also the routes watchedOmni answers itself.
  const from = askedOf(omni).length
  const fetched = []
  const watched = globalThis.fetch
  globalThis.fetch = (address, init) => {
    fetched.push(String(address))
    return watched(address, init)
  }
  const args = { thread_say: { text: 'oi' }, thread_react: { messageId: MESSAGE_IDS.text, emoji: '🔥' }, thread_history: {}, thread_picture: { messageId: MESSAGE_IDS.picture }, thread_ask_omni: { question: 'Oi?' } }
  for (const name of THREAD_TOOLS) {
    const { card, result } = await dsh(run, name, thread.sessionId, args[name])
    assert.equal(card, false, name)
    assert.equal(name === 'thread_picture' ? result.text : result, `${['thread_say', 'thread_react'].includes(name) ? 'Error: ' : ''}${NEEDS_NEWER_TEAM}`, name)
  }
  globalThis.fetch = watched
  assert.deepEqual([fetched.filter(address => !address.includes('/events/')), askedOf(omni).slice(from), omni.sent], [[], [], []])

  // The client: the tree on this start's own view and endpoints.
  const calls = []
  const call = async (endpoint, body) => {
    calls.push(endpoint)
    const known = run.team.extended.endpointOf(endpoint)
    return known ? asValue(await known.fn(asValue(body))) : {}
  }
  const storage = new Map([['omni.tree.open', JSON.stringify([INSTANCE])]])
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) }
  const document = { hidden: false, body: { dataset: {} }, addEventListener: () => {}, removeEventListener: () => {} }
  const ui = await bundleClient([
    'export { OmniTree } from \'./omni-tree.js\'',
    'export { omniStore } from \'./omni-store.js\'',
    'export { installPhone } from \'./omni-phone.js\'',
  ], { globals: { URL, URLSearchParams, setTimeout: () => 0, clearTimeout: () => {}, document, localStorage }, team: { omni: { ...teamClient, call } } })
  const overview = await call('omni-overview', {})
  ui.omniStore.set({ ...ui.omniStore.getSnapshot(), preview: false, source: { kind: 'live', origin: overview.origin }, channels: overview.channels, chats: overview.chats, link: { origin: overview.origin, version: '2.261027.3', outdated: false } })
  const roster = asValue(run.view())
  const opened = []
  const actions = { selectPanel: () => {}, openSession: id => opened.push(id) }
  const stand = column()
  t.after(ui.installPhone(stand.ctx, () => ({})))
  const tree = mount(() => react.createElement(ui.OmniTree, { bot: { id: 'm1', kind: 'omni', name: 'Omni' }, wide: true, roster, actions }), { effects: false })
  t.after(() => tree.unmount())
  const root = tree.draw()
  // The channel row offers no + and says why; the thread row shows the reason in place.
  assert.equal(byLabel(root, 'Add a chat'), undefined)
  assert.deepEqual(all(root, 'ot-empty').map(text), [NEEDS_NEWER_TEAM])
  const row = one(root, 'bt-thread')
  assert.deepEqual([row.props['data-thread-id'], text(one(row, 'ot-thread-reason')), row.props['aria-disabled']], [thread.id, NEEDS_NEWER_TEAM, true])
  row.props.onClick()
  // The row's phone action still opens the pane, which shows the chat through the link key.
  one(root, 'ot-thread-phone').props.onClick()
  assert.deepEqual(stand.opened, [['omni-phone', { params: { threadId: thread.id, chatId: CHAT } }]])
  const tab = { id: 'tab-1', visible: true, navigation: { address: 'sidebar://omni-phone', params: stand.opened[0][1].params, revision: 1 } }
  const phone = mount(() => react.createElement(stand.bodies[0].component, { useTabInfo: () => ({ tab }), sessionId: 'm1', useRoster: select => select(roster) }), { refs: true })
  t.after(() => phone.unmount())
  phone.draw()
  await until(() => calls.includes('omni-messages'))
  await threadFlush()
  const shown = phone.draw()
  assert.equal(one(shown, 'op-pane').props['data-thread-id'], thread.id)
  assert.match(text(one(shown, 'op-head')), /^Marina/)
  assert.equal(all(shown, 'oc-bubble').length, Object.values(MESSAGES).filter(message => message.chatId === CHAT).length)
  // Clicking the row never opened its Session; the pane read the chat with the link key only.
  assert.deepEqual(opened, [])
  assert.deepEqual(new Set(omni.askedWith.slice(asked).filter(ask => !ask.route.includes(' /events/')).map(ask => ask.key)), new Set([omni.link.text]))
  // After all of it: still nothing registered, and no Tasks agent.
  assert.deepEqual([run.registered, run.channels.state.agents], [[], { coder }])
})

// Group 17 (:189): no resume pass of the plugin's own, read from every host file. None of the
// team's resume is copied (its healCutSessions, its "[DeepSeek Harness restarted]" follow-up,
// its resume text, state.omniResumes), nothing writes the team's resume marker, no module that
// touches a restart sets a timer, and no rt.deliver or follow-up resumes a cut turn. The only
// restart-cut code: rt.cutByRestart read on a turn's end (live, or in a Session's log), the
// signal recovery's inbox read, and the one wake (inbox.remove + agent.followup, then flush).
test('the plugin has no resume pass of its own: no copy of the team\'s, no resume text, timer or resuming delivery; its only restart-cut code is cutByRestart on a turn end, the recovery\'s inbox read and the one wake (:189)', async () => {
  const dir = new URL('../src/host/', import.meta.url)
  const files = Object.fromEntries(readdirSync(dir).filter(name => name.endsWith('.js')).sort().map(name => [name, readFileSync(new URL(name, dir), 'utf8')]))
  // A file's code, line for line: block comments and line comments blanked, never the code
  // around them.
  const codeOf = (source) => {
    let open = false
    return source.split('\n').map((line) => {
      let out = ''
      let rest = line
      while (rest !== '') {
        if (open) {
          const end = rest.indexOf('*/')
          if (end === -1) return out
          rest = rest.slice(end + 2)
          open = false
          continue
        }
        const start = rest.indexOf('/*')
        const slashes = /^\s*\/\//.test(rest) ? 0 : -1
        if (slashes === 0) return out
        if (start === -1) return out + rest
        out += rest.slice(0, start)
        rest = rest.slice(start + 2)
        open = true
      }
      return out
    })
  }
  // Per file, how many code lines match `pattern`.
  const count = pattern => Object.fromEntries(Object.entries(files)
    .map(([name, source]) => [name, codeOf(source).filter(line => pattern.test(line)).length]).filter(([, n]) => n > 0))
  // Not even in a comment.
  for (const text of ['healCutSessions', '[DeepSeek Harness restarted]', 'omniResumes']) {
    assert.deepEqual(Object.keys(files).filter(name => files[name].includes(text)), [], text)
  }
  // No sentence of the team's own resume text, and nothing writes its resume marker.
  const { resumeText } = await import(teamFile('src/host/resume.js'))
  const sentences = resumeText({ approval: { tool: 'bash', reason: 'x' } }).split(/(?<=[.:;]) /).map(part => part.slice(0, 40)).filter(part => part.length >= 20)
  assert.ok(sentences.length >= 4)
  for (const sentence of sentences) assert.deepEqual(Object.keys(files).filter(name => files[name].includes(sentence)), [], sentence)
  assert.deepEqual(count(/resumed\s*:\s*true/), {})
  // Timers only where nothing restarts: the event stream's backoff and its 30 s sync, the local
  // CLI's kill, the pairing poll, and the key file's lock wait, heartbeat and drain.
  assert.deepEqual(count(/\bset(Timeout|Interval)\(/), { 'omni-events.js': 2, 'omni-link.js': 1, 'omni-local.js': 1, 'thread-keys.js': 4 })
  // Every delivery and follow-up: an ask, a permission note, a hand-off's report, an
  // automation's task; a handed-over event or instruction, an ask's answer; the wake. None
  // carries the marker or the team's resume roles.
  const delivered = Object.entries(files).flatMap(([name, source]) => codeOf(source).filter(line => line.includes('rt.deliver(')).map(line => [name, /role: '([^']+)'/.exec(line)?.[1]]))
  assert.deepEqual(delivered, [['asks.js', 'task'], ['grants.js', 'permission'], ['handoff.js', 'task-done'], ['subscriptions.js', 'task']])
  assert.deepEqual(count(/\.(followup|steer)\(/), { 'asks.js': 1, 'standing-runs.js': 1 })
  assert.deepEqual(count(/createUserMessage\(/), { 'asks.js': 1 })
  assert.deepEqual(count(/await followupAndFlush\(rt,/), { 'asks.js': 1, 'handoff.js': 1, 'standing-runs.js': 1 })
  // cutByRestart is read only on a turn's end, live or in a log: from each read of a reason, the
  // nearest line that names a turn's start or end (that line included) names its end, or is a
  // turn/start branch that returned before the read.
  const onTurnEnd = (lines, index) => {
    for (let at = index; at >= Math.max(0, index - 20); at -= 1) {
      const line = lines[at]
      if (line.includes('\'turn/end\'')) return true
      if (!line.includes('\'turn/start\'')) continue
      const indent = /^\s*/.exec(line)[0]
      const between = lines.slice(at + 1, index)
      const returned = between.findIndex(inner => /^\s*return\b/.test(inner))
      return returned !== -1 && between.slice(returned + 1).some(inner => inner === `${indent}}`)
    }
    return false
  }
  const reads = Object.entries(files).flatMap(([name, source]) => {
    const lines = codeOf(source)
    return lines.flatMap((line, index) => (/cutByRestart(\?\.)?\(\w+(\.data)?\?\.reason\)/.test(line) ? [[name, onTurnEnd(lines, index)]] : []))
  })
  assert.deepEqual(reads.filter(([, onEnd]) => !onEnd), [])
  assert.deepEqual([...new Set(reads.map(([name]) => name))], ['asks.js', 'handoff.js', 'omni-rows.js', 'standing-recovery.js', 'standing-runs.js', 'subscriptions.js', 'threads.js'])
  // The signal recovery's inbox read, once in each recovery that decides unbound work.
  assert.deepEqual(count(/inbox\?\.nextStep/), { 'handoff.js': 1, 'standing-recovery.js': 1 })
  // The one wake: wakeOnce's requeue (the inbox move) and its flush, beside the hand-over's own.
  assert.deepEqual(count(/\.requeue\(/), { 'standing-recovery.js': 1 })
  assert.deepEqual(count(/inbox\.remove\(/), { 'standing-runs.js': 1 })
  assert.deepEqual(count(/sessions\.flush\(/), { 'asks.js': 1, 'standing-recovery.js': 1 })
  assert.deepEqual(count(/await wakeOnce\(rt,/), { 'handoff.js': 1, 'standing-recovery.js': 1 })
  // Any other spelling of the same things (optional calls, destructuring, an un-awaited call, a
  // promise timer, a computed key) still names them: every raw line naming one, comments
  // included, is counted per file, so a new one fails here until it is reviewed.
  const raw = pattern => Object.fromEntries(Object.entries(files)
    .map(([name, source]) => [name, source.split('\n').filter(line => pattern.test(line)).length]).filter(([, n]) => n > 0))
  assert.deepEqual(raw(/\bdeliver\b/), { 'asks.js': 3, 'grants.js': 1, 'handoff.js': 2, 'standing-recovery.js': 1, 'subscriptions.js': 1 })
  assert.deepEqual(raw(/\bfollowup(AndFlush)?\b|\bsteer\b/), { 'asks.js': 3, 'handoff.js': 2, 'standing-runs.js': 3 })
  assert.deepEqual(raw(/cutByRestart/), { 'asks.js': 1, 'handoff.js': 4, 'omni-rows.js': 1, 'standing-recovery.js': 9, 'standing-runs.js': 1, 'subscriptions.js': 1, 'threads.js': 1 })
  assert.deepEqual(raw(/\bset(Timeout|Interval|Immediate)\b|timers\/promises|queueMicrotask|\bsleep\b/), { 'omni-events.js': 2, 'omni-link.js': 1, 'omni-local.js': 1, 'thread-keys.js': 4 })
  assert.deepEqual(raw(/\bresumed\b/), { 'asks.js': 1, 'handoff.js': 6, 'resume-hook.js': 15, 'standing-recovery.js': 7 })
  assert.deepEqual(raw(/\brequeue\b|\bwakeOnce\b/), { 'handoff.js': 3, 'standing-recovery.js': 4, 'standing-runs.js': 2 })
})
