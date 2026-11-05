import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/omni-channel-actions.js'
import { bundleClient, byLabel, mount, nodes, plain, react, settle, text } from './client-stand-in.js'
import { omni } from './omni-client.js'
const config = { callbackUrl: 'https://omni.example.com/api/v2/channels/whatsapp-business/webhook', verifyToken: 'test-verify-token', appSecretConfigured: true, state: 'ready' }
function host(status = 200, body = { data: config }) {
  const calls = [], registered = new Map()
  const rt = { ctx: { effect: fn => fn() }, hooks: { endpoint(name, _fn, options) { registered.set(name, options); return () => {} } },
    omniRequest: async (method, path) => { calls.push([method, path]); return new Response(JSON.stringify(body), { status }) } }
  install(rt)
  return { calls, registered, run: () => rt.omniChannelEndpoint('omni-wab-webhook-setup') }
}
test('host retrieves the authenticated endpoint, strips extras and preserves the writable-host gate', async () => {
  const f = host(200, { data: { ...config, appSecret: 'test-app-secret', accessToken: 'test-access-token' } })
  assert.deepEqual(await f.run(), { authorized: true, ...config })
  assert.deepEqual(f.calls, [['GET', '/channels/whatsapp-business/webhook-setup']])
  assert.notEqual(f.registered.get('omni-wab-webhook-setup')?.read, true)
})
test('host accepts the invalid-URL state and all states served by older Omni releases', async () => {
  for (const state of ['ready', 'public_url_missing', 'public_url_invalid', 'verify_token_missing']) {
    const value = { ...config, state,
      callbackUrl: state.startsWith('public_url_') ? null : config.callbackUrl,
      verifyToken: state === 'verify_token_missing' ? null : config.verifyToken }
    assert.deepEqual(await host(200, { data: value }).run(), { authorized: true, ...value })
  }
})
test('denied, failed and malformed responses never reflect secrets from server error bodies', async () => {
  for (const status of [401, 403]) assert.deepEqual(await host(status, { error: { message: 'test-secret' } }).run(), { authorized: false })
  for (const status of [404, 500]) await assert.rejects(host(status, { error: { message: 'test-secret' } }).run(), e => !e.message.includes('test-secret'))
  await assert.rejects(host(200, { data: { ...config, appSecretConfigured: 'test-secret' } }).run(), e => !e.message.includes('test-secret'))
})
const copies = []
let clipboardFails = false, callReply
const ui = await bundleClient([
  "export { MetaWebhookSetup } from './meta-webhook-setup.js'", "export { ChannelSettings } from './channel-settings.js'", "export { LiveConnectFlow } from './channel-connect-live.js'",
], { team: { omni: { ...omni, call: (...args) => callReply(...args) } }, globals: { navigator: { clipboard: { writeText: async value => { if (clipboardFails) throw Error('test-secret'); copies.push(value) } } }, setTimeout, clearTimeout } })
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node) === label)
function panel({ reply = { authorized: true, ...config }, writable = true, request } = {}) {
  const calls = []
  request ??= async name => { calls.push(name); return reply }
  const view = mount(() => react.createElement(ui.MetaWebhookSetup, { request, writable, initiallyOpen: true }))
  return { view, calls, async draw() { view.draw(); await settle(); return view.draw() } }
}
test('masked until reveal; copies are separate and give feedback; closing/reopening remasks and refetches', async () => {
  copies.length = 0
  const f = panel(); let tree = await f.draw()
  assert.equal(byLabel(tree, 'Verify token').props.type, 'password')
  assert.equal(byLabel(tree, 'Verify token').props.value, '••••••••')
  assert.ok(!JSON.stringify(plain(tree)).includes(config.verifyToken))
  await button(tree, 'Copy verify token').props.onClick()
  assert.ok(text(f.view.draw()).includes('Verify token copied'))
  await button(tree, 'Copy callback URL').props.onClick()
  assert.deepEqual(copies, [config.verifyToken, config.callbackUrl])
  button(tree, 'Reveal verify token').props.onClick(); tree = f.view.draw()
  assert.equal(byLabel(tree, 'Verify token').props.value, config.verifyToken)
  button(tree, 'Hide verify token').props.onClick(); tree = f.view.draw()
  assert.equal(byLabel(tree, 'Verify token').props.value, '••••••••')
  assert.ok(text(tree).includes('not your Graph API access token'))
  assert.ok(text(tree).includes('then verify and save'))
  button(tree, 'Close webhook setup').props.onClick(); tree = f.view.draw()
  assert.equal(byLabel(tree, 'Verify token'), undefined)
  button(tree, 'Show webhook setup').props.onClick(); tree = await f.draw()
  assert.equal(f.calls.length, 2)
  assert.equal(byLabel(tree, 'Verify token').props.type, 'password')
  f.view.unmount()
})
test('missing config and app-secret readiness are actionable; buttons cannot copy null', async () => {
  const f = panel({ reply: { authorized: true, callbackUrl: null, verifyToken: null, state: 'public_url_missing', appSecretConfigured: false } })
  const tree = await f.draw()
  for (const label of ['Copy callback URL', 'Reveal verify token', 'Copy verify token']) assert.equal(button(tree, label).props.disabled, true)
  for (const key of ['server.public_url', 'META_VERIFY_TOKEN', 'META_APP_SECRET']) assert.ok(text(tree).includes(key))
  f.view.unmount()
})
test('API denial and read-only team views say ask an admin without secret controls or read-only retrieval', async () => {
  for (const writable of [false, true]) {
    const f = panel({ reply: { authorized: false }, writable }); const tree = await f.draw()
    assert.ok(text(tree).includes('Callback URL unavailable'))
    assert.ok(text(tree).includes('ask an admin'))
    assert.equal(byLabel(tree, 'Verify token'), undefined)
    assert.equal(button(tree, 'Copy verify token'), undefined)
    if (!writable) assert.deepEqual(f.calls, [])
    f.view.unmount()
  }
})
test('copy and retrieval failures are safe and actionable', async () => {
  const f = panel(); const tree = await f.draw()
  clipboardFails = true
  try { await button(tree, 'Copy verify token').props.onClick() } finally { clipboardFails = false }
  assert.ok(text(f.view.draw()).includes('Could not copy'))
  assert.ok(!text(f.view.draw()).includes('test-secret'))
  f.view.unmount()
  const failed = panel({ request: async () => { throw Error(config.verifyToken) } }); const errorTree = await failed.draw()
  assert.ok(text(errorTree).includes('Could not load webhook setup'))
  assert.ok(!text(errorTree).includes(config.verifyToken))
  failed.view.unmount()
})
test('existing Business settings reopen setup without creating an instance; other channels have no Meta setup', async () => {
  const calls = []
  const request = async endpoint => { calls.push(endpoint); return endpoint === 'omni-channel-settings' ? { settings: {} } : endpoint === 'omni-channel-agents' ? { items: [] } : { authorized: true, ...config } }
  for (const type of ['whatsapp-business', 'telegram', 'slack', 'discord', 'whatsapp-baileys']) {
    const view = mount(() => react.createElement(ui.ChannelSettings, { channel: { id: 'existing', type }, writable: true, request }))
    view.draw(); await settle(); let tree = view.draw()
    assert.equal(!!button(tree, 'Show webhook setup'), type === 'whatsapp-business')
    if (type === 'whatsapp-business') { button(tree, 'Show webhook setup').props.onClick(); view.draw(); await settle(); tree = view.draw(); assert.equal(byLabel(tree, 'Callback URL').props.value, config.callbackUrl) }
    view.unmount()
  }
  assert.equal(calls.filter(name => name === 'omni-wab-webhook-setup').length, 1)
  assert.ok(calls.every(name => !['omni-wab-connect', 'omni-channel-create', 'omni-wab-repair'].includes(name)))
})
test('Business connect immediately shows setup with a masked token', async () => {
  const calls = []
  callReply = async (endpoint, payload) => { calls.push([endpoint, plain(payload)]); return endpoint === 'omni-channel-types' ? { types: ['whatsapp-business'] } : endpoint === 'omni-wab-connect' ? { id: 'created-channel', type: 'whatsapp-business', name: 'Business' } : { authorized: true, ...config } }
  const view = mount(() => react.createElement(ui.LiveConnectFlow, { state: { page: { type: 'whatsapp-business' } }, omni: {}, Tile: () => null, PreviewChip: () => null }))
  view.draw(); await settle(); let tree = view.draw()
  for (const [index, value] of ['test-access-token', '12345678', '23456789'].entries()) { nodes(tree).filter(n => n.type === 'input')[index].props.onChange({ target: { value } }); tree = view.draw() }
  await button(tree, 'Connect').props.onClick(); view.draw(); await settle(); tree = view.draw()
  assert.equal(byLabel(tree, 'Callback URL').props.value, config.callbackUrl)
  assert.equal(byLabel(tree, 'Verify token').props.value, '••••••••')
  assert.equal(calls.filter(([name]) => name === 'omni-wab-connect').length, 1)
  view.unmount()
})
