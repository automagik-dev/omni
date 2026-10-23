import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { install as installHooks } from '../src/host/extend.js'
import { install } from '../src/host/prompt.js'
import { fakeContext } from './fake-ctx.js'

const BOTS = [
  ['main', { name: 'Omni' }],
  ['worker', { name: 'Dev', instructions: 'Check files.' }],
]

// The prompt section and the hooks other Omni plugins add the Main Bot's rules through.
function start(config = {}, bots = new Map(BOTS)) {
  const ctx = fakeContext()
  const rt = {
    ctx,
    selfOf: id => id === 'group-worker' ? 'worker' : id,
    botOf: id => bots.get(id),
    roomOf: id => id === 'room' ? {} : undefined,
    isMain: id => id === 'main',
    config,
  }
  installHooks(rt)
  install(rt)
  const prompt = id => ctx.sections.get('bot-identity').text({ agent: { id } })
  return { ctx, rt, prompt }
}

// Written by the prompt before its Omni parts moved out of prompt.js, which joined them
// into one list. The hooks must give a Main Bot the very same text, byte for byte, or its
// provider's prompt cache starts over. main-prompt-omni.txt is the same Main Bot with an
// Omni named; the channels and canvas plugins check it with their parts added.
test('a Main Bot\'s prompt is the text it was before the Omni parts moved out', (t) => {
  const fixture = name => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')
  const plain = start({}, new Map([['main', { name: 'Omni', role: 'Channel orchestrator', instructions: 'Keep it short.' }]]))
  t.after(() => plain.ctx.dispose())
  assert.equal(plain.prompt('main'), fixture('main-prompt.txt'))
})

test('the parts other Omni plugins add go between the Main Bot\'s rules and the team\'s, for Main Bots only', (t) => {
  const { ctx, rt, prompt } = start()
  t.after(() => ctx.dispose())
  const before = prompt('main')
  const off = rt.hooks.mainRules(self => `## Part for ${self}`, { order: 100 })
  const main = prompt('main')
  assert.ok(main.includes('\n\n## Part for main\n\n## How your Bot team works'))
  assert.ok(main.indexOf('## You are the Main Bot') < main.indexOf('## Part for main'))
  assert.ok(!prompt('worker').includes('## Part for'))
  off()
  assert.equal(prompt('main'), before)
})

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
