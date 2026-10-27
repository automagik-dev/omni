// A chat thread's own tools (wish omni-chat-threads, Group 9; criteria :195, :197, :198, :199):
// say, react, history and picture in its own chat only, on its own key, every send asked on
// DSH's card, and nothing else in its hands. The bench (thread-fixture.js) runs the real Bot
// team under this plugin on a fake DSH and a fake Omni; every send goes to that fake Omni.
// DSH's tool pipeline is played here in its order: the tools/pre-execute waterfall, the
// approval card when it asks (DSH's answerer is the last link), the guards, then the tool.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { defineTool, ToolRuntime, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { MEDIA_FILE_BYTES } from '../src/host/omni.js'
import { NEEDS_NEWER_TEAM } from '../src/host/resume-hook.js'
import { NOT_LINKED } from '../src/host/thread-keys.js'
import { ASK_NOT_YET, FREE_REACTIONS_DEFAULT, isFreeReaction, NOT_A_THREAD, withoutThreadTools } from '../src/host/thread-tools.js'
import { THREAD_REFUSAL, THREAD_TOOLS } from '../src/host/threads.js'
import { askedOf, boot, CHAT, CHATS, flush, GROUP, guarded, homeFor, INSTANCE, keysOf, MESSAGE_IDS, PNG, record, resetFetch, saved, teamState, fakeOmni } from './thread-fixture.js'

afterEach(resetFetch)

// DSH's attachment store for pictures, in memory, with DSH's default limits unless given.
function pictureStore(limits = {}) {
  const saved = []
  return {
    saved,
    imageLimits: { mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], maxImageBytes: 5_000_000, maxMessageImageBytes: 20_000_000, ...limits },
    async saveImage({ data, mediaType, name }) {
      saved.push({ data: Buffer.from(data), mediaType, name })
      return { attachmentId: `sha256:${saved.length}`, mediaType, bytes: data.length, width: 1, height: 1, name }
    },
  }
}

// A linked Omni and one added chat (CHAT, or `chat`), its thread on a model that `sees`
// pictures or not; `store` is DSH's attachment service, or none.
const mocked = new WeakSet()
async function bench(t, { chat = CHAT, sees = true, store = pictureStore(), mask = false } = {}) {
  // One test may make several benches; its timers are mocked once.
  if (!mocked.has(t)) t.mock.timers.enable({ apis: ['setTimeout'] })
  mocked.add(t)
  const omni = fakeOmni()
  const home = homeFor(t, omni)
  const llm = { resolveModelInfo: async (provider, model) => ({ id: `${provider}/${model}`, inputModalities: sees ? ['text', 'image'] : ['text'] }) }
  const services = { llm, ...(store ? { attachments: store } : {}) }
  const run = await boot(t, home, { services })
  const added = await run.channels.threads.add(INSTANCE, chat)
  assert.equal(added.ok, true, added.reason)
  await flush()
  const thread = added.thread
  const key = keysOf(home).threads[thread.id].key
  if (!mask) return { omni, home, run, thread, key, store }
  // The same home on a Bot team without the hook.
  await run.stop()
  return { omni, home, run: await boot(t, home, { mask: true, services }), thread, key, store }
}

// One tool's body in a Session, as DSH calls it once every gate let it through.
const use = (run, name, sessionId, args = {}) => run.ctx.registeredTools.get(name).execute(args, { agent: run.agentOf(sessionId) })
// The tools/pre-execute waterfall for one call: every listener in order, then `last`.
const preExecute = (run, name, sessionId, args = {}, last = { kind: 'allow' }) => {
  const chain = [...(run.ctx.listeners.get('tools/pre-execute') ?? [])]
  const exec = { name, arguments: args, agent: run.agentOf(sessionId) }
  const step = index => (index < chain.length ? chain[index](exec, () => step(index + 1)) : Promise.resolve(last))
  return step(0)
}
// DSH's approval: the approval/request middleware (each prepended, so the last registered
// runs first), ending in DSH's own card, which the user answers with `answer`.
const approve = (run, request, card) => {
  const chain = [...(run.ctx.listeners.get('approval/request') ?? [])].reverse()
  const step = index => (index < chain.length ? Promise.resolve(chain[index](request, () => step(index + 1))) : Promise.resolve(card()))
  return step(0)
}
// One call through DSH's pipeline: whether the card showed, and the tool's answer.
async function dsh(run, name, sessionId, args = {}, answer = 'allowed-once') {
  const decision = await preExecute(run, name, sessionId, args)
  let card = false
  // The thread's status while its card is up.
  let waiting = null
  if (decision.kind === 'ask') {
    const outcome = await approve(run, { agent: run.agentOf(sessionId), toolName: name, reason: decision.reason }, () => {
      card = true
      waiting = run.channels.threads.bySession(sessionId)?.status ?? null
      return answer
    })
    if (outcome !== 'allowed-once') return { card, waiting, result: `Error: the user rejected tool "${name}"` }
  } else if (decision.kind !== 'allow') {
    return { card, result: `Error: ${decision.reason}` }
  }
  const refused = guarded(run.ctx, sessionId, name)
  if (refused !== undefined) return { card, result: `Error: ${refused}` }
  return { card, waiting, decision, result: await use(run, name, sessionId, args) }
}
const asked = (omni, from) => askedOf(omni).slice(from)
// The tools whose calls may raise a card: a refused call is denied before the card, so DSH
// answers it as an error.
const CARDED = new Set(['thread_say', 'thread_react'])

// DSH's real tool registry (dsh-tools), with a stand-in for each tool of a DSH profile.
async function realTools(mode) {
  const root = new Context()
  root.plugin(SystemPrompt, {})
  root.plugin(ToolRuntime, { mode })
  const ctx = await new Promise((resolve) => { root.plugin({ inject: ['tools'], apply: resolve }) })
  const stub = name => defineTool({ name, description: name, parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => name })
  return { ctx, stub }
}

test('a thread lists only its five tools: restricted right after it is added and again on a later agent; the guard refuses the rest (:197)', async (t) => {
  const { run, thread } = await bench(t)
  // Right after add, on the agent DSH resolves for the Session.
  const first = run.agentOf(thread.sessionId)
  assert.deepEqual(run.restricts.map(entry => [entry.sessionId, entry.filter]), [[thread.sessionId, { allow: [...THREAD_TOOLS] }]])
  assert.equal(run.restricts[0].agent, first)
  // The same agent again changes nothing; a new agent of the Session (a resume, a clear) is
  // restricted again; another Session's agent is not.
  run.ctx.emit('agent/created', { agent: first })
  run.ctx.emit('agent/created', { agent: run.freshAgent('some-session') })
  await flush()
  assert.equal(run.restricts.length, 1)
  const next = run.freshAgent(thread.sessionId)
  run.ctx.emit('agent/created', { agent: next })
  await flush()
  assert.deepEqual(run.restricts.map(entry => entry.agent), [first, next])
  // Whatever stays visible outside the five, a scope-local subagent and run_code included,
  // is refused in the thread; its own five are not.
  for (const name of ['bash', 'subagent', 'list_subagent_models', 'run_code', 'omni_call', 'omni_send', 'start_task']) assert.equal(guarded(run.ctx, thread.sessionId, name), THREAD_REFUSAL, name)
  for (const name of THREAD_TOOLS) assert.equal(guarded(run.ctx, thread.sessionId, name), undefined, name)
})

test('probe 2: on DSH\'s real tool registry the thread\'s filter hides every global tool but the five; scope-local tools stay listed and the guard refuses them; ptc mode is turned back to native (:197)', async (t) => {
  for (const mode of ['native', 'ptc']) {
    const { run, thread } = await bench(t)
    const real = await realTools(mode)
    for (const name of ['bash', 'read', 'write', 'web_search', 'omni_call', 'omni_send', 'start_task']) real.ctx.tools.register(real.stub(name))
    // The plugin's own definitions, as DSH registers them: their output schemas pass DSH's checks.
    for (const name of THREAD_TOOLS) real.ctx.tools.register(run.ctx.registeredTools.get(name))
    // A live agent of the thread's Session, with tools of its own layer, as DSH's subagent tool has.
    const agent = { id: thread.sessionId, session: { id: thread.sessionId } }
    agent.ctx = createScope(real.ctx, agent).ctx
    for (const name of ['subagent', 'list_subagent_models']) agent.ctx.tools.register(real.stub(name))
    const visible = () => [...real.ctx.tools.view(agent).visible.keys()].sort()
    assert.ok(visible().includes('bash'))
    assert.equal(visible().includes('run_code'), mode === 'ptc')
    // The plugin restricts it on agent/created, through the registry's own restrict().
    run.ctx.tools.modeFor = scope => real.ctx.tools.modeFor(scope)
    run.ctx.emit('agent/created', { agent })
    await flush()
    assert.deepEqual(visible(), [...THREAD_TOOLS, 'list_subagent_models', 'subagent'].sort(), mode)
    assert.equal(real.ctx.tools.modeFor(agent), 'native')
    for (const name of ['subagent', 'list_subagent_models']) assert.equal(guarded(run.ctx, thread.sessionId, name), THREAD_REFUSAL)
    // restrict() refuses the whole list for one name it does not know, so the five are all
    // registered globally before any thread is restricted.
    assert.throws(() => agent.ctx.tools.restrict({ allow: [...THREAD_TOOLS, 'not_a_tool'] }), /unknown global tool "not_a_tool"/)
  }
})

test('each thread tool called from another Session refuses and asks Omni nothing; thread_ask_omni refuses in its thread until it has its body (:197)', async (t) => {
  const { omni, run, thread } = await bench(t)
  const from = askedOf(omni).length
  const args = { thread_say: { text: 'oi' }, thread_react: { messageId: MESSAGE_IDS.text, emoji: '🔥' }, thread_history: {}, thread_picture: { messageId: MESSAGE_IDS.picture }, thread_ask_omni: { question: 'Que horas são?' } }
  for (const sessionId of ['m1', 'some-session']) {
    for (const name of THREAD_TOOLS) {
      const { card, result } = await dsh(run, name, sessionId, args[name])
      assert.equal(card, false, name)
      assert.equal(name === 'thread_picture' ? result.text : result, `${CARDED.has(name) ? 'Error: ' : ''}${NOT_A_THREAD}`, name)
    }
  }
  assert.deepEqual(asked(omni, from), [])
  assert.equal(await use(run, 'thread_ask_omni', thread.sessionId, args.thread_ask_omni), ASK_NOT_YET)
  assert.deepEqual(asked(omni, from), [])
})

test('every send shows DSH\'s card, every time and in a group too, and goes on the thread\'s own key to the chat\'s JID (:198)', async (t) => {
  for (const chat of [CHAT, GROUP]) {
    const { omni, run, thread, key } = await bench(t, { chat })
    const first = await dsh(run, 'thread_say', thread.sessionId, { text: 'Chego às 8.' })
    assert.equal(first.card, true)
    // DSH's card shows the reason, so the reason carries the message.
    assert.equal(first.decision.reason, `Send into "${CHATS[chat].name}" as you?\n\nChego às 8.`)
    assert.equal(first.waiting, 'waiting')
    assert.match(first.result, /^Sent into the chat\./)
    // A second send asks again: DSH's card allows once only, and nothing here remembers it.
    const second = await dsh(run, 'thread_say', thread.sessionId, { text: 'Até já.' })
    assert.equal(second.card, true)
    // Refused on the card, nothing is sent.
    const rejected = await dsh(run, 'thread_say', thread.sessionId, { text: 'Não mande isto.' }, 'rejected')
    assert.equal(rejected.card, true)
    assert.deepEqual(omni.sent.map(send => [send.path, send.body, send.key]), [
      ['/messages/send', { instanceId: INSTANCE, to: CHATS[chat].externalId, text: 'Chego às 8.' }, key],
      ['/messages/send', { instanceId: INSTANCE, to: CHATS[chat].externalId, text: 'Até já.' }, key],
    ])
    assert.notEqual(key, omni.link.text)
    // Once the card is answered the thread is idle again.
    assert.equal(run.channels.threads.byId(thread.id).status, 'idle')
  }
})

test('the six reactions go without a card, with or without the variation selector; any other asks; an edited list applies and is kept (:198)', async (t) => {
  const { omni, home, run, thread, key } = await bench(t)
  const react = emoji => dsh(run, 'thread_react', thread.sessionId, { messageId: MESSAGE_IDS.picture, emoji })
  for (const emoji of ['👍', '❤️', '❤', '😂', '😮', '😢', '🙏', '👍️']) {
    const { card, result } = await react(emoji)
    assert.equal(card, false, emoji)
    assert.equal(result, `Reacted ${emoji}.`)
  }
  for (const emoji of ['🔥', '👎', '👍🏽']) assert.equal((await react(emoji)).card, true, emoji)
  assert.ok(omni.sent.every(send => send.path === '/messages/send/reaction' && send.key === key && send.body.to === CHATS[CHAT].externalId && send.body.messageId === MESSAGE_IDS.picture))
  assert.deepEqual(await run.call('omni-free-reactions', {}), { freeReactions: [...FREE_REACTIONS_DEFAULT], defaults: [...FREE_REACTIONS_DEFAULT] })
  // The owner's list, from the settings page: 🔥 goes free, 👍 asks.
  assert.deepEqual((await run.call('omni-free-reactions-save', { freeReactions: ['🔥', '❤'] })).freeReactions, ['🔥', '❤'])
  assert.equal((await react('🔥')).card, false)
  assert.equal((await react('❤️')).card, false)
  assert.equal((await react('👍')).card, true)
  assert.deepEqual(saved(home).omniSettings, { freeReactions: ['🔥', '❤'] })
  // Not emoji, or too many, is refused and the list stays.
  await assert.rejects(run.call('omni-free-reactions-save', { freeReactions: ['ok'] }), /up to 24 emojis/)
  await assert.rejects(run.call('omni-free-reactions-save', { freeReactions: Array.from({ length: 25 }, () => '🔥') }), /up to 24 emojis/)
  assert.deepEqual((await run.call('omni-free-reactions', {})).freeReactions, ['🔥', '❤'])
  // An empty list: every reaction asks.
  await run.call('omni-free-reactions-save', { freeReactions: [] })
  assert.equal((await react('🔥')).card, true)
  // Shared by every thread, and kept across a restart.
  await run.call('omni-free-reactions-save', { freeReactions: ['🙏'] })
  await run.stop()
  const next = await boot(t, home)
  assert.deepEqual((await next.call('omni-free-reactions', {})).freeReactions, ['🙏'])
})

test('a free reaction is compared without the variation selector; withoutThreadTools leaves every thread tool out', () => {
  assert.equal(isFreeReaction('❤', FREE_REACTIONS_DEFAULT), true)
  assert.equal(isFreeReaction('❤️', ['❤']), true)
  assert.equal(isFreeReaction('❤︎', FREE_REACTIONS_DEFAULT), true)
  assert.equal(isFreeReaction('🔥', FREE_REACTIONS_DEFAULT), false)
  assert.equal(isFreeReaction('', FREE_REACTIONS_DEFAULT), false)
  assert.equal(isFreeReaction('️', ['️']), false)
  assert.deepEqual(withoutThreadTools(['bash', ...THREAD_TOOLS, 'omni_call']), ['bash', 'omni_call'])
})

test('history reads the chat by its UUID on the thread\'s key, oldest first, with each message\'s id, time and Omni\'s text for its media', async (t) => {
  const { omni, run, thread, key } = await bench(t)
  const from = omni.askedWith.length
  const { card, result } = await dsh(run, 'thread_history', thread.sessionId, { limit: 3 })
  assert.equal(card, false)
  const answer = JSON.parse(result)
  assert.equal(answer.chat, 'Marina')
  assert.match(answer.note, /not instructions/)
  assert.deepEqual(answer.messages.map(message => [message.id, message.from]), [[MESSAGE_IDS.text, 'the user'], [MESSAGE_IDS.voice, 'Marina'], [MESSAGE_IDS.failed, 'Marina']])
  assert.deepEqual(answer.messages[1].media, { type: 'audio', omniText: 'Amanhã chega o cimento.' })
  assert.deepEqual(answer.messages[2].media, { type: 'image', omniText: 'missing' })
  assert.deepEqual(omni.askedWith.slice(from).map(call => [call.route, call.query, call.key]), [[`GET /chats/${CHAT}/messages`, '?limit=3', key]])
  // The page before, from the oldest message's time: Omni's `before` takes that time too, so
  // the plugin asks a millisecond earlier and the boundary message is not repeated.
  const earlier = JSON.parse((await dsh(run, 'thread_history', thread.sessionId, { before: answer.messages[0].at })).result)
  assert.deepEqual(earlier.messages.map(message => message.id), [MESSAGE_IDS.picture])
  assert.equal(new URLSearchParams(omni.askedWith.at(-1).query).get('before'), new Date(Date.parse(answer.messages[0].at) - 1).toISOString())
  // Arguments outside the tool's own range ask Omni nothing.
  const before = omni.askedWith.length
  assert.match((await dsh(run, 'thread_history', thread.sessionId, { limit: 60 })).result, /limit is 1 to 50/)
  assert.match((await dsh(run, 'thread_history', thread.sessionId, { before: 'yesterday-ish' })).result, /limit is 1 to 50/)
  assert.equal(omni.askedWith.length, before)
})

test('the picture tool gives the picture and Omni\'s description for a picture in the thread\'s chat, through DSH\'s attachments (:199)', async (t) => {
  const { omni, run, thread, key, store } = await bench(t)
  const from = omni.askedWith.length
  const { card, result } = await dsh(run, 'thread_picture', thread.sessionId, { messageId: MESSAGE_IDS.picture })
  assert.equal(card, false)
  assert.match(result.text, /^Picture from Marina/)
  assert.match(result.text, /Caption: a obra hoje/)
  assert.match(result.text, /Omni's description: A brick wall half built/)
  assert.doesNotMatch(result.text, /not shown/)
  assert.deepEqual(result.image, { attachmentId: 'sha256:1', mediaType: 'image/png', bytes: PNG.length, width: 1, height: 1, name: `${MESSAGE_IDS.picture}.png` })
  assert.deepEqual(store.saved.map(file => [file.mediaType, file.data.equals(PNG)]), [['image/png', true]])
  // The row, then the file, all on the link key: a chat key holds no messages:read.
  assert.deepEqual(omni.askedWith.slice(from).map(call => [call.route, call.key === omni.link.text]), [
    [`GET /messages/${MESSAGE_IDS.picture}`, true], ['POST /messages/media/download', true], ['GET /media/pic.png', true],
  ])
  assert.notEqual(key, omni.link.text)
  // What the model gets: DSH checks the value against the tool's output schema and renders a
  // text block and an image block from it.
  const definition = run.ctx.registeredTools.get('thread_picture')
  assert.deepEqual(validateJsonSchemaValue(definition.output.schema, result, 'value'), [])
  assert.deepEqual(definition.output.render({}, result).map(block => block.type), ['text', 'image'])
  assert.equal(definition.output.render({}, result)[1].attachment.attachmentId, 'sha256:1')
})

// Probe 1, as far as a test goes: the picture through DSH's own attachment store (on a
// throwaway home), into the content blocks DSH's registry would hand the model. The live run
// in a dev-harness DSH is not part of this suite.
test('probe 1: a chat\'s picture goes through DSH\'s real attachment store into a text block and an image block (:199)', async (t) => {
  const dshHome = mkdtempSync(join(tmpdir(), 'omni-thread-attachments-'))
  t.after(() => rmSync(dshHome, { recursive: true, force: true, maxRetries: 5 }))
  const root = new Context()
  root.plugin(LocalAttachmentStore, { dshHome })
  const attachments = await new Promise((resolve) => { root.plugin({ inject: ['attachments'], apply: ctx => resolve(ctx.attachments) }) })
  const { run, thread } = await bench(t, { store: attachments })
  const { result } = await dsh(run, 'thread_picture', thread.sessionId, { messageId: MESSAGE_IDS.picture })
  assert.match(result.image.attachmentId, /^sha256:[0-9a-f]{64}$/)
  assert.deepEqual({ ...result.image, attachmentId: 'id' }, { attachmentId: 'id', mediaType: 'image/png', bytes: PNG.length, width: 1, height: 1, name: `${MESSAGE_IDS.picture}.png` })
  const real = await realTools('native')
  real.ctx.tools.register(run.ctx.registeredTools.get('thread_picture'))
  const definition = real.ctx.tools.get('thread_picture')
  assert.deepEqual(validateJsonSchemaValue(definition.output.schema, result, 'value'), [])
  const blocks = definition.output.render({}, result)
  assert.deepEqual(blocks.map(block => block.type), ['text', 'image'])
  assert.equal(blocks[1].attachment.attachmentId, result.image.attachmentId)
  // DSH's store kept the very bytes Omni served, and reads them back under the block's
  // reference (it checks the digest, type, size and dimensions against it).
  assert.ok(Buffer.from((await attachments.readImage(blocks[1].attachment)).data).equals(PNG))
})

test('another chat\'s message, or one without media, is refused with nothing downloaded (:199)', async (t) => {
  const { omni, run, thread, store } = await bench(t)
  const cases = [[MESSAGE_IDS.elsewhere, 'That message is not in this chat.'], [MESSAGE_IDS.text, 'That message has no picture.'], ['6a1b2c3d-9999-4a5b-8c6d-7e8f9a0b1c09', 'Omni has no such message.']]
  for (const [messageId, refusal] of cases) {
    const from = askedOf(omni).length
    const { result } = await dsh(run, 'thread_picture', thread.sessionId, { messageId })
    assert.deepEqual(result, { text: refusal })
    assert.deepEqual(asked(omni, from), [`GET /messages/${messageId}`])
  }
  assert.deepEqual(store.saved, [])
  // A message id is all it takes; nothing else names the chat.
  assert.match((await use(run, 'thread_picture', thread.sessionId, { messageId: CHAT.replace(/.$/, 'x') })).text, /message id from thread_history/)
})

test('a text-only model, an over-limit picture or no attachment store gets the description and a "not shown" line; failed or missing text reads as missing (:199)', async (t) => {
  const picture = async (options, messageId = MESSAGE_IDS.picture) => {
    const { omni, run, thread, store } = await bench(t, options)
    const from = askedOf(omni).length
    const { result } = await dsh(run, 'thread_picture', thread.sessionId, { messageId })
    return { result, asked: asked(omni, from), saved: store?.saved ?? [] }
  }
  const textOnly = await picture({ sees: false })
  assert.match(textOnly.result.text, /Omni's description: A brick wall half built/)
  assert.match(textOnly.result.text, /The picture itself is not shown: this thread's model does not take pictures\.$/)
  assert.equal(textOnly.result.image, undefined)
  // Nothing is downloaded for a model that would not see it.
  assert.deepEqual([textOnly.asked, textOnly.saved], [[`GET /messages/${MESSAGE_IDS.picture}`], []])

  const large = await picture({ store: pictureStore({ maxImageBytes: PNG.length - 1 }) })
  assert.match(large.result.text, /not shown: the picture is larger than DeepSeek Harness takes\.$/)
  assert.deepEqual([large.result.image, large.saved], [undefined, []])

  const none = await picture({ store: null })
  assert.match(none.result.text, /not shown: this DeepSeek Harness has no attachment store for pictures\.$/)

  const refusing = pictureStore()
  refusing.saveImage = async () => { throw Object.assign(new Error('too big'), { code: 'IMAGE_DIMENSION_TOO_LARGE' }) }
  assert.match((await picture({ store: refusing })).result.text, /not shown: the picture is over DeepSeek Harness's picture limits\.$/)

  const failed = await picture({}, MESSAGE_IDS.failed)
  assert.match(failed.result.text, /Omni's description: missing \(Omni has none, or could not make one\)/)
  assert.doesNotMatch(failed.result.text, /\[error/)
  assert.ok(failed.result.image)
  // A voice note is Omni's text only, with nothing downloaded.
  const voice = await picture({}, MESSAGE_IDS.voice)
  assert.match(voice.result.text, /^A voice note or audio from Marina/)
  assert.match(voice.result.text, /Omni's text: Amanhã chega o cimento\.\nIt is not a picture, so nothing is shown\.$/)
  assert.deepEqual([voice.asked, voice.saved], [[`GET /messages/${MESSAGE_IDS.voice}`], []])
})

test('against a team stand-in with no hook, each of the five tools in a thread refuses with the reason, raises no card and asks Omni nothing (:195)', async (t) => {
  const { omni, run, thread } = await bench(t, { mask: true })
  assert.equal(run.channels.teamResume.ready, false)
  const from = askedOf(omni).length
  const args = { thread_say: { text: 'oi' }, thread_react: { messageId: MESSAGE_IDS.text, emoji: '🔥' }, thread_history: {}, thread_picture: { messageId: MESSAGE_IDS.picture }, thread_ask_omni: { question: 'Oi?' } }
  for (const name of THREAD_TOOLS) {
    const { card, result } = await dsh(run, name, thread.sessionId, args[name])
    assert.equal(card, false, name)
    assert.equal(name === 'thread_picture' ? result.text : result, `${CARDED.has(name) ? 'Error: ' : ''}${NEEDS_NEWER_TEAM}`, name)
  }
  assert.deepEqual(asked(omni, from), [])
  assert.deepEqual(omni.sent, [])
})

test('a thread with no key refuses with why and asks Omni nothing; it never falls back to the link key', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const omni = fakeOmni()
  const home = homeFor(t, omni, teamState({ omniThreads: { old: record('old', 'old-session') } }))
  const run = await boot(t, home)
  const from = askedOf(omni).length
  for (const [name, args] of [['thread_say', { text: 'oi' }], ['thread_react', { messageId: MESSAGE_IDS.text, emoji: '👍' }], ['thread_history', {}]]) {
    const { card, result } = await dsh(run, name, 'old-session', args)
    assert.equal(card, false, name)
    assert.equal(result, `${CARDED.has(name) ? 'Error: ' : ''}Not connected: this thread has no key.`, name)
  }
  assert.equal((await dsh(run, 'thread_picture', 'old-session', { messageId: MESSAGE_IDS.picture })).result.text, 'Not connected: this thread has no key.')
  assert.deepEqual([asked(omni, from), omni.sent], [[], []])
})

test('Omni\'s refusal of a send comes back as its words, and nothing is said to be sent', async (t) => {
  const { run, thread, omni } = await bench(t)
  // The key is revoked behind the plugin's back: Omni answers 401.
  for (const child of omni.children()) child.revoked = true
  const { result } = await dsh(run, 'thread_say', thread.sessionId, { text: 'oi' })
  assert.equal(result, 'Not sent. Omni answered 401: Invalid API key')
  assert.equal((await use(run, 'thread_say', thread.sessionId, { text: '   ' })), 'text must be a message of 1 to 4096 characters')
  assert.deepEqual(omni.sent, [])
})

test('a call refused at the card\'s stage is denied there: a key that comes in before the tool\'s own check sends nothing without a card', async (t) => {
  const { omni, run, thread } = await bench(t)
  const keys = run.channels.threadKeys
  const keyFor = keys.keyFor
  // Not connected when DSH asks whether to raise a card; connected again right after (a drain
  // claimed a key, another host handed one over).
  const flaky = () => {
    let first = true
    keys.keyFor = (threadId) => {
      if (!first) return keyFor(threadId)
      first = false
      return null
    }
  }
  for (const [name, args] of [['thread_say', { text: 'Sem cartão?' }], ['thread_react', { messageId: MESSAGE_IDS.text, emoji: '🔥' }], ['thread_react', { messageId: MESSAGE_IDS.text, emoji: '👍' }]]) {
    flaky()
    const { card, result } = await dsh(run, name, thread.sessionId, args)
    assert.equal(card, false, name)
    assert.equal(result, `Error: ${NOT_LINKED}`, name)
  }
  assert.deepEqual(omni.sent, [])
})

test('the card says what goes out: a send\'s text (cut at 1000 characters), a reaction\'s emoji and its message', async (t) => {
  const { run, thread } = await bench(t)
  const long = 'a'.repeat(1500)
  assert.equal((await preExecute(run, 'thread_say', thread.sessionId, { text: long })).reason, `Send into "Marina" as you?\n\n${'a'.repeat(1000)}…`)
  assert.equal((await preExecute(run, 'thread_react', thread.sessionId, { messageId: MESSAGE_IDS.picture, emoji: '🔥' })).reason, `React 🔥 in "Marina" as you?\n\nTo message ${MESSAGE_IDS.picture}`)
})

test('arguments a tool would refuse are denied before any card, and nothing is sent', async (t) => {
  const { omni, run, thread } = await bench(t)
  for (const [name, args, said] of [['thread_say', { text: '   ' }, 'text must be a message of 1 to 4096 characters'], ['thread_say', { text: 'x'.repeat(4097) }, 'text must be a message of 1 to 4096 characters'], ['thread_react', { messageId: MESSAGE_IDS.text, emoji: '' }, 'Give a message id from thread_history and one emoji']]) {
    const { card, result } = await dsh(run, name, thread.sessionId, args)
    assert.deepEqual([card, result], [false, `Error: ${said}`], name)
  }
  assert.deepEqual(omni.sent, [])
})

test('without DSH\'s image limits a picture is still held to the media cap', async (t) => {
  const store = pictureStore()
  delete store.imageLimits
  const { omni, run, thread } = await bench(t, { store })
  // A PNG one byte over the cap.
  const huge = Buffer.alloc(MEDIA_FILE_BYTES + 1)
  PNG.copy(huge)
  omni.files['pic.png'] = huge
  const { result } = await dsh(run, 'thread_picture', thread.sessionId, { messageId: MESSAGE_IDS.picture })
  assert.match(result.text, /not shown: the picture is larger than DeepSeek Harness takes\.$/)
  assert.deepEqual(store.saved, [])
})
