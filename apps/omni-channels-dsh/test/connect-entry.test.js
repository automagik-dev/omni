import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { omni } from './omni-client.js'

// The ways into the Connect wizard for a DSH that may never show onboarding: the Omni page in
// DSH's settings, the Channels page's card, and the wizard opening by itself once after
// install. Bundled as DSH bundles the client, with a React that builds plain element trees.
async function load() {
  const entry = `
    export { settingsView, runSettingsAction, registerSettings, OmniSettingsSection, parseReactions, saveFreeReactions } from './omni-settings.js'
    export { autoOpenOnce, openConnectWizard, closeConnectWizard, wizardOpen, ConnectPrompt, AUTO_OPENED } from './wizard.js'
    export { noteStepShown, stepShown } from './onboarding.js'
  `
  const bundle = await build({
    stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../src/client/', import.meta.url)), loader: 'js' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom', '@automagik/bots-dsh/client'],
    loader: { '.css': 'text' },
  })
  const module = { exports: {} }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {}, useRef: current => ({ current }), useCallback: fn => fn, useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  }
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, URL, require: name => ({ react, 'react-dom': { createPortal: node => node }, '@automagik/bots-dsh/client': { omni } })[name] })
  return module.exports
}
const ui = await load()
const plain = value => JSON.parse(JSON.stringify(value))
const memoryStorage = (entries = {}) => {
  const map = new Map(Object.entries(entries))
  return { map, getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => { map.set(key, String(value)) } }
}
const findAll = (node, match, found = []) => {
  if (node && typeof node === 'object') {
    if (match(node)) found.push(node)
    for (const child of node.children ?? []) findAll(child, match, found)
  }
  return found
}

test('the settings card offers the wizard when no Omni is linked', () => {
  const view = plain(ui.settingsView({ linked: false, configured: false }))
  assert.equal(view.title, 'Connect your Omni')
  assert.deepEqual(view.actions, [{ id: 'connect', label: 'Connect your Omni', primary: true }])
})

test('linked, the card names the Omni and its version, with Change and Disconnect', () => {
  const view = plain(ui.settingsView({ linked: true, configured: true, origin: 'omni.example.com', version: '2.261023.16', reachable: true }))
  assert.equal(view.title, 'Connected to omni.example.com')
  assert.deepEqual(view.lines, ['Omni 2.261023.16'])
  assert.deepEqual(view.actions.map(action => action.id), ['change', 'disconnect'])
  // Disconnect asks first.
  const asking = plain(ui.settingsView({ linked: true, origin: 'omni.example.com', version: '2.261023.16' }, { confirming: true }))
  assert.deepEqual(asking.actions.map(action => action.id), ['confirm-disconnect', 'cancel'])
  assert.match(asking.lines.at(-1), /^Disconnect from omni\.example\.com\?/)
  // An Omni reached through the profile's older URL and key can be changed, not disconnected here.
  assert.deepEqual(plain(ui.settingsView({ linked: false, configured: true })).actions.map(action => action.id), ['change'])
})

test('Connect and Change close settings and open the wizard', async () => {
  for (const id of ['connect', 'change']) {
    const log = []
    const next = await ui.runSettingsAction(id, { info: {}, close: () => log.push('close'), open: () => log.push('open'), request: async () => { throw new Error('no host call') } })
    assert.equal(next, null)
    assert.deepEqual(log, ['close', 'open'], id)
  }
})

test('Disconnect is asked first, then removes the link and shows the card unlinked', async () => {
  const asked = []
  const request = async (endpoint) => {
    asked.push(endpoint)
    return endpoint === 'omni-link-info' ? { linked: false, configured: false } : { status: 'disconnected' }
  }
  const info = { linked: true, origin: 'omni.example.com' }
  assert.deepEqual(plain(await ui.runSettingsAction('disconnect', { info, request })), { info, confirming: true })
  assert.deepEqual(asked, [], 'the first click only asks')
  assert.deepEqual(plain(await ui.runSettingsAction('cancel', { info, request })), { info, confirming: false })
  const done = plain(await ui.runSettingsAction('confirm-disconnect', { info, request, refresh: () => asked.push('refresh') }))
  assert.deepEqual(asked, ['omni-disconnect', 'refresh', 'omni-link-info'])
  assert.deepEqual(done, { info: { linked: false, configured: false }, confirming: false })
  assert.equal(plain(ui.settingsView(done.info)).title, 'Connect your Omni')
})

test('the free reactions are typed as one line and saved through the host, or put back to the defaults', async () => {
  assert.deepEqual(plain(ui.parseReactions(' 👍 ❤️,😂  🙏 ')), ['👍', '❤️', '😂', '🙏'])
  assert.deepEqual(plain(ui.parseReactions('')), [])
  const sent = []
  const request = async (endpoint, body) => {
    sent.push([endpoint, body])
    return { freeReactions: body.freeReactions, defaults: ['👍'] }
  }
  assert.deepEqual(plain(await ui.saveFreeReactions('🔥, ❤', { request })), { freeReactions: ['🔥', '❤'], defaults: ['👍'] })
  await ui.saveFreeReactions('🔥', { reset: true, defaults: ['👍', '🙏'], request })
  assert.deepEqual(plain(sent), [['omni-free-reactions-save', { freeReactions: ['🔥', '❤'] }], ['omni-free-reactions-save', { freeReactions: ['👍', '🙏'] }]])
})

test('the Omni page registers on DSH\'s settings.section slot', () => {
  const registered = []
  const effects = []
  ui.registerSettings({
    effect: (_run, label) => effects.push(label),
    slots: { inject: (name, register) => { registered.push(name); register() }, register: (options, component) => { registered.push(plain({ ...options, component: typeof component })); return () => {} } },
  })
  assert.deepEqual(registered, ['settings.section', { name: 'settings.section', id: 'omni', order: 60, label: 'Omni', component: 'function' }])
  assert.deepEqual(effects, ['omni-channels: settings styles'])
})

test('the Channels page\'s card opens the wizard', () => {
  ui.closeConnectWizard()
  const tree = ui.ConnectPrompt()
  const [button] = findAll(tree, node => node.type === 'button')
  assert.equal(button.children.join(''), 'Connect your Omni')
  assert.equal(ui.wizardOpen(), false)
  button.props.onClick()
  assert.equal(ui.wizardOpen(), true)
  ui.closeConnectWizard()
})

test('the wizard opens by itself once, only when there is no Omni and no skip, and never over DSH\'s own step', async () => {
  const notLinked = async () => ({ linked: false, configured: false })
  const noOmniAi = async () => { throw new Error('no omni-ai') }
  const wait = async () => {}
  const run = async (storage, extra = {}) => {
    let opened = 0
    const result = await ui.autoOpenOnce({ request: notLinked, omniAi: noOmniAi, storage, wait, open: () => { opened += 1 }, ...extra })
    return { result, opened }
  }
  const storage = memoryStorage()
  assert.deepEqual(await run(storage), { result: true, opened: 1 })
  assert.equal(storage.map.get(ui.AUTO_OPENED), '1')
  // Once: the next page load leaves it shut.
  assert.deepEqual(await run(storage), { result: false, opened: 0 })
  // A linked Omni, or a skip kept here or with omni-ai, never opens it.
  assert.deepEqual(await run(memoryStorage(), { request: async () => ({ linked: true, configured: true }) }), { result: false, opened: 0 })
  assert.deepEqual(await run(memoryStorage({ 'omni-ui:connect-omni-skipped': '1' })), { result: false, opened: 0 })
  assert.deepEqual(await run(memoryStorage(), { omniAi: async () => ({ connectOmniSkipped: true }) }), { result: false, opened: 0 })
  // DSH's first-run onboarding is showing the step: it does not stack a second one, and may
  // still open on a later load.
  const later = memoryStorage()
  const release = ui.noteStepShown()
  assert.deepEqual(await run(later, { shown: ui.stepShown }), { result: false, opened: 0 })
  release()
  assert.equal(later.map.has(ui.AUTO_OPENED), false)
  assert.deepEqual(await run(later, { shown: ui.stepShown }), { result: true, opened: 1 })
  // The welcome's onboarding on screen (it installed this plugin from its team step) counts too.
  const showing = Symbol.for('automagik.omni.onboarding-showing')
  assert.equal(ui.stepShown({ [showing]: 1 }), true)
  assert.equal(ui.stepShown({ [showing]: 0 }), false)
  assert.equal(ui.stepShown({}), false)
})
