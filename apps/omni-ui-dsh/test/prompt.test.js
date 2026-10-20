import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/prompt.js'
import { fakeContext } from './fake-ctx.js'

function start(config = {}) {
  const ctx = fakeContext()
  const bots = new Map([
    ['main', { name: 'Omni' }],
    ['worker', { name: 'Dev', instructions: 'Check files.' }],
  ])
  install({
    ctx,
    selfOf: id => id === 'group-worker' ? 'worker' : id,
    botOf: id => bots.get(id),
    roomOf: id => id === 'room' ? {} : undefined,
    isMain: id => id === 'main',
    config,
  })
  const prompt = id => ctx.sections.get('bot-identity').text({ agent: { id } })
  return { ctx, prompt }
}

test('Bots get a scoped progress rule without changing the private/group prompt prefix', (t) => {
  const { ctx, prompt } = start()
  t.after(() => ctx.dispose())
  const rules = [
    '- Only for a direct user request in your own chat that needs several steps: write one short sentence of normal reply text before your first tool call, and make that tool call in the same response. Never start such a task with tools alone or end it with a promise. On long tasks, give brief factual updates only at meaningful milestones, then keep working.',
    '- For "[Message from …]" or "[Reply from …]" messages, do not write plans or progress updates: use tools silently, then reply with the answer. Simple answers do not need progress messages.',
    '- In a group chat, the group sees what you write while you work, not only your final reply. For work that takes more than a quick look, start with one short sentence on what you will do, in the same response as your first tool call. After that, write only when you find something the group should know or finish a part of the work, in a sentence or two, not at every step. End with the result. Simple answers need no updates.',
  ]
  for (const id of ['main', 'worker']) {
    for (const rule of rules) {
      assert.ok(prompt(id).split('\n').includes(rule))
      assert.equal(prompt(id).split(rule).length - 1, 1)
    }
  }
  assert.equal(prompt('group-worker'), prompt('worker'))
})

test('the group relay and non-Bot sessions do not get progress instructions', (t) => {
  const { ctx, prompt } = start()
  t.after(() => ctx.dispose())
  assert.match(prompt('room'), /end your turn with an empty reply/)
  assert.doesNotMatch(prompt('room'), /progress|milestone/)
  assert.equal(prompt('outside'), '')
})

test('with an omni to operate, the Main Bot alone learns the API tools, automations and canvases', (t) => {
  const { ctx, prompt } = start({ omni: { url: 'https://omni.example.com' } })
  t.after(() => ctx.dispose())
  const main = prompt('main')
  for (const part of ['## You operate Omni for the user', 'omni_endpoints', 'omni_call', '## Automations', 'save_automation', 'show_canvas', 'start_task', 'You have no shell', 'QrCode(channelId: string)', 'Query("omni_chats"', 'omni_get(path: string']) assert.ok(main.includes(part), part)
  // The canvas language is generated from the components the client renders, without the
  // OpenUI features a canvas does not have.
  assert.ok(!/Mutation\(\)(?! is not available)/.test(main))
  assert.ok(!main.includes('FormControl'))
  const worker = prompt('worker')
  for (const part of ['omni_call', 'openui-lang', 'save_automation', 'start_task']) assert.ok(!worker.includes(part), part)
  // Without an omni, the Main Bot's prompt has none of it.
  const plain = start()
  t.after(() => plain.ctx.dispose())
  assert.ok(!plain.prompt('main').includes('omni_call'))
})
