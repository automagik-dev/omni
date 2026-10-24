// The team's and the channels plugin's client bundles as DSH hands them to this plugin:
// their committed client.js files, run as DSH runs them, with stand-in platform modules,
// the channels bundle requiring the team's. Tests that import this plugin's client modules
// get them here (harness-resolve.mjs maps both specifiers), and bundled tests pass them to
// their `require`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

export const PLATFORM = {
  react: { createElement: () => null, Fragment: Symbol('Fragment'), useState: initial => [initial, () => {}], useEffect: () => {}, useLayoutEffect: () => {}, useMemo: make => make(), useRef: current => ({ current }), useCallback: fn => fn, useContext: context => context?._currentValue, useSyncExternalStore: (_subscribe, snapshot) => snapshot(), createContext: value => ({ Provider: () => null, _currentValue: value }), Component: class {} },
  'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') },
  'react-dom': { createPortal: node => node },
  '@deepseek-ai/dsh-client-ui-primitives': { MarkdownText: () => null },
}

function run(dir, modules) {
  // The bundle's own registration comes first; the Bot team's client also registers under
  // its former name (@automagik/omni-dsh), which hands over the same module.
  let registration
  runInNewContext(readFileSync(join(dir, 'client.js'), 'utf8'), { window: { __ModuleLoader__: { load: (entry) => { registration ??= entry } } } })
  return registration.factory((name) => {
    if (!(name in modules)) throw new Error(`no module ${name}`)
    return modules[name]
  })
}

// Fresh instances of both, the channels one on the team one.
export function loadClients(platform = PLATFORM) {
  const team = run(process.env.OMNI_DSH_CORE, platform)
  const channels = run(process.env.OMNI_DSH_CHANNELS, { ...platform, '@automagik/bots-dsh/client': team })
  return { team, channels }
}

const loaded = loadClients()
export const { omni } = loaded.team
export const { channels } = loaded.channels
