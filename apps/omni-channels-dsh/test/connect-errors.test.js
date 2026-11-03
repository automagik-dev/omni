import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STRINGS } from '../src/client/strings.js'
import { omni } from './omni-client.js'
import { bundleClient, byLabel, mount, nodes, react, settle, text } from './client-stand-in.js'

const probes = ['<img src=x onerror=alert(1)>REMOTE', '\u001b[31m\u009b31mREMOTE\u202e', 'REMOTE-' + 'x'.repeat(5000)]
const warnings = [], timers = new Map(), listeners = new Map()
let answer, timerId = 0
const window = {
  addEventListener: (name, fn) => listeners.set(name, fn),
  removeEventListener: name => listeners.delete(name),
  dispatchEvent: event => listeners.get(event.type)?.(event),
  open() {},
}
const ui = await bundleClient([
  "export { LiveConnectFlow } from './channel-connect-live.js'",
  "export { ChannelSettings } from './channel-settings.js'",
  "export { ChatMessages } from './channels.js'",
  "export { ConnectOmni, connectFromApp, unavailableWords } from './omni-connect.js'",
], { team: { omni: { ...omni, call: (...args) => answer(...args) } }, globals: {
  URL, URLSearchParams, window, navigator: {},
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } },
  console: { ...console, warn: (...args) => warnings.push(args) },
  setTimeout: fn => { timers.set(++timerId, fn); return timerId }, clearTimeout: id => timers.delete(id),
} })
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node) === label)
const click = async (view, label) => {
  const tree = view.draw(), control = button(tree, label)
  assert.ok(control, label)
  if (control.props.onClick) await control.props.onClick()
  else await nodes(tree).find(node => node.type === 'form' && nodes(node).includes(control)).props.onSubmit({ preventDefault() {} })
  await draw(view)
}
async function draw(view) { for (let index = 0; index < 3; index++) { view.draw(); await settle() } return view.draw() }
const change = (view, node, value) => { assert.ok(node); node.props.onChange({ target: { value } }); return view.draw() }
const input = (view, match) => nodes(view.draw()).find(node => node.type === 'input' && match(node.props))
const tick = async view => { const [id, run] = timers.entries().next().value; timers.delete(id); await run(); return draw(view) }
const defaults = endpoint => {
  if (endpoint === 'omni-channel-types') return { types: [] }
  if (endpoint === 'omni-channel-create') return { id: 'channel', name: 'My channel' }
  if (endpoint === 'omni-channel-pairing') return { connected: false }
  if (endpoint === 'omni-slack-app') return { configured: true }
  if (endpoint === 'omni-slack-start') return { configured: true, nonce: 'nonce', authorizeUrl: 'https://slack.com/authorize' }
  if (endpoint === 'omni-discover') return { omnis: [] }
  if (endpoint === 'omni-channel-settings') return { settings: { processAudio: true, metaPhoneNumberId: '12345678', metaWabaId: '23456789' } }
  if (endpoint === 'omni-channel-agents') return { items: [] }
  return {}
}
const flow = type => mount(() => react.createElement(ui.LiveConnectFlow, {
  state: { page: { type } }, omni: {}, Tile: () => null, PreviewChip: () => null,
}))
const settings = () => mount(() => react.createElement(ui.ChannelSettings, {
  channel: { id: 'channel', type: 'whatsapp-business' }, writable: true,
  request: (...args) => answer(...args), refresh: async () => {},
}))
const connect = () => mount(() => react.createElement(ui.ConnectOmni))
const failOn = (endpoint, raw) => { answer = async name => { if (name === endpoint) throw new Error(raw); return defaults(name) } }
const token = async view => {
  change(view, input(view, props => props.type === 'password'), 'fixture-bot-token')
  await click(view, 'Connect')
}
const business = async view => {
  change(view, input(view, props => props.type === 'password'), 'fixture-access-token')
  for (const node of nodes(view.draw()).filter(node => node.type === 'input' && node.props.inputMode === 'numeric')) change(view, node, '123456789')
  await click(view, 'Connect')
}
const remote = async view => {
  change(view, byLabel(view.draw(), 'Omni address or link'), 'https://omni.example.com')
  await click(view, 'Continue')
}
const clean = (tree, raw, expected) => {
  assert.ok(text(tree).includes(expected), expected)
  assert.equal(text(tree).includes(raw), false, 'raw diagnostic absent from text')
  for (const node of nodes(tree)) for (const key of ['title', 'aria-label'])
    assert.equal(String(node.props?.[key] ?? '').includes(raw), false, `raw diagnostic absent from ${key}`)
  assert.ok(warnings.some(args => args.some(value => value === raw || value?.message === raw)), 'raw diagnostic retained in console.warn')
}

const cases = [
  ['channel pairing poll', 'Could not refresh the connection. Retrying soon.', async raw => {
    failOn('omni-channel-pairing', raw); const view = flow('whatsapp-baileys'); await draw(view); await click(view, 'Show the code'); return view
  }],
  ['WhatsApp create', 'Could not create the channel. Try again.', async raw => {
    failOn('omni-channel-create', raw); const view = flow('whatsapp-baileys'); await draw(view); await click(view, 'Show the code'); return view
  }],
  ['phone code', 'Could not get a phone code. Try again.', async raw => {
    failOn('omni-channel-phone-code', raw); const view = flow('whatsapp-baileys'); await draw(view); await click(view, 'Show the code')
    await click(view, 'No camera? Link with your number instead')
    change(view, input(view, props => props.inputMode === 'tel'), '5511912345678'); await click(view, 'Get code'); return view
  }],
  ['bot token connect', 'Could not connect the bot. Check its token and try again.', async raw => {
    failOn('omni-channel-create', raw); const view = flow('telegram'); await draw(view); await token(view); return view
  }],
  ['bot pairing status message', 'Waiting for Omni to say the bot is up', async raw => {
    answer = async endpoint => endpoint === 'omni-channel-pairing' ? { connected: false, message: raw } : defaults(endpoint)
    const view = flow('telegram'); await draw(view); await token(view); return view
  }],
  ['Slack result', 'Slack did not finish the sign-in. Try again.', async raw => {
    answer = async endpoint => endpoint === 'omni-slack-result' ? { status: 'error', message: raw } : defaults(endpoint)
    const view = flow('slack'); await draw(view); await click(view, 'Connect with Slack'); await tick(view); return view
  }],
  ['Slack poll exception', 'Could not refresh the Slack sign-in. Retrying soon.', async raw => {
    failOn('omni-slack-result', raw); const view = flow('slack'); await draw(view); await click(view, 'Connect with Slack'); await tick(view); return view
  }],
  ['Slack start', 'Could not start the Slack sign-in. Try again.', async raw => {
    failOn('omni-slack-start', raw); const view = flow('slack'); await draw(view); await click(view, 'Connect with Slack'); return view
  }],
  ['Business connect', 'Could not connect the Business number. Check its details and try again.', async raw => {
    failOn('omni-wab-connect', raw); const view = flow('whatsapp-business'); await draw(view); await business(view); return view
  }],
  ['settings load', 'Could not load channel settings. Try again.', async raw => {
    failOn('omni-channel-settings', raw); const view = settings(); await draw(view); return view
  }],
  ['settings save', 'Could not save channel settings. Try again.', async raw => {
    failOn('omni-channel-settings-save', raw); const view = settings(); await draw(view)
    change(view, byLabel(view.draw(), 'processAudio'), 'false'); await click(view, 'Save settings'); return view
  }],
  ['settings repair', 'Credentials may have been saved. Reload this channel before retrying.', async raw => {
    failOn('omni-wab-repair', raw); const view = settings(); await draw(view)
    change(view, byLabel(view.draw(), 'Access token'), 'fixture-access-token'); await click(view, 'Repair and reconnect'); return view
  }],
  ['settings repair input exception', 'Check the Meta identifiers and try again.', async raw => {
    // An unexpected local read failure, separate from the fixed cleared-identifier guard.
    let failRead = false
    const record = { metaWabaId: '23456789', get metaPhoneNumberId() {
      if (failRead) { failRead = false; throw new Error(raw) }
      return '12345678'
    } }
    answer = async endpoint => endpoint === 'omni-channel-settings' ? { settings: record } : defaults(endpoint)
    const view = settings(); await draw(view)
    change(view, byLabel(view.draw(), 'Access token'), 'fixture-access-token')
    const repair = button(view.draw(), 'Repair and reconnect').props.onClick
    failRead = true; await repair(); await draw(view); return view
  }],
  ['media refusal tooltip', 'not available', async raw => {
    answer = async endpoint => endpoint === 'omni-media' ? { ok: false, reason: raw } : defaults(endpoint)
    const view = mount(() => react.createElement(ui.ChatMessages, { messages: [{ id: 'media', type: 'image', hasMedia: true, from: 'them', at: 1, text: '' }] }), { refs: true })
    await draw(view); return view
  }],
  ['media exception tooltip', 'not available', async raw => {
    failOn('omni-media', raw)
    const view = mount(() => react.createElement(ui.ChatMessages, { messages: [{ id: 'media', type: 'image', hasMedia: true, from: 'them', at: 1, text: '' }] }), { refs: true })
    await draw(view); return view
  }],
  ['desktop connect exception', 'Could not connect to Omni. Try again.', async raw => {
    failOn('omni-connect-grant', raw); const view = connect(); await draw(view); await ui.connectFromApp('https://omni.example.com', 'grant'); await draw(view); return view
  }],
  ['desktop unavailable reason', 'This Omni is too old to pair from here. Update it, or paste an API key or the link it sent you.', async raw => {
    answer = async endpoint => endpoint === 'omni-pair-start' ? { status: 'unavailable', reason: 'too-old', message: raw, version: raw } : defaults(endpoint)
    const view = connect(); await draw(view); await ui.connectFromApp('https://omni.example.com'); await draw(view); return view
  }],
  ['pairing event problem', 'Could not connect to Omni. Try again.', async raw => {
    const view = connect(); await draw(view)
    window.dispatchEvent({ type: 'omni:pairing', detail: { problem: raw } }); await draw(view); return view
  }],
  ['device poll exception', 'Could not check the sign-in. Retrying soon.', async raw => {
    answer = async endpoint => { if (endpoint === 'omni-pair-poll') throw new Error(raw); return endpoint === 'omni-pair-start' ? { pairing: { code: '123456', origin: 'omni.example.com', approveUrl: 'https://omni.example.com/approve' } } : defaults(endpoint) }
    const view = connect(); await draw(view); await remote(view); await tick(view); return view
  }],
  ['connect action exception', 'Could not connect to Omni. Try again.', async raw => {
    failOn('omni-pair-start', raw); const view = connect(); await draw(view); await remote(view); return view
  }],
  ['connect action message', 'Could not connect to Omni. Try again.', async raw => {
    answer = async endpoint => endpoint === 'omni-pair-start' ? { message: raw } : defaults(endpoint)
    const view = connect(); await draw(view); await remote(view); return view
  }],
  ['unknown unavailable reason', 'Could not connect to Omni. Try again.', async raw => {
    answer = async endpoint => endpoint === 'omni-pair-start' ? { status: 'unavailable', reason: 'unknown', message: raw } : defaults(endpoint)
    const view = connect(); await draw(view); await remote(view); return view
  }],
]
for (const [spot, expected, run] of cases) test(`connect error privacy: ${spot}`, async () => {
  for (const raw of probes) {
    warnings.length = 0; timers.clear(); listeners.clear(); answer = async endpoint => defaults(endpoint)
    const view = await run(raw)
    try { clean(await draw(view), raw, expected) } finally { view.unmount(); timers.clear(); listeners.clear() }
  }
})

test('connect error privacy: invalid settings keep the user input but show fixed validation guidance', async () => {
  for (const raw of probes) {
    warnings.length = 0; answer = async endpoint => defaults(endpoint)
    const view = settings(); await draw(view)
    change(view, byLabel(view.draw(), 'triggerReactions'), raw)
    await click(view, 'Save settings')
    const tree = view.draw()
    assert.ok(text(tree).includes('Check the settings values and try again.'))
    assert.equal(byLabel(tree, 'triggerReactions').props.value, raw, 'the user can correct their own input')
    assert.equal(text(tree).includes(raw), false)
    for (const node of nodes(tree)) for (const key of ['title', 'aria-label']) assert.equal(String(node.props?.[key] ?? '').includes(raw), false)
    assert.ok(warnings.some(args => args.some(value => value?.message === 'triggerReactions: enter valid JSON')))
    view.unmount()
  }
})

test('connect error privacy: every fixed line has Chinese copy', () => {
  for (const key of new Set([...cases.map(([, expected]) => expected), 'Check the settings values and try again.', 'Could not load this file. Try again.']))
    assert.match(STRINGS[key], /[\u3400-\u9fff]/, key)
})

test('connect error privacy: known unavailable reasons use fixed en/zh copy, with no remote version or message', () => {
  for (const [reason, expected] of [
    ['too-old', 'This Omni is too old to pair from here. Update it, or paste an API key or the link it sent you.'],
    ['off', 'Pairing is off on this Omni. Its owner can turn it on, or you can paste an API key.'],
  ]) for (const raw of probes) {
    warnings.length = 0
    const message = ui.unavailableWords({ reason, message: raw, version: raw })
    assert.equal(message, expected)
    assert.match(STRINGS[message], /[\u3400-\u9fff]/)
  }
  for (const reason of [null, '__proto__', 'constructor', 'toString', ['off'], new String('off'), { toString: () => 'off' }])
    assert.equal(ui.unavailableWords({ reason, message: probes[0] }), 'Could not connect to Omni. Try again.')
})
