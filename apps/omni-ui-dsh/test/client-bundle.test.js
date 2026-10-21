import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { bundleClient } from '../scripts/build-client.mjs'

const committed = () => readFileSync(new URL('../client.js', import.meta.url), 'utf8')

test('client.js is the build of src/client', async () => {
  assert.equal(await bundleClient(), committed(), 'client.js is stale: run `npm run build` and commit it')
})

// dsh runs client.js as a classic script that hands a factory to the module loader; the
// factory's `require` answers only the shell's platform modules.
test('client.js registers a factory that exports apply and inject', () => {
  const registrations = []
  runInNewContext(committed(), { window: { __ModuleLoader__: { load: registration => registrations.push(registration) } } })
  assert.equal(registrations.length, 1)
  const [{ id, factory, ...rest }] = registrations
  assert.equal(id, '@automagik/omni-dsh')
  assert.deepEqual(Object.keys(rest), [])

  const requested = []
  const platform = {
    'react': { createElement: () => null, Fragment: Symbol('Fragment'), useState: initial => [initial, () => {}], useEffect: () => {}, useMemo: make => make(), useRef: current => ({ current }), createContext: value => ({ Provider: () => null, _currentValue: value }), Component: class {} },
    'react-dom': { createPortal: node => node },
    '@deepseek-ai/dsh-client-ui-primitives': { MarkdownText: () => null },
  }
  const exports = factory((specifier) => {
    requested.push(specifier)
    if (!(specifier in platform)) throw new Error(`no platform module ${specifier}`)
    return platform[specifier]
  })
  assert.deepEqual([...new Set(requested)].sort(), Object.keys(platform).sort())
  assert.equal(Object.prototype.toString.call(exports), '[object Module]')
  // `omni` is what the Omni channels and canvas plugins build on (their bundles require
  // this one through dsh.client.external).
  assert.deepEqual(Object.keys(exports), ['apply', 'inject', 'omni'])
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(Object.keys(exports.omni).sort(), ['addStrings', 'badges', 'call', 'dateLocale', 'face', 'headerButtons', 'hostText', 'language', 'nav', 'onShell', 'setCanvasRenderer', 't', 'toolCards', 'ui'])
  assert.deepEqual(Object.keys(exports.omni.ui).sort(), ['BotMark', 'CHARACTERS', 'MAIN_LOOK', 'OmniMark', 'createSource', 'icons', 'relativeShort'])
  assert.ok(Object.isFrozen(exports.omni))
  assert.equal(exports.omni.face(), null)
  // No `configForms`: the client never writes the user's DSH settings, such as the
  // work-details mode it once held at `verbose`.
  assert.deepEqual(Array.from(exports.inject), ['sessions', 'uiWorkspace', 'uiConversation', 'slots', 'theme', 'layout'])
})
