import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bundleClient, mount, nodes, react, settle, text } from './client-stand-in.js'
import { omni } from './omni-client.js'

// The WhatsApp Business page's Kapso path (#1676): the key only while Omni has none, a setup
// link opened in a new tab and kept, the project's numbers with a refresh, Connect, and a test
// message sent only when the person presses it. `call` answers from `replies`.
const NUMBERS = [
  { phoneNumberId: '106540352242922', wabaId: '102290129340398', displayPhoneNumber: '+55 11 91234-5678', name: 'Loja Centro' },
  { phoneNumberId: '106540352242923', wabaId: '102290129340398', displayPhoneNumber: '+1 555-010-0199', name: null },
]
let calls = []
let replies = {}
const opened = []
const ui = await bundleClient(["export { LiveConnectFlow } from './channel-connect-live.js'"], {
  team: { omni: { ...omni, call: async (endpoint, body) => {
    calls.push([endpoint, body === undefined ? undefined : JSON.parse(JSON.stringify(body))])
    const reply = replies[endpoint]
    if (reply instanceof Error) throw reply
    return typeof reply === 'function' ? reply(body) : reply ?? {}
  } } },
  globals: { window: { open: (...args) => opened.push(args) }, setTimeout, clearTimeout },
})
const page = () => mount(() => react.createElement(ui.LiveConnectFlow, { state: { page: { type: 'whatsapp-business' } }, omni: {}, Tile: () => null, PreviewChip: () => null }))
async function draw(view) { for (let index = 0; index < 3; index++) { view.draw(); await settle() } return view.draw() }
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node) === label)
const radio = (tree, start) => nodes(tree).find(node => node.type === 'button' && node.props.role === 'radio' && text(node).startsWith(start))
const press = async (view, control) => { assert.ok(control); await control.props.onClick(); return draw(view) }
const type = (view, node, value) => { assert.ok(node); node.props.onChange({ target: { value } }); return view.draw() }
const named = name => calls.filter(([endpoint]) => endpoint === name)
// The input a visible <label> names.
const field = (tree, label) => nodes(nodes(tree).find(node => node.type === 'label' && text(node).startsWith(label))).find(node => node.type === 'input')

test('with no key saved the page asks for it, saves it once and then shows the numbers', async () => {
  calls = []
  let saved = false
  replies = {
    'omni-kapso-numbers': () => (saved ? { configured: true, numbers: NUMBERS, publicAddress: true } : { configured: false }),
    'omni-kapso-key': () => { saved = true; return { saved: true } },
  }
  const view = page()
  let tree = await draw(view)
  assert.equal(radio(tree, 'Through Kapso').props['aria-checked'], true)
  tree = type(view, field(tree, 'Kapso project API key'), 'fixture-kapso-key')
  tree = await press(view, button(tree, 'Save key'))
  assert.deepEqual(named('omni-kapso-key'), [['omni-kapso-key', { apiKey: 'fixture-kapso-key' }]])
  assert.equal(field(tree, 'Kapso project API key'), undefined)
  assert.ok(radio(tree, '+55 11 91234-5678'))
  assert.ok(!text(tree).includes('fixture-kapso-key'))
  view.unmount()
})

test('a saved key skips the key step; the setup link opens in a new tab and stays on the page', async () => {
  calls = []
  opened.length = 0
  replies = {
    'omni-kapso-numbers': { configured: true, numbers: NUMBERS, publicAddress: true },
    'omni-kapso-setup-link': { url: 'https://app.kapso.ai/whatsapp/setup/abc', expiresAt: null },
  }
  const view = page()
  let tree = await draw(view)
  assert.equal(field(tree, 'Kapso project API key'), undefined)
  tree = await press(view, button(tree, 'Create setup link'))
  assert.deepEqual(opened, [['https://app.kapso.ai/whatsapp/setup/abc', '_blank', 'noopener,noreferrer']])
  const again = nodes(tree).find(node => node.type === 'a' && text(node) === 'Open the setup link again')
  assert.equal(again.props.href, 'https://app.kapso.ai/whatsapp/setup/abc')
  tree = await press(view, button(tree, 'Refresh'))
  assert.equal(named('omni-kapso-numbers').length, 2)
  // Meta's details and back: the same link, never a second one.
  tree = await press(view, radio(tree, 'With Meta'))
  tree = await press(view, radio(tree, 'Through Kapso'))
  assert.ok(nodes(tree).find(node => node.type === 'a' && text(node) === 'Open the setup link again'))
  assert.equal(named('omni-kapso-setup-link').length, 1)
  view.unmount()
})

test('pick a number, Connect, then a test message only when pressed, to the typed number', async () => {
  calls = []
  replies = {
    'omni-kapso-numbers': { configured: true, numbers: NUMBERS, publicAddress: true },
    'omni-kapso-connect': { id: 'channel-1', type: 'whatsapp-business', name: 'Loja Centro', detail: '+55 11 91234-5678' },
    'omni-kapso-test': { sent: true },
  }
  const view = page()
  let tree = await draw(view)
  assert.equal(button(tree, 'Connect').props.disabled, true)
  tree = await press(view, radio(tree, '+1 555-010-0199'))
  tree = await press(view, button(tree, 'Connect'))
  assert.deepEqual(named('omni-kapso-connect'), [['omni-kapso-connect', { name: '+1 555-010-0199', phoneNumberId: '106540352242923' }]])
  assert.ok(text(tree).includes('WhatsApp Business is connected'))
  assert.deepEqual(named('omni-kapso-test'), [])
  tree = type(view, field(tree, 'Send a test message to'), '+55 11 98888-7777')
  tree = await press(view, button(tree, 'Send a test message'))
  assert.deepEqual(named('omni-kapso-test'), [['omni-kapso-test', { id: 'channel-1', phone: '+55 11 98888-7777' }]])
  assert.ok(text(tree).includes('Sent. Look at that phone.'))
  view.unmount()
})

test('without a public address Connect stays off and the page says why; Kapso refusals show in plain words', async () => {
  calls = []
  replies = { 'omni-kapso-numbers': { configured: true, numbers: NUMBERS, publicAddress: false } }
  const view = page()
  let tree = await draw(view)
  tree = await press(view, radio(tree, '+55 11 91234-5678'))
  assert.equal(button(tree, 'Connect').props.disabled, true)
  assert.ok(text(tree).includes('Omni has no public https address'))
  view.unmount()

  replies = {
    'omni-kapso-numbers': { configured: true, numbers: NUMBERS, publicAddress: true },
    'omni-kapso-setup-link': new Error('Kapso refused to create a setup link: Customer is archived.'),
  }
  const failing = page()
  tree = await draw(failing)
  tree = await press(failing, button(tree, 'Create setup link'))
  assert.ok(text(tree).includes('Kapso refused to create a setup link: Customer is archived.'))
  failing.unmount()
})
