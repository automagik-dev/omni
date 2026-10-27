import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { KEY_ROUTE_REFUSAL, fitted, isKeyRoute, operationsOf, search, shapeOf } from '../src/host/omni-api.js'
import { applyBoth, fakeContext } from './team.js'

test('omni operations come from its OpenAPI description, found by words, with readable shapes', () => {
  const ops = operationsOf({ paths: {
    '/instances/{id}/qr': { get: { summary: 'Get QR code', tags: ['Instances'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }] } },
    '/messages/send': { post: { summary: 'Send a message', requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['to'], properties: { to: { type: 'string' }, text: { type: 'string' }, kind: { enum: ['text', 'image'] }, tags: { type: 'array', items: { type: 'string' } } } } } } } } },
  } })
  assert.equal(ops.length, 2)
  assert.equal(ops[0].pattern.test('/instances/5f0c/qr'), true)
  assert.equal(ops[0].pattern.test('/instances/5f0c/qr/x'), false)
  assert.equal(ops[1].body, '{to: string, text?: string, kind?: "text" | "image", tags?: string[]}')
  assert.equal(shapeOf({ anyOf: [{ type: 'string' }, { type: 'null' }] }), 'string | null')
  assert.deepEqual(search(ops, 'send message').map(op => op.path), ['/messages/send'])
  assert.deepEqual(search(ops, 'qr').map(op => op.path), ['/instances/{id}/qr'])
})

test('a large answer keeps its shape: its lists are shortened until it fits', () => {
  const items = Array.from({ length: 500 }, (_, index) => ({ id: index, name: `chat ${index}`, note: 'x'.repeat(50) }))
  const text = fitted({ status: 200, data: { items, meta: { total: 500 } } }, 4000)
  assert.ok(text.length <= 4000)
  const value = JSON.parse(text)
  assert.equal(value.status, 200)
  assert.equal(value.data.meta.total, 500)
  assert.ok(value.data.items.length > 0 && value.data.items.length < 500)
  assert.match(value._cut, /shortened/)
  assert.equal(fitted({ status: 200, data: { ok: true } }), '{"status":200,"data":{"ok":true}}')
})

test('routes omni declares but leaves out of its API description are found and callable too', async () => {
  const { withSourceRoutes, search, findOperation } = await import('../src/host/omni-api.js')
  const { SOURCE_ROUTES } = await import('../src/host/omni-routes.js')
  // The committed index is this repository's API: chats and sending are in it.
  const sent = SOURCE_ROUTES.find(route => route.method === 'POST' && route.path === '/messages/send')
  assert.match(sent.body, /instanceId: z\.string\(\)\.uuid\(\)/)
  assert.match(SOURCE_ROUTES.find(route => route.method === 'GET' && route.path === '/chats').query, /unreadOnly/)
  assert.ok(!SOURCE_ROUTES.some(route => route.path === '/' || /^\/\{\w+\}(\/|$)/.test(route.path)), 'no root catch-alls')
  const documented = [{ method: 'GET', path: '/chats/{id}', pattern: /^\/chats\/[^/]+$/, summary: 'Get chat (documented)', params: [], body: null }]
  const ops = withSourceRoutes(documented, [
    { method: 'GET', path: '/chats/{id}', summary: 'Get chat by ID', tag: 'chats' },
    { method: 'GET', path: '/chats', summary: 'List chats', tag: 'chats', query: 'z.object({ unreadOnly: z.coerce.boolean().optional() })' },
    { method: 'POST', path: '/messages/send', summary: '', tag: 'messages' },
  ])
  assert.deepEqual(ops.map(op => [op.method, op.path, op.summary, op.undocumented === true]), [
    ['GET', '/chats/{id}', 'Get chat (documented)', false],
    ['GET', '/chats', 'List chats', true],
    ['POST', '/messages/send', 'messages · send', true],
  ])
  assert.equal(findOperation(ops, 'POST', '/messages/send').summary, 'messages · send')
  assert.equal(search(ops, 'unread chats')[0].path, '/chats')
})

test('routes of a router mounted at the root keep their own full path', async () => {
  const { SOURCE_ROUTES } = await import('../src/host/omni-routes.js')
  assert.ok(SOURCE_ROUTES.some(route => route.method === 'GET' && route.path === '/events/consumers'))
  assert.ok(!SOURCE_ROUTES.some(route => route.path.startsWith('//')))
})

// Chat keys (wish: omni-chat-threads, criterion :196): their answers carry key text, so no
// Bot reaches them. A fake omni that documents them, and answers them with a key.
const OMNI = 'https://omni.test'
const HOST_KEY = 'omni_sk_host_test'
const CHILD_KEY = 'omni_sk_child_test'
const KEY_PATHS = {
  '/keys/children': { post: { summary: 'Mint a chat key', tags: ['Keys'], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { chatId: { type: 'string' } } } } } } } },
  '/keys/children/self/revoke': { post: { summary: 'A chat key revokes itself', tags: ['Keys'] } },
  '/keys/children/{id}/revoke': { post: { summary: 'Revoke one of your chat keys', tags: ['Keys'] } },
}

function keyBench(t) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-keys-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({
    version: 1, mainBotIds: ['m1'], revision: 1,
    bots: { m1: { id: 'm1', name: 'Omni', role: 'Orchestrator', instructions: '', createdAt: 1 } },
    rooms: {}, agents: {}, exchanges: [], exchangeTurns: {},
  }))
  const realFetch = globalThis.fetch
  const requests = []
  const answers = {
    '/openapi.json': { paths: { '/instances': { get: { summary: 'List instances', tags: ['Instances'] } }, ...KEY_PATHS } },
    '/instances': { items: [] },
    '/keys/children': { data: { id: 'c1', plainTextKey: CHILD_KEY } },
  }
  globalThis.fetch = async (address, init = {}) => {
    const path = String(address).replace(`${OMNI}/api/v2`, '')
    requests.push({ method: init.method ?? 'GET', path })
    const answer = answers[path.split('?')[0]]
    return new Response(JSON.stringify(answer ?? {}), { status: answer ? 200 : 404 })
  }
  const ctx = fakeContext({ services: { credentials: { resolve: async ref => (ref === 'OMNI_API_KEY' ? { value: HOST_KEY } : undefined) } } })
  applyBoth(ctx, { home, omni: { url: OMNI } })
  t.after(async () => {
    globalThis.fetch = realFetch
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  const tool = name => args => ctx.registeredTools.get(name).execute(args, { agent: { id: 'm1' } })
  return { tool, requests }
}

const noKeyText = (text) => {
  for (const key of [HOST_KEY, CHILD_KEY]) assert.ok(!String(text).includes(key), 'no key text in a tool result')
}

test('omni_call refuses each chat-key route before any request, however the path is written', async (t) => {
  const { tool, requests } = keyBench(t)
  for (const path of [
    '/keys/children',
    '/keys/children/self/revoke',
    '/keys/children/c1/revoke',
    '/api/v2/keys/children',
    '/keys//children',
    '/keys/%63hildren/self/revoke',
    '/keys/./children',
    '/instances/../keys/children',
    '/keys/%2e/children/self/revoke',
  ]) {
    const answer = await tool('omni_call')({ method: 'POST', path, body: JSON.stringify({ chatId: 'c1' }) })
    assert.deepEqual(JSON.parse(answer), { status: 0, error: KEY_ROUTE_REFUSAL }, path)
    noKeyText(answer)
  }
  // Refused before omni_call reads the API description, and before any key route: the only
  // request so far is the host's own start-up housekeeping, if any.
  assert.deepEqual(requests.filter(request => isKeyRoute(request.path) || request.path === '/openapi.json'), [])
  // Other routes still go through, and /keys/childrenX is not a chat-key route.
  assert.equal(JSON.parse(await tool('omni_call')({ method: 'GET', path: '/instances' })).status, 200)
  assert.equal(isKeyRoute('/keys/childrenX'), false)
  assert.equal(isKeyRoute('/keys/c1/revoke'), false)
})

test('omni_endpoints never lists a chat-key route, whatever it is asked', async (t) => {
  const { tool } = keyBench(t)
  for (const words of ['keys children', 'mint chat key', 'revoke chat key self', 'keys']) {
    const found = await tool('omni_endpoints')({ search: words })
    assert.ok(!/\/keys\/children/.test(found), words)
    noKeyText(found)
  }
  assert.match(await tool('omni_endpoints')({ search: 'list instances' }), /GET \/instances/)
})

test('the committed route index has the chat-key routes, and the tools still leave them out', async () => {
  const { SOURCE_ROUTES } = await import('../src/host/omni-routes.js')
  const keyRoutes = SOURCE_ROUTES.filter(route => isKeyRoute(route.path)).map(route => `${route.method} ${route.path}`).sort()
  assert.deepEqual(keyRoutes, ['POST /keys/children', 'POST /keys/children/self/revoke', 'POST /keys/children/{id}/revoke'])
})
