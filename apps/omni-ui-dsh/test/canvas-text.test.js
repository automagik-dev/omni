import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasCanvas, splitCanvases } from '../src/client/canvas-text.js'

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
