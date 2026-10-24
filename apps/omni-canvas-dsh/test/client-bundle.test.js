import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { EXTERNAL_BUNDLES, PLATFORM_MODULES, bundleClient } from '../scripts/build-client.mjs'
import { FENCE } from '../src/client/omni-ui-spec.js'
import { STRINGS } from '../src/client/strings.js'
import { PLATFORM, loadClients } from './omni-client.js'

const committed = () => readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const teamUrl = path => new URL(path, `file://${process.env.OMNI_DSH_CORE}/`)

test('client.js is the build of src/client', async () => {
  assert.equal(await bundleClient(), committed(), 'client.js is stale: run `npm run build` and commit it')
})

test('the team\'s and the channels\' client bundles are named in dsh.client.external', () => {
  assert.deepEqual(manifest.dsh.client, { platform: 'web', external: ['@automagik/bots-dsh/client', '@automagik/omni-dsh/client', '@automagik/omni-channels-dsh/client'] })
  assert.deepEqual(EXTERNAL_BUNDLES, manifest.dsh.client.external)
})

test('canvases come in the fence the team\'s chat looks for', async () => {
  const { FENCE: chat } = await import(teamUrl('src/client/canvas-text.js'))
  assert.equal(FENCE, chat)
})

// A DSH that still runs the team as @automagik/omni-dsh hands its client over under that name.
test('client.js takes the team\'s client under its former name when the new one is missing', () => {
  const { team, channels } = loadClients()
  const registrations = []
  runInNewContext(committed(), { window: { __ModuleLoader__: { load: registration => registrations.push(registration) } } })
  const [{ factory }] = registrations
  const modules = { ...PLATFORM, '@automagik/omni-dsh/client': team, '@automagik/omni-channels-dsh/client': channels }
  const requested = []
  const exports = factory((specifier) => {
    requested.push(specifier)
    if (!(specifier in modules)) throw new Error(`no module ${specifier}`)
    return modules[specifier]
  })
  assert.deepEqual(requested.filter(name => name.includes('-dsh/')).slice(0, 2), ['@automagik/bots-dsh/client', '@automagik/omni-dsh/client'])
  assert.deepEqual(Object.keys(exports), ['apply'])
})

// DSH runs client.js as a classic script that hands a factory to the module loader; the
// factory's `require` answers the shell's platform modules and the bundles it names.
test('client.js requires the platform and the two bundles it names, and draws show_canvas', () => {
  const { team, channels } = loadClients()
  const registrations = []
  runInNewContext(committed(), { window: { __ModuleLoader__: { load: registration => registrations.push(registration) } } })
  assert.equal(registrations.length, 1)
  const [{ id, factory }] = registrations
  assert.equal(id, '@automagik/omni-canvas-dsh')
  const modules = { ...PLATFORM, '@automagik/bots-dsh/client': team, '@automagik/omni-channels-dsh/client': channels }
  const requested = new Set()
  const exports = factory((specifier) => {
    requested.add(specifier)
    if (!(specifier in modules)) throw new Error(`no module ${specifier}`)
    return modules[specifier]
  })
  // react-dom stays external in case OpenUI ever imports it; today nothing does.
  assert.deepEqual([...requested].sort(), ['@automagik/bots-dsh/client', '@automagik/omni-channels-dsh/client', 'react', 'react/jsx-runtime'])
  assert.ok([...requested].every(name => PLATFORM_MODULES.includes(name) || EXTERNAL_BUNDLES.includes(name)))
  assert.equal(Object.prototype.toString.call(exports), '[object Module]')
  assert.deepEqual(Object.keys(exports), ['apply'])

  const { omni } = team
  const effects = []
  const disposers = []
  exports.apply({ effect: (run, label) => { effects.push(label); const dispose = run(); if (typeof dispose === 'function') disposers.push(dispose) } })
  assert.deepEqual(effects, ['ds-bot: canvas copy', 'ds-bot: canvases', 'ds-bot: canvas card', 'ds-bot: canvas styles'])
  assert.equal(typeof omni.toolCards.renderer('show_canvas'), 'function')
  assert.equal(omni.toolCards.phrase('show_canvas')().label, 'Drawing it')
  for (const dispose of disposers.reverse()) dispose()
  assert.equal(omni.toolCards.renderer('show_canvas'), undefined)
})

test('every literal this client translates has a Chinese entry, here or in the team\'s copy', async () => {
  const { DICTIONARY } = await import(teamUrl('src/client/i18n.js'))
  const dir = new URL('../src/client/', import.meta.url)
  const missing = []
  for (const name of readdirSync(dir).filter(file => file.endsWith('.js'))) {
    const text = readFileSync(new URL(name, dir), 'utf8')
    for (const match of text.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
      const key = match[2].replace(/\\'/g, "'")
      if (!Object.hasOwn(STRINGS, key) && !Object.hasOwn(DICTIONARY.zh, key)) missing.push(`${name}: ${key}`)
    }
  }
  assert.deepEqual(missing, [])
  assert.deepEqual(Object.keys(STRINGS).filter(key => Object.hasOwn(DICTIONARY.zh, key)), [])
})
