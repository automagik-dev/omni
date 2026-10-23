// The team's client bundle (@automagik/bots-dsh/client) as DSH hands it to this plugin: the
// team's committed client.js, run as DSH runs it, with stand-in platform modules. Tests
// that import this plugin's client modules get its `omni` here (harness-resolve.mjs maps
// the specifier), and bundled tests pass it to their `require`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

const PLATFORM = {
  react: { createElement: () => null, Fragment: Symbol('Fragment'), useState: initial => [initial, () => {}], useEffect: () => {}, useLayoutEffect: () => {}, useMemo: make => make(), useRef: current => ({ current }), useCallback: fn => fn, useSyncExternalStore: (_subscribe, snapshot) => snapshot(), createContext: value => ({ Provider: () => null, _currentValue: value }), Component: class {} },
  'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') },
  'react-dom': { createPortal: node => node },
  '@deepseek-ai/dsh-client-ui-primitives': { MarkdownText: () => null },
}

export function loadTeamClient(platform = PLATFORM) {
  // The bundle's own registration comes first; the Bot team's client also registers under
  // its former name (@automagik/omni-dsh), which hands over the same module.
  let registration
  runInNewContext(readFileSync(join(process.env.OMNI_DSH_CORE, 'client.js'), 'utf8'), { window: { __ModuleLoader__: { load: (entry) => { registration ??= entry } } } })
  return registration.factory(name => platform[name] ?? (() => { throw new Error(`no platform module ${name}`) })())
}

export const { omni } = loadTeamClient()
