import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { isOmniBot } from '../src/client/omni-store.js'
import { STRINGS } from '../src/client/strings.js'
import { NEEDS_NEWER_TEAM, TEAM_CONTRACT } from '../src/host/resume-hook.js'
import { BEING_CUT, NOT_LINKED, OTHER_OMNI, WAITING } from '../src/host/thread-keys.js'
import { omni } from './omni-client.js'

test('only the Bot of kind omni carries the channel tree', () => {
  assert.equal(isOmniBot({ kind: 'omni' }), true)
  assert.equal(isOmniBot({ name: 'Omni' }), false)
  assert.equal(isOmniBot(undefined), false)
})


// -------------------------------------------------------------------------
// A stand-in React that keeps hooks per component, so a click changes state and the next
// draw shows it. Function components are drawn in place, each with its own hooks.

let current = null
const changed = (before, deps) => deps === undefined || before === undefined || deps.some((dep, index) => !Object.is(dep, before[index]))
const slot = () => current.index++
const react = {
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
  useLayoutEffect: () => {},
  useId: () => 'id',
  useSyncExternalStore: (_subscribe, get) => get(),
}
react.useLayoutEffect = (run, deps) => react.useEffect(run, deps)

// Draws `root()` again on every call, keeping each component's hooks by its place.
function mount(root, { effects = true } = {}) {
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
    return { ...node, children: node.children.map((child, index) => draw(child, `${path}/${child?.props?.key ?? index}`)) }
  }
  return {
    draw: () => { keys.length = 0; return draw(root(), '') },
    keys: name => keys.filter(([type]) => type === name).map(([, key]) => key),
    unmount: () => { for (const own of hooks.values()) for (const kept of own.slots) kept?.cleanup?.() },
  }
}

const nodes = (node, out = []) => {
  if (Array.isArray(node)) { for (const child of node) nodes(child, out) } else if (node && typeof node === 'object') {
    out.push(node)
    for (const child of node.children ?? []) nodes(child, out)
  }
  return out
}
const classOf = node => String(node.props?.className ?? '').split(' ')
const all = (root, className) => nodes(root).filter(node => classOf(node).includes(className))
const one = (root, className) => all(root, className)[0]
const text = node => (typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : (node?.children ?? []).map(text).join(''))
const byLabel = (root, label) => nodes(root).find(node => node.props?.['aria-label'] === label)
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

// The tree's modules bundled as DSH bundles the client, with the stand-in React and a host
// stand-in for `call`: nothing leaves the test.
const calls = []
let answer = () => ({})
// Objects made in the bundle's realm come back as plain ones, so they compare as values.
const plain = value => (value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value)
const fakeCall = async (endpoint, body) => {
  calls.push([endpoint, plain(body)])
  const reply = await answer(endpoint, body)
  if (reply instanceof Error) throw reply
  return reply
}
const document = { body: { dataset: {} } }
const storage = new Map()
const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) }

async function loadTree() {
  const bundle = await build({
    stdin: {
      contents: [
        'export { OmniTree, ThreadRow, ThreadPicker, ThreadDock, plusOf, teamReady, threadsOf, rowPropsOf, isThreadSession, OMNI_OUTDATED, OMNI_TREE_CSS } from \'./omni-tree.js\'',
        'export { openConnectWizard } from \'./wizard.js\'',
        'export { omniStore, startLive, loadLink, refreshLive } from \'./omni-store.js\'',
      ].join('\n'),
      resolveDir: fileURLToPath(new URL('../src/client/', import.meta.url)), loader: 'js',
    },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom', '@automagik/bots-dsh/client'],
    loader: { '.css': 'text' },
  })
  const module = { exports: {} }
  const team = { ...omni, call: fakeCall }
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, URL, URLSearchParams, setTimeout, clearTimeout, document, localStorage, console,
    require: name => ({ react, 'react-dom': { createPortal: node => node }, '@automagik/bots-dsh/client': { omni: team } })[name],
  })
  return module.exports
}
const ui = await loadTree()

const CHANNEL_A = { id: '11111111-1111-4111-8111-111111111111', type: 'whatsapp-baileys', name: 'Sales', status: 'connected' }
const CHANNEL_B = { id: '22222222-2222-4222-8222-222222222222', type: 'whatsapp-baileys', name: 'Personal', status: 'connected' }
const CHAT = (n, channel = CHANNEL_A) => ({ id: `c${n}`, channelId: channel.id, name: `Chat ${n}`, at: n, unread: 0 })
const THREAD = (n, channel = CHANNEL_A, extra = {}) => ({ id: `t${n}`, sessionId: `s${n}`, chatId: `c${n}`, channelId: channel.id, title: `Chat ${n}`, status: 'idle', connected: true, reason: null, ...extra })
const BOT = { id: 'omni-bot', kind: 'omni', name: 'Omni' }

// The roster as the host's view makes it (threads.js threadsView): a team with the hook names
// the row props; one without names none and says why.
const hooked = (extra = {}) => ({ omniThreads: [], omniThreadsOffered: true, omniThreadsReason: null, omniRowProps: [...TEAM_CONTRACT.rowProps], ...extra })
const oldTeam = (extra = {}) => ({ omniThreads: [], omniThreadsOffered: false, omniThreadsReason: NEEDS_NEWER_TEAM, omniRowProps: [], ...extra })

function linked({ chats = [CHAT(1), CHAT(2), CHAT(3, CHANNEL_B)], link = { origin: 'omni.example.com', version: '2.261027.3', outdated: false }, open = [CHANNEL_A.id, CHANNEL_B.id] } = {}) {
  const fresh = ui.omniStore.getSnapshot()
  ui.omniStore.set({ ...fresh, preview: false, source: { kind: 'live', origin: 'omni.example.com' }, channels: [CHANNEL_A, CHANNEL_B], chats, link })
  storage.set('omni.tree.open', JSON.stringify(open))
}

// Draws the tree the way the team's BotChildren does: `props` are the row props it passes.
function tree(t, props) {
  answer = endpoint => (endpoint === 'omni-overview' ? { configured: false } : {})
  calls.length = 0
  const opened = []
  const actions = { selectPanel: () => {}, openSession: id => opened.push(id), ...props.actions }
  const view = mount(() => react.createElement(ui.OmniTree, { bot: BOT, wide: true, ...props, actions }))
  t.after(() => { view.unmount(); ui.startLive(fakeCall)?.() })
  return { view, opened }
}
const channelOf = (root, channel) => nodes(root).find(node => classOf(node).includes('ot-channel') && nodes(node).some(inner => inner.props?.id === `omni-tree-${channel.id}`))

test('a channel with no added chat shows no chats; an added chat shows under its own channel only (:185)', (t) => {
  linked()
  const roster = hooked({ omniThreads: [THREAD(1)] })
  const { view } = tree(t, { roster })
  const root = view.draw()
  const [a, b] = [channelOf(root, CHANNEL_A), channelOf(root, CHANNEL_B)]
  assert.deepEqual(all(a, 'bt-thread').map(row => row.props['data-thread-id']), ['t1'])
  assert.deepEqual(all(b, 'bt-thread'), [])
  // The channel's other chats are not listed here; the Channels page keeps them, a click away.
  assert.equal(text(a).includes('Chat 2'), false)
  assert.equal(text(b).includes('Chat 3'), false)
  assert.equal(text(one(b, 'ot-all')), 'All chats')
  // A channel with no chats at all offers its health instead.
  linked({ chats: [CHAT(1)] })
  assert.equal(text(one(channelOf(view.draw(), CHANNEL_B), 'ot-all')), 'Channel health')
  linked()
  assert.equal(all(root, 'ot-chat').filter(node => !classOf(node).includes('ot-all')).length, 0)
})

test('a thread whose channel this Omni no longer lists still shows, apart, so it can be removed', (t) => {
  linked()
  const { view } = tree(t, { roster: hooked({ omniThreads: [THREAD(1), THREAD(9, { id: '99999999-9999-4999-8999-999999999999' }, { connected: false, reason: OTHER_OMNI })] }) })
  const root = view.draw()
  const others = byLabel(root, 'Other chats')
  assert.deepEqual(all(others, 'bt-thread').map(row => row.props['data-thread-id']), ['t9'])
  assert.equal(text(one(others, 'ot-thread-reason')), OTHER_OMNI)
  assert.ok(one(others, 'ot-thread-remove'))
  assert.deepEqual(all(channelOf(root, CHANNEL_A), 'bt-thread').map(row => row.props['data-thread-id']), ['t1'])
  // None of that while every thread's channel is listed.
  const { view: tidy } = tree(t, { roster: hooked({ omniThreads: [THREAD(1)] }) })
  assert.equal(byLabel(tidy.draw(), 'Other chats'), undefined)
})

test('with no Omni linked, the threads still show under the Connect link, and remove works there (:188)', async (t) => {
  ui.omniStore.set({ ...ui.omniStore.getSnapshot(), preview: true })
  const roster = hooked({ omniThreadsOffered: false, omniThreadsReason: NOT_LINKED, omniThreads: [THREAD(1, CHANNEL_A, { connected: false, reason: NOT_LINKED })] })
  const { view } = tree(t, { roster })
  const root = view.draw()
  assert.equal(text(one(root, 'ot-link')), 'Connect Omni →')
  const others = byLabel(root, 'Other chats')
  assert.equal(text(one(others, 'ot-thread-reason')), NOT_LINKED)
  calls.length = 0
  answer = () => ({ ok: true })
  one(view.draw(), 'ot-thread-remove').props.onClick()
  one(view.draw(), 'ot-thread-remove').props.onClick()
  await settle()
  assert.deepEqual(calls.filter(([endpoint]) => endpoint === 'omni-thread-remove'), [['omni-thread-remove', { threadId: 't1' }]])
  ui.omniStore.set({ ...ui.omniStore.getSnapshot(), preview: false })
})

test('a thread row remounts when the team starts or stops passing the status hooks', (t) => {
  linked()
  const thread = THREAD(1)
  const orphan = THREAD(9, { id: '99999999-9999-4999-8999-999999999999' })
  let props = { roster: hooked({ omniThreads: [thread, orphan] }) }
  const { view } = tree(t, new Proxy({}, { get: (_, name) => props[name], ownKeys: () => Reflect.ownKeys(props), getOwnPropertyDescriptor: (_, name) => ({ value: props[name], enumerable: true, configurable: true }) }))
  view.draw()
  const bare = view.keys('ThreadRow')
  props = { ...props, useSessionStatus: select => select(new Map()), useSessionRetainInfo: (_id, select) => select(undefined) }
  view.draw()
  const full = view.keys('ThreadRow')
  assert.equal(bare.length, 2)
  assert.equal(full.length, 2)
  for (const [index, key] of bare.entries()) assert.notEqual(key, full[index])
})

test('the + gets the focus back when its picker closes, and folding a channel closes its picker', async (t) => {
  linked()
  const { view } = tree(t, { roster: hooked() })
  answer = endpoint => (endpoint === 'omni-thread-chats' ? { chats: [{ id: 'c2', name: 'Chat 2', jid: '2@s.whatsapp.net', added: false }] } : endpoint === 'omni-thread-add' ? { ok: true, threadId: 't2' } : {})
  let focused = 0
  const open = () => {
    const plus = byLabel(channelOf(view.draw(), CHANNEL_A), 'Add a chat')
    plus.props.ref.current = { focus: () => { focused += 1 } }
    plus.props.onClick()
    return view.draw()
  }
  one(open(), 'ot-picker').props.onKeyDown({ key: 'Escape', stopPropagation: () => {} })
  assert.equal(all(view.draw(), 'ot-picker').length, 0)
  assert.equal(focused, 1)
  open()
  await settle()
  one(view.draw(), 'ot-picker-chat').props.onClick()
  await settle()
  await settle()
  assert.equal(all(view.draw(), 'ot-picker').length, 0)
  assert.equal(focused, 2)
  // Folded with its picker open, the channel opens again without it.
  open()
  one(channelOf(view.draw(), CHANNEL_A), 'ot-channel-row').props.onClick()
  assert.equal(all(view.draw(), 'ot-picker').length, 0)
  one(channelOf(view.draw(), CHANNEL_A), 'ot-channel-row').props.onClick()
  assert.equal(all(view.draw(), 'ot-picker').length, 0)
})

test('a folded channel keeps its thread rows out of the tab order', (t) => {
  linked({ open: [] })
  const { view } = tree(t, { roster: hooked({ omniThreads: [THREAD(1)] }) })
  let root = view.draw()
  assert.deepEqual([one(root, 'bt-thread').props.tabIndex, one(root, 'ot-thread-remove').props.tabIndex], [-1, -1])
  one(channelOf(root, CHANNEL_A), 'ot-channel-row').props.onClick()
  root = view.draw()
  assert.deepEqual([one(root, 'bt-thread').props.tabIndex, one(root, 'ot-thread-remove').props.tabIndex], [undefined, undefined])
})

test('the + lists that channel\'s chats; a chat that is a thread already cannot be picked again (:185)', async (t) => {
  linked()
  const roster = hooked({ omniThreads: [THREAD(1)] })
  const { view } = tree(t, { roster })
  answer = endpoint => (endpoint === 'omni-thread-chats' ? { chats: [{ id: 'c1', name: 'Chat 1', jid: '1@s.whatsapp.net', added: true }, { id: 'c2', name: 'Chat 2', jid: '2@s.whatsapp.net', added: false }] } : {})
  let root = view.draw()
  const plus = byLabel(channelOf(root, CHANNEL_A), 'Add a chat')
  assert.equal(plus.type, 'button')
  assert.equal(all(root, 'ot-picker').length, 0)
  plus.props.onClick()
  root = view.draw()
  await settle()
  root = view.draw()
  assert.deepEqual(calls.filter(([endpoint]) => endpoint === 'omni-thread-chats'), [['omni-thread-chats', { channelId: CHANNEL_A.id }]])
  const picker = one(channelOf(root, CHANNEL_A), 'ot-picker')
  assert.ok(picker)
  assert.equal(all(channelOf(root, CHANNEL_B), 'ot-picker').length, 0)
  const [taken, free] = all(picker, 'ot-picker-chat')
  assert.deepEqual([taken.props['data-chat-id'], taken.props.disabled, text(taken)], ['c1', true, 'Chat 1Added'])
  assert.deepEqual([free.props['data-chat-id'], free.props.disabled], ['c2', false])
  // A search asks the host again, once the typing stops.
  one(picker, 'ot-picker-search').props.onChange({ target: { value: ' Mar ' } })
  view.draw()
  await settle()
  assert.equal(calls.filter(([endpoint]) => endpoint === 'omni-thread-chats').length, 1, 'nothing is asked while the typing goes on')
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.deepEqual(calls.filter(([endpoint]) => endpoint === 'omni-thread-chats').at(-1), ['omni-thread-chats', { channelId: CHANNEL_A.id, query: 'Mar' }])
})

test('picking a chat adds it on the host and closes the picker; a failed mint shows the reason and adds no row (:187)', async (t) => {
  linked()
  const roster = hooked()
  const { view } = tree(t, { roster })
  const reason = 'Omni at omni.example.com cannot make chat keys; update it.'
  let added = { ok: false, reason }
  answer = endpoint => (endpoint === 'omni-thread-chats' ? { chats: [{ id: 'c2', name: 'Chat 2', jid: '2@s.whatsapp.net', added: false }] } : endpoint === 'omni-thread-add' ? added : {})
  byLabel(channelOf(view.draw(), CHANNEL_A), 'Add a chat').props.onClick()
  view.draw()
  await settle()
  let root = view.draw()
  one(root, 'ot-picker-chat').props.onClick()
  await settle()
  await settle()
  root = view.draw()
  assert.deepEqual(calls.find(([endpoint]) => endpoint === 'omni-thread-add'), ['omni-thread-add', { channelId: CHANNEL_A.id, chatId: 'c2' }])
  const problem = one(root, 'ot-picker-problem')
  assert.deepEqual([problem.props.role, text(problem)], ['alert', reason])
  assert.ok(one(root, 'ot-picker'), 'the picker stays open')
  assert.equal(all(root, 'bt-thread').length, 0)
  assert.equal(one(root, 'ot-picker-chat').props.disabled, false)
  // A refusal thrown by the host shows the same way.
  answer = endpoint => (endpoint === 'omni-thread-add' ? new Error('Could not reach Omni. Try again in a moment.') : {})
  one(root, 'ot-picker-chat').props.onClick()
  await settle()
  await settle()
  assert.equal(text(one(view.draw(), 'ot-picker-problem')), 'Could not reach Omni. Try again in a moment.')
  // Added: the picker closes; the row comes with the team's next roster.
  added = { ok: true, threadId: 't2' }
  answer = endpoint => (endpoint === 'omni-thread-add' ? added : {})
  one(view.draw(), 'ot-picker-chat').props.onClick()
  await settle()
  await settle()
  assert.equal(all(view.draw(), 'ot-picker').length, 0)
})

test('an Omni older than the floor is not offered the +, and says to update it (:183)', (t) => {
  linked({ link: { origin: 'omni.example.com', version: '2.261027.2', outdated: true } })
  const { view } = tree(t, { roster: hooked() })
  const root = view.draw()
  assert.equal(byLabel(root, 'Add a chat'), undefined)
  assert.deepEqual(all(root, 'ot-empty').map(text), [ui.OMNI_OUTDATED, ui.OMNI_OUTDATED])
  // At the floor, or with its version not known, the + is there.
  assert.deepEqual(plain(ui.plusOf(hooked(), { link: { outdated: false } })), { offered: true, reason: null })
  assert.deepEqual(plain(ui.plusOf(hooked(), { link: null })), { offered: true, reason: null })
  assert.deepEqual(plain(ui.plusOf(hooked({ omniThreadsOffered: false, omniThreadsReason: NOT_LINKED }), { link: null })), { offered: false, reason: NOT_LINKED })
})

test('the linked Omni\'s floor is read once per link, and again while it is outdated', async () => {
  const asked = []
  let info = { linked: true, version: '2.261027.2', outdated: true }
  const call = async (endpoint) => { asked.push(endpoint); return info }
  await ui.loadLink(call, 'omni.example.com')
  assert.deepEqual(plain(ui.omniStore.getSnapshot().link), { origin: 'omni.example.com', version: '2.261027.2', outdated: true })
  info = new Error('unreachable')
  await ui.loadLink(async () => { throw info }, 'omni.example.com')
  assert.equal(ui.omniStore.getSnapshot().link.outdated, true, 'a failed read keeps what was known')
  info = { linked: true, version: null }
  await ui.loadLink(call, 'omni.example.com')
  assert.deepEqual(plain(ui.omniStore.getSnapshot().link), { origin: 'omni.example.com', version: null, outdated: false })
  assert.deepEqual(asked, ['omni-link-info', 'omni-link-info'])
})

test('each poll reads the linked Omni\'s floor only for a new link, or while it is outdated', async () => {
  const asked = []
  let info = { linked: true, version: '2.261027.3', outdated: false }
  const call = async (endpoint) => {
    asked.push(endpoint)
    if (endpoint === 'omni-overview') return { configured: true, origin: 'omni.example.com', channels: [], chats: [] }
    if (endpoint === 'omni-channel-abilities') return { changeChannels: false, send: false }
    return endpoint === 'omni-link-info' ? info : {}
  }
  ui.omniStore.set({ ...ui.omniStore.getSnapshot(), link: null, chatId: null })
  const reads = () => asked.filter(endpoint => endpoint === 'omni-link-info').length
  await ui.refreshLive(call)
  await settle()
  await ui.refreshLive(call)
  await settle()
  assert.equal(reads(), 1)
  ui.omniStore.set({ ...ui.omniStore.getSnapshot(), link: { origin: 'omni.example.com', version: '2.261027.2', outdated: true } })
  await ui.refreshLive(call)
  await settle()
  assert.equal(reads(), 2)
  assert.equal(ui.omniStore.getSnapshot().link.outdated, false, 'an updated Omni gets the + back without a reload')
  await settle()
  // Another Omni linked here is read again.
  ui.omniStore.set({ ...ui.omniStore.getSnapshot(), link: { origin: 'other.example.com', version: '2.261027.3', outdated: false } })
  await ui.refreshLive(call)
  await settle()
  assert.equal(reads(), 3)
  // An Omni that did not answer with its version is asked again next time.
  info = { linked: true, version: null, reachable: false }
  ui.omniStore.set({ ...ui.omniStore.getSnapshot(), link: null })
  await ui.refreshLive(call)
  await settle()
  await ui.refreshLive(call)
  await settle()
  assert.equal(reads(), 5)
  // The poll and the open chat's messages do not wait for a slow link read.
  info = new Promise(() => {})
  ui.omniStore.set({ ...ui.omniStore.getSnapshot(), link: null, chatId: 'c1' })
  const done = await Promise.race([ui.refreshLive(call).then(() => 'done'), new Promise(resolve => setTimeout(resolve, 100, 'waited'))])
  assert.equal(done, 'done')
  assert.ok(asked.includes('omni-messages'))
  ui.omniStore.set({ ...ui.omniStore.getSnapshot(), chatId: null })
})

test('on a team without the hook: no +, the channels say a newer Bot team is needed, and a thread row never opens its Session (:195)', (t) => {
  linked()
  const opened = []
  // An older team passes BotChildren only these (bots-dsh before 3.32.1 sidebar.js BotChildren).
  const { view } = tree(t, { roster: oldTeam({ omniThreads: [THREAD(1, CHANNEL_A, { connected: false, reason: NEEDS_NEWER_TEAM })] }), actions: { openSession: id => opened.push(id) } })
  const root = view.draw()
  assert.equal(byLabel(root, 'Add a chat'), undefined)
  assert.deepEqual(all(root, 'ot-empty').map(text), [NEEDS_NEWER_TEAM, NEEDS_NEWER_TEAM])
  const row = one(root, 'bt-thread')
  assert.equal(text(one(row, 'ot-thread-reason')), NEEDS_NEWER_TEAM)
  assert.equal(row.props['aria-disabled'], true)
  assert.match(row.props['aria-label'], /Adding a chat needs a newer Bot team/)
  row.props.onClick()
  assert.deepEqual(opened, [])
})

test('a thread row has the bt-thread look: working, waiting and idle from the view, and "not connected" with its reason in place', () => {
  const roster = hooked()
  const props = { roster, actions: { openSession: () => {} } }
  const rowProps = ui.rowPropsOf(props, roster.omniRowProps)
  const draw = thread => mount(() => react.createElement(ui.ThreadRow, { thread, actions: props.actions, rowProps })).draw()
  const working = one(draw(THREAD(1, CHANNEL_A, { status: 'working' })), 'bt-thread')
  assert.deepEqual([working.props['data-state'], classOf(working.children[0])[0]], ['working', 'bt-thread-spin'])
  assert.match(working.props['aria-label'], /Working/)
  const waiting = one(draw(THREAD(1, CHANNEL_A, { status: 'waiting' })), 'bt-thread')
  assert.deepEqual([waiting.props['data-state'], classOf(waiting.children[0])[0]], ['waiting', 'bt-thread-wait'])
  const idleRoot = draw(THREAD(1))
  const idle = one(idleRoot, 'bt-thread')
  assert.deepEqual([idle.props['data-state'], classOf(idle.children[0])[0], one(idleRoot, 'ot-thread').props['data-idle']], ['idle', 'ot-thread-idle', true])
  assert.equal(one(idle, 'ot-thread-reason'), undefined)
  const cut = one(draw(THREAD(1, CHANNEL_A, { connected: false, reason: OTHER_OMNI })), 'bt-thread')
  assert.equal(text(one(cut, 'ot-thread-reason')), OTHER_OMNI)
  assert.equal(cut.props.title, OTHER_OMNI)
  assert.equal(cut.props['aria-disabled'], undefined)
})

test('without the row props a thread shows and opens, with only the unread dot missing; with them it shows DSH\'s dot and "waiting" (:209)', () => {
  const sessions = new Map([['s1', { completionUnread: true }], ['s2', { pendingInteraction: { kind: 'approval' } }], ['s3', { completionUnread: true }]])
  const shown = new Set(['s3'])
  const opened = []
  const actions = { openSession: id => opened.push(id) }
  const roster = hooked()
  const full = {
    bot: BOT, roster, actions, wide: true, useSessions: select => select({ byId: {} }), useUi: select => select({}),
    useSessionStatus: select => select(sessions), useSessionRetainInfo: (id, select) => select({ retainedBy: { mainView: shown.has(id) ? 1 : 0 } }),
    useActivity: select => select({}), useWork: select => select({}),
  }
  const draw = (thread, rowProps) => mount(() => react.createElement(ui.ThreadRow, { thread, actions, rowProps })).draw()
  // Without them: an older team's BotChildren passes only bot, roster and actions.
  const bare = ui.rowPropsOf({ bot: BOT, roster, actions }, roster.omniRowProps)
  assert.deepEqual(Object.keys(bare).sort(), ['actions', 'bot', 'roster'])
  const plain = draw(THREAD(1), bare)
  assert.equal(one(plain, 'bt-unread'), undefined)
  assert.equal(one(plain, 'bt-thread').props['data-state'], 'idle')
  one(plain, 'bt-thread').props.onClick()
  assert.deepEqual(opened, ['s1'])
  // With them: the dot, DSH's own "waiting", and the row marked while its Session is shown.
  const rowProps = ui.rowPropsOf(full, roster.omniRowProps)
  assert.deepEqual(Object.keys(rowProps).sort(), [...TEAM_CONTRACT.rowProps].sort())
  const unread = draw(THREAD(1), rowProps)
  assert.ok(one(unread, 'bt-unread'))
  assert.match(one(unread, 'bt-thread').props['aria-label'], /Unread activity/)
  const asking = one(draw(THREAD(2, CHANNEL_A, { status: 'idle' }), rowProps), 'bt-thread')
  assert.deepEqual([asking.props['data-state'], classOf(asking.children[0])[0]], ['waiting', 'bt-thread-wait'])
  assert.match(asking.props['aria-label'], /Waiting for you/)
  const open = draw(THREAD(3), rowProps)
  assert.equal(one(open, 'bt-thread').props['aria-current'], 'page')
  assert.equal(one(open, 'bt-unread'), undefined, 'a Session on screen is read')
  // Drawn by the tree the team's way, the props reach each row.
  linked()
  const view = mount(() => react.createElement(ui.OmniTree, { ...full, roster: hooked({ omniThreads: [THREAD(1)] }), actions: { ...actions, selectPanel: () => {} } }), { effects: false })
  assert.ok(one(view.draw(), 'bt-unread'))
})

test('removing a thread asks once more, then asks the host', async () => {
  calls.length = 0
  answer = () => ({ ok: true })
  const roster = hooked()
  const view = mount(() => react.createElement(ui.ThreadRow, { thread: THREAD(1), actions: {}, rowProps: ui.rowPropsOf({ roster }, roster.omniRowProps) }))
  let remove = one(view.draw(), 'ot-thread-remove')
  assert.equal(remove.props['aria-label'], 'Remove Chat 1')
  remove.props.onClick()
  remove = one(view.draw(), 'ot-thread-remove')
  assert.equal(remove.props['data-confirm'], true)
  assert.deepEqual(calls, [])
  remove.props.onClick()
  await settle()
  assert.deepEqual(calls, [['omni-thread-remove', { threadId: 't1' }]])
  // A refusal says why on the row.
  answer = () => new Error('The thread could not be removed: busy')
  one(view.draw(), 'ot-thread-remove').props.onClick()
  one(view.draw(), 'ot-thread-remove').props.onClick()
  await settle()
  assert.equal(text(one(view.draw(), 'ot-thread-problem')), 'The thread could not be removed: busy')
})

test('the reasons the host gives a thread or the + have Chinese copy here', () => {
  for (const reason of [NEEDS_NEWER_TEAM, NOT_LINKED, OTHER_OMNI, BEING_CUT, WAITING, ui.OMNI_OUTDATED]) assert.ok(Object.hasOwn(STRINGS, reason), reason)
})

// Before an Omni is linked, the tree is one quiet link into the Connect wizard.
test('an Omni Bot with no linked Omni shows one "Connect Omni →" link that opens the wizard', () => {
  ui.omniStore.set({ ...ui.omniStore.getSnapshot(), preview: true })
  const tree = mount(() => react.createElement(ui.OmniTree, { bot: BOT, actions: { selectPanel: () => {} } }), { effects: false }).draw()
  assert.equal(tree.children.filter(Boolean).length, 1)
  const [link] = tree.children
  assert.equal(link.type, 'button')
  assert.equal(link.props.onClick, ui.openConnectWizard)
  assert.equal(text(link), 'Connect Omni →')
  assert.equal(link.children[1].props['aria-hidden'], true)
})

// -------------------------------------------------------------------------
// First probe 3: what a thread's Session gets when it opens. Not run in a live DSH (that needs
// a running DSH and the owner's approval); instead the pinned Bot team's own client code, from
// source, is drawn for a thread's Session id. It opens in the Bot skin (it is not a DSH Agent
// Session, so `openSession` does not take the plain surface), every Bot dock and header control
// keyed by a Bot or a group draws nothing there, and the one Bot control that draws for any
// Session (voice chat) is hidden by the thread's own record (ThreadDock).

async function loadTeamDocks() {
  const dir = join(process.env.OMNI_DSH_CORE, 'src', 'client')
  const bundle = await build({
    stdin: {
      contents: [
        'export { MemberDock } from \'./member-status.js\'',
        'export { ModelChoiceDock } from \'./model-menu.js\'',
        'export { QuestionDock } from \'./questions.js\'',
        'export { WidgetDock } from \'./widget-cell.js\'',
        'export { SecretDock } from \'./secret-card.js\'',
        'export { SuggestionDock } from \'./suggestions.js\'',
        'export { BtwDock } from \'./btw.js\'',
        'export { ComposerPlus, ComposerVoice } from \'./composer.js\'',
        'export { packModelCell } from \'./composer-pack-cells.js\'',
        'export { HeaderPill } from \'./header.js\'',
        'export { isAgentSession } from \'./sources.js\'',
      ].join('\n'),
      resolveDir: dir, loader: 'js',
    },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/*'],
    loader: { '.css': 'text', '.png': 'dataurl', '.svg': 'text', '.webp': 'dataurl' },
  })
  const module = { exports: {} }
  const platform = { react, 'react-dom': { createPortal: node => node }, 'react/jsx-runtime': { jsx: react.createElement, jsxs: react.createElement, Fragment: react.Fragment }, '@deepseek-ai/dsh-client-ui-primitives': { MarkdownText: () => null } }
  const window = { addEventListener: () => {}, removeEventListener: () => {}, innerWidth: 1280, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) }
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, URL, URLSearchParams, setTimeout, clearTimeout, console, window, document: { ...document, addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null }, localStorage, navigator: { userAgent: 'node' },
    require: name => platform[name] ?? (() => { throw new Error(`no module ${name}`) })(),
  })
  return module.exports
}

test('first probe 3: a thread opens in the Bot skin with every other Bot dock empty, and its own record hides the Bot controls left', async () => {
  const team = await loadTeamDocks()
  const bot = { id: 'omni-bot', kind: 'omni', name: 'Omni', model: 'deepseek/deepseek-chat' }
  const roster = {
    ready: true, mainBotId: 'main', eventsBotId: bot.id, byId: { [bot.id]: bot }, roomsById: {}, agentOf: {}, agentsById: {},
    questions: {}, views: {}, secretRequests: {}, btwCards: {}, exchangeTurns: {}, models: [{ ref: 'deepseek/deepseek-chat' }], omniConsents: {},
    ...hooked({ omniThreads: [THREAD(1)] }),
  }
  const props = sessionId => ({
    sessionId, input: { draft: '' }, session: { running: false }, inputActions: undefined,
    useRoster: select => select(roster), useWork: select => select({ bots: {}, rooms: {}, approvals: [] }), useCards: select => select({}), useHeldCards: select => select({}),
    useSessions: select => select({ byId: {}, ids: [], projectionsBySession: {} }), useSessionStatus: select => select(new Map()), useSession: select => select?.({}),
    useActivity: select => select({}), useMemoryNews: select => select(new Map()), useTurnClock: select => select({}), useUi: select => select({ visits: {} }),
    useLive: select => select?.({}), useStore: select => select({}), useConversationViews: select => select([]),
    actions: { turnFacts: () => ({ turns: 0, openTurn: null }), speech: () => undefined, canReferenceChat: () => false, beginVisit: () => {}, endVisit: () => {}, refreshModels: () => {} },
  })
  const draw = (Component, sessionId) => mount(() => react.createElement(Component, props(sessionId)), { effects: false }).draw()
  // The Bot skin: the team opens any Session that is not a DSH Agent Session's on its own surface.
  assert.equal(team.isAgentSession(roster, new Set(), 's1'), false)
  // Every dock above the composer, and the composer's model and "+" cells, draw nothing for it.
  const PackModelCell = team.packModelCell({})
  const docks = { MemberDock: team.MemberDock, ModelChoiceDock: team.ModelChoiceDock, QuestionDock: team.QuestionDock, WidgetDock: team.WidgetDock, SecretDock: team.SecretDock, SuggestionDock: team.SuggestionDock, BtwDock: team.BtwDock, ComposerPlus: team.ComposerPlus, PackModelCell }
  const drawn = Object.fromEntries(Object.entries(docks).map(([name, Component]) => [name, draw(Component, 's1')]))
  assert.deepEqual(Object.entries(drawn).filter(([, out]) => out !== null && out !== undefined).map(([name]) => name), [])
  // The Omni Bot's own chat, as a check that the stand-in draws them: its "+" is there.
  assert.ok(nodes(draw(team.ComposerPlus, bot.id)).some(node => classOf(node).includes('bt-plus')))
  // The header names no Bot: no header buttons (the automations board), no details button.
  const head = draw(team.HeaderPill, 's1')
  assert.equal(all(head, 'bt-head-details').length, 0)
  assert.ok(nodes(draw(team.HeaderPill, bot.id)).some(node => classOf(node).includes('bt-head-details')))
  // Voice chat draws for any Session: the one Bot control left. The thread's record hides it.
  assert.ok(nodes(draw(team.ComposerVoice, 's1')).some(node => classOf(node).includes('bt-voice')))
  const view = mount(() => react.createElement(ui.ThreadDock, { sessionId: 's1', useRoster: select => select(roster) }))
  assert.equal(view.draw(), null)
  assert.equal(document.body.dataset.omniThread, '')
  assert.match(ui.OMNI_TREE_CSS, /body\[data-omni-thread\] \.bt-voice/)
  // What never draws in a thread is not hidden there; dictation stays on purpose.
  for (const name of ['bt-head-details', 'bt-suggest', 'bt-mic']) assert.equal(ui.OMNI_TREE_CSS.includes(`body[data-omni-thread] .${name}`), false, name)
  view.unmount()
  assert.equal(Object.hasOwn(document.body.dataset, 'omniThread'), false)
  // Any other Session leaves the page as it was.
  mount(() => react.createElement(ui.ThreadDock, { sessionId: bot.id, useRoster: select => select(roster) })).draw()
  assert.equal(Object.hasOwn(document.body.dataset, 'omniThread'), false)
})
