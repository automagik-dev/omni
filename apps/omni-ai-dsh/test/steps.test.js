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
const { GROUPS, VENDOR_TERMS } = await load('connect-ai.js')

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

test('Connect AI tiles connect for real: sign-ins first, marked, then keys, then the rest', () => {
  const tiles = plain(GROUPS).flatMap(group => group.tiles.map(tile => ({ ...tile, group: group.title })))
  assert.deepEqual(tiles.map(tile => tile.id), ['codex', 'claude', 'kimi', 'copilot', 'deepseek', 'openai', 'anthropic', 'openrouter', 'zai', 'moonshot', 'opencode', 'cliproxy', 'api-key'])
  assert.equal(GROUPS[0].terms, VENDOR_TERMS)
  assert.equal(VENDOR_TERMS, 'Personal use under the vendor\'s terms')
  // A sign-in tile names the pi-ai provider whose flow it runs; a key tile, where to get a key.
  for (const tile of GROUPS[0].tiles) assert.ok(tile.signin === true && typeof tile.provider === 'string', tile.id)
  for (const tile of GROUPS[1].tiles) assert.ok(typeof tile.provider === 'string' && /^https:\/\//.test(tile.key), tile.id)
  // Only "Another provider" leads to DSH's Models page; no tile is a dead end.
  assert.deepEqual(tiles.filter(tile => tile.section).map(tile => tile.id), ['api-key'])
  assert.equal(tiles.find(tile => tile.id === 'cliproxy').form, true)
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
