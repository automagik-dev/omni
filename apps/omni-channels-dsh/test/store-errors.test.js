import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STRINGS } from '../src/client/strings.js'
import { omni } from './omni-client.js'
import { bundleClient, byLabel, mount, nodes, react, settle, text } from './client-stand-in.js'

const probes = ['<img src=x onerror=alert(1)>REMOTE', '\u001b[31m\u009b31mREMOTE\u202e', 'REMOTE-' + 'x'.repeat(5000)]
let answer = async () => ({}), warnings = []
const timers = new Map()
let timerId = 0
class Terminal {
  cols = 80
  open() {}
  focus() {}
  resize() {}
  write() {}
  dispose() {}
  onData() { return { dispose() {} } }
}
const ui = await bundleClient([
  "export { omniStore, omniActions, loadMessages, startLive } from './omni-store.js'",
  "export { ChannelsPage, ChatPage } from './channels.js'",
  "export { LiveChannel, LiveQr, OmniCallCard, OmniToolCard, errorText } from './omni-live.js'",
  "export { ThreadDefaultsCard, FreeReactionsCard, OmniSettingsSection } from './omni-settings.js'",
  "export { UpdateBar } from './omni-update.js'",
  "export { InlineTerminal, footFor } from './omni-terminal.js'",
  "export { ThreadRow } from './omni-tree.js'",
  "export { PhonePane } from './omni-phone.js'",
  "export { ConnectOmni } from './omni-connect.js'",
  "export { ChannelSettings } from './channel-settings.js'",
], { team: { omni: { ...omni, call: (...args) => answer(...args) } }, modules: {
  '@xterm/xterm': { Terminal }, '@xterm/xterm/css/xterm.css': '',
}, globals: {
  URL, URLSearchParams, navigator: {}, performance: { now: () => 1 }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  window: { addEventListener() {}, removeEventListener() {} },
  document: { hidden: false, createElement: () => ({}), addEventListener() {}, removeEventListener() {} },
  console: { ...console, warn: (...args) => warnings.push(args) },
  setTimeout: fn => { timers.set(++timerId, fn); return timerId }, clearTimeout: id => timers.delete(id),
  setInterval: () => 0, clearInterval() {},
} })
const fresh = ui.omniStore.getSnapshot()
const channel = { id: 'channel', name: 'Sales', type: 'telegram', status: 'connected', detail: 'Bot', answeredBy: 'You', health: {} }
const chat = { id: 'chat', channelId: 'channel', name: 'Marina', at: 1, unread: 0 }
const thread = { id: 'thread', sessionId: 'session', chatId: 'chat', channelId: 'channel', title: 'Marina', connected: false, reason: null }
function reset() {
  warnings = []; timers.clear()
  ui.omniStore.set({ ...fresh, preview: false, channels: [channel], chats: [chat], messages: { chat: [] }, chatId: 'chat', abilities: { changeChannels: true, send: true }, source: { kind: 'live' }, page: { view: 'overview' } })
  answer = async endpoint => {
    if (endpoint === 'omni-discover') return { omnis: [] }
    if (endpoint === 'omni-thread-defaults') return { threadSends: 'ask', threadReactions: 'list', askFirstDefault: true }
    if (endpoint === 'omni-free-reactions') return { freeReactions: ['👍'], defaults: ['👍'] }
    if (endpoint === 'omni-link-info') return { linked: true, origin: 'omni.example.com' }
    if (endpoint === 'omni-channel-settings') return { settings: { triggerReactions: [], inboundMaxAgeMinutes: 1, processAudio: true } }
    if (endpoint === 'omni-channel-agents') return { items: [] }
    return {}
  }
}
const actions = { selectPanel() {} }
const element = (Component, props = {}, options) => mount(() => react.createElement(Component, props), options)
const page = () => element(ui.ChannelsPage, { actions })
async function draw(view) { for (let i = 0; i < 4; i++) { view.draw(); await settle() } return view.draw() }
const button = (view, label) => nodes(view.draw()).find(n => n.type === 'button' && text(n) === label)
async function click(view, label) { const b = button(view, label); assert.ok(b, label); await b.props.onClick(); return draw(view) }
function clean(tree, raw, expected) {
  const shown = [text(tree), ...nodes(tree).flatMap(n => Object.values(n.props ?? {}).filter(value => typeof value === 'string'))].join(' ')
  assert.ok(shown.includes(expected), `expected ${expected}`)
  assert.equal(text(tree).includes(raw), false, 'raw error absent from text')
  for (const n of nodes(tree)) for (const [key, value] of Object.entries(n.props ?? {}))
    if (typeof value === 'string') assert.equal(value.includes(raw), false, `raw error absent from ${key}`)
  const contains = value => value === raw || value?.message === raw || (value !== null && typeof value === 'object' && Object.values(value).some(contains))
  assert.ok(warnings.some(contains), 'diagnostic logged')
}
const cases = [
  ['channel action', 'Could not change this channel. Try again.', async raw => {
    ui.omniActions(() => {}, async () => { throw new Error(raw) }).pause('channel')
    await settle(); await settle(); ui.omniStore.set(s => ({ ...s, page: { view: 'channel', channelId: 'channel' } })); return page()
  }],
  ['send', 'Could not send this message. Check your connection and access, then try again.', async raw => {
    ui.omniActions(() => {}, async () => { throw new Error(raw) }).sendText('chat', 'My own message')
    await settle(); assert.equal(ui.omniStore.getSnapshot().sendError.text, 'My own message'); return element(ui.ChatPage, { actions })
  }],
  ['delete', 'Could not delete this instance. Check your access or connection, then try again.', async raw => {
    await ui.omniActions(() => {}, async () => { throw new Error(raw) }).deleteInstance('channel')
    ui.omniStore.set(s => ({ ...s, page: { view: 'channel', channelId: 'channel' } })); return page()
  }],
  ['refresh after delete', 'Instance deleted, but the overview could not refresh. Refresh or wait for the next update.', async raw => {
    await ui.omniActions(() => {}, async endpoint => { if (endpoint === 'omni-overview') throw new Error(raw); return {} }).deleteInstance('channel'); return page()
  }],
  ['message load', 'Could not load messages. Retrying soon.', async raw => {
    await ui.loadMessages(async () => { throw new Error(raw) }, 'chat'); return page()
  }],
  ['overview poll', 'Could not refresh channels. Retrying soon.', async raw => {
    const stop = ui.startLive(async () => { throw new Error(raw) }); await settle(); stop(); return page()
  }],
  ['live GET catch', 'Could not load this Omni data. Retrying soon.', async raw => {
    answer = async () => { throw new Error(raw) }; return element(ui.LiveChannel, { id: 'channel' })
  }],
  ['live GET refusal', 'Omni could not complete this request. Try again.', async raw => {
    answer = async () => ({ ok: false, status: 500, data: { error: { message: raw } } }); return element(ui.LiveChannel, { id: 'channel' })
  }],
  ['tool call refusal', 'Omni could not complete this request. Try again.', async raw => element(ui.OmniCallCard, { method: 'GET', path: '/events', done: true, result: { status: 500, data: { error: { message: raw } } } })],
  ['tool runtime error', 'Omni could not complete this request. Try again.', async raw => element(ui.OmniToolCard, { tool: 'omni_send', arg: () => undefined, done: true, content: JSON.stringify({ error: raw }) })],
  ['QR status message', 'Live · refreshes by itself', async raw => {
    answer = async () => ({ ok: true, data: { data: { message: raw } } }); return element(ui.LiveQr, { channelId: 'channel' })
  }],
  ['thread defaults', 'Could not save these defaults. Try again.', async raw => {
    const view = element(ui.ThreadDefaultsCard); await draw(view); const old = answer; answer = async endpoint => { if (endpoint === 'omni-thread-defaults-save') throw new Error(raw); return old(endpoint) }
    const select = nodes(view.draw()).find(n => n.type === 'select'); assert.ok(select); await select.props.onChange({ target: { value: 'allow' } }); return view
  }],
  ['free reactions', 'Could not save these reactions. Try again.', async raw => {
    const view = element(ui.FreeReactionsCard); await draw(view); answer = async () => { throw new Error(raw) }; await click(view, 'Save'); return view
  }],
  ['disconnect', 'Could not disconnect this Omni. Try again.', async raw => {
    const view = element(ui.OmniSettingsSection, { close() {} }); await draw(view); await click(view, 'Disconnect'); answer = async () => { throw new Error(raw) }; await click(view, 'Disconnect'); return view
  }],
  ['update', 'Could not request the update. Check your connection and access, then try again.', async raw => {
    answer = async endpoint => { if (endpoint === 'omni-update-request') throw new Error(raw); return { state: 'available', current: '1', latest: '2' } }
    const view = element(ui.UpdateBar, { origin: 'omni.example.com' }); await draw(view); await click(view, 'Update'); return view
  }],
  ['terminal open', 'Could not run this command. Read the terminal output, then try again.', async raw => {
    answer = async () => { throw new Error(raw) }; return element(ui.InlineTerminal, { kind: 'install', title: 'Install Omni' }, { refs: true })
  }],
  ['terminal read', 'Could not run this command. Read the terminal output, then try again.', async raw => {
    answer = async endpoint => { if (endpoint === 'omni-terminal-read') throw new Error(raw); return { terminal: 'term', state: 'ready' } }; return element(ui.InlineTerminal, { kind: 'install', title: 'Install Omni' }, { refs: true })
  }],
  ['thread row', 'Not connected. Try reconnecting this chat.', async raw => element(ui.ThreadRow, { thread: { ...thread, reason: raw }, actions: {}, rowProps: { roster: { omniRowProps: ['useSessionStatus'] } } })],
  ['phone row reason', 'Not connected. Try reconnecting this chat.', async raw => {
    answer = async () => ({ messages: [] }); return element(ui.PhonePane, { params: { threadId: 'thread' }, sessionId: 'session', useRoster: select => select({ omniThreads: [{ ...thread, reason: raw }] }) })
  }],
  ['channel overview status', 'Omni does not report this channel as connected.', async raw => {
    ui.omniStore.set(s => ({ ...s, channels: [{ ...channel, status: 'attention', problem: raw, problemCode: 'not_connected' }] })); return page()
  }],
  ['channel detail status', 'Omni does not report this channel as connected.', async raw => {
    ui.omniStore.set(s => ({ ...s, page: { view: 'channel', channelId: 'channel' }, channels: [{ ...channel, status: 'attention', problem: raw, problemCode: 'not_connected' }] })); return page()
  }],
]
for (const [spot, expected, run] of cases) test(`store error privacy: ${spot}`, async () => {
  for (const raw of probes) { reset(); const view = await run(raw); try { clean(await draw(view), raw, expected) } finally { view.unmount() } }
})
test('store error privacy: terminal reply errors and tool error text stay diagnostic', () => {
  for (const raw of probes) {
    reset(); assert.equal(ui.footFor({ state: 'failed', error: raw }), 'Could not run this command. Read the terminal output, then try again.')
    assert.equal(ui.errorText(raw, 500), 'Omni could not complete this request. Try again.')
  }
})
test('store error privacy: all fixed guidance has Chinese copy', () => {
  for (const key of new Set(cases.map(([, expected]) => expected))) assert.match(STRINGS[key], /[\u3400-\u9fff]/, key)
})

const keyCodes = [
  ['bot/bad-key', 'Paste the whole API key.'],
  ['bot/bad-address', 'Give the address of the Omni, like omni.example.com'],
  ['bot/key-refused', 'Omni did not accept that key. Check the key and try again.'],
]
async function keyFailure(code, raw) {
  const old = answer
  answer = async endpoint => {
    if (endpoint === 'omni-pair-start') return { status: 'unavailable', url: 'https://omni.example.com', reason: 'off' }
    if (endpoint === 'omni-discover-key') throw Object.assign(new Error(raw), { code })
    return old(endpoint)
  }
  const view = element(ui.ConnectOmni); await draw(view)
  byLabel(view.draw(), 'Omni address or link').props.onChange({ target: { value: 'https://omni.example.com' } })
  const form = nodes(view.draw()).find(n => n.type === 'form' && nodes(n).some(c => c.props?.['aria-label'] === 'Omni address or link'))
  await form.props.onSubmit({ preventDefault() {} }); await draw(view)
  byLabel(view.draw(), 'API key for this Omni').props.onChange({ target: { value: 'omni_sk_own_key' } })
  const keyForm = nodes(view.draw()).find(n => n.type === 'form' && nodes(n).some(c => c.props?.['aria-label'] === 'API key for this Omni'))
  await keyForm.props.onSubmit({ preventDefault() {} })
  return view
}
for (const [code, expected] of keyCodes) test(`store curated guidance: ${code}`, async () => {
  for (const raw of probes) {
    reset(); const view = await keyFailure(code, raw)
    try { clean(await draw(view), raw, expected); assert.match(STRINGS[expected], /[\u3400-\u9fff]/) } finally { view.unmount() }
  }
})
for (const [field, expected] of [
  ['triggerReactions', 'Enter valid JSON for triggerReactions.'],
  ['inboundMaxAgeMinutes', 'Enter a nonnegative integer for inboundMaxAgeMinutes.'],
  ['processAudio', 'Choose true or false for processAudio.'],
  ['triggerMode', 'Choose an available value for triggerMode.'],
]) test(`store curated validation: ${field}`, async () => {
  for (const raw of probes) {
    reset(); const view = element(ui.ChannelSettings, { channel: { id: 'channel', type: 'telegram' }, writable: true })
    await draw(view)
    byLabel(view.draw(), field).props.onChange({ target: { value: raw } })
    await click(view, 'Save settings')
    const tree = await draw(view)
    assert.ok(text(tree).includes(expected)); assert.equal(text(tree).includes(raw), false)
    assert.equal(byLabel(tree, field).props.value, raw, 'retain the person\'s own editable input')
    for (const n of nodes(tree)) for (const key of ['title', 'aria-label']) assert.equal(String(n.props?.[key] ?? '').includes(raw), false)
    assert.ok(warnings.some(args => args.some(v => v?.field === field)))
    view.unmount()
  }
})
test('store reason codes: non-string, inherited and unknown codes cannot select curated guidance', async () => {
  for (const code of [undefined, 'unknown', '__proto__', 'constructor', ['chat_key_limit'], new String('chat_key_limit'), { toString: () => 'chat_key_limit' }]) {
    reset(); const raw = probes[0]
    const view = element(ui.ThreadRow, { thread: { ...thread, reason: raw, reasonCode: code }, rowProps: { roster: { omniRowProps: ['useSessionStatus'] } }, actions: {} })
    try { clean(await draw(view), raw, 'Not connected. Try reconnecting this chat.') } finally { view.unmount() }
  }
})
test('store reason codes: known thread codes carry fixed translated guidance to text and props', async () => {
  for (const [reasonCode, expected] of [
    ['not_linked', 'Not connected: this app is not linked to an Omni.'],
    ['other_omni', 'Not connected: this app is linked to another Omni.'],
    ['being_cut', 'Not connected: its previous key is still being cut.'],
    ['waiting', 'Not connected: waiting for a key from the linked Omni.'],
    ['no_key', 'Not connected: this thread has no key.'],
    ['needs_newer_team', 'Adding a chat needs a newer Bot team.'],
    ['omni_unreachable', 'Could not reach Omni. Try again in a moment.'],
    ['chat_keys_unavailable', 'Omni cannot make chat keys; update it.'],
    ['chat_key_limit', 'This app holds as many chat keys as Omni allows.'],
  ]) for (const raw of probes) {
    reset(); const view = element(ui.ThreadRow, { thread: { ...thread, reason: raw, reasonCode }, rowProps: { roster: { omniRowProps: ['useSessionStatus'] } }, actions: {} })
    try { clean(await draw(view), raw, expected); assert.match(STRINGS[expected], /[\u3400-\u9fff]/) } finally { view.unmount() }
  }
})

test('store key guidance: inherited and non-string codes stay generic', async () => {
  for (const code of ['__proto__', 'constructor', ['bot/bad-key'], new String('bot/key-refused'), { toString: () => 'bot/bad-address' }]) {
    reset(); const raw = probes[0], view = await keyFailure(code, raw)
    try { clean(await draw(view), raw, 'Could not connect to Omni. Try again.') } finally { view.unmount() }
  }
})
