import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { fakeContext } from './fake-ctx.js'

const OMNI = 'https://omni.test'
const omniAnswers = {
  '/instances': { items: [{ id: 'wa-1', channel: 'whatsapp-baileys', name: 'Sales', isActive: true }] },
  '/instances/wa-1/status': { data: { state: 'connected' } },
  '/chats': { items: [
    { id: 'obras', instanceId: 'wa-1', name: 'Grupo Obras', chatType: 'group' },
    { id: 'marina', instanceId: 'wa-1', name: 'Marina Lopes', chatType: 'dm' },
  ] },
}

// A team with its Main Bot, Tentacall and Ops, watching a fake omni.
function setup(t) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-subs-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({
    version: 1, mainBotIds: ['m1'], eventsBotId: 't1', eventsBotStored: true, revision: 1,
    bots: {
      m1: { id: 'm1', name: 'Omni', role: 'Orchestrator', instructions: '', createdAt: 1 },
      t1: { id: 't1', name: 'Tentacall', role: 'Event router', instructions: '', createdAt: 2 },
      b2: { id: 'b2', name: 'Ops', role: 'Ops', instructions: '', createdAt: 3 },
    },
    rooms: {}, agents: {}, exchanges: [], exchangeTurns: {},
  }))
  const realFetch = globalThis.fetch
  globalThis.fetch = async (address) => {
    const answer = omniAnswers[String(address).replace(`${OMNI}/api/v2`, '').split('?')[0]]
    return new Response(JSON.stringify(answer ?? {}), { status: answer ? 200 : 404 })
  }
  const ctx = fakeContext({ services: { credentials: { resolve: async ref => (ref === 'OMNI_API_KEY' ? { value: 'omni_sk_test' } : undefined) } } })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => { route = options; return register(options) }
  apply(ctx, { home, omni: { url: OMNI } })
  t.after(async () => {
    globalThis.fetch = realFetch
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  const tool = name => args => ctx.registeredTools.get(name).execute(args, { agent: { id: 't1' } })
  const as = (name, agentId) => args => ctx.registeredTools.get(name).execute(args, { agent: { id: agentId } })
  const call = async (endpoint, payload) => (await (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json())
  return { tool, as, call }
}

test('only Tentacall manages subscriptions', async (t) => {
  const { as } = setup(t)
  assert.match(await as('save_subscription', 'b2')({ trigger: 'message', sources: 'chat:obras' }), /Only Tentacall/)
  assert.match(await as('list_watchable', 'm1')({}), /Only Tentacall/)
})

test('Tentacall finds chats by name with the ids it saves with', async (t) => {
  const { tool } = setup(t)
  const all = await tool('list_watchable')({})
  assert.match(all, /channel:wa-1 · whatsapp-baileys · Sales · connected/)
  assert.match(all, /chat:obras · group · Grupo Obras · on Sales/)
  assert.doesNotMatch(await tool('list_watchable')({ search: 'obras' }), /Marina/)
})

test('a saved subscription is on the team view at once, as the board shows it', async (t) => {
  const { tool, call } = setup(t)
  const reply = await tool('save_subscription')({ sources: 'chat:obras, channel:wa-1', trigger: 'reaction', emoji: '📌', worker: 'Ops', reply_to_me: true })
  assert.match(reply, /^Saved sub-/)
  assert.match(reply, /when you react 📌 in Grupo Obras, all of Sales → Ops \(reacts 👀 then ✅, replies to you\)/)
  const view = (await call('state', {})).value
  assert.equal(view.subscriptions.length, 1)
  const [sub] = view.subscriptions
  assert.deepEqual(sub.sources.map(source => [source.kind, source.id, source.name]), [['chat', 'obras', 'Grupo Obras'], ['channel', 'wa-1', 'Sales']])
  assert.deepEqual(sub.worker, { kind: 'bot', botId: 'b2' })
  assert.equal(sub.askFirst, true)
  assert.equal(sub.on, true)
})

test('what the user has not said is asked, not guessed', async (t) => {
  const { tool, call } = setup(t)
  assert.match(await tool('save_subscription')({ trigger: 'reaction', sources: 'chat:obras' }), /needs the one emoji .* Ask/)
  assert.match(await tool('save_subscription')({ trigger: 'keyword', sources: 'chat:obras' }), /needs the words .* Ask/)
  assert.match(await tool('save_subscription')({ trigger: 'voice' }), /Which chats/)
  assert.match(await tool('save_subscription')({ trigger: 'voice', sources: 'chat:nope' }), /No channel or chat "chat:nope"/)
  assert.match(await tool('save_subscription')({ trigger: 'voice', sources: 'chat:obras', worker: 'Nobody' }), /No Bot named "Nobody"/)
  assert.equal((await call('state', {})).value.subscriptions.length, 0)
})

test('changing, pausing and deleting go by id, from the tools and from the board', async (t) => {
  const { tool, call } = setup(t)
  await tool('save_subscription')({ sources: 'chat:marina', trigger: 'media' })
  const id = (await call('state', {})).value.subscriptions[0].id
  assert.match(await tool('save_subscription')({ id, trigger: 'keyword', words: 'orçamento, quote' }), /a message says "orçamento" or "quote" in Marina Lopes → Tentacall/)
  assert.match(await tool('pause_subscription')({ id, on: false }), /paused/)
  assert.equal((await call('state', {})).value.subscriptions[0].on, false)
  assert.equal((await call('subscription-set-on', { id, on: true })).ok, true)
  assert.equal((await call('subscription-test', { id })).ok, true)
  assert.equal((await call('state', {})).value.subscriptionRuns[0].test, true)
  assert.match(await tool('list_subscriptions')({}), new RegExp(`${id} · `))
  assert.match(await tool('delete_subscription')({ id }), /Deleted/)
  const view = (await call('state', {})).value
  assert.equal(view.subscriptions.length, 0)
  assert.equal(view.subscriptionRuns.length, 0)
})
