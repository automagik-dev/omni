import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { EXTERNAL_BUNDLES, bundleClient } from '../scripts/build-client.mjs'
import { STRINGS } from '../src/client/strings.js'
import { loadTeamClient } from './omni-client.js'

const committed = () => readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('client.js is the build of src/client', async () => {
  assert.equal(await bundleClient(), committed(), 'client.js is stale: run `npm run build` and commit it')
})

test('the team\'s client bundle is named in dsh.client.external, so DSH loads it first and shares it', () => {
  assert.deepEqual(manifest.dsh.client, { platform: 'web', external: ['@automagik/bots-dsh/client', '@automagik/omni-dsh/client'] })
  assert.deepEqual(EXTERNAL_BUNDLES, manifest.dsh.client.external)
  assert.equal(manifest.exports['./client'], './client.js')
})

// A DSH that still runs the team as @automagik/omni-dsh hands its client over under that name
// only: the bundle takes it there, and a miss under both names still fails loudly.
test('client.js takes the team\'s client under its former name when the new one is missing', () => {
  const team = loadTeamClient()
  const registrations = []
  const document = { head: { append() {} }, createElement: () => ({ dataset: {}, remove() {} }) }
  runInNewContext(committed(), { document, window: { __ModuleLoader__: { load: registration => registrations.push(registration) } } })
  const [{ factory }] = registrations
  const former = { react: { createElement: () => null, Fragment: Symbol('Fragment') }, 'react-dom': { createPortal: node => node }, '@automagik/omni-dsh/client': team }
  const requested = []
  const exports = factory((specifier) => {
    requested.push(specifier)
    if (!(specifier in former)) throw new Error(`no module ${specifier}`)
    return former[specifier]
  })
  assert.deepEqual(requested.filter(name => name.startsWith('@automagik/')), ['@automagik/bots-dsh/client', '@automagik/omni-dsh/client'])
  assert.deepEqual(Object.keys(exports).sort(), ['apply', 'channels', 'inject'])
  assert.throws(() => factory((specifier) => {
    if (specifier.startsWith('@automagik/')) throw new Error(`no module ${specifier}`)
    return former[specifier]
  }), /no module @automagik\/bots-dsh\/client/)
})

// DSH runs client.js as a classic script that hands a factory to the module loader; the
// factory's `require` answers the shell's platform modules and the bundles it names.
test('client.js requires React, ReactDOM and the team\'s client, and adds to the team\'s registries', () => {
  const team = loadTeamClient()
  const registrations = []
  // The onboarding step adds its stage styles to the page.
  const document = { head: { append() {} }, createElement: () => ({ dataset: {}, remove() {} }) }
  runInNewContext(committed(), { document, window: { __ModuleLoader__: { load: registration => registrations.push(registration) } } })
  assert.equal(registrations.length, 1)
  const [{ id, factory }] = registrations
  assert.equal(id, '@automagik/omni-channels-dsh')

  const platform = { react: { createElement: () => null, Fragment: Symbol('Fragment') }, 'react-dom': { createPortal: node => node }, '@automagik/bots-dsh/client': team }
  const requested = new Set()
  const exports = factory((specifier) => {
    requested.add(specifier)
    if (!(specifier in platform)) throw new Error(`no module ${specifier}`)
    return platform[specifier]
  })
  assert.deepEqual([...requested].sort(), ['@automagik/bots-dsh/client', 'react', 'react-dom'])
  assert.equal(Object.prototype.toString.call(exports), '[object Module]')
  assert.deepEqual(Object.keys(exports).sort(), ['apply', 'channels', 'inject'])
  assert.deepEqual(Array.from(exports.inject), ['slots'])
  assert.deepEqual(Object.keys(exports.channels).sort(), ['Badge', 'KeyValue', 'LiveChannel', 'LiveChat', 'LiveQr', 'Table'])

  const { omni } = team
  const effects = []
  const disposers = []
  const registered = []
  exports.apply({
    effect: (run, label) => { effects.push(label); const dispose = run(); if (typeof dispose === 'function') disposers.push(dispose) },
    slots: {
      inject: (name, register) => register(),
      register: (options) => { registered.push([options.name, options.id]); return () => {} },
    },
  })
  assert.deepEqual(registered, [['settings.onboarding', 'omni-connect'], ['settings.section', 'omni']])
  for (const name of ['omni_call', 'omni_channels', 'omni_chats', 'omni_messages', 'omni_connect', 'save_automation']) assert.equal(typeof omni.toolCards.renderer(name), 'function', name)
  assert.equal(omni.toolCards.renderer('find_chats'), undefined)
  assert.equal(omni.toolCards.phrase('find_chats')(() => undefined).state, 'searching')
  assert.deepEqual([...omni.nav.entries()].map(entry => entry.id), ['automations'])
  assert.deepEqual([...omni.badges.entries()].map(entry => entry.id), ['omni-events'])
  assert.deepEqual([...omni.botChildren.entries()].map(entry => entry.id), ['omni-channels'])
  assert.deepEqual([...omni.headerButtons.entries()].map(entry => entry.id), ['omni-board'])
  assert.equal(omni.t('Channels and their health'), 'Channels and their health')
  // Everything it added leaves with its effects.
  for (const dispose of disposers.reverse()) dispose()
  assert.equal(omni.toolCards.renderer('omni_call'), undefined)
  assert.equal(omni.nav.entries().length, 0)
  assert.equal(omni.botChildren.entries().length, 0)
  assert.ok(effects.includes('ds-bot: channels copy'))
})

test('every literal this client translates has a Chinese entry, here or in the team\'s copy', async () => {
  const { DICTIONARY } = await import(new URL('src/client/i18n.js', `file://${process.env.OMNI_DSH_CORE}/`))
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
  // The plugin's copy adds to the team's; it never restates a key the team has.
  assert.deepEqual(Object.keys(STRINGS).filter(key => Object.hasOwn(DICTIONARY.zh, key)), [])
})
