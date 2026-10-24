import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatsOf, isOmniBot } from '../src/client/omni-store.js'

test('only the Bot of kind omni carries the channel tree', () => {
  assert.equal(isOmniBot({ kind: 'omni' }), true)
  assert.equal(isOmniBot({ name: 'Omni' }), false)
  assert.equal(isOmniBot(undefined), false)
})

test('a channel shows its newest chats first, and counts the ones it leaves out', () => {
  const chats = Array.from({ length: 11 }, (_, n) => ({ id: `c${n}`, channelId: n % 4 === 0 ? 'slack' : 'wa', at: n }))
  const { chats: shown, more } = chatsOf({ chats }, 'wa', 5)
  assert.deepEqual(shown.map(chat => chat.id), ['c10', 'c9', 'c7', 'c6', 'c5'])
  assert.equal(more, 3)
  assert.deepEqual(chatsOf({ chats }, 'slack', 8), { chats: [chats[8], chats[4], chats[0]], more: 0 })
  assert.deepEqual(chatsOf({ chats }, 'none', 8), { chats: [], more: 0 })
})

// Before an Omni is linked, the tree is one quiet link into the Connect wizard.
test('an Omni Bot with no linked Omni shows one "Connect Omni →" link that opens the wizard', async () => {
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const { runInNewContext } = await import('node:vm')
  const { omni } = await import('./omni-client.js')
  const bundle = await build({
    stdin: { contents: 'export { OmniTree } from \'./omni-tree.js\'\nexport { openConnectWizard } from \'./wizard.js\'', resolveDir: fileURLToPath(new URL('../src/client/', import.meta.url)), loader: 'js' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom', '@automagik/omni-dsh/client'],
    loader: { '.css': 'text' },
  })
  const module = { exports: {} }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect: () => {}, useMemo: make => make(), useRef: current => ({ current }), useCallback: fn => fn,
    useSyncExternalStore: (_subscribe, get) => get(),
  }
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, URL, require: name => ({ react, 'react-dom': { createPortal: node => node }, '@automagik/omni-dsh/client': { omni } })[name] })
  const { OmniTree, openConnectWizard } = module.exports
  const tree = OmniTree({ bot: { id: 'o1', kind: 'omni', name: 'Omni' }, actions: { selectPanel: () => {} } })
  assert.equal(tree.children.length, 1)
  const [link] = tree.children
  assert.equal(link.type, 'button')
  assert.equal(link.props.onClick, openConnectWizard)
  const text = node => (typeof node === 'string' ? node : (node?.children ?? []).map(text).join(''))
  assert.equal(text(link), 'Connect Omni →')
  assert.equal(link.children[1].props['aria-hidden'], true)
})
