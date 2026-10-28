// The client's test bench: a stand-in React that keeps hooks per component, so a click
// changes state and the next draw shows it, a mount that draws function components in place,
// each with its own hooks, the queries the client tests read a drawn tree with, and this
// plugin's client modules bundled as DSH bundles them. Used by test/omni-tree.test.js,
// test/omni-phone.test.js and the old-team sweep in test/resume-hook.test.js.
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

let current = null
const changed = (before, deps) => deps === undefined || before === undefined || deps.some((dep, index) => !Object.is(dep, before[index]))
const slot = () => current.index++
export const react = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useState(initial) {
    const at = slot()
    const own = current
    if (!(at in own.slots)) own.slots[at] = typeof initial === 'function' ? initial() : initial
    return [own.slots[at], (next) => { own.slots[at] = typeof next === 'function' ? next(own.slots[at]) : next }]
  },
  useRef(value) {
    const at = slot()
    if (!(at in current.slots)) current.slots[at] = { current: value }
    return current.slots[at]
  },
  useMemo(make, deps) {
    const at = slot()
    const before = current.slots[at]
    if (before === undefined || changed(before.deps, deps)) current.slots[at] = { value: make(), deps }
    return current.slots[at].value
  },
  useCallback: fn => fn,
  useEffect(run, deps) {
    const at = slot()
    const own = current
    const before = own.slots[at]
    if (before !== undefined && !changed(before.deps, deps)) return
    own.slots[at] = { deps, cleanup: before?.cleanup }
    own.effects.push(() => {
      before?.cleanup?.()
      own.slots[at].cleanup = run()
    })
  },
  useId: () => 'id',
  useSyncExternalStore: (_subscribe, get) => get(),
}
react.useLayoutEffect = (run, deps) => react.useEffect(run, deps)

// A host element's ref gets this node, as the DOM would give it, when the mount asks for refs.
const standInNode = () => ({ closest: () => null, scrollTop: 0, scrollHeight: 100, clientHeight: 100 })

// Draws `root()` again on every call, keeping each component's hooks by its place.
// `effects: false` drops every effect; `refs: true` fills each host element's empty ref.
export function mount(root, { effects = true, refs = false } = {}) {
  const hooks = new Map()
  const keys = []
  const draw = (node, path) => {
    if (Array.isArray(node)) return node.map((child, index) => draw(child, `${path}/${child?.props?.key ?? index}`))
    if (node === null || typeof node !== 'object') return node
    if (typeof node.type === 'function') {
      const id = `${path}<${node.type.name}:${node.props.key ?? ''}>`
      keys.push([node.type.name, node.props.key])
      if (!hooks.has(id)) hooks.set(id, { slots: [], effects: [] })
      const own = hooks.get(id)
      const before = current
      current = own
      own.index = 0
      let out
      try {
        out = node.type({ ...node.props, children: node.children })
      } finally {
        current = before
      }
      const drawn = draw(out, id)
      if (effects) for (const effect of own.effects.splice(0)) effect()
      else own.effects.length = 0
      return drawn
    }
    if (refs && node.props.ref && typeof node.props.ref === 'object' && node.props.ref.current == null) node.props.ref.current = standInNode()
    return { ...node, children: node.children.map((child, index) => draw(child, `${path}/${child?.props?.key ?? index}`)) }
  }
  return {
    draw: () => { keys.length = 0; return draw(root(), '') },
    keys: name => keys.filter(([type]) => type === name).map(([, key]) => key),
    unmount: () => { for (const own of hooks.values()) for (const kept of own.slots) kept?.cleanup?.() },
  }
}

export const nodes = (node, out = []) => {
  if (Array.isArray(node)) { for (const child of node) nodes(child, out) } else if (node && typeof node === 'object') {
    out.push(node)
    for (const child of node.children ?? []) nodes(child, out)
  }
  return out
}
export const classOf = node => String(node.props?.className ?? '').split(' ')
export const all = (root, className) => nodes(root).filter(node => classOf(node).includes(className))
export const one = (root, className) => all(root, className)[0]
export const ofType = (root, type) => nodes(root).filter(node => node.type === type)
export const text = node => (typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : (node?.children ?? []).map(text).join(''))
export const byLabel = (root, label) => nodes(root).find(node => node.props?.['aria-label'] === label)
export const settle = () => new Promise(resolve => setTimeout(resolve, 0))
// Objects made in the bundle's realm come back as plain ones, so they compare as values.
export const plain = value => (value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value)

// The stand-in right column, through the same two services DSH's sidebar-right plugin gives.
export function column() {
  const types = []
  const bodies = []
  const opened = []
  const state = { onScreen: 's-omni' }
  const right = {
    mounted: { getSnapshot: () => state.onScreen, subscribe: () => () => {} },
    openTab: (kind, options) => {
      if (!types.some(type => type.kind === kind)) throw new Error(`sidebarRight: no tab type is registered as "${kind}"`)
      opened.push([kind, plain(options)])
    },
  }
  const ctx = {
    inject: (_names, install) => {
      const disposers = []
      install({
        sidebarRight: right,
        sidebarRightTabs: { register: (definition) => { types.push(definition); return () => types.splice(types.indexOf(definition), 1) } },
        effect: (run) => { const dispose = run(); if (typeof dispose === 'function') disposers.push(dispose) },
      })
      return { dispose: () => { for (const dispose of disposers.reverse()) dispose() } }
    },
    slots: { inject: (_name, register) => register(), register: (options, component) => { bodies.push({ ...options, component }); return () => {} } },
  }
  return { ctx, types, bodies, opened, state }
}

// This plugin's client modules (`lines`: export lines, read from src/client/) bundled as DSH
// bundles the client, run with `globals` and the stand-in React; `team` is what
// '@automagik/bots-dsh/client' hands over. Nothing leaves the test.
export async function bundleClient(lines, { globals = {}, team }) {
  const bundle = await build({
    stdin: { contents: lines.join('\n'), resolveDir: fileURLToPath(new URL('../src/client/', import.meta.url)), loader: 'js' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom', '@automagik/bots-dsh/client'],
    loader: { '.css': 'text' },
  })
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, console, ...globals,
    require: name => ({ react, 'react-dom': { createPortal: node => node }, '@automagik/bots-dsh/client': team })[name],
  })
  return module.exports
}
