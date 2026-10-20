import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { CONNECT_STEP, callOmniAi, gateConnect, skipConnect, skippedHere } from '../src/client/onboarding.js'
import { STORAGE } from '../src/client/storage.js'

const memoryStorage = (entries = {}) => {
  const map = new Map(Object.entries(entries))
  return { map, getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => { map.set(key, String(value)) }, removeItem: key => map.delete(key) }
}

// The host's omni-link reply, omni-ai's actions (or none: a DSH without omni-ai), and a log
// of what the step asked and did.
function world({ link = { linked: false, configured: false }, omniAi = { connectOmniSkipped: false }, storage = memoryStorage(), explicit } = {}) {
  const log = []
  const request = async (endpoint) => {
    log.push(`host ${endpoint}`)
    if (link instanceof Error) throw link
    return link
  }
  const ai = async (endpoint, payload) => {
    log.push(payload === undefined ? `omni-ai ${endpoint}` : `omni-ai ${endpoint} ${JSON.stringify(payload)}`)
    if (omniAi === null) throw Object.assign(new Error('omni-ai answered HTTP 404'), { code: 'HTTP_404' })
    return endpoint === 'state' ? omniAi : { connectOmniSkipped: true }
  }
  const props = { stepId: CONNECT_STEP.id, explicit, complete: () => log.push('complete'), openSection: id => log.push(`open ${id}`) }
  return { log, storage, props, deps: { request, omniAi: ai, storage } }
}

test('the step is omni-connect, between omni-ai\'s welcome (-300) and Connect AI (-200)', () => {
  assert.deepEqual({ ...CONNECT_STEP }, { id: 'omni-connect', order: -250 })
  assert.ok(CONNECT_STEP.order > -300 && CONNECT_STEP.order < -200)
})

test('a DSH that already reaches an Omni completes the step at once and shows nothing', async () => {
  for (const link of [{ linked: true, configured: true, origin: 'omni.example.com' }, { linked: false, configured: true, origin: null }]) {
    const { log, props, deps } = world({ link })
    assert.equal(await gateConnect(props, deps), null)
    assert.deepEqual(log, ['host omni-link', 'complete'])
  }
})

test('a skip kept by omni-ai, or in this plugin\'s storage, completes the step at once', async () => {
  const kept = world({ omniAi: { connectOmniSkipped: true } })
  assert.equal(await gateConnect(kept.props, kept.deps), null)
  assert.deepEqual(kept.log, ['host omni-link', 'omni-ai state', 'complete'])

  const here = world({ omniAi: null, storage: memoryStorage({ [STORAGE.connectOmniSkipped]: '1' }) })
  assert.equal(await gateConnect(here.props, here.deps), null)
  assert.deepEqual(here.log, ['host omni-link', 'complete'])
})

test('with no link and no skip the step shows, whether or not omni-ai is installed', async () => {
  const fresh = world()
  assert.deepEqual(await gateConnect(fresh.props, fresh.deps), { link: { linked: false, configured: false } })
  assert.deepEqual(fresh.log, ['host omni-link', 'omni-ai state'])

  const raw = world({ omniAi: null })
  assert.deepEqual(await gateConnect(raw.props, raw.deps), { link: { linked: false, configured: false } })
  assert.deepEqual(raw.log, ['host omni-link', 'omni-ai state'])

  // A host that cannot answer still leaves the step to the skip rules.
  const down = world({ link: new Error('down') })
  assert.deepEqual(await gateConnect(down.props, down.deps), { link: null })
  const downSkipped = world({ link: new Error('down'), omniAi: { connectOmniSkipped: true } })
  assert.equal(await gateConnect(downSkipped.props, downSkipped.deps), null)
})

test('a step the user reopened on purpose shows, skipped or connected', async () => {
  const skipped = world({ explicit: true, omniAi: { connectOmniSkipped: true }, storage: memoryStorage({ [STORAGE.connectOmniSkipped]: '1' }) })
  assert.deepEqual(await gateConnect(skipped.props, skipped.deps), { link: { linked: false, configured: false } })
  assert.equal(skipped.log.includes('complete'), false)

  const linked = world({ explicit: true, link: { linked: true, configured: true, origin: 'omni.example.com' } })
  assert.deepEqual(await gateConnect(linked.props, linked.deps), { link: { linked: true, configured: true, origin: 'omni.example.com' } })
  assert.deepEqual(linked.log, ['host omni-link'])
})

test('skipping keeps the skip with omni-ai when it is installed, else in this plugin\'s storage', async () => {
  const withAi = world()
  await skipConnect(withAi.props, withAi.deps)
  assert.deepEqual(withAi.log, ['omni-ai done {"stepId":"omni-connect"}', 'complete'])
  assert.equal(skippedHere(withAi.storage), false)

  const raw = world({ omniAi: null })
  await skipConnect(raw.props, raw.deps)
  assert.deepEqual(raw.log, ['omni-ai done {"stepId":"omni-connect"}', 'complete'])
  assert.equal(raw.storage.map.get('omni-ui:connect-omni-skipped'), '1')
  // ... and the next mount completes at once.
  const again = world({ omniAi: null, storage: raw.storage })
  assert.equal(await gateConnect(again.props, again.deps), null)

  // Storage that refuses writes still lets the step hand on.
  const locked = world({ omniAi: null, storage: { getItem: () => null, setItem: () => { throw new Error('quota') } } })
  await skipConnect(locked.props, locked.deps)
  assert.deepEqual(locked.log.at(-1), 'complete')
})

test('omni-ai is called on its own route, and anything but its ok envelope means it is absent', async () => {
  const asked = []
  const answer = (status, body) => async (url, init) => {
    asked.push({ url, method: init.method, body: JSON.parse(init.body) })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }
  assert.deepEqual(await callOmniAi('done', { stepId: 'omni-connect' }, answer(200, { ok: true, value: { connectOmniSkipped: true } })), { connectOmniSkipped: true })
  assert.deepEqual(asked[0], { url: 'api/omni-ai', method: 'POST', body: { endpoint: 'done', payload: { stepId: 'omni-connect' } } })
  await assert.rejects(callOmniAi('state', undefined, answer(404, 'Not Found')), { code: 'HTTP_404' })
  // A web app that answers unknown routes with its page.
  await assert.rejects(callOmniAi('state', undefined, answer(200, '<!doctype html><title>DSH</title>')))
  await assert.rejects(callOmniAi('state', undefined, answer(200, { ok: false, error: { code: 'omni-ai/invalid', message: 'No onboarding step' } })), { code: 'omni-ai/invalid' })
  await assert.rejects(callOmniAi('state', undefined, async () => { throw new TypeError('Failed to fetch') }))
})

// The step module itself, with a React that records elements instead of rendering them.
test('the step registers on settings.onboarding with its stage styles', async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/client/connect-step.js', import.meta.url))],
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom'],
  })
  const module = { exports: {} }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {}, useRef: current => ({ current }), useCallback: fn => fn, useMemo: make => make(),
  }
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: name => ({ react, 'react-dom': { createPortal: node => node } })[name] })
  const { registerConnectStep, ConnectOmniStep } = module.exports

  const injected = []
  const registered = []
  const effects = []
  registerConnectStep({
    effect: (_run, label) => effects.push(label),
    slots: {
      inject: (name, register) => { injected.push(name); register() },
      register: (options, component) => { registered.push({ ...options, component }); return () => {} },
    },
  })
  assert.deepEqual(effects, ['omni-ui: onboarding stage styles'])
  assert.deepEqual(injected, ['settings.onboarding'])
  assert.equal(registered.length, 1)
  assert.deepEqual({ ...registered[0], component: typeof registered[0].component }, { name: 'settings.onboarding', id: 'omni-connect', order: -250, component: 'function' })
  assert.equal(registered[0].component, ConnectOmniStep)
  // While it decides, the step draws nothing, so it blocks nothing.
  assert.equal(ConnectOmniStep({ stepId: 'omni-connect', complete: () => {}, openSection: () => {} }), null)
})
