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
