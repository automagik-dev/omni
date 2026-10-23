import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../index.js'
import { KEY_REF, ROUTE, cleanBaseUrl, install, modelIdsOf } from '../src/host/endpoint.js'
import { fakeContext, fakeGateway } from './fake-ctx.js'

const KEY = 'sk-cliproxy-secret-0123456789'
const MODELS = { object: 'list', data: [{ id: 'gpt-5' }, { id: 'claude-sonnet-4-5' }, { id: 'gpt-5' }, { id: '' }, { nope: 1 }] }
const withPiAi = (providers = {}) => ({ 'omni-ai': {}, 'llm-pi-ai': { providers } })

// No Claude Code here, unless a test says so.
const noClaude = async () => ({ plugin: false, installed: false, loggedIn: false })
function host({ entries = withPiAi(), gateway = fakeGateway({ body: MODELS }), checkClaude = noClaude, ...rest } = {}) {
  const fake = fakeContext({ entries, ...rest })
  const { actions, handle } = install(fake.ctx, { fetch: gateway.fetch, checkClaude })
  return { ...fake, actions, handle, gateway }
}
const everything = fake => JSON.stringify([fake.updates, [...fake.routes].map(route => route.path), fake.logs, fake.valueOf('llm-pi-ai'), fake.valueOf('omni-ai')])

test('the plugin declares its entry, its services, and its live onboarding fields', () => {
  assert.equal(plugin.name, 'omni-ai')
  assert.deepEqual(plugin.inject, ['settings', 'credentials', 'connection'])
  const { uid, refs } = plugin.Config.toJSON()
  const fields = refs[uid].dict
  const flags = ['companionDone', 'connectAiDone', 'connectOmniSkipped', 'teamDone', 'teamGenie', 'teamOmni', 'welcomeDone']
  const texts = ['companionColor', 'companionImage', 'companionName', 'companionShape', 'teamOmniAbilities']
  assert.deepEqual(Object.keys(fields).sort(), [...flags, ...texts].sort())
  for (const name of flags) assert.deepEqual(refs[fields[name]], { type: 'boolean', meta: { volatile: true } })
  for (const name of texts) assert.deepEqual(refs[fields[name]], { type: 'string', meta: { volatile: true } })
})

test('apply serves one POST route and keeps the flags off the generated settings pages', () => {
  const fake = fakeContext({ entries: withPiAi() })
  plugin.apply(fake.ctx)
  assert.deepEqual(fake.routes.map(route => [route.path, route.methods]), [[ROUTE, ['POST']]])
  assert.deepEqual(fake.presentations, [{ auto: false }])
})

test('cliproxy stores the key only in credentials and writes a route that references it', async () => {
  const fake = host()
  const reply = await fake.handle('cliproxy', { baseURL: ' http://localhost:8317/v1/ ', apiKey: ` ${KEY} ` })
  assert.equal(reply.ok, true)
  assert.deepEqual(reply.value, { route: 'cliproxy', baseURL: 'http://localhost:8317/v1', models: ['gpt-5', 'claude-sonnet-4-5'] })
  assert.equal(fake.gateway.requests[0].url, 'http://localhost:8317/v1/models')
  assert.equal(fake.gateway.requests[0].init.headers.authorization, `Bearer ${KEY}`)
  assert.equal(fake.gateway.requests[0].init.redirect, 'error')

  assert.deepEqual([...fake.secrets], [[KEY_REF, KEY]])
  assert.deepEqual(fake.updates, [{
    ns: 'llm-pi-ai',
    expectedRevision: 3,
    patch: { providers: { cliproxy: {
      displayName: 'CLIProxyAPI',
      api: 'openai-completions',
      baseURL: 'http://localhost:8317/v1',
      apiKeyEnv: KEY_REF,
      models: [{ id: 'gpt-5', name: 'gpt-5' }, { id: 'claude-sonnet-4-5', name: 'claude-sonnet-4-5' }],
    } } },
  }])
  assert.ok(!everything(fake).includes(KEY), 'the key is in settings, a route or a log')
  assert.ok(!JSON.stringify(reply).includes(KEY), 'the reply echoes the key')
})

test('cliproxy merges into the existing routes rather than replacing them', async () => {
  const openai = { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy.example.com' }
  const fake = host({ entries: withPiAi({ openai, cliproxy: { api: 'openai-completions', baseURL: 'http://old.example/v1', apiKeyEnv: KEY_REF, models: [{ id: 'old-1' }, { id: 'old-2' }, { id: 'old-3' }], compat: { thinkingFormat: 'openai' } } }) })
  const reply = await fake.handle('cliproxy', { baseURL: 'https://gateway.example/v1', apiKey: KEY })
  assert.equal(reply.ok, true)
  const { providers } = fake.valueOf('llm-pi-ai')
  assert.deepEqual(providers.openai, openai)
  assert.deepEqual(providers.cliproxy.models.map(model => model.id), ['gpt-5', 'claude-sonnet-4-5'])
  assert.equal(providers.cliproxy.baseURL, 'https://gateway.example/v1')
  assert.deepEqual(providers.cliproxy.compat, { thinkingFormat: 'openai' })
})

test('cliproxy refuses a gateway that lists no models, and stores nothing', async () => {
  for (const body of [{ data: [] }, { models: {} }, [], { data: [{ id: '  ' }] }]) {
    const fake = host({ gateway: fakeGateway({ body }) })
    const reply = await fake.handle('cliproxy', { baseURL: 'http://localhost:8317/v1', apiKey: KEY })
    assert.equal(reply.ok, false)
    assert.equal(reply.error.code, 'omni-ai/refused')
    assert.match(reply.error.message, /lists no models/)
    assert.equal(fake.secrets.size, 0)
    assert.deepEqual(fake.updates, [])
  }
})

test('cliproxy refuses an address that is not http(s), before any request', async () => {
  for (const baseURL of ['ftp://gateway.example/v1', 'javascript:alert(1)', 'file:///etc/passwd', 'localhost:8317', 'http://user:pass@gateway.example/v1', 'http://gateway.example/v1?x=1', '', null, 42]) {
    const fake = host()
    const reply = await fake.handle('cliproxy', { baseURL, apiKey: KEY })
    assert.equal(reply.ok, false, String(baseURL))
    assert.equal(reply.error.code, 'omni-ai/invalid')
    assert.equal(fake.gateway.requests.length, 0)
    assert.equal(fake.secrets.size, 0)
  }
})

test('a gateway address without a path gets /v1, where CLIProxyAPI serves it', () => {
  assert.equal(cleanBaseUrl('http://localhost:8317'), 'http://localhost:8317/v1')
  assert.equal(cleanBaseUrl('HTTPS://Gateway.Example/api/v1//'), 'https://gateway.example/api/v1')
  assert.deepEqual(modelIdsOf({ data: [{ id: 'a' }, { id: 'a' }, { id: 7 }] }), ['a'])
})

test('cliproxy never echoes the key, whatever goes wrong', async () => {
  const cases = [
    fakeGateway({ status: 401, body: { error: `bad key ${KEY}` } }),
    fakeGateway({ status: 500, body: `oops ${KEY}` }),
    fakeGateway({ body: `not json ${KEY}` }),
    { fetch: async () => { throw new Error(`connect ECONNREFUSED ${KEY}`) }, requests: [] },
  ]
  for (const gateway of cases) {
    const fake = host({ gateway })
    const reply = await fake.handle('cliproxy', { baseURL: 'http://localhost:8317/v1', apiKey: KEY })
    assert.equal(reply.ok, false)
    assert.ok(!JSON.stringify(reply).includes(KEY), reply.error.message)
    assert.ok(!everything(fake).includes(KEY))
    assert.equal(fake.secrets.size, 0)
  }
})

test('cliproxy refuses without a key, without pi-ai, and when settings moved meanwhile', async () => {
  assert.equal((await host().handle('cliproxy', { baseURL: 'http://localhost:8317/v1', apiKey: '   ' })).error.code, 'omni-ai/invalid')
  const bare = host({ entries: { 'omni-ai': {} } })
  const missing = await bare.handle('cliproxy', { baseURL: 'http://localhost:8317/v1', apiKey: KEY })
  assert.equal(missing.error.code, 'omni-ai/refused')
  assert.equal(bare.gateway.requests.length, 0)

  const raced = host()
  const update = raced.ctx.settings.update
  raced.ctx.settings.update = async (ns, patch, revision) => update(ns, patch, revision + 1)
  const conflict = await raced.handle('cliproxy', { baseURL: 'http://localhost:8317/v1', apiKey: KEY })
  assert.equal(conflict.error.code, 'omni-ai/refused')
  assert.match(conflict.error.message, /changed while saving/)
  // The key stored for a route that was never saved is taken back out.
  assert.equal(raced.secrets.has(KEY_REF), false)
})

test('a refused save puts the previous gateway key back', async () => {
  const fake = host()
  fake.secrets.set(KEY_REF, 'sk-previous-key')
  fake.ctx.settings.update = async () => { throw new Error('refused by pi-ai') }
  const reply = await fake.handle('cliproxy', { baseURL: 'http://localhost:8317/v1', apiKey: KEY })
  assert.equal(reply.error.code, 'omni-ai/refused')
  assert.equal(fake.secrets.get(KEY_REF), 'sk-previous-key')
})

test('a gateway that answers /models with more than 2 MB is not read past it', async () => {
  const huge = JSON.stringify({ data: Array.from({ length: 120_000 }, (_, n) => ({ id: `model-${n}-${'x'.repeat(8)}` })) })
  const fake = host({ gateway: fakeGateway({ body: huge }) })
  const reply = await fake.handle('cliproxy', { baseURL: 'http://localhost:8317/v1', apiKey: KEY })
  assert.equal(reply.error.code, 'omni-ai/refused')
  assert.match(reply.error.message, /JSON model list/)
  assert.equal(fake.secrets.size, 0)
})

test('done writes the step flag in the plugin entry', async () => {
  const fake = host()
  assert.deepEqual(await fake.handle('done', { stepId: 'omni-companion' }), { ok: true, value: { companionDone: true } })
  assert.deepEqual((await fake.handle('done', { stepId: 'omni-connect' })).value, { connectOmniSkipped: true })
  assert.deepEqual(fake.updates.map(update => [update.ns, update.patch]), [['omni-ai', { companionDone: true }], ['omni-ai', { connectOmniSkipped: true }]])
  assert.deepEqual(fake.valueOf('omni-ai'), { companionDone: true, connectOmniSkipped: true })
  for (const stepId of ['toString', 'deepseek-official', undefined]) {
    assert.equal((await fake.handle('done', { stepId })).error.code, 'omni-ai/invalid')
  }
  assert.equal(fake.updates.length, 2)
})

test('state reports the flags and whether an AI is already connected', async () => {
  const fresh = await host().handle('state')
  assert.deepEqual(JSON.parse(JSON.stringify(fresh.value)), {
    companionDone: false, teamDone: false, welcomeDone: false, connectAiDone: false, connectOmniSkipped: false,
    companionImage: false, teamOmni: true, teamGenie: false, deepseek: false, piAiRoutes: [], aiConnected: false,
  })

  const fake = host({ entries: { 'omni-ai': { welcomeDone: true, connectAiDone: true }, 'llm-pi-ai': { providers: { zai: { apiKeyEnv: 'ZAI_API_KEY' } } } }, credentials: { ZAI_API_KEY: 'x' } })
  const value = (await fake.handle('state')).value
  assert.equal(value.welcomeDone, true)
  assert.equal(value.connectAiDone, true)
  assert.deepEqual(value.piAiRoutes, ['zai'])
  assert.equal(value.aiConnected, true)
  // A route with nothing behind it (a sign-in that never finished) is not an AI.
  assert.equal((await host({ entries: withPiAi({ 'kimi-coding': {} }) }).handle('state')).value.aiConnected, false)
  // Claude Code signed in is.
  const claude = async () => ({ plugin: true, installed: true, loggedIn: true, reachable: true })
  assert.equal((await host({ checkClaude: claude }).handle('state')).value.aiConnected, true)

  assert.equal((await host({ credentials: { DEEPSEEK_API_KEY: 'x' } }).handle('state')).value.deepseek, true)
  assert.equal((await host({ records: ['deepseek-account-platform/default'] }).handle('state')).value.deepseek, true)
})

test('the route answers JSON for the browser, unknown endpoints included', async () => {
  const fake = host()
  const [route] = fake.routes
  const post = async body => (await route.fetch(new Request('http://dsh.local/api/omni-ai', { method: 'POST', body: JSON.stringify(body) }))).json()
  assert.deepEqual(await post({ endpoint: 'done', payload: { stepId: 'omni-connect-ai' } }), { ok: true, value: { connectAiDone: true } })
  assert.equal((await post({ endpoint: 'constructor' })).error.code, 'omni-ai/not-found')
  const saved = await post({ endpoint: 'cliproxy', payload: { baseURL: 'http://localhost:8317', apiKey: KEY } })
  assert.equal(saved.ok, true)
  assert.ok(!JSON.stringify(saved).includes(KEY))
})
