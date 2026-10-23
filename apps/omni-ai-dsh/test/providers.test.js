import { test } from 'node:test'
import assert from 'node:assert/strict'
import { install } from '../src/host/endpoint.js'
import { keyRefOf } from '../src/host/providers.js'
import { fakeContext } from './fake-ctx.js'

const withPiAi = (providers = {}) => ({ 'omni-ai': {}, 'llm-pi-ai': { providers } })
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

// DSH's authorization service, holding each attempt open until the test settles it.
function fakeAuthorization(flows = ['llm-pi-ai/kimi-coding', 'llm-pi-ai/openai-codex']) {
  const begun = []
  const cancelled = []
  return {
    begun,
    cancelled,
    describe: key => (flows.includes(key) ? { key, label: key, methods: [{ id: 'oauth' }], inFlight: false } : undefined),
    cancel(key) {
      cancelled.push(key)
      begun.find(attempt => attempt.key === key)?.settle({ status: 'cancelled' })
    },
    begin(request) {
      return new Promise((resolve, reject) => begun.push({ ...request, settle: resolve, fail: reject }))
    },
  }
}

function host({ entries = withPiAi(), authorization = fakeAuthorization(), services = {}, ...rest } = {}) {
  const fake = fakeContext({ entries, services: { ...(authorization ? { authorization } : {}), ...services }, ...rest })
  const { handle } = install(fake.ctx)
  return { ...fake, handle, authorization }
}

test('a key is stored under the reference the Models page uses, and the route points at it', async () => {
  const fake = host({ entries: withPiAi({ zai: { reasoning: 'high' } }) })
  const reply = await fake.handle('provider-key', { provider: 'zai', apiKey: '  sk-zai-0123  ' })
  assert.deepEqual(reply, { ok: true, value: { provider: 'zai', connected: true } })
  assert.equal(keyRefOf('openai-codex'), 'OPENAI_CODEX_API_KEY')
  assert.equal(fake.secrets.get('ZAI_API_KEY'), 'sk-zai-0123')
  // What the route held stays; the key itself never enters settings.
  assert.deepEqual(fake.valueOf('llm-pi-ai').providers.zai, { reasoning: 'high', apiKeyEnv: 'ZAI_API_KEY' })
  assert.ok(!JSON.stringify(fake.updates).includes('sk-zai'))
})

test("DeepSeek's key is DSH's own DeepSeek key, with no pi-ai route", async () => {
  const fake = host()
  assert.equal((await fake.handle('provider-key', { provider: 'deepseek', apiKey: 'sk-ds' })).ok, true)
  assert.equal(fake.secrets.get('DEEPSEEK_API_KEY'), 'sk-ds')
  assert.deepEqual(fake.valueOf('llm-pi-ai').providers, {})
})

test('a key for a provider no tile offers, or no key at all, is refused', async () => {
  const fake = host()
  assert.equal((await fake.handle('provider-key', { provider: 'evil', apiKey: 'x' })).error.code, 'omni-ai/invalid')
  assert.equal((await fake.handle('provider-key', { provider: 'zai', apiKey: 'two words' })).error.code, 'omni-ai/invalid')
  assert.equal(fake.secrets.size, 0)
})

test('payloads are parsed before use: wrong types read as missing fields, never as values', async () => {
  const fake = host()
  assert.equal((await fake.handle('provider-key', { provider: 42, apiKey: 'sk' })).error.code, 'omni-ai/invalid')
  assert.equal((await fake.handle('provider-key', { provider: 'zai', apiKey: ['sk'] })).error.code, 'omni-ai/invalid')
  assert.equal((await fake.handle('provider-key', 'zai')).error.code, 'omni-ai/invalid')
  assert.equal((await fake.handle('signin-answer', { provider: 'kimi-coding', promptId: { id: 1 }, value: 'x' })).error.code, 'omni-ai/refused')
  assert.equal(fake.secrets.size, 0)
})

test('a key DSH would not route is taken back: the earlier key returns, or none stays', async () => {
  const keyed = host({ entries: { 'omni-ai': {} }, credentials: { ZAI_API_KEY: 'sk-old' } })
  assert.equal((await keyed.handle('provider-key', { provider: 'zai', apiKey: 'sk-new' })).error.code, 'omni-ai/refused')
  assert.equal(keyed.secrets.get('ZAI_API_KEY'), 'sk-old')
  const fresh = host({ entries: { 'omni-ai': {} } })
  assert.equal((await fresh.handle('provider-key', { provider: 'zai', apiKey: 'sk-new' })).ok, false)
  assert.equal(fresh.secrets.has('ZAI_API_KEY'), false)
})

test('two starts at once begin one sign-in and write the route once, with no settings conflict', async () => {
  const fake = host()
  const [first, second] = await Promise.all([
    fake.handle('signin-start', { provider: 'kimi-coding' }),
    fake.handle('signin-start', { provider: 'kimi-coding' }),
  ])
  assert.equal(first.ok && second.ok, true, JSON.stringify([first, second]))
  assert.equal(fake.authorization.begun.length, 1)
  assert.equal(fake.updates.length, 1)
  // A route that is there already is not written again.
  fake.authorization.begun[0].settle({ status: 'cancelled' })
  await tick()
  assert.equal((await fake.handle('signin-start', { provider: 'kimi-coding' })).ok, true)
  assert.equal(fake.updates.length, 1)
})

test('a sign-in adds the route, relays its notice and question, takes the answer and ends authorized', async () => {
  const fake = host()
  const started = await fake.handle('signin-start', { provider: 'openai-codex' })
  assert.equal(started.value.status, 'running')
  assert.deepEqual(fake.valueOf('llm-pi-ai').providers['openai-codex'], {})
  const [attempt] = fake.authorization.begun
  assert.equal(attempt.key, 'llm-pi-ai/openai-codex')
  assert.equal(attempt.method, 'oauth')

  attempt.interaction.notify({ message: 'Enter this code', url: 'https://auth.example/device', code: 'AB12-CD34' })
  const answer = attempt.interaction.prompt({ kind: 'select', message: 'How?', options: [{ id: 'device', label: 'Device code' }, { id: 'browser', label: 'Browser' }] })
  const status = (await fake.handle('signin-status', { provider: 'openai-codex' })).value
  assert.deepEqual(status.notice, { message: 'Enter this code', url: 'https://auth.example/device', code: 'AB12-CD34' })
  assert.equal(status.prompt.kind, 'select')
  assert.equal((await fake.handle('signin-answer', { provider: 'openai-codex', promptId: status.prompt.id, value: 'nope' })).error.code, 'omni-ai/invalid')
  assert.equal((await fake.handle('signin-answer', { provider: 'openai-codex', promptId: status.prompt.id, value: 'device' })).ok, true)
  assert.equal(await answer, 'device')
  // An answered question is closed.
  assert.equal((await fake.handle('signin-answer', { provider: 'openai-codex', promptId: status.prompt.id, value: 'device' })).error.code, 'omni-ai/refused')

  attempt.settle({ status: 'authorized' })
  await tick()
  assert.equal((await fake.handle('signin-status', { provider: 'openai-codex' })).value.status, 'authorized')
})

test('a second start while one runs joins it; cancel withdraws the attempt and its question', async () => {
  const fake = host()
  await fake.handle('signin-start', { provider: 'kimi-coding' })
  await fake.handle('signin-start', { provider: 'kimi-coding' })
  assert.equal(fake.authorization.begun.length, 1)
  const question = fake.authorization.begun[0].interaction.prompt({ kind: 'text', message: 'Paste the code' })
  const cancelled = await fake.handle('signin-cancel', { provider: 'kimi-coding' })
  await assert.rejects(question)
  await tick()
  assert.deepEqual(fake.authorization.cancelled, ['llm-pi-ai/kimi-coding'])
  assert.equal(cancelled.value.prompt, null)
  assert.equal((await fake.handle('signin-status', { provider: 'kimi-coding' })).value.status, 'cancelled')
})

test('a failed sign-in reports why; one this DSH cannot run is refused before any route is written', async () => {
  const fake = host()
  await fake.handle('signin-start', { provider: 'kimi-coding' })
  fake.authorization.begun[0].fail(new Error('device code expired'))
  await tick()
  const status = (await fake.handle('signin-status', { provider: 'kimi-coding' })).value
  assert.equal(status.status, 'failed')
  assert.match(status.error, /expired/)

  const noFlow = host()
  assert.equal((await noFlow.handle('signin-start', { provider: 'github-copilot' })).error.code, 'omni-ai/refused')
  const noService = host({ authorization: null })
  assert.equal((await noService.handle('signin-start', { provider: 'kimi-coding' })).error.code, 'omni-ai/refused')
  assert.deepEqual(noService.valueOf('llm-pi-ai').providers, {})
})

test('providers reports, per tile, a stored key, a sign-in and whether this DSH can run it', async () => {
  const fake = host({ credentials: { OPENAI_API_KEY: 'k' }, records: ['llm-pi-ai/kimi-coding'] })
  const value = (await fake.handle('providers')).value
  assert.equal(value.openai.key, true)
  assert.equal(value['kimi-coding'].signedIn, true)
  assert.equal(value['kimi-coding'].signIn, true)
  assert.equal(value['github-copilot'].signIn, false)
})

test('Claude has no sign-in of ours: no anthropic flow is ever begun', async () => {
  const fake = host({ authorization: fakeAuthorization(['llm-pi-ai/anthropic']) })
  assert.equal((await fake.handle('signin-start', { provider: 'anthropic' })).error.code, 'omni-ai/invalid')
  assert.equal(fake.authorization.begun.length, 0)
})

test('claude-code finds the CLI, reads `claude auth status`, and sees the dsh-oh-my-claude route', async () => {
  const { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'claude-cli-'))
  const bin = join(dir, 'claude')
  writeFileSync(bin, '#!/bin/sh\n[ "$1 $2" = "auth status" ] && echo \'{"loggedIn":true,"authMethod":"claude.ai","email":"owner@example.com","subscriptionType":"max"}\'\n')
  chmodSync(bin, 0o755)
  const path = process.env.PATH
  process.env.PATH = `${dir}:${path}`
  const llm = { listProviders: () => [{ id: 'deepseek-official' }, { id: 'claude-code' }] }
  try {
    const fake = host({ services: { llm } })
    const value = (await fake.handle('claude-code')).value
    assert.deepEqual(value, { plugin: true, installed: true, path: bin, reachable: true, loggedIn: true, email: 'owner@example.com', plan: 'max' })
    writeFileSync(bin, '#!/bin/sh\necho \'{"loggedIn":false}\'\n')
    assert.equal((await fake.handle('claude-code')).value.loggedIn, false)
    // Without the plugin's route, Claude cannot run here whatever the CLI says.
    assert.equal((await host().handle('claude-code')).value.plugin, false)
  } finally {
    process.env.PATH = path
  }
})

test('an older CLI that answers auth status in prose is still read', async () => {
  const { parseClaudeStatus, claudeCandidates } = await import('../src/host/providers.js')
  assert.equal(parseClaudeStatus('Logged in as owner@example.com').loggedIn, true)
  assert.equal(parseClaudeStatus('Not logged in').loggedIn, false)
  assert.ok(claudeCandidates({ PATH: '' }, '/home/u').includes('/home/u/.local/bin/claude'))
})
