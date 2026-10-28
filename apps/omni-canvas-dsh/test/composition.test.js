import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { TEAM_TOOLS } from '@automagik/bots-dsh/src/host/constants.js'
import { OPERATOR_RULES } from '@automagik/omni-channels-dsh/src/host/omni-rules.js'
import { THREAD_TOOLS } from '@automagik/omni-channels-dsh/src/host/threads.js'
import * as plugin from '../index.js'
import { applyAll, composed, fakeContext, teamFile } from './team.js'

const TEAM = {
  version: 1, mainBotIds: ['m1'], revision: 1, rooms: {}, exchanges: [], exchangeTurns: {},
  bots: {
    m1: { id: 'm1', name: 'Omni', role: 'Channel orchestrator', instructions: 'Keep it short.', createdAt: 1 },
    w1: { id: 'w1', name: 'Dev', role: '', instructions: 'Check files.', createdAt: 2 },
  },
}
const prompt = (run, id) => run.ctx.sections.get('bot-identity').text({ agent: { id } })

test('the plugin is the omni-canvas row, on the team and its channels', () => {
  assert.equal(plugin.name, 'omni-canvas')
  assert.deepEqual(plugin.inject, ['omniTeam', 'omniChannels', 'tools'])
})

// Omni's rules as the team's fixture has them, from their heading to their last line.
const RULES_START = '## You operate Omni for the user'
const RULES_END = 'A task for an event only reads omni.'
const rulesIn = text => text.slice(text.indexOf(RULES_START), text.indexOf(RULES_END) + RULES_END.length)

// Written by the team's prompt before its Omni parts moved out (the team keeps the
// fixture). With the channels plugin and this one, a Main Bot's prompt is that text, byte
// for byte, or its provider's prompt cache starts over; only Omni's rules are as the channels
// plugin has them now, where the lines that named Tasks say where the work runs instead.
test('with all three plugins, a Main Bot\'s prompt is the text it was before the split, with Omni\'s rules as they are now', async (t) => {
  const named = composed(TEAM, { channelsConfig: { omni: { url: 'https://omni.example.com' } } })
  const older = composed(TEAM, { config: { omni: { url: 'https://omni.example.com' } } })
  const plain = composed(TEAM)
  t.after(() => Promise.all([named.stop(), older.stop(), plain.stop()]))
  await Promise.all([named.team.load(), older.team.load(), plain.team.load()])
  const fixture = name => readFileSync(teamFile(`test/fixtures/${name}`), 'utf8')
  const omni = fixture('main-prompt-omni.txt')
  const now = omni.replace(rulesIn(omni), OPERATOR_RULES)
  assert.notEqual(now, omni)
  assert.equal(prompt(named, 'm1'), now)
  // An Omni named the older way, on the team's row, counts the same.
  assert.equal(prompt(older, 'm1'), now)
  assert.equal(prompt(plain, 'm1'), fixture('main-prompt.txt'))
})

test('with an omni to operate, the Main Bot alone learns the canvas language', async (t) => {
  const named = composed(TEAM, { channelsConfig: { omni: { url: 'https://omni.example.com' } } })
  const plain = composed(TEAM)
  t.after(() => Promise.all([named.stop(), plain.stop()]))
  await Promise.all([named.team.load(), plain.team.load()])
  const main = prompt(named, 'm1')
  for (const part of ['## Showing things: canvases', 'show_canvas', 'QrCode(channelId: string)', 'Query("omni_chats"', 'omni_get(path: string']) assert.ok(main.includes(part), part)
  // The canvas language is generated from the components the client renders, without the
  // OpenUI features a canvas does not have.
  assert.ok(!/Mutation\(\)(?! is not available)/.test(main))
  assert.ok(!main.includes('FormControl'))
  assert.ok(!prompt(named, 'w1').includes('openui-lang'))
  assert.ok(!prompt(plain, 'm1').includes('show_canvas'))
})

test('show_canvas shows only canvases that pass, and only for a Main Bot', async (t) => {
  const run = composed(TEAM)
  t.after(run.stop)
  const tool = run.ctx.registeredTools.get('show_canvas')
  const as = id => args => tool.execute(args, { agent: { id } })
  assert.equal(await as('m1')({ program: 'root = Stack([a])\na = Text("hi")' }), 'Shown.')
  assert.match(await as('m1')({ program: 'root = Stack([a])\na = Text("hi"' }), /^Not shown: Line 2 does not close its brackets .* call show_canvas again\.$/)
  assert.match(await as('w1')({ program: 'root = Stack([a])\na = Text("hi")' }), /Only a Main Bot/)
})

// Enough of DSH's services for the team to make its Main Bot.
function services(ctx) {
  Object.assign(ctx, {
    llm: { listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }], listModels: async () => [{ id: 'deepseek-v4-flash' }], resolveModelInfo: async () => ({}) },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async path => ({ id: 'w1', path }), archiveSession: async () => {} },
    sessionController: { create: async () => ({ sessionId: 's1' }), resolveAgent: async sessionId => ({ agent: { session: { id: sessionId }, followup() {} } }), selectModel: async () => {} },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  return ctx
}

// The channels plugin's own tools, the chat threads' (THREAD_TOOLS), come on top.
test('with all three plugins, the team registers exactly the tools TEAM_TOOLS names, plus the channels plugin\'s own', async (t) => {
  const ctx = services(fakeContext())
  const home = mkdtempSync(join(tmpdir(), 'omni-canvas-all-'))
  applyAll(ctx, { home, browser: true })
  t.after(async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) })
  assert.deepEqual([...ctx.registeredTools.keys()].sort(), [...TEAM_TOOLS, ...THREAD_TOOLS].sort())
  // This plugin's own come last, and it adds no llm/stream listener.
  const own = ctx.calls.slice(ctx.calls.indexOf('provide omniChannels') + 1)
  assert.deepEqual(own, ['effect ds-bot: canvas rules', 'tool show_canvas'])
})
