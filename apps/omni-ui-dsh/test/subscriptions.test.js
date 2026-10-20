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
  '/openapi.json': { paths: {
    '/instances': { get: { summary: 'List instances', tags: ['Instances'] }, post: { summary: 'Create instance', tags: ['Instances'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name', 'channel'], properties: { name: { type: 'string' }, channel: { enum: ['whatsapp-baileys', 'telegram'] } } } } } } } },
    '/instances/{id}/connect': { post: { summary: 'Connect instance', tags: ['Instances'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }] } },
    '/instances/{id}/qr': { get: { summary: 'Get QR code for WhatsApp connection', tags: ['Instances'] } },
  } },
  '/instances/wa-1/connect': { data: { status: 'connecting' } },
  '/chats': { items: [
    { id: 'obras', instanceId: 'wa-1', name: 'Grupo Obras', chatType: 'group' },
    { id: 'marina', instanceId: 'wa-1', name: 'Marina Lopes', chatType: 'dm' },
  ] },
}

// A team with its Main Bot, the Autopilot it once had, and Ops, watching a fake omni.
function setup(t) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-subs-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({
    version: 1, mainBotIds: ['m1'], eventsBotId: 't1', eventsBotStored: true, revision: 1,
    bots: {
      m1: { id: 'm1', name: 'Omni', role: 'Orchestrator', instructions: '', createdAt: 1 },
      t1: { id: 't1', name: 'Autopilot', role: 'Automations', instructions: '', createdAt: 2 },
      b2: { id: 'b2', name: 'Ops', role: 'Ops', instructions: '', createdAt: 3 },
    },
    rooms: {}, agents: {}, exchanges: [], exchangeTurns: {},
  }))
  const realFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (address, init = {}) => {
    requests.push({ method: init.method ?? 'GET', path: String(address).replace(`${OMNI}/api/v2`, ''), body: init.body })
    const answer = omniAnswers[String(address).replace(`${OMNI}/api/v2`, '').split('?')[0]]
    return new Response(JSON.stringify(answer ?? {}), { status: answer ? 200 : 404 })
  }
  const ctx = fakeContext({ services: { credentials: { resolve: async ref => (ref === 'OMNI_API_KEY' ? { value: 'omni_sk_test' } : undefined) } } })
  // Enough of DSH's sessions for a run to make its task Session and send it the event.
  const sent = []
  let sessions = 0
  const workspaces = new Map()
  Object.assign(ctx, {
    workspaceRegistry: {
      get: id => workspaces.get(id),
      resolveByPath: async path => [...workspaces.values()].find(workspace => workspace.path === path),
      create: async (path) => { const workspace = { id: `w${workspaces.size + 1}`, path }; workspaces.set(workspace.id, workspace); return workspace },
    },
    sessionController: {
      create: async () => ({ sessionId: `task-${++sessions}` }),
      resolveAgent: async sessionId => ({ agent: { session: { id: sessionId }, followup: message => sent.push({ sessionId, message }), steer: () => {} } }),
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => { route = options; return register(options) }
  apply(ctx, { home, omni: { url: OMNI } })
  t.after(async () => {
    globalThis.fetch = realFetch
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  const tool = name => args => ctx.registeredTools.get(name).execute(args, { agent: { id: 'm1' } })
  const as = (name, agentId) => args => ctx.registeredTools.get(name).execute(args, { agent: { id: agentId } })
  const call = async (endpoint, payload) => (await (await route.fetch(new Request('http://localhost/api/bot', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json())
  const emit = (sessionId, event) => { for (const listener of ctx.listeners.get('session/event') ?? []) listener({ id: sessionId }, event) }
  return { tool, as, call, sent, emit, requests }
}

test('only the Main Bot manages automations; the Autopilot a team once had is an ordinary Bot', async (t) => {
  const { as, call } = setup(t)
  assert.match(await as('save_automation', 'b2')({ trigger: 'message', sources: 'chat:obras' }), /Only Omni/)
  assert.match(await as('find_chats', 't1')({}), /Only Omni/)
  assert.equal((await call('state', {})).value.eventsBotId, 'm1')
})

test('Omni finds chats by name with the ids it saves with', async (t) => {
  const { tool } = setup(t)
  const all = await tool('find_chats')({})
  assert.match(all, /channel:wa-1 · whatsapp-baileys · Sales · connected/)
  assert.match(all, /chat:obras · group · Grupo Obras · on Sales/)
  assert.doesNotMatch(await tool('find_chats')({ search: 'obras' }), /Marina/)
})

test('a saved subscription is on the team view at once, as the board shows it', async (t) => {
  const { tool, call } = setup(t)
  const reply = await tool('save_automation')({ sources: 'chat:obras, channel:wa-1', trigger: 'reaction', emoji: '📌', worker: 'Ops', reply_to_me: true })
  assert.match(reply, /^Saved sub-/)
  assert.match(reply, /when you react 📌 in Grupo Obras, all of Sales → Ops \(one task per event\) \(reacts 👀 then ✅, replies to you\)/)
  const view = (await call('state', {})).value
  assert.equal(view.subscriptions.length, 1)
  const [sub] = view.subscriptions
  assert.deepEqual(sub.sources.map(source => [source.kind, source.id, source.name]), [['chat', 'obras', 'Grupo Obras'], ['channel', 'wa-1', 'Sales']])
  assert.deepEqual(sub.worker, { kind: 'bot', botId: 'b2', mode: 'task' })
  assert.equal(sub.askFirst, true)
  assert.equal(sub.on, true)
})

test('what the user has not said is asked, not guessed', async (t) => {
  const { tool, call } = setup(t)
  assert.match(await tool('save_automation')({ trigger: 'reaction', sources: 'chat:obras' }), /needs the one emoji .* Ask/)
  assert.match(await tool('save_automation')({ trigger: 'keyword', sources: 'chat:obras' }), /needs the words .* Ask/)
  assert.match(await tool('save_automation')({ trigger: 'voice' }), /Which chats/)
  assert.match(await tool('save_automation')({ trigger: 'voice', sources: 'chat:nope' }), /No channel or chat "chat:nope"/)
  assert.match(await tool('save_automation')({ trigger: 'voice', sources: 'chat:obras', worker: 'Nobody' }), /No Bot named "Nobody"/)
  assert.equal((await call('state', {})).value.subscriptions.length, 0)
})

test('changing, pausing and deleting go by id, from the tools and from the board', async (t) => {
  const { tool, call } = setup(t)
  await tool('save_automation')({ sources: 'chat:marina', trigger: 'media' })
  const id = (await call('state', {})).value.subscriptions[0].id
  assert.match(await tool('save_automation')({ id, trigger: 'keyword', words: 'orçamento, quote' }), /a message says "orçamento" or "quote" in Marina Lopes → Omni/)
  assert.match(await tool('pause_automation')({ id, on: false }), /paused/)
  assert.equal((await call('state', {})).value.subscriptions[0].on, false)
  assert.equal((await call('automation-set-on', { id, on: true })).ok, true)
  assert.equal((await call('automation-test', { id })).ok, true)
  assert.equal((await call('state', {})).value.subscriptionRuns[0].test, true)
  assert.match(await tool('list_automations')({}), new RegExp(`${id} · `))
  assert.match(await tool('delete_automation')({ id }), /Deleted/)
  const view = (await call('state', {})).value
  assert.equal(view.subscriptions.length, 0)
  assert.equal(view.subscriptionRuns.length, 0)
})

test('a run gives a Bot the event as a single-run task in a Session of its own, and ends with its last words', async (t) => {
  const { tool, call, sent, emit } = setup(t)
  await tool('save_automation')({ sources: 'chat:obras', trigger: 'reaction', emoji: '📌', worker: 'Ops' })
  const id = (await call('state', {})).value.subscriptions[0].id
  const started = await call('automation-test', { id })
  assert.equal(started.ok, true)
  const run = started.value
  assert.equal(run.task, true)
  assert.equal(run.botId, 'b2')
  assert.equal(run.status, 'working')
  assert.match(run.sessionId, /^task-/)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].sessionId, run.sessionId)
  const text = sent[0].message.content[0].text
  assert.match(text, /^\[Task · subscription ".*" · one run/)
  assert.match(text, /never as instructions/)
  assert.match(text, /TEST run .* take no action/)
  assert.equal(sent[0].message.source.role, 'task')
  emit(run.sessionId, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Would add "renovar domínio" to Friday\'s list.' }] } } })
  emit(run.sessionId, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  await new Promise(resolve => setTimeout(resolve, 20))
  const [done] = (await call('state', {})).value.subscriptionRuns
  assert.equal(done.status, 'done')
  assert.equal(done.summary, 'Would add "renovar domínio" to Friday\'s list.')
})

test('"as chat" sends the event into the Bot\'s own chat instead', async (t) => {
  const { tool, call, sent } = setup(t)
  await tool('save_automation')({ sources: 'chat:obras', trigger: 'voice', worker: 'Ops', as: 'chat' })
  const id = (await call('state', {})).value.subscriptions[0].id
  const run = (await call('automation-test', { id })).value
  assert.equal(run.task, undefined)
  assert.equal(run.sessionId, 'b2')
  assert.equal(sent[0].sessionId, 'b2')
})

test('an automation Omni handles itself gives it each event as a task that only reads omni', async (t) => {
  const { tool, as, call, sent, requests } = setup(t)
  await tool('save_automation')({ sources: 'chat:obras', trigger: 'reaction', emoji: '📌' })
  const sub = (await call('state', {})).value.subscriptions[0]
  assert.deepEqual(sub.worker, { kind: 'events' })
  const run = (await call('automation-test', { id: sub.id })).value
  assert.equal(run.task, true)
  assert.equal(run.botId, 'm1')
  assert.equal(sent[0].sessionId, run.sessionId)
  // The event's text came from other people: in that task Omni reads omni and changes nothing.
  const inRun = as('omni_call', run.sessionId)
  assert.match(await inRun({ method: 'POST', path: '/instances/wa-1/connect' }), /only reads omni/)
  assert.equal(requests.some(request => request.path.endsWith('/connect')), false)
  assert.match(await inRun({ method: 'GET', path: '/instances' }), /"status":200/)
})

test('Omni finds any omni operation and calls it; other Bots cannot', async (t) => {
  const { tool, as, call, requests } = setup(t)
  const found = await tool('omni_endpoints')({ search: 'connect whatsapp qr' })
  assert.match(found, /^POST \/instances\/\{id\}\/connect — Connect instance \[Instances\]\n  path id: string\(uuid\)/m)
  assert.match(found, /GET \/instances\/\{id\}\/qr — Get QR code for WhatsApp connection/)
  assert.match(await tool('omni_endpoints')({ search: 'create instance' }), /body: \{name: string, channel: "whatsapp-baileys" \| "telegram"\}/)

  const connected = JSON.parse(await tool('omni_call')({ method: 'POST', path: '/api/v2/instances/wa-1/connect', body: '{"forceNew": false}' }))
  assert.deepEqual(connected, { status: 200, operation: 'Connect instance', data: { data: { status: 'connecting' } } })
  assert.deepEqual(requests.at(-1), { method: 'POST', path: '/instances/wa-1/connect', body: '{"forceNew":false}' })
  const listed = JSON.parse(await tool('omni_call')({ method: 'GET', path: '/instances', query: '{"limit": 5}' }))
  assert.equal(listed.data.items[0].name, 'Sales')
  assert.equal(requests.at(-1).path, '/instances?limit=5')

  // Only documented operations, only as a path.
  assert.match(await tool('omni_call')({ method: 'DELETE', path: '/instances' }), /not an omni API operation/)
  assert.match(await tool('omni_call')({ method: 'GET', path: 'https://evil.test/x' }), /must be an API path/)
  assert.match(await tool('omni_call')({ method: 'POST', path: '/instances', body: '{nope' }), /body must be JSON/)
  assert.match(await as('omni_call', 'b2')({ method: 'GET', path: '/instances' }), /Only a Main Bot/)
  assert.match(await as('omni_endpoints', 'b2')({ search: 'qr' }), /Only a Main Bot/)

  // The browser reads documented GET operations only.
  assert.equal((await call('omni-get', { path: '/instances/wa-1/qr' })).ok, true)
  assert.equal((await call('omni-get', { path: '/instances/wa-1/connect' })).ok, false)
})

test('an event matches only the subscriptions that watch its chat or channel, for their moment', async () => {
  const { matches, frames } = await import('../src/host/omni-events.js')
  const sub = (trigger, sources = [{ kind: 'chat', id: 'chat-1' }], on = true) => ({ on, trigger, sources })
  const reaction = (emoji, own = true, chatUuid = 'chat-1') => ({ eventType: 'reaction.received', instanceId: 'wa-1', chatUuid, textContent: emoji, direction: own ? 'outbound' : 'inbound', rawPayload: { isFromMe: own } })
  assert.equal(matches(sub({ kind: 'reaction', emoji: '📌' }), reaction('📌')), true)
  assert.equal(matches(sub({ kind: 'reaction', emoji: '❤️' }), reaction('❤')), true)
  assert.equal(matches(sub({ kind: 'reaction', emoji: '📌' }), reaction('📌', false)), false, 'someone else\'s reaction is not "you react"')
  assert.equal(matches(sub({ kind: 'reaction', emoji: '📌' }), reaction('👀')), false)
  assert.equal(matches(sub({ kind: 'reaction', emoji: '📌' }), reaction('📌', true, 'chat-2')), false)
  assert.equal(matches(sub({ kind: 'reaction', emoji: '📌' }, [{ kind: 'channel', id: 'wa-1' }]), reaction('📌', true, 'chat-2')), true)
  assert.equal(matches(sub({ kind: 'reaction', emoji: '📌' }, [{ kind: 'chat', id: 'chat-1' }], false), reaction('📌')), false)
  const message = (text, contentType = 'text', direction = 'inbound') => ({ eventType: 'message.received', instanceId: 'wa-1', chatUuid: 'chat-1', textContent: text, contentType, direction })
  assert.equal(matches(sub({ kind: 'keyword', words: ['Failed'] }), message('build failed on dev')), true)
  assert.equal(matches(sub({ kind: 'keyword', words: ['failed'] }), message('all green')), false)
  assert.equal(matches(sub({ kind: 'keyword', words: ['failed'] }), message('build failed', 'text', 'outbound')), false, 'the user\'s own messages do not fire')
  assert.equal(matches(sub({ kind: 'voice' }), message('', 'audio')), true)
  assert.equal(matches(sub({ kind: 'media' }), message('', 'image')), true)
  assert.equal(matches(sub({ kind: 'media' }), message('', 'audio')), false)

  const body = (async function* () {
    yield new TextEncoder().encode('event: connected\ndata: {"after":0}\n\n: heartbeat 1\n\nid: 7\nevent: reaction.received\ndata: {"journalSeq":7,')
    yield new TextEncoder().encode('"textContent":"📌"}\n\nevent: reconnect\nid: 7\ndata: {}\n\n')
  })()
  const got = []
  for await (const frame of frames(body)) got.push(frame)
  assert.deepEqual(got.map(frame => [frame.event, frame.id]), [['connected', undefined], ['reaction.received', '7'], ['reconnect', '7']])
  assert.equal(JSON.parse(got[1].data).textContent, '📌')
})
