import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { bundleClient } from '../scripts/build-client.mjs'

const committed = () => readFileSync(new URL('../client.js', import.meta.url), 'utf8')

test('client.js is the build of src/client', async () => {
  assert.equal(await bundleClient(), committed(), 'client.js is stale: run `npm run build` and commit it')
})

// DSH runs client.js as a classic script that hands a factory to the module loader; the
// factory's `require` answers only the shell's platform modules.
test('client.js registers the two onboarding steps on settings.onboarding, in order', () => {
  const registrations = []
  runInNewContext(committed(), { window: { __ModuleLoader__: { load: registration => registrations.push(registration) } } })
  assert.equal(registrations.length, 1)
  const [{ id, factory }] = registrations
  assert.equal(id, '@automagik/omni-ai-dsh')

  const platform = { react: { createElement: () => null }, 'react-dom': { createPortal: node => node } }
  const requested = new Set()
  const exports = factory((specifier) => {
    requested.add(specifier)
    if (!(specifier in platform)) throw new Error(`no platform module ${specifier}`)
    return platform[specifier]
  })
  assert.deepEqual([...requested].sort(), ['react', 'react-dom'])
  assert.equal(Object.prototype.toString.call(exports), '[object Module]')
  assert.deepEqual(Object.keys(exports).sort(), ['apply', 'inject'])
  assert.deepEqual(Array.from(exports.inject), ['slots'])

  const injected = []
  const registered = []
  const effects = []
  exports.apply({
    effect: (_run, label) => effects.push(label),
    slots: {
      inject: (name, register) => { injected.push(name); register() },
      register: (options, component) => { registered.push({ ...options, component: typeof component }); return () => {} },
    },
  })
  assert.deepEqual(effects, ['omni-ai: stage styles', 'omni-ai: omni-welcome on the rail', 'omni-ai: omni-connect-ai on the rail'])
  assert.deepEqual(injected, ['settings.onboarding', 'settings.onboarding'])
  assert.deepEqual(registered, [
    { name: 'settings.onboarding', id: 'omni-welcome', order: -300, component: 'function' },
    { name: 'settings.onboarding', id: 'omni-connect-ai', order: -200, component: 'function' },
  ])
})
