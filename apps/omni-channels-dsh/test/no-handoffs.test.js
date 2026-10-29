// Omni has no computer and no hand-offs (the owner, 2026-10-29: "omni doesn't have handoffs"),
// against the real Bot team (the release apps/automagik.json pins) on a fake DSH: the Omni Bot
// lists no hand-off tool, its computer tools and the team's start_task are refused in plain
// words, and the hand-offs a start finds from before are archived, never resumed.
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { START_TASK_REFUSAL } from '../src/host/grants.js'
import { COMPUTER_TOOLS } from '../src/host/omni-api.js'
import { OPERATOR_RULES } from '../src/host/omni-rules.js'
import { boot, fakeOmni, gateOf, guarded, homeFor, resetFetch, saved, signal, teamState, until } from './thread-fixture.js'

afterEach(resetFetch)

const AT = Date.now() - 60_000
const handoffRow = (sessionId, extra = {}) => ({ sessionId, kind: 'handoff', title: 'Fix the build', reportTo: 'm1', reported: false, turnOpenAt: AT, at: 1, ...extra })

test('the Omni Bot has no hand-off tool, and nothing the plugin tells it names one, start_task or Tasks; its computer tools and start_task are refused saying it has no computer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const run = await boot(t, homeFor(t, fakeOmni()))
  await signal(t, run)
  assert.equal(run.ctx.registeredTools.has('omni_handoff'), false)
  assert.deepEqual([...run.ctx.registeredTools.keys()].filter(name => /hand/i.test(name)), [])
  const said = [OPERATOR_RULES]
  for (const name of [...COMPUTER_TOOLS, 'start_task']) {
    const refusal = guarded(run.ctx, 'm1', name)
    assert.equal(refusal, START_TASK_REFUSAL, name)
    said.push(refusal)
  }
  assert.equal(START_TASK_REFUSAL, 'Omni has no computer: it works only through its own tools. Tell the user what the work needs, so they can give it to a Bot that has one.')
  for (const text of said) assert.doesNotMatch(text, /hand.?off|session under (you|your row)|dshBot|start_task|\bTasks\b/, text)
  // No word of tasks, which it does not start, but the one line that says so.
  const lines = said.flatMap(text => text.split('\n'))
  assert.deepEqual(lines.filter(line => /\btasks?\b/i.test(line)), ['- You have no shell and no files, and you start no tasks. For code, a repository, a document, research or a long investigation, tell the user in a line what the work needs, so they can give it to a Bot that has a computer.'])
  assert.match(OPERATOR_RULES, /## Work that needs a computer is not yours\n- You have no shell and no files, and you start no tasks\./)
  assert.deepEqual(run.channels.state.agents, {})
})

test('against a team stand-in with no hook, start_task stays refused with an Omni named', async (t) => {
  const run = await boot(t, homeFor(t, fakeOmni()), { mask: true })
  assert.equal(run.channels.teamResume.ready, false)
  assert.equal(guarded(run.ctx, 'm1', 'start_task'), START_TASK_REFUSAL)
  assert.equal(run.ctx.registeredTools.has('omni_handoff'), false)
})

test('review 15, MEDIUM-1: with no Omni named every Bot the team allows keeps start_task, the Omni Bot and a second Main Bot alike, and it runs; once an Omni is named they lose it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const bots = {
    m1: { id: 'm1', name: 'Omni', role: 'Orchestrator', instructions: '', createdAt: 1, model: 'deepseek/flash' },
    m2: { id: 'm2', name: 'Caramelo', role: 'Main', instructions: '', createdAt: 2 },
  }
  const plain = await boot(t, homeFor(t, undefined, teamState({ mainBotIds: ['m1', 'm2'], bots })))
  await signal(t, plain)
  const startTask = (run, id) => run.ctx.registeredTools.get('start_task').execute({ title: 'Check the repo', instructions: 'List the open TODOs.' }, { agent: { id } })
  for (const id of ['m1', 'm2']) {
    assert.equal(guarded(plain.ctx, id, 'start_task'), undefined, id)
    assert.deepEqual(await gateOf(plain, 'start_task', id), { kind: 'allow' }, id)
    assert.match(await startTask(plain, id), /^Started task "Check the repo" \(session-[\w]+\) under your row/, id)
  }
  assert.equal(Object.keys(plain.team.state.tasks).length, 2)
  const named = await boot(t, homeFor(t, fakeOmni(), teamState({ mainBotIds: ['m1', 'm2'], bots })))
  for (const id of ['m1', 'm2']) {
    assert.equal(guarded(named.ctx, id, 'start_task'), START_TASK_REFUSAL, id)
    assert.deepEqual(await gateOf(named, 'start_task', id), { kind: 'deny', reason: START_TASK_REFUSAL }, id)
  }
})

test('review 15, LOW-1: in an ask-first event run of the Omni Bot, start_task is denied before any card asks, while bash still asks', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const run = await boot(t, homeFor(t, fakeOmni(), teamState({
    subscriptions: {},
    subscriptionRuns: [{ id: 'run-1', subId: 'sub-gone', botId: 'm1', task: true, sessionId: 'run-omni', status: 'working', askFirst: true, at: AT }],
  })))
  assert.deepEqual(await gateOf(run, 'start_task', 'run-omni'), { kind: 'deny', reason: START_TASK_REFUSAL })
  assert.equal((await gateOf(run, 'bash', 'run-omni')).kind, 'ask')
})

test('the hand-offs a start finds from before go once: each row\'s Session archived with its work stopped, never deleted and never resumed, the rows and state.omniHandoffs dropped, their DSH bots\' Sessions left with their bots; nothing reports; a second start changes nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const coder = { id: 'coder', kind: 'dsh', name: 'Coder', sessions: ['dsh-handoff'], createdAt: 1 }
  const omniRows = {}
  // Six, as on the owner's Mac: reported or not, one with its turn cut a minute ago.
  for (let index = 0; index < 6; index += 1) omniRows[`handoff-${index}`] = handoffRow(`handoff-${index}`, { reported: index % 2 === 0, turnOpenAt: index === 0 ? AT : null })
  const home = homeFor(t, fakeOmni(), teamState({
    agents: { coder },
    omniRows,
    omniHandoffs: { 'dsh-handoff': { sessionId: 'dsh-handoff', agentId: 'coder', title: 'Fix the build', reportTo: 'm1', at: 1 } },
  }))
  const run = await boot(t, home)
  run.cut('handoff-0')
  await until(() => run.archived.length === 6)
  // Nothing of theirs reaches the team's restart pass.
  assert.deepEqual(run.registered[0].sessions(), [])
  const done = await signal(t, run)
  assert.deepEqual(done.resumed, [])
  assert.deepEqual(run.archiving.map(([id, options]) => [id, options]).sort(), Object.keys(omniRows).sort().map(id => [id, { stopActivity: true }]))
  for (const id of Object.keys(omniRows)) assert.deepEqual(run.agentOf(id).calls, [], id)
  assert.deepEqual([run.channels.state.omniRows, Object.hasOwn(run.channels.state, 'omniHandoffs'), run.view().omniRows], [{}, false, []])
  // The DSH bot keeps its Session; nothing reported to the Omni Bot.
  assert.deepEqual([run.team.state.agents.coder.sessions, run.archived.includes('dsh-handoff'), run.agentOf('m1').calls], [['dsh-handoff'], false, []])
  await run.channels.save()
  const disk = saved(home)
  assert.deepEqual([disk.omniRows, Object.hasOwn(disk, 'omniHandoffs')], [{}, false])
  await run.stop()
  const again = await boot(t, home)
  assert.deepEqual([again.archiving, again.registered[0].sessions()], [[], []])
})

test('a hand-off row left from before never reaches the team\'s restart pass: not before the start pass archives it, nor when its archive fails, though the tree still draws it so its menu can remove it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const home = homeFor(t, fakeOmni(), teamState({ omniRows: { 'handoff-cut': handoffRow('handoff-cut') } }))
  const run = await boot(t, home, { archiveError: new Error('DSH is busy') })
  run.cut('handoff-cut')
  await until(() => run.archiving.length === 1)
  assert.deepEqual([run.channels.omniRows.list().map(row => row.sessionId), run.view().omniRows.map(row => row.sessionId)], [['handoff-cut'], ['handoff-cut']])
  assert.deepEqual(run.registered[0].sessions(), [])
  const done = await signal(t, run)
  assert.deepEqual([done.resumed, run.agentOf('handoff-cut').calls], [[], []])
  // The menu removes it once DSH archives again.
  run.fake.archiveError = null
  await run.call('omni-row-remove', { sessionId: 'handoff-cut' })
  assert.deepEqual([run.archived, run.channels.omniRows.list()], [['handoff-cut'], []])
})
