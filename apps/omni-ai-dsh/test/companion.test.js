import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { install } from '../src/host/endpoint.js'
import { CODEX_IMAGES, CODEX_IMAGE_MODEL, CODEX_RECORD, COMPANION_ROLE, OMNI_BOT, OMNI_BOT_FALLBACK, OPENAI_IMAGES, OPENAI_RECORD, accountIdOf, companionPrompt } from '../src/host/companion.js'
import { fakeContext } from './fake-ctx.js'

const ACCESS = `x.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-7' } })).toString('base64url')}.sig`
const KEY = 'sk-openai-secret-0123456789'
const PNG = Buffer.from('a tiny png').toString('base64')
const noClaude = async () => ({ plugin: false, installed: false, loggedIn: false })

// The Omni team service (@automagik/omni-dsh's omniTeam), as far as onboarding uses it.
function fakeTeam({ mainName = 'Omni', folder } = {}) {
  const calls = []
  const state = { mainBotIds: ['main'], bots: { main: { id: 'main', name: mainName } } }
  const rt = {
    state,
    calls,
    async load() {},
    async bootstrap() { calls.push(['bootstrap']) },
    botOf: id => state.bots[id],
    findBot: name => Object.values(state.bots).find(bot => bot.name.toLowerCase() === name.toLowerCase()),
    teamFolder: () => folder,
    async updateBot(id, patch) {
      calls.push(['updateBot', id, patch])
      Object.assign(state.bots[id], patch)
    },
    async createBot(options) {
      calls.push(['createBot', options])
      const bot = { id: `bot-${calls.length}`, ...options }
      state.bots[bot.id] = bot
      return bot
    },
  }
  return rt
}

function host({ entries = { 'omni-ai': {} }, team, fetch, env = {}, ...rest } = {}) {
  const fake = fakeContext({ entries, services: team ? { omniTeam: team } : {}, ...rest })
  const requests = []
  const fetchImpl = fetch ?? (async (url, init) => {
    requests.push({ url: String(url), init })
    return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const { handle } = install(fake.ctx, { checkClaude: noClaude, companion: { fetch: fetchImpl, env, now: () => 1_000_000 } })
  return { ...fake, handle, requests }
}

const grant = (expires = 9_000_000) => ({ [CODEX_RECORD]: { kind: 'grant', payload: { access: ACCESS, refresh: 'r-secret', expires } } })

test('the vendored characters and inks are still the team plugin\'s own', () => {
  for (const name of ['characters.js', 'inks.js']) {
    const copy = readFileSync(new URL(`../src/client/vendor/${name}`, import.meta.url), 'utf8').split('\n').slice(2).join('\n')
    const original = readFileSync(new URL(`../../omni-ui-dsh/src/client/${name}`, import.meta.url), 'utf8')
    assert.equal(copy, original, `${name} drifted from omni-ui-dsh: copy it again`)
  }
})

test('companion says which image source is ready, and never what it holds', async () => {
  assert.equal((await host().handle('companion')).value.generate, null)

  const chatgpt = await host({ recordValues: grant() }).handle('companion')
  assert.deepEqual(chatgpt.value.generate, { kind: 'chatgpt', ready: true })
  assert.doesNotMatch(JSON.stringify(chatgpt), /r-secret|sig/)

  const stale = await host({ recordValues: grant(1_000) }).handle('companion')
  assert.deepEqual(stale.value.generate, { kind: 'chatgpt', ready: false })

  const keyed = await host({ recordValues: { [OPENAI_RECORD]: { kind: 'api-key', key: KEY } } }).handle('companion')
  assert.deepEqual(keyed.value.generate, { kind: 'openai', ready: true })
  assert.doesNotMatch(JSON.stringify(keyed), new RegExp(KEY))

  const fromEnv = await host({ credentials: { OPENAI_API_KEY: KEY } }).handle('companion')
  assert.deepEqual(fromEnv.value.generate, { kind: 'openai', ready: true })
})

test('a ChatGPT plan draws through the Codex images endpoint; a key through OpenAI\'s', async () => {
  assert.equal(accountIdOf(ACCESS), 'acct-7')
  const chatgpt = host({ recordValues: grant() })
  const reply = await chatgpt.handle('companion-generate', { description: 'a sleepy fox' })
  assert.deepEqual(reply.value, { image: `data:image/png;base64,${PNG}`, via: 'chatgpt' })
  const [request] = chatgpt.requests
  assert.equal(request.url, CODEX_IMAGES)
  assert.equal(request.init.headers['chatgpt-account-id'], 'acct-7')
  assert.equal(request.init.headers.authorization, `Bearer ${ACCESS}`)
  const body = JSON.parse(request.init.body)
  assert.equal(body.model, CODEX_IMAGE_MODEL)
  assert.equal(body.prompt, companionPrompt('a sleepy fox'))

  const keyed = host({ recordValues: { [OPENAI_RECORD]: { kind: 'api-key', key: KEY } } })
  assert.equal((await keyed.handle('companion-generate', { description: 'a sleepy fox' })).value.via, 'openai')
  assert.equal(keyed.requests[0].url, OPENAI_IMAGES)
})

test('drawing is refused without a source, with a stale sign-in, or when the service says no', async () => {
  const none = host()
  assert.match((await none.handle('companion-generate', { description: 'a fox' })).error.message, /Connect ChatGPT or an OpenAI key/)
  assert.equal(none.requests.length, 0)
  const stale = host({ recordValues: grant(1_000) })
  assert.match((await stale.handle('companion-generate', { description: 'a fox' })).error.message, /needs a refresh/)
  assert.equal(stale.requests.length, 0)
  assert.equal((await host({ recordValues: grant() }).handle('companion-generate', { description: 'x' })).error.code, 'omni-ai/invalid')
  const failing = host({ recordValues: grant(), fetch: async () => new Response(JSON.stringify({ error: { message: 'quota reached' } }), { status: 429 }) })
  assert.equal((await failing.handle('companion-generate', { description: 'a fox' })).error.message, 'The image was not made: quota reached')
})

test('saving the companion makes it the Main Bot, by look and name', async () => {
  const team = fakeTeam()
  const fake = host({ team })
  const reply = await fake.handle('companion-save', { name: ' Mochi ', shape: 'octopus', color: 'orange' })
  assert.deepEqual(reply.value, { name: 'Mochi', applied: true, image: false })
  assert.deepEqual(team.calls, [['updateBot', 'main', { name: 'Mochi', role: COMPANION_ROLE, color: 'orange', avatar: { shape: 'octopus' } }]])
  assert.deepEqual(fake.valueOf('omni-ai'), { companionName: 'Mochi', companionShape: 'octopus', companionColor: 'orange' })
  assert.equal((await fake.handle('state')).value.companionName, 'Mochi')

  // Without the team plugin the companion is kept for later.
  assert.deepEqual((await host().handle('companion-save', { name: 'Pip', shape: 'star' })).value, { name: 'Pip', applied: false, image: false })
})

test('a drawn companion is kept as a private file in the Omni home', async () => {
  const home = mkdtempSync(join(tmpdir(), 'omni-ai-companion-'))
  try {
    const fake = host({ env: { OMNI_HOME: home } })
    const reply = await fake.handle('companion-save', { name: 'Nova', image: `data:image/png;base64,${PNG}` })
    assert.deepEqual(reply.value, { name: 'Nova', applied: false, image: true })
    const file = join(home, 'ai', 'companion.png')
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.equal(readFileSync(file).toString('base64'), PNG)
    assert.deepEqual((await fake.handle('companion-image')).value, { image: `data:image/png;base64,${PNG}` })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a companion needs a plain name and a look', async () => {
  const fake = host({ team: fakeTeam() })
  for (const payload of [{ name: '', shape: 'octopus' }, { name: '<b>x</b>', shape: 'octopus' }, { name: 'Pip' }, { name: 'Pip', shape: 'Octo pus' }, { name: 'Pip', image: 'data:text/html;base64,AAAA' }]) {
    assert.equal((await fake.handle('companion-save', payload)).error.code, 'omni-ai/invalid', JSON.stringify(payload))
  }
  assert.deepEqual(fake.updates, [])
})

test('Omni joining the team adds the Omni Bot once, in its own project, with its greeting held', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'omni-ai-team-'))
  try {
    const team = fakeTeam({ mainName: 'Mochi', folder })
    const fake = host({ team })
    const reply = await fake.handle('team-save', { omni: true, genie: false, omniAbilities: { channels: true, shell: false } })
    assert.equal(reply.value.omniBot.name, 'Omni')
    const [, options] = team.calls.find(call => call[0] === 'createBot')
    assert.deepEqual({ ...options, avatar: { ...options.avatar } }, { ...OMNI_BOT, avatar: { ...OMNI_BOT.avatar }, workDir: join(folder, 'omni'), pickModel: true })
    assert.ok(statSync(join(folder, 'omni')).isDirectory())
    assert.deepEqual(fake.valueOf('omni-ai'), { teamOmni: true, teamGenie: false, teamOmniAbilities: '{"channels":true,"shell":false}' })

    await fake.handle('team-save', { omni: true })
    assert.equal(team.calls.filter(call => call[0] === 'createBot').length, 1)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('the Omni Bot takes another name when the companion is called Omni', async () => {
  const team = fakeTeam({ mainName: 'Omni' })
  const reply = await host({ team }).handle('team-save', { omni: true })
  assert.equal(reply.value.omniBot.name, OMNI_BOT_FALLBACK)
})

test('Omni left out adds no Bot and skips its connect step; a bad choice changes nothing', async () => {
  const team = fakeTeam()
  const fake = host({ team })
  assert.deepEqual((await fake.handle('team-save', { omni: false })).value, { omni: false, genie: false, abilities: null, omniBot: null })
  assert.deepEqual(team.calls, [])
  assert.deepEqual(fake.valueOf('omni-ai'), { teamOmni: false, teamGenie: false, connectOmniSkipped: true })

  const strict = host({ team })
  for (const payload of [{}, { omni: 'yes' }, { omni: true, omniAbilities: { 'Not A Key': true } }, { omni: true, omniAbilities: { shell: 'on' } }]) {
    assert.equal((await strict.handle('team-save', payload)).error.code, 'omni-ai/invalid', JSON.stringify(payload))
  }
  assert.deepEqual(strict.updates, [])
})
