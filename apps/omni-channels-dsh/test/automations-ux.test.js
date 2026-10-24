import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { omni } from './omni-client.js'

// The automations board's quieter first run and the warning Omni's confirmation carries,
// out of their React. Bundled as DSH bundles the client, with stand-in React.
async function load() {
  const entry = 'export { boardOpensFor, headCount, savedOf, savedNotice, SavedAutomationCard, SubscriptionsButton } from \'./subscriptions.js\''
  const bundle = await build({
    stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../src/client/', import.meta.url)), loader: 'js' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom', '@automagik/omni-dsh/client'],
    loader: { '.css': 'text' },
  })
  const module = { exports: {} }
  // Elements come back as plain data, so a test can read what a component draws.
  const react = { createElement: (type, props, ...children) => ({ type: typeof type === 'function' ? type.name : type, props: props ?? {}, children: children.flat() }), Fragment: 'Fragment', useState: initial => [initial, () => {}], useEffect: () => {}, useSyncExternalStore: (_subscribe, get) => get() }
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, URL, require: name => ({ react, 'react-dom': { createPortal: node => node }, '@automagik/omni-dsh/client': { omni } })[name] })
  return module.exports
}
const ui = await load()

const roster = (subscriptions = []) => ({ eventsBotId: 'm1', byId: { m1: { id: 'm1', name: 'Omni' }, b2: { id: 'b2', name: 'Ops' } }, subscriptions })
const live = { source: { kind: 'live' } }
const preview = { source: { kind: 'preview', missing: ['url'] } }
const textOf = node => (node === null || node === undefined ? '' : typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''))

test('the board opens by itself once per Omni chat, and only with omni connected', () => {
  const opened = new Set()
  assert.equal(ui.boardOpensFor({ id: 'm1', opened, roster: roster(), omni: preview }), false, 'not connected: it would only say there is nothing to watch')
  assert.equal(ui.boardOpensFor({ id: 'm1', opened, roster: roster(), omni: live }), true)
  assert.equal(ui.boardOpensFor({ id: 'b2', opened, roster: roster(), omni: live }), false, 'only Omni\'s chat has the board')
  assert.equal(ui.boardOpensFor({ id: undefined, opened, roster: roster(), omni: live }), false)
  opened.add('m1')
  assert.equal(ui.boardOpensFor({ id: 'm1', opened, roster: roster(), omni: live }), false, 'once')
})

test('the header button counts automations only once there is one, and shows who waits', () => {
  assert.equal(ui.headCount(roster()), null)
  assert.equal(ui.headCount({}), null)
  assert.equal(ui.headCount(roster([{ id: 'sub-a', on: false }])), 1)
  assert.equal(ui.headCount(roster([{ id: 'sub-a', on: true }, { id: 'sub-b', on: false }])), 2)
  const button = (subs, approvals = []) => ui.SubscriptionsButton({ roster: { ...roster(subs), subscriptionRuns: [{ id: 'r1', status: 'working', sessionId: 's1' }] }, onToggle: () => {}, useWork: pick => pick({ approvals }) })
  assert.deepEqual(button([]).children.filter(Boolean).map(textOf), ['Automations'])
  assert.deepEqual(button([], [{ sessionId: 's1' }]).children.filter(Boolean).map(child => [child.props?.className ?? '', textOf(child)]), [['', 'Automations'], ['os-pending', '1']])
  assert.deepEqual(button([{ id: 'sub-a', on: true }]).children.filter(Boolean).map(child => [child.props?.className ?? '', textOf(child)]), [['', 'Automations'], ['os-head-count', '1']])
})

test('Omni\'s confirmation of a saved automation carries the steering warning, loudly when it acts without asking', () => {
  const saved = 'Saved sub-mh2k9x1abcd · Pins: when you react 📌 in Grupo Obras → Ops (one task per event). It is in the Automations panel now.'
  assert.equal(ui.savedOf('Not saved: Which chats?', roster(), undefined), null)
  assert.deepEqual(JSON.parse(JSON.stringify(ui.savedOf(saved, roster(), undefined))), { id: 'sub-mh2k9x1abcd', name: 'Pins', askFirst: true })
  assert.equal(ui.savedOf(saved, roster(), false).askFirst, false)
  assert.equal(ui.savedOf(saved, roster(), 'false').askFirst, false)
  // Read as the host reads it: anything but true, "true" or "yes" turns it off.
  assert.equal(ui.savedOf(saved, roster(), 'no').askFirst, false)
  assert.equal(ui.savedOf(saved, roster(), '').askFirst, false)
  assert.equal(ui.savedOf(saved, roster(), 'yes').askFirst, true)
  // An edit that leaves ask first alone shows the automation's own.
  const off = { id: 'sub-mh2k9x1abcd', name: 'Pins', askFirst: false, trigger: { kind: 'reaction', emoji: '📌' } }
  assert.equal(ui.savedOf(saved, roster([off]), undefined).askFirst, false)
  assert.equal(ui.savedOf(saved, roster([off]), true).askFirst, true)

  const quiet = ui.savedNotice({ askFirst: true, main: 'Omni' })
  assert.equal(quiet.loud, false)
  assert.match(quiet.text, /tries to steer a Bot\. The work this starts reads on its own and asks you before anything else\./)
  const loud = ui.savedNotice({ askFirst: false, main: 'Omni' })
  assert.equal(loud.loud, true)
  assert.match(loud.text, /^This automation acts without asking you\. .*steer a Bot.*own permissions and keys\. Tell Omni to ask first/)

  const card = (askFirst, subs = []) => ui.SavedAutomationCard({ done: true, content: saved, roster: roster(subs), argValue: key => (key === 'ask_first' ? askFirst : undefined) })
  assert.equal(card(undefined).props['data-loud'], undefined)
  assert.match(textOf(card(undefined)), /Saved automationPins.*asks you before anything else/)
  const acting = card(false)
  assert.equal(acting.props['data-loud'], true)
  assert.match(textOf(acting), /acts without asking you/)
  assert.equal(ui.SavedAutomationCard({ done: false, content: '', roster: roster() }), null)
  assert.equal(ui.SavedAutomationCard({ done: true, content: 'Not saved: Which chats?', roster: roster() }).props.className, 'bt-event')
})
