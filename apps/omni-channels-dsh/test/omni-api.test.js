import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitted, operationsOf, search, shapeOf } from '../src/host/omni-api.js'

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
