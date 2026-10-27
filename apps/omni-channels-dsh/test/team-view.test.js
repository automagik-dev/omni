import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { TEAM_TOOLS } from '@automagik/bots-dsh/src/host/constants.js'
import * as plugin from '../index.js'
import { THREAD_TOOLS } from '../src/host/threads.js'
import { applyBoth, composed, fakeContext, teamFile } from './team.js'

const settle = () => new Promise(resolve => setTimeout(resolve, 20))

// Both plugins applied on a fake DSH with enough of its services for the team to make its
// Main Bot, and the POST route to call.
function start(team, { models = ['deepseek-v4-flash'], config = {}, channelsConfig = {}, services } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'omni-channels-view-'))
  if (team !== undefined) writeFileSync(join(home, 'state.json'), JSON.stringify(team))
  const ctx = fakeContext({ services })
  const workspaces = new Map()
  let sessions = 0
  Object.assign(ctx, {
    llm: {
      listProviders: () => (models.length > 0 ? [{ id: 'deepseek', name: 'DeepSeek' }] : []),
      listModels: async () => models.map(id => ({ id })),
      resolveModelInfo: async () => ({}),
    },
    workspaceRegistry: {
      get: id => workspaces.get(id),
      resolveByPath: async path => [...workspaces.values()].find(workspace => workspace.path === path),
      create: async (path) => {
        const workspace = { id: `w${workspaces.size + 1}`, path }
        workspaces.set(workspace.id, workspace)
        return workspace
      },
      archiveSession: async () => {},
    },
    sessionController: {
      create: async () => ({ sessionId: `s${++sessions}` }),
      resolveAgent: async sessionId => ({ agent: { session: { id: sessionId }, followup() {} } }),
      selectModel: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => {
    route = options
    return register(options)
  }
  const runtimes = applyBoth(ctx, { home, ...config }, channelsConfig)
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/omni-ui', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { ctx, call, stop, home, ...runtimes }
}

test('the plugin is the omni-channels row, on the team it injects', () => {
  assert.equal(plugin.name, 'omni-channels')
  assert.deepEqual(plugin.inject, ['omniTeam', 'tools', 'sessions', 'settings', 'systemPrompt', 'workspaceRegistry'])
})

test('with an omni to operate, the Main Bot runs the automations and no second Bot is made', async (t) => {
  const { call, stop } = start(undefined, { config: { omni: { url: 'https://omni.test' } } })
  t.after(stop)
  await call('state', {})
  await settle()
  const team = (await call('state', {})).value
  assert.equal(team.bots.length, 1)
  assert.equal(team.eventsBotId, team.mainBotIds[0])
  assert.deepEqual(team.subscriptions, [])
  assert.deepEqual(team.omniEvents, { listening: [] })
})

test('a team made with Autopilot keeps it as an ordinary Bot; the Main Bot runs the automations', async (t) => {
  const { call, stop } = start({
    version: 1, mainBotIds: ['m1'], eventsBotId: 't1', eventsBotStored: true, revision: 1,
    bots: {
      m1: { id: 'm1', name: 'Omni', role: 'Orchestrator', instructions: '', createdAt: 1 },
      t1: { id: 't1', name: 'Autopilot', role: 'Automations', instructions: 'old', createdAt: 2 },
    },
    rooms: {}, agents: {}, exchanges: [], exchangeTurns: {},
  }, { channelsConfig: { omni: { url: 'https://omni.test' } } })
  t.after(stop)
  await call('state', {})
  await settle()
  const team = (await call('state', {})).value
  assert.equal(team.eventsBotId, 'm1')
  // Nothing of the user's is deleted: its chat stays, and the user can delete it.
  assert.equal(team.bots.find(bot => bot.id === 't1').name, 'Autopilot')
})

test('the Omni endpoints are this plugin\'s, served on the team\'s route, and go with it', async (t) => {
  const { call, stop, ctx } = start({ version: 1, mainBotIds: ['m1'], revision: 1, bots: { m1: { id: 'm1', name: 'Omni', role: '', instructions: '', createdAt: 1 } }, rooms: {}, exchanges: [], exchangeTurns: {} })
  t.after(stop)
  // Without an Omni named, the overview says what is missing.
  const overview = await call('omni-overview', {})
  assert.equal(overview.ok, true)
  assert.equal(overview.value.configured, false)
  assert.equal((await call('omni-link', {})).value.linked, false)
  assert.equal((await call('state', {})).value.channelsMoved, false)
  await ctx.dispose()
  assert.equal((await call('omni-overview', {})).error.code, 'bot/not-found')
})

// show_canvas is the canvas plugin's, which checks the whole list. The plugin's own tools,
// the chat threads' (THREAD_TOOLS), come on top.
test('with this plugin, the team registers the tools TEAM_TOOLS names but show_canvas, plus the plugin\'s own', async (t) => {
  const { ctx, stop } = start(undefined, { config: { browser: true } })
  t.after(stop)
  assert.deepEqual([...ctx.registeredTools.keys()].sort(), [...TEAM_TOOLS.filter(name => name !== 'show_canvas'), ...THREAD_TOOLS].sort())
})

// The text a Main Bot's prompt had when the Omni parts were part of the team's prompt.js
// (the team keeps the fixture). With this plugin and an Omni named, it is that text without
// the canvas part, which the canvas plugin adds back in its place (its tests check the whole).
test('a Main Bot\'s prompt with an Omni named is the text it was before the split, but its canvases', async (t) => {
  const team = { version: 1, mainBotIds: ['m1'], revision: 1, bots: { m1: { id: 'm1', name: 'Omni', role: 'Channel orchestrator', instructions: 'Keep it short.', createdAt: 1 } }, rooms: {}, exchanges: [], exchangeTurns: {} }
  const named = composed(team, { channelsConfig: { omni: { url: 'https://omni.example.com' } } })
  const plain = composed(team)
  t.after(() => Promise.all([named.stop(), plain.stop()]))
  await named.team.load()
  await plain.team.load()
  const prompt = run => run.ctx.sections.get('bot-identity').text({ agent: { id: 'm1' } })
  const before = readFileSync(teamFile('test/fixtures/main-prompt-omni.txt'), 'utf8')
  const canvases = before.slice(before.indexOf('\n\n## Showing things: canvases'), before.indexOf('\n\n## How your Bot team works'))
  assert.ok(canvases.length > 1000)
  assert.equal(prompt(named), before.replace(canvases, ''))
  assert.equal(prompt(plain), readFileSync(teamFile('test/fixtures/main-prompt.txt'), 'utf8'))
})

test('with an omni to operate, the Main Bot alone learns the API tools and automations', async (t) => {
  const team = {
    version: 1, mainBotIds: ['m1'], revision: 1, rooms: {}, exchanges: [], exchangeTurns: {},
    bots: { m1: { id: 'm1', name: 'Omni', role: '', instructions: '', createdAt: 1 }, w1: { id: 'w1', name: 'Dev', role: '', instructions: 'Check files.', createdAt: 2 } },
  }
  const named = composed(team, { channelsConfig: { omni: { url: 'https://omni.example.com' } } })
  const plain = composed(team)
  t.after(() => Promise.all([named.stop(), plain.stop()]))
  await Promise.all([named.team.load(), plain.team.load()])
  const prompt = (run, id) => run.ctx.sections.get('bot-identity').text({ agent: { id } })
  const main = prompt(named, 'm1')
  for (const part of ['## You operate Omni for the user', 'omni_endpoints', 'omni_call', '## Automations', 'save_automation', 'start_task', 'You have no shell']) assert.ok(main.includes(part), part)
  // Canvases are the canvas plugin's.
  assert.ok(!main.includes('show_canvas'))
  const worker = prompt(named, 'w1')
  for (const part of ['omni_call', 'openui-lang', 'save_automation', 'start_task']) assert.ok(!worker.includes(part), part)
  // Without an omni, the Main Bot's prompt has none of it.
  assert.ok(!prompt(plain, 'm1').includes('omni_call'))
})

// Listeners run, and tools are listed, in the order they are registered; this plugin's
// come after the team's, and it adds no llm/stream listener, so the team's usage meter
// stays the last one to see each model request.
test('apply registers its listeners, tools and effects after the team\'s, in a fixed order', async (t) => {
  const { ctx, stop } = start()
  t.after(stop)
  const own = ctx.calls.slice(ctx.calls.indexOf('provide omniTeam') + 1)
  assert.deepEqual(own, [
    'on session/event',
    'effect ds-bot: restart resumes',
    'effect ds-bot: interrupted Omni permissions',
    'effect ds-bot: omni-consent-answer',
    'effect ds-bot: omni-grant-revoke',
    'effect ds-bot: omni-grant-approval',
    'effect ds-bot: Omni permissions view',
    'on tools/pre-execute (prepend)',
    'on session/event',
    'effect ds-bot: automations view',
    'effect ds-bot: automation-set-on',
    'effect ds-bot: automation-delete',
    'effect ds-bot: automation-test',
    'tool find_chats',
    'tool list_automations',
    'tool save_automation',
    'tool pause_automation',
    'tool delete_automation',
    'on tools/pre-execute (prepend)',
    'on session/event',
    'on agent/created',
    'tools guard',
    'tool omni_endpoints',
    'tool omni_call',
    'tool omni_channels',
    'tool omni_chats',
    'tool omni_messages',
    'tool omni_send',
    'tool omni_react',
    'tool omni_media',
    'tool omni_delete',
    'tool omni_connect',
    'effect ds-bot: omni-get',
    'effect ds-bot: omni-read',
    "effect omni-channels: offer the linked Omni's market",
    'effect ds-bot: omni-link',
    'effect ds-bot: omni-pair-start',
    'effect ds-bot: omni-pair-poll',
    'effect ds-bot: omni-pair-cancel',
    'effect ds-bot: omni-connect-grant',
    'effect ds-bot: omni-disconnect',
    'effect omni-channels: omni-discover',
    'effect omni-channels: omni-link-info',
    'effect omni-channels: omni-discover-use',
    'effect omni-channels: omni-discover-key',
    'effect omni-channels: omni-local-install',
    'effect omni-channels: omni-local-progress',
    'effect omni-channels: omni-terminal-open',
    'effect omni-channels: omni-terminal-read',
    'effect omni-channels: omni-terminal-write',
    'effect omni-channels: omni-terminal-resize',
    'effect omni-channels: omni-terminal-close',
    'effect omni-channels: close terminals',
    'effect omni-channels: omni-update-status',
    'effect omni-channels: omni-update-request',
    'effect ds-bot: omni-overview',
    'effect ds-bot: omni-messages',
    'effect ds-bot: omni-media',
    'effect ds-bot: operator rules',
    'effect omni-channels: thread keys',
    'on session/event',
    'on approval/request (prepend)',
    'tools guard',
    'effect omni-channels: thread instructions',
    'prompt omni-thread 650',
    'effect omni-channels: threads view',
    'effect omni-channels: omni-thread-chats',
    'effect omni-channels: omni-thread-add',
    'effect omni-channels: omni-thread-remove',
    'tool thread_say',
    'tool thread_react',
    'tool thread_history',
    'tool thread_picture',
    'tool thread_ask_omni',
    'effect omni-channels: asks of removed threads',
    'on tools/pre-execute (prepend)',
    'effect omni-channels: thread tool lists',
    'on agent/created',
    'effect omni-channels: omni-free-reactions',
    'effect omni-channels: omni-free-reactions-save',
    'effect ds-bot: omni events view',
    'effect ds-bot: omni events',
    'effect omni-channels: omni-channel-abilities',
    'effect omni-channels: omni-channel-pairing',
    'effect omni-channels: omni-channel-types',
    'effect omni-channels: omni-slack-app',
    'effect omni-channels: omni-channel-create',
    'effect omni-channels: omni-channel-phone-code',
    'effect omni-channels: omni-channel-cancel',
    'effect omni-channels: omni-channel-act',
    'effect omni-channels: omni-send',
    'effect omni-channels: omni-slack-start',
    'effect omni-channels: omni-slack-result',
    'effect omni-channels: omni-wab-connect',
    'provide omniChannels',
  ])
  assert.ok(!own.includes('on llm/stream'))
})
