import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The client modules, with a React that records elements instead of rendering them.
async function load(file) {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL(`../src/client/${file}`, import.meta.url))],
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom'],
    loader: { '.css': 'text' },
  })
  const module = { exports: {} }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {}, useRef: current => ({ current }), useCallback: fn => fn,
  }
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: name => ({ react, 'react-dom': { createPortal: node => node } })[name] })
  return module.exports
}
// Values made inside the vm compare by shape, not by realm.
const plain = value => JSON.parse(JSON.stringify(value))

const { gate, finish, finishInto, FLAG_OF, announceStep, railSteps } = await load('stage.js')

function recorder(state = {}) {
  const log = []
  const request = async (endpoint, payload) => {
    log.push(payload === undefined ? endpoint : `${endpoint} ${JSON.stringify(payload)}`)
    return endpoint === 'state' ? state : { ok: true }
  }
  const props = stepId => ({ stepId, complete: () => log.push('complete'), openSection: id => log.push(`open ${id}`) })
  return { log, request, props }
}

test('a step whose done flag is set completes at once and shows nothing', async () => {
  for (const [stepId, flag] of Object.entries(FLAG_OF)) {
    const { log, request, props } = recorder({ [flag]: true })
    assert.equal(await gate(props(stepId), request), null)
    assert.deepEqual(log, ['state', 'complete'])
  }
})

test('a step shows when its flag is unset, or when the user reopened it', async () => {
  const fresh = recorder({ welcomeDone: false, aiConnected: true })
  assert.deepEqual(plain(await gate(fresh.props('omni-welcome'), fresh.request)), { welcomeDone: false, aiConnected: true })
  assert.deepEqual(fresh.log, ['state'])

  const reopened = recorder({ welcomeDone: true })
  assert.deepEqual(plain(await gate({ ...reopened.props('omni-welcome'), explicit: true }, reopened.request)), { welcomeDone: true })
  assert.deepEqual(reopened.log, ['state'])

  const offline = recorder()
  assert.deepEqual(plain(await gate(offline.props('omni-connect-ai'), async () => { throw new Error('down') })), {})
})

test('finishing writes the flag, then completes; a tile completes before it opens a section', async () => {
  const done = recorder()
  await finish(done.props('omni-welcome'), done.request)
  assert.deepEqual(done.log, ['done {"stepId":"omni-welcome"}', 'complete'])

  const tile = recorder()
  await finishInto(tile.props('omni-connect-ai'), 'models', tile.request)
  assert.deepEqual(tile.log, ['done {"stepId":"omni-connect-ai"}', 'complete', 'open models'])

  const failing = recorder()
  await finish(failing.props('omni-welcome'), async () => { throw new Error('down') })
  assert.deepEqual(failing.log, ['complete'])
})

test('Connect AI is a list of switches: found first, then 4 more and the rest on demand', async () => {
  const { sections, onCount, flipAction, FIRST_OTHERS } = await load('connect-ai.js')
  const rows = [
    { id: 'claude', found: 'Signed in to Claude Code', ready: true, on: true },
    { id: 'chatgpt', found: null, ready: false, on: false },
    { id: 'deepseek', found: 'DEEPSEEK_API_KEY found', ready: true, on: true },
    { id: 'openai', found: null, ready: true, on: true },
    { id: 'kimi', found: null, ready: true, on: false },
  ]
  const { found, others } = plain(sections(rows))
  // On rows count as found: they are what this computer already uses.
  assert.deepEqual(found.map(row => row.id), ['claude', 'deepseek', 'openai'])
  assert.deepEqual(others.map(row => row.id), ['chatgpt', 'kimi'])
  assert.equal(FIRST_OTHERS, 4)
  assert.equal(onCount(rows), 3)
  // Flipping: off when on, on when set up, else open its setup in place.
  assert.deepEqual(rows.map(flipAction), ['off', 'setup', 'off', 'off', 'on'])
})

test('Continue needs one AI really on; Skip always finishes', async () => {
  const { onCount } = await load('connect-ai.js')
  assert.equal(onCount([{ on: false }, { on: false }]), 0)
  assert.equal(onCount([]), 0)
  assert.equal(onCount([{ on: false }, { on: true }]), 1)
})

test('every row that signs in names its own provider; Claude never signs in, keys say where to get one', async () => {
  const { PROVIDER_OF, LOGOS } = await load('connect-ai.js')
  const providers = plain(PROVIDER_OF)
  assert.equal(providers.claude, undefined)
  assert.deepEqual([providers.chatgpt, providers.kimi, providers.copilot, providers.grok], ['openai-codex', 'kimi-coding', 'github-copilot', 'xai'])
  assert.ok(!Object.values(providers).includes('claude'))
  assert.equal(typeof plain(LOGOS).claude, 'string')
})

test('the rail names only the steps this DSH has: Connect Omni only with the plugin that brings it', () => {
  const scope = {}
  const labels = current => plain(railSteps(current, scope).map(([, label]) => label))
  announceStep('omni-welcome', scope)
  announceStep('omni-connect-ai', scope)
  assert.deepEqual(labels('omni-welcome'), ['Welcome', 'Connect AI'])
  const leave = announceStep('omni-connect', scope)
  assert.deepEqual(labels('omni-connect-ai'), ['Welcome', 'Connect Omni', 'Connect AI'])
  leave()
  assert.deepEqual(labels('omni-connect-ai'), ['Welcome', 'Connect AI'])
  // A step that never announced itself still shows where it is.
  assert.deepEqual(plain(railSteps('omni-connect', {}).map(([id]) => id)), ['omni-connect'])
})

test('a subscription takes the next free account slot; only vendors nothing else covers are offered', async () => {
  const { nextIndex, signedInCount, SUBSCRIPTION_TILES } = await load('subscriptions.js')
  const { subscriptionRows } = await load('connect-ai.js')
  const accounts = [
    { provider: 'kiro', index: 1, configured: true },
    { provider: 'kiro', index: 2, configured: false },
    { provider: 'cursor', index: 1, configured: true },
    { provider: 'cursor', index: 3, configured: true },
  ]
  assert.equal(nextIndex(accounts, 'kiro'), 2)
  assert.equal(nextIndex(accounts, 'cursor'), 4)
  assert.equal(nextIndex(accounts, 'glm'), 1)
  assert.equal(nextIndex(null, 'glm'), 1)
  assert.equal(signedInCount(accounts, 'cursor'), 2)
  // Claude, ChatGPT, Kimi, Copilot and Grok each have their own row: never offered twice.
  const ids = plain(SUBSCRIPTION_TILES).map(tile => tile.provider)
  for (const id of ['claude', 'codex', 'kimi', 'copilot', 'grok', 'ollama', 'openai-codex', 'kimi-coding', 'anthropic']) assert.ok(!ids.includes(id), id)
  // A row per vendor, on when signed in and not hidden.
  const rows = plain(subscriptionRows({ accounts: [{ provider: 'cursor', index: 1 }, { provider: 'cursor', index: 3 }, { provider: 'kiro', index: 1 }], hidden: ['kiro'] }))
  const by = Object.fromEntries(rows.map(row => [row.tile.provider, row]))
  assert.deepEqual([by.cursor.on, by.cursor.found], [true, '2 accounts'])
  assert.deepEqual([by.kiro.on, by.kiro.ready], [false, true])
  assert.deepEqual([by.glm.on, by.glm.ready, by.glm.found], [false, false, null])
  assert.deepEqual(plain(subscriptionRows(null)), [])
})
