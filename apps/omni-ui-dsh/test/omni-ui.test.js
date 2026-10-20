import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasCanvas, splitCanvases } from '../src/client/canvas-text.js'
import { fitted, operationsOf, search, shapeOf } from '../src/host/omni-api.js'

test('a reply splits into its text and its canvases, in order; one still streaming is incomplete', () => {
  const program = 'root = Stack([a])\na = Text("hi")\n'
  const reply = `Here it is.\n\n\`\`\`openui-lang\n${program}\`\`\`\n\nAnything else?`
  assert.equal(hasCanvas(reply), true)
  assert.equal(hasCanvas('```js\nx\n```'), false)
  assert.deepEqual(splitCanvases(reply), [
    { kind: 'text', text: 'Here it is.\n\n' },
    { kind: 'canvas', program, complete: true },
    { kind: 'text', text: '\n\nAnything else?' },
  ])
  assert.deepEqual(splitCanvases('Drawing:\n```openui-lang\nroot = Stack(['), [
    { kind: 'text', text: 'Drawing:\n' },
    { kind: 'canvas', program: 'root = Stack([', complete: false },
  ])
  // Every line of a long canvas stays.
  const long = Array.from({ length: 60 }, (_, index) => `t${index} = Text("${index}")`).join('\n')
  assert.equal(splitCanvases(`\`\`\`openui-lang\n${long}\n\`\`\``)[0].program, `${long}\n`)
})

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

test('a canvas is checked the same way on both sides; a refusal says what to fix', async () => {
  const { checkProgram, refusalText, unclosedLine } = await import('../src/host/omni-ui-check.bundle.js')
  assert.equal(checkProgram('root = Stack([a])\na = Text("hi")'), null)
  // Extra arguments are dropped, not fatal.
  assert.equal(checkProgram('root = Stack([r])\nr = Row([Text("a")], "m")'), null)
  const broken = checkProgram('root = Stack([t])\nt = Card("x", [KeyValue([{label: "a", value: "b"}), Row([])])')
  assert.equal(refusalText(broken), 'Line 2 does not close its brackets or quotes: t = Card("x", [KeyValue([{label: "a", value: "b"}), Row([])]')
  assert.equal(refusalText(checkProgram('root = Stack([m])\nm = Mutation("omni_get", {})')), 'A canvas cannot change omni; ask Omni instead.')
  assert.equal(refusalText(checkProgram('root = Stack([x])\nx = Iframe("https://evil.test")')), 'Unknown component Iframe.')
  assert.equal(refusalText(checkProgram('root = Stack([q])\nq = Query("send_message", {}, {})')), 'A canvas can only read omni.')
  assert.equal(unclosedLine('a = Text("a (b")'), null, 'brackets inside strings do not count')
})

test('every example Omni is taught passes the canvas check', async () => {
  const { checkProgram, refusalText } = await import('../src/host/omni-ui-check.bundle.js')
  const { OMNI_UI_PROMPT } = await import('../src/host/omni-ui-prompt.js')
  const examples = OMNI_UI_PROMPT.split('## Examples')[1].split('\n## ')[0].trim().split(/\n\s*\n/).map(block => block.trim()).filter(block => block.startsWith('root ='))
  assert.ok(examples.length >= 2)
  for (const example of examples) assert.equal(checkProgram(example) && refusalText(checkProgram(example)), null, example)
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
