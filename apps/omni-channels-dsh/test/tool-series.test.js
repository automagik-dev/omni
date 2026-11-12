// A Session whose tool series lost every tool of its first request (#1699): the model provider
// refuses each of its requests, compaction included, with "tools: at least one tool must have
// defer_loading=false". The fixtures run DSH's own fold (dsh-session) and request projection
// (dsh-llm) on the event sequence such a Session logged, on both of DeepSeek's tool-update routes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createDeveloperMessage, projectToolUpdates } from '@deepseek-ai/dsh-llm'
import { Session } from '@deepseek-ai/dsh-session'
import { strandedSeries } from '../src/host/tool-series.js'
import { ANSWER_MASTER, INSTANCE, answerBench, saved } from './thread-fixture.js'

const CONFIG = { provider: 'deepseek', model: 'deepseek-flash' }
const tool = name => ({ name, description: `The ${name} tool.`, parameters: { type: 'object', properties: {} } })
const names = (from, count) => Array.from({ length: count }, (_, index) => `tool_${String(from + index).padStart(2, '0')}`)
// The live Session's sequence: one tool from an old host policy plugin at its first request,
// then 57 tools in its place in one change, then 14 more.
const BASELINE = ['host_lookup']
const FIRST = names(1, 57)
const LATER = names(58, 14)
const ALL = [...FIRST, ...LATER]
const sorted = list => [...list].sort()
// The harness's DSH. On 0.2.2-rc.1 (the live host's, and the oldest this plugin admits) the
// addition-only route of deepseek-flash drops each declaration no longer offered, the removed
// first-request tool included, and keeps only deferred additions: the live refusal. From rc.2
// that route rebuilds the baseline at that change by itself (dsh-llm rebaseAdditionOnlyHistory):
// the 57 go in full, the 14 after them stay deferred. In-history never rebuilds.
const DSH_LLM = JSON.parse(readFileSync(new URL('../package.json', import.meta.resolve('@deepseek-ai/dsh-llm')), 'utf8')).version
const ADDITION_ONLY_REBUILDS = DSH_LLM !== '0.2.2-rc.1'
const ROUTES = ['addition-only', 'in-history']

// What DSH's agent loop logs for one request (dsh-agent-loop buildRequest): a header when the
// tools change, with a tool-registry developer message naming what joined and what left; or,
// on a request whose pre-step decision starts a new series, a header that says so: reason
// series when the tools are unchanged, else resume (the first request after a restart) or
// change, marked startsSeries.
function request(session, tools, { reason = 'change', turn, startsSeries = reason === 'initial' } = {}) {
  const before = new Set(session.requestHeader()?.tools?.map(each => each.name))
  const header = { config: CONFIG, ...(tools.length > 0 ? { tools: tools.map(tool) } : {}) }
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  const { seq } = session.append('request/header', { header, reason, ...(startsSeries ? { startsSeries: true } : {}) })
  const additions = tools.filter(name => !before.has(name)).map(toolName => ({ type: 'tool-addition', toolName }))
  const removals = [...before].filter(name => !tools.includes(name)).map(toolName => ({ type: 'tool-removal', toolName }))
  if (reason !== 'initial' && reason !== 'series' && additions.length + removals.length > 0) {
    session.append('developer/message', { turn, step: 1, message: createDeveloperMessage({ source: { kind: 'tool-registry' }, content: [...additions, ...removals] }), ...(additions.length > 0 ? { headerSeq: seq } : {}) }, { surfaceOp: 'append' })
  }
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function liveSession(id = 'stuck', baseline = BASELINE) {
  const session = Session.create(id)
  request(session, baseline, { reason: 'initial', turn: 1 })
  request(session, baseline, { reason: 'resume', turn: 2 })
  request(session, FIRST, { turn: 3 })
  request(session, [...FIRST, ...LATER], { turn: 4 })
  return session
}

// The request the provider receives on a route, and the tools the model may still call directly:
// declared without defer_loading, and not removed by the history. On addition-only an empty list
// means every declaration is deferred, which the provider refuses (the live case, rc.1). On
// in-history the removed tool stays declared without defer_loading, so the model is left with
// no tool to call even if the provider takes the request; the guard treats both alike.
function sent(session, tools = ALL, route = 'in-history') {
  return projectToolUpdates(session.deriveMessages(), tools.map(tool), route, session.toolHistory())
}
function callable(projected) {
  const direct = new Set(projected.tools.filter(each => each.deferLoading !== true).map(each => each.name))
  for (const message of projected.messages) if (message.role === 'developer') for (const block of message.content) if (block.type === 'tool-removal') direct.delete(block.toolName)
  return [...direct]
}

test('a Session whose one first-request tool was removed is refused, and a new series brings every tool back', () => {
  const session = liveSession()
  const before = sent(session)
  assert.deepEqual(before.tools.filter(each => each.deferLoading !== true).map(each => each.name), BASELINE)
  assert.equal(before.tools.filter(each => each.deferLoading === true).length, FIRST.length + LATER.length)
  assert.deepEqual(callable(before), [], 'in-history: host_lookup stays declared but removed, and every other tool is deferred')
  assert.deepEqual(sorted(callable(sent(session, ALL, 'addition-only'))), ADDITION_ONLY_REBUILDS ? sorted(FIRST) : [], `addition-only on dsh-llm ${DSH_LLM}`)
  assert.equal(strandedSeries(session, ALL), true)
  // The pre-step decision starts a series: the next request declares today's tools in full.
  request(session, ALL, { reason: 'series', turn: 5 })
  for (const route of ROUTES) {
    const after = sent(session, ALL, route)
    assert.equal(after.tools.length, ALL.length, route)
    assert.deepEqual(sorted(callable(after)), sorted(ALL), route)
    assert.equal(after.messages.some(message => message.role === 'developer'), false, route)
  }
  // It stays healthy: the next step does not start another series.
  assert.equal(strandedSeries(session, [...FIRST, ...LATER]), false)
})

// The fix reaches a live host after an update and a restart: the stuck Session's next request
// is the first one its new agent logs (reason resume), or one whose tools changed too.
test('the new series also holds when it starts on the first request after a restart, or on a request whose tools change', () => {
  const restarted = liveSession('restarted')
  request(restarted, ALL, { reason: 'resume', startsSeries: true, turn: 5 })
  for (const route of ROUTES) assert.deepEqual(sorted(callable(sent(restarted, ALL, route))), sorted(ALL), route)
  assert.equal(strandedSeries(restarted, ALL), false)
  const changed = liveSession('changed')
  const next = [...ALL.slice(1), 'tool_99']
  request(changed, next, { startsSeries: true, turn: 5 })
  assert.equal(changed.deriveMessages().filter(message => message.role === 'developer').length, 3, 'the change still logs what joined and what left')
  for (const route of ROUTES) assert.deepEqual(sorted(callable(sent(changed, next, route))), sorted(next), route)
  assert.equal(strandedSeries(changed, next), false)
})

test('a Session whose first request declared no tool is refused, and a new series brings every tool back', () => {
  const session = liveSession('empty', [])
  assert.deepEqual(sent(session).tools.filter(each => each.deferLoading !== true), [])
  assert.deepEqual(callable(sent(session)), [])
  assert.deepEqual(sorted(callable(sent(session, ALL, 'addition-only'))), ADDITION_ONLY_REBUILDS ? sorted(FIRST) : [], `addition-only on dsh-llm ${DSH_LLM}`)
  assert.equal(strandedSeries(session, ALL), true)
  request(session, ALL, { reason: 'series', turn: 5 })
  for (const route of ROUTES) assert.deepEqual(sorted(callable(sent(session, ALL, route))), sorted(ALL), route)
  assert.equal(strandedSeries(session, ALL), false)
})

test('a healthy Session keeps its series: a first-request tool is still offered, or no request was made yet', () => {
  const session = Session.create('healthy')
  request(session, ['omni_call', 'bash'], { reason: 'initial', turn: 1 })
  request(session, ['omni_call', ...FIRST], { turn: 2 })
  assert.deepEqual(callable(sent(session, ['omni_call', ...FIRST])), ['omni_call'])
  assert.equal(strandedSeries(session, ['omni_call', ...FIRST]), false)
  // The tool goes in this step: the check sees it before the request, not after a refusal.
  assert.equal(strandedSeries(session, FIRST), true)
  assert.equal(strandedSeries(Session.create('new'), FIRST), false)
  // A request that declared no tool deferred nothing: no new series, so none at every step.
  const bare = Session.create('bare')
  request(bare, ['omni_call'], { reason: 'initial', turn: 1 })
  request(bare, [], { reason: 'series', startsSeries: true, turn: 2 })
  assert.equal(strandedSeries(bare, FIRST), false)
  request(bare, [], { reason: 'series', turn: 3 })
  assert.equal(strandedSeries(bare, FIRST), false)
  // Code mode declares only run_code, which no plugin registers: that is no reason to restart.
  const code = Session.create('code')
  request(code, ['run_code'], { reason: 'initial', turn: 1 })
  request(code, ['run_code'], { reason: 'resume', turn: 2 })
  assert.equal(strandedSeries(code, FIRST), false)
})

// The pre-step listeners as DSH runs them, outermost first; what this plugin decides.
const preStep = async (ctx, agent, decision = { kind: 'enter', messages: [] }) => {
  const event = { agent, messages: [], signal: new AbortController().signal, step: 1 }
  const out = await (ctx.listeners.get('agent/pre-step') ?? []).reduceRight((next, listener) => () => listener(event, next), async () => decision)()
  return { kind: out.kind, newSeries: out.startsRequestSeries === true }
}
const ENTER = { kind: 'enter', newSeries: false }
const NEW_SERIES = { kind: 'enter', newSeries: true }

test('the channel bot\'s stuck Session starts a new series at its next step, and staff Repair forces one; its id, channels, automations and answer children stay', async t => {
  const run = await answerBench(t)
  const child = await run.child()
  run.team.state.subscriptions = { 'sub-owned': { id: 'sub-owned', name: 'Orders', on: true, ownerBotId: ANSWER_MASTER, sources: [], trigger: { kind: 'message' }, worker: { kind: 'events' }, outputs: { react: false, replyToMe: false }, askFirst: true, createdAt: 1, updatedAt: 1 } }
  await run.team.save()
  const before = JSON.stringify(saved(run.home))
  const warnings = []
  run.team.warn = (...args) => warnings.push(args)
  run.ctx.tools.schemas = () => [...FIRST, ...LATER].map(name => ({ name }))
  const stuck = { id: ANSWER_MASTER, session: liveSession(ANSWER_MASTER) }
  assert.deepEqual(await preStep(run.ctx, stuck), NEW_SERIES)
  assert.match(warnings.at(-1)[0], /starts a new tool series/)
  // A healthy Session of the same bot is left alone until staff ask; then once.
  const healthy = { id: ANSWER_MASTER, session: Session.create(ANSWER_MASTER) }
  request(healthy.session, FIRST, { reason: 'initial', turn: 1 })
  assert.deepEqual(await preStep(run.ctx, healthy), ENTER)
  assert.deepEqual(await run.call('repair_tool_series', { botId: ANSWER_MASTER }), { botId: ANSWER_MASTER, next: 'fresh-tools' })
  assert.deepEqual(await preStep(run.ctx, healthy), NEW_SERIES)
  assert.deepEqual(await preStep(run.ctx, healthy), ENTER)
  // A rejected step, another Bot's Session and the answer child's Session are never touched.
  assert.deepEqual(await preStep(run.ctx, stuck, { kind: 'reject' }), { kind: 'reject', newSeries: false })
  for (const id of ['someone-else', child.sessionId]) assert.deepEqual(await preStep(run.ctx, { id, session: liveSession(id) }), ENTER, id)
  // The default bot is repaired the same way: it can be a channel bot on its own Session too.
  assert.deepEqual(await run.call('repair_tool_series', { botId: run.channels.eventsBotId() }), { botId: run.channels.eventsBotId(), next: 'fresh-tools' })
  await assert.rejects(run.call('repair_tool_series', { botId: 'someone-else' }), /operates Omni/)
  await assert.rejects(run.call('repair_tool_series', { botId: ANSWER_MASTER, extra: true }), /nrecognized/)
  // Nothing was saved or moved: the bot keeps its id, its channel, its automation and its child.
  assert.equal(JSON.stringify(saved(run.home)), before)
  const kept = saved(run.home)
  assert.equal(kept.omniOwnership.channels[INSTANCE], ANSWER_MASTER)
  assert.equal(kept.subscriptions['sub-owned'].ownerBotId, ANSWER_MASTER)
  assert.equal(run.channels.threads.list().find(thread => thread.id === child.id)?.ownerBotId, ANSWER_MASTER)
  assert.equal(run.team.botOf(ANSWER_MASTER).instructions, 'MASTER: help customers with orders.')
})
