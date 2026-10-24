import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { omni } from './omni-client.js'

// The Connect card's decisions, out of its React: which row opens, what each found Omni
// offers, what the one remote input holds, when Continue lights up, and what the terminal's
// footer says. Bundled as DSH bundles the client, with stand-in React.
async function load() {
  const entry = `
    export { foundRow, firstOpen, readRemote, onMac, unavailableWords, noticeWords } from './omni-connect.js'
    export { continueButton, announceStep } from './connect-step.js'
    export { footFor, columnsFor } from './omni-terminal.js'
  `
  const bundle = await build({
    stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../src/client/', import.meta.url)), loader: 'js' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom', '@automagik/bots-dsh/client'],
    loader: { '.css': 'text' },
  })
  const module = { exports: {} }
  const react = { createElement: () => null, useState: initial => [initial, () => {}], useEffect: () => {}, useRef: current => ({ current }), useCallback: fn => fn }
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, URL, URLSearchParams, require: name => ({ react, 'react-dom': { createPortal: node => node }, '@automagik/bots-dsh/client': { omni } })[name] })
  // Objects made in the bundle's realm come back as plain ones, so they compare as values.
  const plain = value => (value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value)
  return Object.fromEntries(Object.entries(module.exports).map(([name, value]) => [name, typeof value === 'function' ? (...args) => plain(value(...args)) : value]))
}
const ui = await load()

const local = (extra = {}) => ({ id: '0123456789abcdef', url: 'http://127.0.0.1:8882', source: 'running', local: true, reachable: true, version: '2.261006.2', hasKey: false, updateTo: null, manager: 'other', canPair: false, pairing: 'too-old', ...extra })

test('an old Omni the Omni CLI runs offers Update and connect; one another app runs points to running a new one', () => {
  assert.deepEqual(ui.foundRow(local({ manager: 'cli' }), { mac: true }), {
    title: 'Omni on this Mac', sub: 'v2.261006.2 · port 8882', badge: 'Needs an update', tone: 'warn', action: 'update',
    note: 'It is too old to pair with this app. Updating takes about a minute and keeps your chats and channels.',
    keyEntry: true, keyHint: false,
  })
  // The owner's Mac: the Yours project runs this one.
  const theirs = ui.foundRow(local(), { mac: true })
  assert.equal(theirs.badge, 'Managed by another app')
  assert.equal(theirs.action, 'elsewhere')
  assert.match(theirs.note, /run a new Omni on this Mac/)
  assert.equal(ui.foundRow(local(), { mac: false }).title, 'Omni on this computer')
})

test('each found Omni gets the one action that fits it', () => {
  assert.equal(ui.foundRow(local({ source: 'sandbox', manager: 'sandbox', pairing: 'available', canPair: true, hasKey: true, updateTo: '2.261023.16' })).action, 'reinstall')
  assert.equal(ui.foundRow(local({ pairing: 'available', canPair: true, hasKey: true, manager: 'cli' })).action, 'use')
  assert.equal(ui.foundRow(local({ pairing: 'available', canPair: true })).action, 'connect')
  assert.equal(ui.foundRow(local({ reachable: false })).badge, 'Not answering')
  assert.equal(ui.foundRow(local({ pairing: 'off' })).action, null)
  assert.deepEqual(ui.foundRow(local({ manager: 'cli' }), { linked: true }).badge, 'Connected')
  const remote = ui.foundRow({ ...local(), url: 'https://omni.example.com', local: false, source: 'cli-server', name: 'work', manager: null, pairing: 'unknown' })
  assert.deepEqual([remote.title, remote.sub], ['omni.example.com', 'v2.261006.2 · saved in your Omni CLI as work'])
})

test('an Omni that cannot approve this app also takes a pasted API key; another app\'s gets the hint where to find it', () => {
  const theirs = ui.foundRow(local(), { mac: true })
  assert.deepEqual([theirs.keyEntry, theirs.keyHint], [true, true])
  const cli = ui.foundRow(local({ manager: 'cli' }))
  assert.deepEqual([cli.action, cli.keyEntry, cli.keyHint], ['update', true, false])
  assert.equal(ui.foundRow(local({ pairing: 'off', version: '2.261023.16' })).keyEntry, true)
  // One that pairs, one this computer has the key for, or one not answering: no key form.
  assert.equal(ui.foundRow(local({ pairing: 'available', canPair: true })).keyEntry, false)
  assert.equal(ui.foundRow(local({ hasKey: true })).keyEntry, false)
  assert.equal(ui.foundRow(local({ reachable: false })).keyEntry, false)
  assert.equal(ui.foundRow(local(), { linked: true }).keyEntry, false)
})

test('a typed address that cannot approve this app says why and what to do instead', () => {
  assert.equal(ui.unavailableWords({ status: 'unavailable', reason: 'too-old', version: '2.261006.2' }), 'Omni 2.261006.2 is too old to pair from here. Update it, or paste an API key or the link it sent you.')
  assert.equal(ui.unavailableWords({ status: 'unavailable', reason: 'too-old', version: null }), 'This Omni is too old to pair from here. Update it, or paste an API key or the link it sent you.')
  assert.equal(ui.unavailableWords({ status: 'unavailable', reason: 'off' }), 'Pairing is off on this Omni. Its owner can turn it on, or you can paste an API key.')
  assert.equal(ui.noticeWords('broad-key'), 'This key can do everything on your Omni; consider giving this device its own key.')
  assert.equal(ui.noticeWords(undefined), null)
})

test('the first row with something to do opens; with none, the remote row does', () => {
  assert.equal(ui.firstOpen([local(), local({ id: 'fedcba9876543210', manager: 'cli' })]), 'fedcba9876543210')
  assert.equal(ui.firstOpen([local()]), 'remote')
  assert.equal(ui.firstOpen([]), 'remote')
})

test('the one remote input tells a link from an address', () => {
  const grant = 'AbCdEfGhIjKlMnOpQrStUvWx'
  assert.deepEqual(ui.readRemote(` https://omni.example.com/api/login/app?grant=${grant} `), { kind: 'grant', url: 'https://omni.example.com', grant })
  assert.deepEqual(ui.readRemote(`omni://connect?url=${encodeURIComponent('https://omni.example.com')}&grant=${grant}`), { kind: 'grant', url: 'https://omni.example.com', grant })
  assert.deepEqual(ui.readRemote('omni.example.com'), { kind: 'address', url: 'omni.example.com' })
  assert.deepEqual(ui.readRemote('https://omni.example.com/api/login/app?grant=short'), { kind: 'bad-link' })
  assert.equal(ui.readRemote('   '), null)
})

test('Continue stays off until an Omni is linked, then names Connect AI when that step is there', () => {
  assert.deepEqual(ui.continueButton(false, {}), { label: 'Continue', disabled: true, title: 'Connect an Omni first, or skip for now' })
  assert.deepEqual(ui.continueButton(true, {}), { label: 'Continue', disabled: false })
  const scope = {}
  ui.announceStep('omni-connect-ai', scope)
  assert.equal(ui.continueButton(true, scope).label, 'Continue to Connect AI →')
})

test('the terminal says the command waits for Enter, then that it runs, then how it ended', () => {
  assert.equal(ui.footFor({ state: 'ready', entered: false }), 'The command is ready. Press Enter to run it, or edit it first.')
  assert.equal(ui.footFor({ state: 'ready', entered: true }), 'Running… This closes on its own when it finishes.')
  assert.equal(ui.footFor({ state: 'preparing', step: 'download-bun' }), 'Getting Bun (checked against its published checksum)…')
  assert.equal(ui.footFor({ state: 'failed', exitCode: 1 }), 'It stopped with exit code 1. Read what it printed above, then try again.')
  assert.equal(ui.footFor({ state: 'failed', error: 'No shell' }), 'No shell')
  assert.equal(ui.footFor({ state: 'cancelled' }), 'Nothing ran. Open it again when you are ready.')
  assert.equal(ui.columnsFor(800, 8), 97)
  assert.equal(ui.columnsFor(0, 8), 80)
  assert.equal(ui.onMac({ navigator: { platform: 'MacIntel' } }), true)
  assert.equal(ui.onMac({ navigator: { platform: 'Linux x86_64', userAgent: 'X11' } }), false)
})
