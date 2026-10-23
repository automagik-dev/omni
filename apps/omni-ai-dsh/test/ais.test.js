import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { COVERED, OLLAMA_KEY_REF, SUBSCRIPTION_ONLY, VENDORS } from '../src/host/ais.js'
import { install } from '../src/host/endpoint.js'
import { CANCELLED, loginCommand } from '../src/host/terminal.js'
import { fakeContext } from './fake-ctx.js'

const SECRET = 'sk-never-leaves-0123456789'
const offline = async () => { throw new Error('offline') }
const noClaude = async () => ({ plugin: false, installed: false, loggedIn: false })
const signedIn = async () => ({ plugin: true, installed: true, path: '/usr/local/bin/claude', reachable: true, loggedIn: true, email: 'owner@example.com', plan: 'max' })
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

// DSH's plugin manager, holding the Claude Code plugin's row.
function fakeManager(enabled = true) {
  const calls = []
  const row = { entryId: 'e-omc', moduleName: 'dsh-oh-my-claude', enabled }
  return {
    calls,
    row,
    listPlugins: async () => [{ entryId: 'e-other', moduleName: 'other', enabled: true }, { ...row }],
    async setPluginEnabled(id, on) {
      calls.push([id, on])
      row.enabled = on
    },
  }
}

function host({ providers = {}, entries = {}, checkClaude = noClaude, fetch = offline, services = {}, ...rest } = {}) {
  const fake = fakeContext({ entries: { 'omni-ai': {}, 'llm-pi-ai': { providers }, ...entries }, services, ...rest })
  const { handle } = install(fake.ctx, { fetch, checkClaude, ...(rest.terminal ? { terminal: rest.terminal } : {}) })
  const rows = async () => (await handle('ais')).value
  const row = async id => (await rows()).rows.find(item => item.id === id)
  return { ...fake, handle, rows, row }
}

test('one row per AI, and no row reaches a vendor another row already covers', () => {
  const ids = VENDORS.map(vendor => vendor.id)
  assert.deepEqual(ids, ['claude', 'chatgpt', 'deepseek', 'kimi', 'copilot', 'grok', 'openai', 'anthropic', 'openrouter', 'zai', 'moonshot', 'opencode', 'cliproxy', 'ollama'])
  // Claude only through Claude Code: no row signs in to Anthropic.
  assert.equal(VENDORS.find(vendor => vendor.id === 'claude').kind, 'claude')
  assert.ok(!VENDORS.some(vendor => vendor.kind === 'signin' && vendor.provider === 'anthropic'))
  // pi-ai's own DeepSeek route is not offered: DeepSeek is DSH's key and account.
  assert.ok(!VENDORS.some(vendor => vendor.provider === 'deepseek' && vendor.route !== false))
  // The dsh-subscriptions vendors Omni offers are only the ones nothing else covers.
  for (const vendor of Object.keys(COVERED)) assert.ok(!SUBSCRIPTION_ONLY.includes(vendor), vendor)
})

test('what this computer has is found: names and states only, never a key', async () => {
  const fake = host({
    providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } },
    credentials: { OPENAI_API_KEY: SECRET },
    env: { DEEPSEEK_API_KEY: SECRET, XAI_API_KEY: SECRET },
    records: ['llm-pi-ai/kimi-coding'],
    checkClaude: signedIn,
    services: { pluginManager: fakeManager() },
    fetch: async url => (String(url).endsWith('/api/tags') ? new Response('{"models":[]}') : new Response('', { status: 404 })),
  })
  const reply = await fake.rows()
  assert.ok(!JSON.stringify(reply).includes(SECRET))
  const by = Object.fromEntries(reply.rows.map(row => [row.id, row]))
  assert.deepEqual([by.claude.found, by.claude.on, by.claude.detail], ['Signed in to Claude Code', true, 'owner@example.com'])
  assert.deepEqual([by.deepseek.found, by.deepseek.on], ['DEEPSEEK_API_KEY found', true])
  assert.deepEqual([by.openai.found, by.openai.on], ['Key saved', true])
  // Signed in but no route: ready, not on until switched.
  assert.deepEqual([by.kimi.found, by.kimi.ready, by.kimi.on], ['Signed in to Kimi', true, false])
  assert.deepEqual([by.grok.found, by.grok.ready, by.grok.on], ['XAI_API_KEY found', true, false])
  assert.deepEqual([by.ollama.found, by.ollama.ready, by.ollama.on], ['Running on this computer', true, false])
  assert.deepEqual([by.openrouter.found, by.openrouter.ready], [null, false])
})

test('Claude is on only once Claude Code is signed in, and says what is missing', async () => {
  assert.equal((await host({ checkClaude: async () => ({ plugin: true, installed: true, loggedIn: false }) }).row('claude')).needs, 'login')
  assert.equal((await host({ checkClaude: async () => ({ plugin: true, installed: false, loggedIn: false }) }).row('claude')).needs, 'install')
  assert.equal((await host({ checkClaude: async () => ({ plugin: false, installed: true, loggedIn: true }) }).row('claude')).needs, 'plugin')
  const out = await host({ checkClaude: async () => ({ plugin: true, installed: true, loggedIn: false }) }).row('claude')
  assert.deepEqual([out.ready, out.on, out.found], [false, false, 'Claude Code found, not signed in'])
  // Turning it on before then is refused; the page opens the login instead.
  const fake = host({ checkClaude: async () => ({ plugin: true, installed: true, loggedIn: false }) })
  assert.equal((await fake.handle('ai-switch', { id: 'claude', on: true })).error.code, 'omni-ai/refused')
})

test('off stops using an AI and keeps its key or sign-in; on brings it back', async () => {
  const fake = host({ credentials: { OPENROUTER_API_KEY: SECRET }, records: ['llm-pi-ai/openai-codex'] })
  // A key: on writes the route that names it, off removes the route only.
  assert.equal((await fake.handle('ai-switch', { id: 'openrouter', on: true })).value.on, true)
  assert.deepEqual(fake.valueOf('llm-pi-ai').providers.openrouter, { apiKeyEnv: 'OPENROUTER_API_KEY' })
  assert.equal((await fake.handle('ai-switch', { id: 'openrouter', on: false })).value.on, false)
  assert.equal(fake.valueOf('llm-pi-ai').providers.openrouter, undefined)
  assert.equal(fake.secrets.get('OPENROUTER_API_KEY'), SECRET)
  // A sign-in: the route names no key, so it runs on the sign-in.
  assert.equal((await fake.handle('ai-switch', { id: 'chatgpt', on: true })).value.on, true)
  assert.deepEqual(fake.valueOf('llm-pi-ai').providers['openai-codex'], {})
  assert.equal((await fake.handle('ai-switch', { id: 'chatgpt', on: false })).value.on, false)
  assert.equal((await fake.row('chatgpt')).ready, true)
  // What is not set up is refused, and nothing is written for it.
  assert.equal((await fake.handle('ai-switch', { id: 'anthropic', on: true })).error.code, 'omni-ai/refused')
  assert.equal(fake.valueOf('llm-pi-ai').providers.anthropic, undefined)
  assert.equal((await fake.handle('ai-switch', { id: 'nope', on: true })).error.code, 'omni-ai/invalid')
  assert.equal((await fake.handle('ai-switch', { id: 'openrouter' })).error.code, 'omni-ai/invalid')
})

test('an environment key turns on by naming its variable; DeepSeek, DSH\'s own route, cannot be switched off here', async () => {
  const fake = host({ env: { ANTHROPIC_API_KEY: SECRET, DEEPSEEK_API_KEY: SECRET } })
  await fake.handle('ai-switch', { id: 'anthropic', on: true })
  assert.deepEqual(fake.valueOf('llm-pi-ai').providers.anthropic, { apiKeyEnv: 'ANTHROPIC_API_KEY' })
  assert.equal((await fake.handle('ai-switch', { id: 'deepseek', on: false })).error.code, 'omni-ai/refused')
  assert.ok(!JSON.stringify(fake.updates).includes(SECRET))
})

test('Claude on and off goes through DSH\'s plugin manager, never the account', async () => {
  const manager = fakeManager(false)
  const fake = host({ checkClaude: signedIn, services: { pluginManager: manager } })
  assert.equal((await fake.row('claude')).on, false)
  assert.equal((await fake.handle('ai-switch', { id: 'claude', on: true })).value.on, true)
  assert.equal((await fake.handle('ai-switch', { id: 'claude', on: false })).value.on, false)
  assert.deepEqual(manager.calls, [['e-omc', true], ['e-omc', false]])
})

test('Ollama on lists its models into a local route; off removes the route', async () => {
  const fetch = async (url) => {
    if (String(url).endsWith('/api/tags')) return new Response('{"models":[]}')
    if (String(url).endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'qwen2.5-coder' }, { id: 'llama3.2' }] }))
    return new Response('', { status: 404 })
  }
  const fake = host({ fetch })
  assert.equal((await fake.handle('ai-switch', { id: 'ollama', on: true })).value.on, true)
  const route = fake.valueOf('llm-pi-ai').providers.ollama
  assert.deepEqual([route.baseURL, route.apiKeyEnv, route.models.map(model => model.id)], ['http://127.0.0.1:11434/v1', OLLAMA_KEY_REF, ['qwen2.5-coder', 'llama3.2']])
  await fake.handle('ai-switch', { id: 'ollama', on: false })
  assert.equal(fake.valueOf('llm-pi-ai').providers.ollama, undefined)
  // Not running: not set up, and turning it on is refused.
  assert.equal((await host().handle('ai-switch', { id: 'ollama', on: true })).error.code, 'omni-ai/refused')
})

const subsEntry = (slots, hiddenModels = []) => ({ 'dsh-subscriptions': { slots, hiddenModels } })
const llmWith = models => ({ listProviders: () => [], listModels: async provider => models[provider] ?? [] })

test('turning Claude on hides the duplicates of it, and deletes none of their accounts', async () => {
  const fake = host({
    checkClaude: signedIn,
    providers: { anthropic: {} },
    records: ['llm-pi-ai/anthropic'],
    entries: subsEntry([{ provider: 'claude', index: 1 }, { provider: 'cursor', index: 1 }]),
    credentials: { CLAUDE_OAUTH_1: SECRET, CURSOR_OAUTH_1: SECRET },
    services: { pluginManager: fakeManager(false), llm: llmWith({ claude: [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-5-5' }], cursor: [{ id: 'auto' }] }) },
  })
  const before = await fake.row('claude')
  assert.deepEqual(before.duplicates.map(duplicate => [duplicate.via, duplicate.provider, duplicate.hidden]), [['dsh-subscriptions', 'claude', false], ['DSH\'s Claude sign-in', 'anthropic', false]])
  await fake.handle('ai-switch', { id: 'claude', on: true })
  const subs = fake.valueOf('dsh-subscriptions')
  assert.deepEqual(subs.hiddenModels, [{ provider: 'claude', id: 'claude-opus-5-5' }, { provider: 'claude', id: 'claude-sonnet-5-5' }])
  // The accounts stay: their slots and credentials are untouched, cursor's models too.
  assert.deepEqual(subs.slots, [{ provider: 'claude', index: 1 }, { provider: 'cursor', index: 1 }])
  assert.equal(fake.secrets.get('CLAUDE_OAUTH_1'), SECRET)
  // DSH's Claude sign-in loses its route; its stored sign-in is not touched.
  assert.equal(fake.valueOf('llm-pi-ai').providers.anthropic, undefined)
  const after = await fake.row('claude')
  assert.deepEqual(after.duplicates.map(duplicate => duplicate.hidden), [true])
  assert.ok(!JSON.stringify(fake.updates).includes(SECRET))
})

test('an Anthropic route on a key is the Anthropic API row, never counted as a Claude duplicate', async () => {
  const fake = host({ checkClaude: signedIn, providers: { anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' } }, credentials: { ANTHROPIC_API_KEY: SECRET }, services: { pluginManager: fakeManager() } })
  assert.equal((await fake.row('claude')).duplicates, undefined)
  await fake.handle('ai-dedupe', { id: 'claude' })
  assert.deepEqual(fake.valueOf('llm-pi-ai').providers.anthropic, { apiKeyEnv: 'ANTHROPIC_API_KEY' })
  assert.equal((await fake.row('anthropic')).on, true)
})

test('a subscription only dsh-subscriptions has: off hides its models, on shows them again', async () => {
  const fake = host({
    entries: subsEntry([{ provider: 'cursor', index: 1 }, { provider: 'kiro', index: 1 }], [{ provider: 'kiro', id: 'x' }]),
    credentials: { CURSOR_OAUTH_1: SECRET },
    services: { llm: llmWith({ cursor: [{ id: 'auto' }, { id: 'gpt-5' }] }) },
  })
  // kiro has a slot but no credential: not an account.
  assert.deepEqual((await fake.rows()).subscriptions, { accounts: [{ provider: 'cursor', index: 1 }], hidden: [] })
  const off = (await fake.handle('ai-subscription', { provider: 'cursor', on: false })).value
  assert.deepEqual(off.subscriptions.hidden, ['cursor'])
  assert.deepEqual(fake.valueOf('dsh-subscriptions').hiddenModels, [{ provider: 'kiro', id: 'x' }, { provider: 'cursor', id: 'auto' }, { provider: 'cursor', id: 'gpt-5' }])
  await fake.handle('ai-subscription', { provider: 'cursor', on: true })
  assert.deepEqual(fake.valueOf('dsh-subscriptions').hiddenModels, [{ provider: 'kiro', id: 'x' }])
  assert.equal((await fake.handle('ai-subscription', { provider: 'kiro', on: true })).error.code, 'omni-ai/refused')
  // A covered vendor is not a subscription row.
  assert.equal((await fake.handle('ai-subscription', { provider: 'claude', on: false })).error.code, 'omni-ai/invalid')
  assert.equal((await host().handle('ai-subscription', { provider: 'cursor', on: false })).error.code, 'omni-ai/refused')
})

// DSH's process service: one terminal, whose output and end the test drives.
function fakeTerminalService() {
  const spawned = []
  return {
    spawned,
    resolveExecutable: async shell => `/bin/${shell}`,
    async spawnTerminal(spec) {
      const output = new EventEmitter()
      let settle
      const handle = { spec, output, writes: [], done: new Promise((resolve) => { settle = resolve }), write: async (data) => { handle.writes.push(data) }, resize: async () => {}, terminate: async () => { settle({ exitCode: null, signal: 'SIGTERM' }) }, settle: outcome => settle(outcome) }
      spawned.push(handle)
      return handle
    },
  }
}

test('the Claude Code login waits typed at the prompt and runs only after Enter', async () => {
  let loggedIn = false
  const checkClaude = async () => ({ plugin: true, installed: true, path: '/usr/local/bin/claude', reachable: true, loggedIn })
  const service = fakeTerminalService()
  const fake = host({ checkClaude, terminal: { subprocess: service, env: { PATH: '/usr/local/bin:/usr/bin' }, home: '/tmp', platform: 'darwin' } })
  const opened = (await fake.handle('ai-terminal-open', { kind: 'claude-login', cols: 80, rows: 10 })).value
  assert.equal(opened.state, 'ready')
  assert.equal(opened.command, 'claude auth login')
  const [terminal] = service.spawned
  // zsh's vared holds the command from the environment; nothing is interpolated into the script.
  assert.equal(terminal.spec.argv[0], '/bin/zsh')
  assert.equal(terminal.spec.env.OMNI_TERMINAL_COMMAND, 'claude auth login')
  assert.ok(!terminal.spec.argv.join(' ').includes('claude auth login'))
  terminal.output.emit('data', '~ $ claude auth login')
  assert.equal((await fake.handle('ai-terminal-read', { terminal: opened.terminal })).value.data, '~ $ claude auth login')
  await fake.handle('ai-terminal-write', { terminal: opened.terminal, data: '\r' })
  assert.deepEqual(terminal.writes, ['\r'])
  loggedIn = true
  terminal.settle({ exitCode: 0 })
  await tick()
  await tick()
  const done = (await fake.handle('ai-terminal-read', { terminal: opened.terminal })).value
  assert.deepEqual([done.state, done.exitCode], ['done', 0])
  // Signed in already: nothing to open.
  assert.equal((await fake.handle('ai-terminal-open', { kind: 'claude-login' })).error.code, 'omni-ai/refused')
})

test('a login that fails or is backed out of leaves the terminal open with its end', async () => {
  const checkClaude = async () => ({ plugin: true, installed: true, path: '/usr/local/bin/claude', reachable: true, loggedIn: false })
  const service = fakeTerminalService()
  const fake = host({ checkClaude, terminal: { subprocess: service, env: { PATH: '/usr/bin' }, home: '/tmp', platform: 'linux' } })
  const first = (await fake.handle('ai-terminal-open', { kind: 'claude-login' })).value
  // Not on DSH's PATH: the command names the CLI by its path.
  assert.equal(first.command, "'/usr/local/bin/claude' auth login")
  assert.equal(service.spawned[0].spec.argv[0], '/bin/bash')
  service.spawned[0].settle({ exitCode: 1 })
  await tick()
  await tick()
  assert.deepEqual([(await fake.handle('ai-terminal-read', { terminal: first.terminal })).value.state], ['failed'])
  const second = (await fake.handle('ai-terminal-open', { kind: 'claude-login' })).value
  service.spawned[1].settle({ exitCode: null, signal: 'SIGINT' })
  await tick()
  const cancelled = (await fake.handle('ai-terminal-read', { terminal: second.terminal })).value
  assert.deepEqual([cancelled.state, cancelled.exitCode], ['cancelled', CANCELLED])
  assert.equal(loginCommand("/opt/it's/claude", { PATH: '' }), "'/opt/it'\\''s/claude' auth login")
})

test('without a terminal the command shows at a prompt and runs on pipes only after Enter', async () => {
  const runs = []
  const spawn = (file, args, options) => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    runs.push({ file, args, command: options.env.OMNI_TERMINAL_COMMAND, shell: options.shell, child })
    return child
  }
  const checkClaude = async () => ({ plugin: true, installed: true, path: '/usr/local/bin/claude', reachable: true, loggedIn: false })
  const fake = host({ checkClaude, terminal: { subprocess: null, spawn, env: { PATH: '/usr/local/bin' }, home: '/tmp' } })
  const opened = (await fake.handle('ai-terminal-open', { kind: 'claude-login' })).value
  assert.match((await fake.handle('ai-terminal-read', { terminal: opened.terminal })).value.data, /claude auth login$/)
  await fake.handle('ai-terminal-write', { terminal: opened.terminal, data: 'x' })
  assert.equal(runs.length, 0)
  await fake.handle('ai-terminal-write', { terminal: opened.terminal, data: '\r' })
  assert.deepEqual(runs.map(run => [run.file, run.args, run.command, run.shell]), [['/bin/sh', ['-c', 'eval "$OMNI_TERMINAL_COMMAND"'], 'claude auth login', false]])
})

test('the terminal opens only for the Claude login, and only where Claude Code is installed', async () => {
  const fake = host({ terminal: { subprocess: fakeTerminalService() } })
  assert.equal((await fake.handle('ai-terminal-open', { kind: 'update' })).error.code, 'omni-ai/invalid')
  assert.equal((await fake.handle('ai-terminal-open', { kind: 'claude-login' })).error.code, 'omni-ai/refused')
  assert.equal((await fake.handle('ai-terminal-read', { terminal: '00000000-0000-4000-8000-000000000000' })).error.code, 'omni-ai/refused')
})
