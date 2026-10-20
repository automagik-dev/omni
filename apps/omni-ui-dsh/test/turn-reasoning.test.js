import test from 'node:test'
import assert from 'node:assert/strict'
import { turnReasoning } from '../src/client/turn-reasoning.js'

const step = (n, blocks, status = 'settled') => ({ turn: 1, step: n, status, blocks })
const think = text => ({ kind: 'reasoning', text })
const tool = { kind: 'tool-call', name: 'read' }

test('a long tool Turn shows its reasoning once, on the first step, in order', () => {
  const steps = Array.from({ length: 24 }, (_, i) => step(i + 1, [think(`Reasoning ${i + 1}`), tool]))
  const shown = steps.map(current => turnReasoning(steps, current))
  assert.equal(shown.filter(Boolean).length, 1)
  assert.equal(shown[0], steps.map((_, i) => `Reasoning ${i + 1}`).join('\n\n'))
})

test('the row sits on the first step with reasoning', () => {
  const steps = [step(1, [{ kind: 'text', text: 'Looking' }, tool]), step(2, [think('B'), tool]), step(3, [think('C'), { kind: 'text', text: 'Done' }])]
  assert.deepEqual(steps.map(current => turnReasoning(steps, current)), ['', 'B\n\nC', ''])
})

test('reasoning still in progress stays out until its step settles', () => {
  const steps = [step(1, [think('A'), tool]), step(2, [think('B')], 'running')]
  assert.equal(turnReasoning(steps, steps[0]), 'A')
  assert.equal(turnReasoning([step(1, [think('A')], 'running')], step(1, [think('A')], 'running')), '')
  steps[1].blocks.push({ kind: 'text', text: 'Reply' })
  assert.equal(turnReasoning(steps, steps[0]), 'A\n\nB')
})

test('a step outside the loaded Turn list shows only its own reasoning', () => {
  const current = step(1, [think(' A ')])
  assert.equal(turnReasoning([], current), 'A')
})
