import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DISCORD_PERMISSIONS, discordInviteUrl, install } from '../src/host/omni-channel-actions.js'
import { install as installHooks } from '@automagik/bots-dsh/src/host/extend.js'
import { ADD, ORDER, copiedTelegramToken, isTelegramToken, offered, telegramChat } from '../src/client/channel-add.js'
import { askUpdate, dismiss, dismissedFor, updateBar, watchStatus } from '../src/client/update-bar.js'
import { CHANNEL_TYPES } from '../src/client/omni-store.js'

const KEY = 'omni_sk_linked_secret'
const CHANNEL = '11111111-2222-4333-8444-555555555555'
const NONCE = 'slackoauth_abcdefgh12345678'

// A host linked to an Omni whose answers come from `routes`, keeping every call.
function host(routes) {
  const calls = []
  const rt = {
    ctx: { effect: run => run() },
    omniRequest: async (method, path, { body } = {}) => {
      calls.push({ method, path, body })
      const route = routes[`${method} ${path}`]
      const [status, json] = route ? route(body) : [404, { error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } }]
      return new Response(JSON.stringify(json), { status })
    },
  }
  installHooks(rt)
  install(rt)
  return { calls, run: (endpoint, body) => rt.omniChannelEndpoint(endpoint, body) }
}

// -------------------------------------------------------------------------
// The grid

test('every card has a time, an action and steps, and the page has no CLI text left', () => {
  for (const type of ORDER) {
    assert.ok(CHANNEL_TYPES[type], type)
    assert.ok(ADD[type].time && ADD[type].how && ADD[type].steps.length >= 2, type)
    assert.equal(CHANNEL_TYPES[type].cli, undefined, `${type} still names CLI commands`)
  }
})

test('the grid offers what the Omni has loaded, or everything when it cannot say', async () => {
  const { run } = host({
    'GET /instances/supported-channels': () => [200, { items: [
      { id: 'whatsapp-baileys', loaded: true }, { id: 'telegram', loaded: true }, { id: 'slack', loaded: true },
      { id: 'whatsapp-business', loaded: false }, { id: 'a2a', loaded: true },
    ] }],
  })
  const { types } = await run('omni-channel-types')
  assert.deepEqual(types, ['whatsapp-baileys', 'slack', 'telegram'])
  assert.deepEqual(offered(types), ['whatsapp-baileys', 'slack', 'telegram'])
  assert.deepEqual(await host({}).run('omni-channel-types'), { types: null })
  assert.deepEqual(offered(null), ORDER)
})

// -------------------------------------------------------------------------
// Slack

test('Slack as a bot or as the person: Omni starts the sign-in, the page waits for how it ended', async () => {
  for (const mode of ['bot', 'user']) {
    let asked = 0
    const { run, calls } = host({
      'GET /slack/app': () => [200, { configured: true, missing: [] }],
      'POST /slack/oauth/start': () => [200, { authorizeUrl: 'https://slack.com/oauth/v2/authorize?client_id=1&state=s', nonce: NONCE, expiresAt: '2026-10-23T20:00:00.000Z' }],
      [`GET /slack/oauth/result/${NONCE}`]: () => (asked++ < 1 ? [200, { status: 'pending' }] : [200, { status: 'done', instanceId: CHANNEL }]),
    })
    assert.deepEqual(await run('omni-slack-app'), { configured: true })
    const started = await run('omni-slack-start', { mode })
    assert.deepEqual(started, { configured: true, authorizeUrl: 'https://slack.com/oauth/v2/authorize?client_id=1&state=s', nonce: NONCE })
    assert.deepEqual(calls.find(call => call.path === '/slack/oauth/start').body, { mode, entry: 'ui' })
    assert.deepEqual(await run('omni-slack-result', { nonce: NONCE }), { status: 'pending' })
    assert.deepEqual(await run('omni-slack-result', { nonce: NONCE }), { status: 'done', id: CHANNEL })
    // A finished sign-in is not this page's to ask about again.
    await assert.rejects(run('omni-slack-result', { nonce: NONCE }), /Unknown Slack sign-in/)
  }
})

test('Slack not set up on the Omni says so, and a sign-in that is not Slack\'s is never opened', async () => {
  const off = host({
    'GET /slack/app': () => [200, { configured: false, missing: ['slack.client_id'] }],
    'POST /slack/oauth/start': () => [409, { error: { code: 'SLACK_APP_NOT_CONFIGURED', message: 'Slack app is not configured; missing settings: slack.client_id' } }],
  })
  assert.deepEqual(await off.run('omni-slack-app'), { configured: false })
  assert.deepEqual(await off.run('omni-slack-start', { mode: 'bot' }), { configured: false })
  const odd = host({ 'POST /slack/oauth/start': () => [200, { authorizeUrl: 'https://evil.example/authorize', nonce: NONCE }] })
  await assert.rejects(odd.run('omni-slack-start', { mode: 'bot' }), /not Slack's/)
  await assert.rejects(odd.run('omni-slack-start', { mode: 'admin' }), /Pick how Omni joins Slack/)
  // A nonce this host did not start is refused before Omni is asked.
  await assert.rejects(off.run('omni-slack-result', { nonce: 'slackoauth_someoneelse1' }), /Unknown Slack sign-in/)
})

test('a Slack sign-in that ended badly shows Slack\'s words', async () => {
  const { run } = host({
    'POST /slack/oauth/start': () => [200, { authorizeUrl: 'https://slack.com/oauth/v2/authorize?x=1', nonce: NONCE }],
    [`GET /slack/oauth/result/${NONCE}`]: () => [200, { status: 'error', code: 'access_denied', message: 'The person cancelled in Slack.' }],
  })
  await run('omni-slack-start', { mode: 'user' })
  assert.deepEqual(await run('omni-slack-result', { nonce: NONCE }), { status: 'error', message: 'The person cancelled in Slack.' })
})

// -------------------------------------------------------------------------
// WhatsApp Business

const META = { name: 'WhatsApp Business', accessToken: 'EAAGsecret-meta-token', phoneNumberId: '123456789012345', wabaId: '987654321098765' }

test('WhatsApp Business: created and connected with the Meta details, and the token never comes back', async () => {
  const { run, calls } = host({
    'POST /instances': body => [201, { data: { id: CHANNEL, name: body.name, channel: body.channel } }],
    [`POST /instances/${CHANNEL}/whatsapp-business/connect`]: () => [200, { data: { connected: true } }],
  })
  const made = await run('omni-wab-connect', META)
  assert.deepEqual(made, { id: CHANNEL, type: 'whatsapp-business', name: 'WhatsApp Business' })
  assert.deepEqual(calls[0].body, { name: 'WhatsApp Business', channel: 'whatsapp-business' })
  assert.deepEqual(calls[1].body, { accessToken: META.accessToken, phoneNumberId: META.phoneNumberId, wabaId: META.wabaId })
  assert.doesNotMatch(JSON.stringify(made), /EAAG/)
})

test('WhatsApp Business details Meta refuses leave no channel behind, and say why', async () => {
  const { run, calls } = host({
    'POST /instances': body => [201, { data: { id: CHANNEL, name: body.name, channel: body.channel } }],
    [`POST /instances/${CHANNEL}/whatsapp-business/connect`]: () => [400, { error: { code: 'META_API_ERROR', message: 'Invalid OAuth access token.' } }],
    [`DELETE /instances/${CHANNEL}`]: () => [200, { data: { deleted: true } }],
  })
  await assert.rejects(run('omni-wab-connect', META), /Invalid OAuth access token/)
  assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), ['POST /instances', `POST /instances/${CHANNEL}/whatsapp-business/connect`, `DELETE /instances/${CHANNEL}`])
  await assert.rejects(run('omni-wab-connect', { ...META, phoneNumberId: 'abc' }), /phone number ID/)
})

// -------------------------------------------------------------------------
// Discord and Telegram

test('Discord: the invite carries the bot\'s application id and the permissions Omni needs, never the token', async () => {
  const appId = '1234567890123456789'
  const token = `${Buffer.from(appId).toString('base64').replace(/=+$/, '')}.GhIjKl.secret-part-of-the-token`
  const url = new URL(discordInviteUrl(token))
  assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize')
  assert.equal(url.searchParams.get('client_id'), appId)
  assert.equal(url.searchParams.get('scope'), 'bot applications.commands')
  const permissions = BigInt(url.searchParams.get('permissions'))
  assert.equal(permissions, DISCORD_PERMISSIONS)
  for (const bit of [10n, 11n, 16n, 38n]) assert.equal((permissions >> bit) & 1n, 1n, `permission bit ${bit}`)
  assert.doesNotMatch(url.href, /secret-part/)
  assert.equal(discordInviteUrl('not-a-token'), null)

  const { run } = host({ 'POST /instances': body => [201, { data: { id: CHANNEL, name: body.name, channel: body.channel } }] })
  const made = await run('omni-channel-create', { type: 'discord', name: 'Discord', token })
  assert.equal(new URL(made.inviteUrl).searchParams.get('client_id'), appId)
  assert.doesNotMatch(JSON.stringify(made), /secret-part/)
})

test('a copied Telegram token is recognized, anything else is not, and a refused clipboard says nothing', async () => {
  const token = '7123456789:AAHk3vZ2-abcdefghijklmnopqrstuvwxyz12'
  assert.equal(isTelegramToken(token), true)
  assert.equal(isTelegramToken(` ${token}\n`), true)
  assert.equal(isTelegramToken('7123456789:short'), false)
  assert.equal(isTelegramToken('hello there'), false)
  assert.equal(await copiedTelegramToken(async () => `${token}\n`), token)
  assert.equal(await copiedTelegramToken(async () => 'a shopping list'), null)
  assert.equal(await copiedTelegramToken(async () => { throw new Error('NotAllowedError') }), null)
  // The page reads the clipboard only through this function, called from a focus handler.
  const { readFile } = await import('node:fs/promises')
  const page = await readFile(new URL('../src/client/channel-connect-live.js', import.meta.url), 'utf8')
  assert.equal(page.match(/clipboard\.readText\(/g)?.length, 1)
  assert.match(page, /addEventListener\('focus', onFocus\)[\s\S]*?\n/)
  assert.match(page.slice(page.indexOf('const onFocus'), page.indexOf("addEventListener('focus'")), /clipboard\.readText/)
})

test('the bot\'s chat link comes from its username only', () => {
  assert.equal(telegramChat('@omni_helper_bot'), 'https://t.me/omni_helper_bot')
  assert.equal(telegramChat('omni_helper_bot'), 'https://t.me/omni_helper_bot')
  assert.equal(telegramChat('Omni Helper'), null)
  assert.equal(telegramChat(null), null)
})

// -------------------------------------------------------------------------
// The update bar

test('the update bar: one action when this Omni can update, a note when its admin does, nothing otherwise', () => {
  assert.deepEqual(updateBar({ state: 'available', latest: '2.261023.25', current: '2.261023.12' }), { kind: 'available', latest: '2.261023.25', current: '2.261023.12', action: 'update' })
  assert.deepEqual(updateBar({ state: 'available', latest: '2.261023.25', current: '2.261023.12', confirm: 'app' }), { kind: 'available', latest: '2.261023.25', current: '2.261023.12', action: 'update', confirm: 'app' })
  assert.deepEqual(updateBar({ state: 'off', latest: '2.261023.25', current: '2.261023.12', command: 'omni update' }), { kind: 'admin', latest: '2.261023.25', action: 'how', command: 'omni update' })
  assert.deepEqual(updateBar({ state: 'pending', version: '2.261023.25' }), { kind: 'pending', version: '2.261023.25', action: 'none' })
  assert.deepEqual(updateBar({ state: 'updating', version: '2.261023.25' }), { kind: 'updating', version: '2.261023.25', action: 'none' })
  for (const state of ['current', 'unknown', 'unreachable', 'terminal', 'none']) assert.equal(updateBar({ state, latest: '2.261023.25' }), null, state)
  assert.equal(updateBar(null), null)
})

// The bar loaded while the Omni ran 2.261025.22; it was updated to 2.261026.11 meanwhile, and
// asking then got ALREADY_CURRENT under a bar still offering it.
test('the update bar looks again before it asks, and lets go when the Omni already runs it', async () => {
  const available = { state: 'available', latest: '2.261026.11', current: '2.261025.22' }
  const current = { state: 'current', latest: '2.261026.11', current: '2.261026.11' }
  const calls = []
  const answering = (looks, request) => async (endpoint, body) => {
    calls.push(endpoint)
    if (endpoint === 'omni-update-status') return looks.shift()
    return request(body)
  }
  // Updated meanwhile: the fresh look says so, and nothing is asked.
  assert.deepEqual(await askUpdate(answering([current], () => assert.fail('asked')), '2.261026.11'), { status: current })
  assert.deepEqual(calls, ['omni-update-status'])
  // Still out: it asks.
  calls.length = 0
  assert.deepEqual(await askUpdate(answering([available], (body) => ({ state: 'awaiting-confirmation', version: body.version })), '2.261026.11'), { reply: { state: 'awaiting-confirmation', version: '2.261026.11' } })
  assert.deepEqual(calls, ['omni-update-status', 'omni-update-request'])
  // Updated between the look and the ask: the refusal comes with the look after it, which no longer offers it.
  const refusal = await askUpdate(answering([available, current], () => { throw new Error('This Omni is up to date.') }), '2.261026.11').catch(error => error)
  assert.equal(refusal.message, 'This Omni is up to date.')
  assert.deepEqual([refusal.stale, refusal.status], [true, current])
  // A refusal that leaves it on offer (WhatsApp unreachable, say) is shown, not dropped.
  const kept = await askUpdate(answering([available, available], () => { throw new Error('Omni could not send the confirmation to WhatsApp. Try again.') }), '2.261026.11').catch(error => error)
  assert.equal(kept.stale, false)
})

test('the update bar looks now, when the window comes back, and every ten minutes, until it goes', () => {
  let looks = 0
  const listeners = new Map()
  const doc = { visibilityState: 'hidden', addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) }
  const intervals = []
  const timers = { setInterval: (fn, ms) => intervals.push({ fn, ms }) - 1, clearInterval: index => { intervals[index] = null } }
  const stop = watchStatus(() => { looks += 1 }, { doc, timers })
  assert.equal(looks, 1)
  assert.equal(intervals[0].ms, 10 * 60_000)
  intervals[0].fn()
  assert.equal(looks, 2)
  listeners.get('visibilitychange')()
  assert.equal(looks, 2, 'hidden: no look')
  doc.visibilityState = 'visible'
  listeners.get('visibilitychange')()
  assert.equal(looks, 3)
  stop()
  assert.equal(intervals[0], null)
  assert.equal(listeners.size, 0)
})

test('a dismissed version stays hidden until the next one, per Omni', () => {
  const kept = new Map()
  const store = { getItem: key => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, value) }
  assert.equal(dismissedFor('https://omni.lembr.ai', store), null)
  dismiss('https://omni.lembr.ai', '2.261023.25', store)
  const dismissed = dismissedFor('https://omni.lembr.ai', store)
  assert.equal(updateBar({ state: 'available', latest: '2.261023.25' }, dismissed), null)
  assert.equal(updateBar({ state: 'off', latest: '2.261023.25' }, dismissed), null)
  assert.equal(updateBar({ state: 'available', latest: '2.261023.26' }, dismissed).kind, 'available')
  assert.equal(dismissedFor('http://127.0.0.1:18882', store), null)
  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.equal(dismissedFor('x', broken), null)
  assert.doesNotThrow(() => dismiss('x', '1', broken))
})

test('no endpoint here returns a key, token or access token to the page', async () => {
  const { run } = host({
    'POST /instances': body => [201, { data: { id: CHANNEL, name: body.name, channel: body.channel, token: body.token } }],
    [`POST /instances/${CHANNEL}/whatsapp-business/connect`]: () => [200, { data: { connected: true, accessToken: META.accessToken } }],
    'GET /slack/app': () => [200, { configured: true, clientSecret: 'slack-secret' }],
    'POST /slack/oauth/start': () => [200, { authorizeUrl: 'https://slack.com/oauth/v2/authorize?x=1', nonce: NONCE, clientSecret: 'slack-secret' }],
  })
  const replies = [
    await run('omni-channel-create', { type: 'telegram', name: 'Telegram', token: '7123456789:AAHk3vZ2-abcdefghijklmnopqrstuvwxyz12' }),
    await run('omni-wab-connect', META),
    await run('omni-slack-app'),
    await run('omni-slack-start', { mode: 'bot' }),
  ]
  const text = JSON.stringify(replies)
  for (const secret of [KEY, 'AAHk3vZ2', 'EAAG', 'slack-secret']) assert.doesNotMatch(text, new RegExp(secret))
})
