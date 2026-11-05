import assert from 'node:assert/strict'
import { test } from 'node:test'

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
