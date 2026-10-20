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
