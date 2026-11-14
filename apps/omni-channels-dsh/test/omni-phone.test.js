import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { NEEDS_NEWER_TEAM, TEAM_CONTRACT } from '../src/host/resume-hook.js'
import { all, bundleClient, column, mount as mountWith, nodes, ofType, one, plain, react, settle, text } from './client-stand-in.js'
import { omni } from './omni-client.js'

// The chat pane (omni-phone.js, its ids still say phone): a thread's chat across the whole pane,
// drawn by the chat view of channels.js, a tab of DSH's right column opened only from the thread. Drawn with a stand-in React and a stand-in
// right column; the host is a stand-in `call`, so nothing leaves the test and nothing is sent.

// The stand-in React of client-stand-in.js; a host element's ref gets a stand-in node, as the
// DOM would give it.
const mount = root => mountWith(root, { refs: true })

// -------------------------------------------------------------------------
// The host and the page, stood in: `call` answers from `answer`, the poll's timers wait for
// the test to run them, and a file becomes a blob: URL.

const calls = []
const logged = []
let answer = () => ({})
const fakeCall = async (endpoint, body) => {
  calls.push([endpoint, plain(body)])
  const reply = await answer(endpoint, body)
  if (reply instanceof Error) throw reply
  return reply
}
const asked = endpoint => calls.filter(([name]) => name === endpoint)
const mediaAsked = id => asked('omni-media').filter(([, body]) => body.messageId === id).length

let timers = []
const fakeSetTimeout = (run, ms) => { const timer = { run, ms, on: true }; timers.push(timer); return timer }
const fakeClearTimeout = (timer) => { if (timer) timer.on = false }
// The next poll: every poll timer due now runs.
async function nextPoll() {
  const due = timers.filter(timer => timer.on && timer.ms === 15_000)
  timers = timers.filter(timer => !due.includes(timer))
  for (const timer of due) timer.run()
  await settle()
}

let blobs = 0
const BundleURL = Object.assign(class extends URL {}, { createObjectURL: () => `blob:file-${++blobs}`, revokeObjectURL: () => {} })
const storage = new Map()
let storageFull = false
const localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => { if (storageFull) throw new Error('QuotaExceededError'); storage.set(key, String(value)) },
  removeItem: key => storage.delete(key),
}
const document = { hidden: false, body: { dataset: {} } }

const ui = await bundleClient([
  'export { PhonePane, PhoneTab, PhoneDock, installPhone, openPhone, requestPhone, hasPhoneIntent, takePhoneIntent, phoneSurfaceIs, threadName, phoneThreadOf, keepParams, keptParams, phoneTabDefinition, phoneTabId, PHONE_KIND, PHONE_TAB_ID, OMNI_PHONE_CSS } from \'./omni-phone.js\'',
  'export { CHANNELS_CSS, ChatPage, EMOJI, MessageBar, TICKS, insertAt } from \'./channels.js\'',
  'export { omniStore } from \'./omni-store.js\'',
  'export { ThreadRow, rowPropsOf } from \'./omni-tree.js\'',
], { globals: { console: { ...console, warn: (...args) => logged.push(args) }, URL: BundleURL, URLSearchParams, Blob, atob, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, document, localStorage }, team: { omni: { ...omni, call: fakeCall } } })

// -------------------------------------------------------------------------
// Threads as the host's view lists them (threads.js threadsView), and a chat's messages as
// the host's messageOf passes them.

const CHAT_1 = '11111111-1111-4111-8111-111111111111'
const CHAT_2 = '22222222-2222-4222-8222-222222222222'
const THREAD = (n, chatId = CHAT_1, extra = {}) => ({ id: `t${n}`, sessionId: `s${n}`, chatId, channelId: 'wa', title: `Chat ${n}`, status: 'idle', connected: true, reason: null, ...extra })
const hooked = threads => ({ omniThreads: threads, omniThreadsOffered: true, omniThreadsReason: null, omniRowProps: [...TEAM_CONTRACT.rowProps] })
const oldTeam = threads => ({ omniThreads: threads, omniThreadsOffered: false, omniThreadsReason: NEEDS_NEWER_TEAM, omniRowProps: [] })
const useRosterOf = roster => select => select(roster)

const AT = Date.UTC(2026, 9, 27, 12)
const media = (id, type, extra = {}) => ({ id, from: 'them', fromMe: false, author: 'Ana', text: '', caption: null, type, hasMedia: true, mime: null, mediaText: null, fileName: null, at: AT, ...extra })
const MESSAGES = [
  media('m1', 'image', { mime: 'image/jpeg', mediaText: 'A red bike by a wall' }),
  media('m2', 'audio', { mime: 'audio/ogg', mediaText: 'Can you call me at five?' }),
  media('m3', 'video', { mime: 'video/mp4', text: 'look' }),
  media('m4', 'document', { mime: 'application/pdf', fileName: 'invoice-482.pdf' }),
  media('m5', 'sticker', { mime: 'image/webp' }),
  { id: 'm6', from: 'omni', fromMe: true, text: 'On my way', caption: null, type: 'text', hasMedia: false, mime: null, mediaText: null, fileName: null, at: AT + 1 },
]
const FILE = { ok: true, mime: 'image/jpeg', data: Buffer.from('file').toString('base64'), name: null }
const host = (messages = MESSAGES) => (endpoint) => {
  if (endpoint === 'omni-messages') return { messages: structuredClone(messages) }
  if (endpoint === 'omni-media') return FILE
  return {}
}

function reset() {
  calls.length = 0
  logged.length = 0
  timers = []
  storage.clear()
  storageFull = false
  document.hidden = false
  answer = host()
}

// Draws and lets the host answer, a few rounds: the poll's reply, then each file near the screen.
async function drawn(view, rounds = 4) {
  let root = view.draw()
  for (let round = 0; round < rounds; round += 1) {
    await settle()
    root = view.draw()
  }
  return root
}

function installed(t) {
  const stand = column()
  const dispose = ui.installPhone(stand.ctx, () => ({}))
  t.after(dispose)
  return stand
}

// A pane header's words, its "Always allow send" switch and the chat's avatar left out.
const headText = head => text({ children: (head?.children ?? []).filter(child => !all(child, 'op-send').length && child?.props?.className !== 'op-send' && !all(child, 'oc-ava').length) })

const pane = (props, t) => {
  const view = mount(() => react.createElement(ui.PhonePane, props))
  t.after(() => view.unmount())
  return view
}

// -------------------------------------------------------------------------

test('the pane shows the thread\'s chat across the whole pane, with no device frame: a picture, a voice note with Omni\'s text in its bubble, a video still, a document by name, a sticker (:203)', async (t) => {
  reset()
  const roster = hooked([THREAD(1)])
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's-omni', useRoster: useRosterOf(roster) }, t)
  const root = await drawn(view)
  assert.deepEqual(asked('omni-messages'), [['omni-messages', { chatId: CHAT_1 }]])
  // No frame: the pane itself is the chat, its header, its log and its message bar.
  assert.deepEqual(['op-device', 'op-frame', 'op-button', 'op-screen'].map(name => all(root, name).length), [0, 0, 0, 0])
  const screen = one(root, 'op-pane')
  assert.deepEqual([screen.props.role, screen.props['aria-label']], ['region', 'Chat with Chat 1'])
  assert.deepEqual(screen.children.map(child => child.props.className.split(' ')[0]), ['oc-chat-head', 'oc-thread', 'oc-bar-wrap'])
  assert.equal(headText(one(screen, 'op-head')), 'Chat 1')
  const log = one(screen, 'oc-thread')
  assert.equal(log.props.role, 'log')
  const bubbles = all(log, 'oc-bubble')
  assert.deepEqual(bubbles.map(bubble => bubble.props['data-media'] ?? 'text'), ['image', 'audio', 'video', 'document', 'sticker', 'text'])
  const [picture, voice, video, documentBubble, sticker, words] = bubbles
  // A picture is a picture, with Omni's text under it in the same bubble; no "[image]".
  const [image] = ofType(picture, 'img')
  assert.match(image.props.src, /^blob:file-/)
  assert.equal(text(one(picture, 'oc-media-text')), 'A red bike by a wall')
  assert.equal(text(root).includes('[image]'), false)
  // A voice note is a player, with Omni's text for it in the same bubble.
  const [player] = ofType(voice, 'audio')
  assert.equal(player.props.controls, true)
  assert.match(player.props.src, /^blob:file-/)
  assert.equal(text(one(voice, 'oc-media-text')), 'Can you call me at five?')
  // A video is a still with a play mark, fetched only once it is played.
  const still = one(video, 'oc-media-still')
  assert.ok(one(still, 'oc-media-play'))
  assert.equal(text(one(video, 'oc-media-caption')), 'look')
  assert.equal(mediaAsked('m3'), 0)
  // A document by its name, never fetched here; a sticker as its picture.
  assert.equal(text(one(documentBubble, 'oc-media-doc')), 'invoice-482.pdf')
  assert.equal(mediaAsked('m4'), 0)
  assert.equal(ofType(sticker, 'img')[0].props.className, 'oc-media-sticker')
  assert.equal(text(words).startsWith('On my way'), true)
  assert.deepEqual([mediaAsked('m1'), mediaAsked('m2'), mediaAsked('m5')], [1, 1, 1])
  // Played, the video's file is asked for, once.
  still.props.onClick()
  const after = await drawn(view)
  assert.equal(ofType(all(after, 'oc-bubble')[2], 'video').length, 1)
  assert.equal(mediaAsked('m3'), 1)
  // It reads; nothing is sent until staff send from its composer (#1715): one box, empty.
  assert.deepEqual([ofType(after, 'textarea').length, ofType(after, 'textarea')[0].props.value, ofType(after, 'input').length], [1, '', 0])
  assert.deepEqual([...new Set(calls.map(([endpoint]) => endpoint))].sort(), ['omni-media', 'omni-messages'])
})

test('the next poll reads the chat again and does not fetch a file it already has (:203)', async (t) => {
  reset()
  const roster = hooked([THREAD(1)])
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's-omni', useRoster: useRosterOf(roster) }, t)
  await drawn(view)
  assert.deepEqual([mediaAsked('m1'), mediaAsked('m2'), mediaAsked('m5')], [1, 1, 1])
  for (let poll = 2; poll <= 3; poll += 1) {
    await nextPoll()
    const root = await drawn(view)
    assert.equal(asked('omni-messages').length, poll)
    assert.deepEqual([mediaAsked('m1'), mediaAsked('m2'), mediaAsked('m5')], [1, 1, 1], `poll ${poll} fetched a file again`)
    assert.match(ofType(all(root, 'oc-bubble')[0], 'img')[0].props.src, /^blob:file-/)
  }
  // A new message on a later poll is fetched, once.
  answer = host([...MESSAGES, media('m7', 'image', { at: AT + 2 })])
  await nextPoll()
  await drawn(view)
  assert.deepEqual([mediaAsked('m1'), mediaAsked('m7')], [1, 1])
  // Gone, the pane polls no more.
  view.unmount()
  await nextPoll()
  assert.equal(asked('omni-messages').length, 4)
})

test('a hidden tab does not poll; a host refusal shows friendly text and logs its diagnostic', async (t) => {
  reset()
  const roster = hooked([THREAD(1)])
  const hidden = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's-omni', useRoster: useRosterOf(roster), visible: false }, t)
  await drawn(hidden)
  assert.equal(asked('omni-messages').length, 0)
  const failure = new Error('omni is not set up here')
  answer = endpoint => (endpoint === 'omni-messages' ? failure : {})
  const root = await drawn(pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's-omni', useRoster: useRosterOf(roster) }, t))
  const problem = all(root, 'op-note').find(node => node.props.role === 'alert')
  assert.equal(text(problem), 'Could not load messages. Retrying soon.')
  assert.equal(text(root).includes(failure.message), false)
  assert.deepEqual(logged, [['Could not load chat messages:', failure]])
})

test('a poll that comes while the page is hidden reads nothing; the next one on a shown page reads again', async (t) => {
  reset()
  const roster = hooked([THREAD(1)])
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's-omni', useRoster: useRosterOf(roster) }, t)
  await drawn(view)
  assert.equal(asked('omni-messages').length, 1)
  document.hidden = true
  await nextPoll()
  await drawn(view)
  assert.equal(asked('omni-messages').length, 1, 'a hidden page polled')
  document.hidden = false
  await nextPoll()
  await drawn(view)
  assert.equal(asked('omni-messages').length, 2)
})

test('kept params hold the newest 50 tabs, and a page whose storage refuses still draws the pane', async (t) => {
  reset()
  for (let n = 0; n <= 50; n += 1) ui.keepParams(`s/tab-${n}`, { threadId: `t${n}`, chatId: CHAT_1 })
  const kept = JSON.parse(storage.get('omni.phone.tabs'))
  assert.equal(Object.keys(kept).length, 50)
  assert.equal(ui.keptParams('s/tab-0'), undefined, 'the oldest is dropped')
  assert.deepEqual(plain(ui.keptParams('s/tab-1')), { threadId: 't1', chatId: CHAT_1 })
  assert.deepEqual(plain(ui.keptParams('s/tab-50')), { threadId: 't50', chatId: CHAT_1 })
  // Keeping one again makes it the newest: the next one in drops the next oldest.
  ui.keepParams('s/tab-1', { threadId: 't1', chatId: CHAT_1 })
  ui.keepParams('s/tab-51', { threadId: 't51', chatId: CHAT_1 })
  assert.equal(ui.keptParams('s/tab-2'), undefined)
  assert.ok(ui.keptParams('s/tab-1'))
  // Storage that throws (full, blocked): the tab still shows its thread.
  storageFull = true
  const tab = { id: 'tab-x', visible: true, navigation: { address: 'sidebar://omni-phone', params: { threadId: 't1', chatId: CHAT_1 }, revision: 1 } }
  const view = mount(() => react.createElement(ui.PhoneTab, { useTabInfo: () => ({ tab }), sessionId: 's-omni', useRoster: useRosterOf(hooked([THREAD(1)])) }))
  t.after(() => view.unmount())
  const root = await drawn(view)
  assert.equal(one(root, 'op-pane').props['data-thread-id'], 't1')
  assert.equal(ui.keptParams('s-omni/tab-x'), undefined)
})

test('names and text from the chat are drawn as text only', async (t) => {
  reset()
  const name = '<img src=x onerror=alert(1)>'
  answer = host([{ ...MESSAGES[5], from: 'them', author: '<b>Ana</b>', text: '<script>alert(1)</script>' }])
  const roster = hooked([THREAD(1, CHAT_1, { title: name })])
  const root = await drawn(pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's-omni', useRoster: useRosterOf(roster) }, t))
  assert.equal(nodes(root).some(node => 'dangerouslySetInnerHTML' in (node.props ?? {})), false)
  assert.equal(one(root, 'op-head').children[0].children[0], name)
  assert.equal(one(root, 'oc-msg-author').children[0], '<b>Ana</b>')
  assert.equal(one(root, 'oc-bubble').children.find(child => typeof child === 'string'), '<script>alert(1)</script>')
  assert.equal(ofType(root, 'img').length + ofType(root, 'script').length + ofType(root, 'b').length, 0)
})

// The regression for Bug 1 of the 3.50.0 dogfood: a row's click opened the pane while the
// Session it had just switched to had no surface yet, so DSH's openTab threw
// "sidebarRight: no session surface is mounted" and the row showed it in red. The click now
// asks (requestPhone) and the thread's own dock opens the pane from the render that brings
// the Session, where openTab is allowed — and DSH's committed surface may be materialized
// one effect after that dock, which must not cost the open (the seat's own effect order).

const threadRow = (thread, actions, roster) => mount(() => react.createElement(ui.ThreadRow, { thread, actions, rowProps: ui.rowPropsOf({ roster, actions }, roster.omniRowProps) }))
const dockOf = (sessionId, roster) => mount(() => react.createElement(ui.PhoneDock, { sessionId, useRoster: useRosterOf(roster) }))

test('a row\'s click opens its Session and asks for the pane, which its own dock opens once the Session has a surface', async (t) => {
  reset()
  // Before DSH's right column is there, the action says so and throws nothing.
  assert.equal(ui.openPhone(THREAD(1)), 'The chat needs DSH\'s right column.')
  const stand = installed(t)
  assert.deepEqual(stand.types.map(type => [type.id, type.kind, type.title()]), [[ui.PHONE_TAB_ID, ui.PHONE_KIND, 'Chat']])
  assert.deepEqual([ui.PHONE_KIND, ui.PHONE_TAB_ID, ui.phoneTabId('t1')], ['omni-phone', 'ds-bot/omni-phone', 'ds-bot/omni-phone:t1'])
  assert.deepEqual(stand.bodies.map(body => [body.name, body.key, body.component === ui.PhoneTab]), [['sidebar.right.pane.tab', ui.PHONE_TAB_ID, true]])
  assert.deepEqual(stand.opened, [], 'installing opens nothing')
  const thread = THREAD(1)
  const roster = hooked([thread])
  const sessions = []
  const actions = { openSession: id => sessions.push(id) }
  const row = threadRow(thread, actions, roster)
  assert.equal(one(row.draw(), 'ot-thread-phone'), undefined)
  one(row.draw(), 'bt-thread').props.onClick()
  assert.deepEqual(sessions, ['s1'])
  assert.deepEqual(stand.opened, [], 'not in the column of the Session still on screen')
  assert.equal(one(row.draw(), 'ot-thread-problem'), undefined)
  // The Session is on screen but its seat has not minted its surface yet: still nothing, and
  // no error on the row (this is where the 3.50.0 build threw and showed the DSH message).
  stand.put('s1')
  assert.equal(stand.right.screen(), undefined, 'control: mounted without a surface')
  assert.equal(one(row.draw(), 'ot-thread-problem'), undefined)
  assert.deepEqual(stand.opened, [])
  // The row left the open to the dock, and the dock is what opens it: no throw at click time.
  assert.equal(ui.hasPhoneIntent('t1'), true, 'the open is still owed')
  // Its Session's seat mints and adopts its store, as the render that brings it does; its
  // committed surface (screen()) comes a moment later, in the seat's own effect. The dock must
  // open in that gap: openTab lands on the adopted Session, place() takes the absent surface.
  stand.adopt('s1')
  assert.equal(stand.right.screen(), undefined, 'control: adopted, surface not committed yet')
  const dock = dockOf('s1', roster)
  assert.equal(dock.draw(), null, 'the dock draws no control')
  await settle()
  assert.deepEqual(stand.opened, [['omni-phone', { params: { threadId: 't1', chatId: CHAT_1 } }]])
  assert.equal(ui.hasPhoneIntent('t1'), false, 'the intent is spent once')
  // Rendered again with nothing owed, it opens nothing more.
  dock.draw()
  await settle()
  assert.equal(stand.opened.length, 1)
  // Clicked again while its Session is on screen with its surface committed: it opens at once.
  stand.materialize('s1')
  one(row.draw(), 'bt-thread').props.onClick()
  assert.equal(stand.opened.length, 2)
  assert.deepEqual(sessions, ['s1', 's1'])
})

test('a row\'s click while another Session is on screen leaves the open to the thread\'s dock, and a newer click wins', async (t) => {
  reset()
  const stand = installed(t)
  const roster = hooked([THREAD(1), THREAD(2, CHAT_2)])
  const actions = { openSession: () => {} }
  const one1 = threadRow(THREAD(1), actions, roster)
  one(one1.draw(), 'bt-thread').props.onClick()
  stand.put('s1')
  stand.adopt('s1')
  const dock = dockOf('s1', roster)
  dock.draw()
  await settle()
  assert.deepEqual(stand.opened, [['omni-phone', { params: { threadId: 't1', chatId: CHAT_1 } }]])
  // The other thread's row clicked while the first is on screen: its own dock opens its pane.
  const two = threadRow(THREAD(2, CHAT_2), actions, roster)
  one(two.draw(), 'bt-thread').props.onClick()
  assert.equal(stand.opened.length, 1)
  stand.put('s2')
  stand.adopt('s2')
  dockOf('s2', roster).draw()
  await settle()
  assert.deepEqual(stand.opened.slice(1), [['omni-phone', { params: { threadId: 't2', chatId: CHAT_2 } }]])
})

test('on a stand-in team without the hook, or with no conversation on screen, a row says why the pane cannot open', async (t) => {
  reset()
  const stand = installed(t)
  const thread = THREAD(1)
  const actions = { openSession: () => {} }
  // No Session on screen at all: no column to open in, and the row says so.
  stand.put(undefined)
  const row = mount(() => react.createElement(ui.ThreadRow, { thread, actions, rowProps: {} }))
  one(row.draw(), 'bt-thread').props.onClick()
  assert.equal(text(one(row.draw(), 'ot-thread-problem')), 'Open a conversation first; the chat opens beside it.')
  assert.equal(stand.opened.length, 0)
  // A team without the hook opens the pane beside the Session on screen, as before.
  stand.put('s-omni')
  one(row.draw(), 'bt-thread').props.onClick()
  assert.deepEqual(stand.opened, [['omni-phone', { params: { threadId: 't1', chatId: CHAT_1 } }]])
})

test('on a stand-in Bot team without the hook, a click on the row opens the pane and the row never calls actions.openSession (:195)', async (t) => {
  reset()
  const stand = installed(t)
  const thread = THREAD(1, CHAT_1, { connected: false, reason: NEEDS_NEWER_TEAM, reasonCode: 'needs_newer_team' })
  const roster = oldTeam([thread])
  const sessions = []
  const actions = { openSession: id => sessions.push(id) }
  // An older team passes BotChildren no row props this plugin names.
  const row = mount(() => react.createElement(ui.ThreadRow, { thread, actions, rowProps: ui.rowPropsOf({ roster, actions }, roster.omniRowProps) }))
  let root = row.draw()
  assert.equal(text(one(root, 'ot-thread-reason')), NEEDS_NEWER_TEAM)
  one(root, 'bt-thread').props.onClick()
  root = row.draw()
  assert.equal(one(root, 'ot-thread-problem'), undefined)
  assert.deepEqual(stand.opened, [['omni-phone', { params: { threadId: 't1', chatId: CHAT_1 } }]])
  assert.deepEqual(sessions, [], 'the row never opens the thread\'s Session')
  // The pane it opened, in the Session on screen, shows that chat.
  const [, { params }] = stand.opened[0]
  const tab = { id: 'tab-1', visible: true, navigation: { address: 'sidebar://omni-phone', params, revision: 1 } }
  const view = mount(() => react.createElement(stand.bodies[0].component, { useTabInfo: () => ({ tab }), sessionId: 's-omni', useRoster: useRosterOf(roster) }))
  t.after(() => view.unmount())
  const shown = await drawn(view)
  assert.equal(one(shown, 'op-pane').props['data-thread-id'], 't1')
  assert.equal(headText(one(shown, 'op-head')), `Chat 1${NEEDS_NEWER_TEAM}`)
  assert.deepEqual(asked('omni-messages'), [['omni-messages', { chatId: CHAT_1 }]])
  assert.equal(all(shown, 'oc-bubble').length, MESSAGES.length)
  assert.deepEqual(sessions, [])
})

test('first probe 4 (not run live): the tab\'s params round-trip, a reload that drops them keeps the chat, and a tab without them shows the thread of its Session', async (t) => {
  reset()
  const stand = installed(t)
  const roster = hooked([THREAD(1), THREAD(2, CHAT_2)])
  const useRoster = useRosterOf(roster)
  one(mount(() => react.createElement(ui.ThreadRow, { thread: THREAD(2, CHAT_2), actions: { openSession: () => {} }, rowProps: {} })).draw(), 'bt-thread').props.onClick()
  const { params } = stand.opened[0][1]
  // JSON-shaped, as the column's params are by contract.
  assert.deepEqual(JSON.parse(JSON.stringify(params)), { threadId: 't2', chatId: CHAT_2 })
  const body = stand.bodies[0].component
  const tabIn = (sessionId, navigationParams, id = 'tab-1') => {
    const tab = { id, visible: true, navigation: { address: 'sidebar://omni-phone', params: navigationParams, revision: navigationParams ? 1 : 0 } }
    const view = mount(() => react.createElement(body, { useTabInfo: () => ({ tab }), sessionId, useRoster }))
    t.after(() => view.unmount())
    return view
  }
  const threadShown = async view => one(await drawn(view, 2), 'op-pane').props['data-thread-id'] ?? text(one(view.draw(), 'op-note'))
  assert.equal(await threadShown(tabIn('s-omni', params)), 't2')
  // A reload: DSH restores the tab record with no params (`params: void 0, revision: 0`); this
  // page kept them for that Session's tab.
  assert.equal(await threadShown(tabIn('s-omni', undefined)), 't2')
  // Nothing kept (another browser, cleared storage): the thread whose Session the tab is in.
  storage.clear()
  assert.equal(await threadShown(tabIn('s1', undefined)), 't1')
  // Outside a thread's Session with nothing to go on, it says where to open it from.
  assert.equal(await threadShown(tabIn('s-omni', undefined, 'tab-9')), 'Open a chat from the sidebar to see it here.')
  // Params of a thread removed since name no listed thread: nothing is read for it.
  calls.length = 0
  assert.equal(await threadShown(tabIn('s-omni', { threadId: 't9', chatId: '99999999-9999-4999-8999-999999999999' })), 'This chat is no longer in the sidebar.')
  assert.equal(asked('omni-messages').length, 0)
  // Even in a thread's own Session: params naming a removed thread do not fall back to it.
  assert.equal(await threadShown(tabIn('s1', { threadId: 't9', chatId: '99999999-9999-4999-8999-999999999999' }, 'tab-8')), 'This chat is no longer in the sidebar.')
  assert.equal(asked('omni-messages').length, 0)
  // Its chat added again (a new thread): the pane follows the chat.
  assert.deepEqual(plain(ui.phoneThreadOf(hooked([THREAD(7, CHAT_2)]), { threadId: 't2', chatId: CHAT_2 }, 's-omni'))?.id, 't7')
  assert.equal(ui.phoneThreadOf({}, undefined, 's1'), null)
})

test('the pane draws no device frame: it fills the pane\'s width and height, with no width cap (owner, 2026-11-14)', () => {
  const css = ui.OMNI_PHONE_CSS
  assert.match(css, /\.op-pane\{[^}]*height:100%[^}]*display:flex;flex-direction:column/)
  for (const gone of ['.op-device', '.op-frame', '.op-screen', '.op-button', 'max-width:300px', 'aspect-ratio:390/844', '100cqi']) assert.equal(css.includes(gone), false, gone)
  // The chat view's rules are the chat page's: one look for both.
  for (const rule of ['.oc-chat-head{', '.oc-bubble{', '.oc-bar-wrap{', '.oc-emoji{', '.oc-tick{']) assert.ok(ui.CHANNELS_CSS.includes(rule), rule)
})

test('the frame\'s file and the notice for its copied look are gone, and NOTICE still says no other third-party code is copied', () => {
  const notice = readFileSync(new URL('../NOTICE', import.meta.url), 'utf8')
  assert.equal(notice.includes('dsh-ios'), false)
  assert.equal(notice.includes('phone-frame.js'), false)
  assert.ok(notice.includes('No other third-party code is copied into this repository.'))
  assert.throws(() => readFileSync(new URL('../src/client/phone-frame.js', import.meta.url), 'utf8'), { code: 'ENOENT' })
})

test('the pane\'s header names a thread by its chat, never a raw id: "Chat" or "Group" when it has no name', async (t) => {
  reset()
  const thread = THREAD(1, CHAT_1, { title: null, kind: 'group' })
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, useRoster: useRosterOf(hooked([thread])) }, t)
  const shown = await drawn(view)
  assert.equal(headText(one(shown, 'op-head')), 'Group')
  assert.equal(nodes(shown).find(node => node.props?.role === 'log').props['aria-label'], 'Conversation with Group')
  assert.equal(ui.threadName({ title: null, kind: 'direct' }), 'Chat')
  assert.equal(ui.threadName({ title: '+5511988887777', kind: 'direct' }), '+5511988887777')
})

test('two rows clicked quickly each open their own pane, the later one last', async (t) => {
  reset()
  const stand = installed(t)
  const roster = hooked([THREAD(1), THREAD(2, CHAT_2)])
  const actions = { openSession: () => {} }
  const rowOf = thread => threadRow(thread, actions, roster)
  // A then B before either Session is on screen: each click leaves its own intent, so the
  // Session that arrives first still gets its pane, and the one after gets its own.
  one(rowOf(THREAD(1)).draw(), 'bt-thread').props.onClick()
  one(rowOf(THREAD(2, CHAT_2)).draw(), 'bt-thread').props.onClick()
  stand.put('s1')
  stand.adopt('s1')
  dockOf('s1', roster).draw()
  await settle()
  assert.deepEqual(stand.opened, [['omni-phone', { params: { threadId: 't1', chatId: CHAT_1 } }]])
  stand.put('s2')
  stand.adopt('s2')
  dockOf('s2', roster).draw()
  await settle()
  assert.deepEqual(stand.opened.slice(1), [['omni-phone', { params: { threadId: 't2', chatId: CHAT_2 } }]])
  // Each intent is spent once: a dock drawn again opens nothing.
  dockOf('s1', roster).draw()
  dockOf('s2', roster).draw()
  await settle()
  assert.equal(stand.opened.length, 2)
})


test('a mounted Session without an adopted store gives a friendly row message and never calls openTab', (t) => {
  reset()
  const stand = installed(t)
  stand.adopted.delete('s-omni')
  let opened = 0
  stand.right.openTab = () => { opened += 1; throw new Error('sidebarRight: no session surface is mounted') }
  const row = mount(() => react.createElement(ui.ThreadRow, { thread: THREAD(1), actions: {}, rowProps: {} }))
  one(row.draw(), 'bt-thread').props.onClick()
  assert.equal(text(one(row.draw(), 'ot-thread-problem')), 'Open a conversation first; the chat opens beside it.')
  assert.equal(opened, 0)
})

test('an unexpected openTab failure shows only a friendly translated row message', (t) => {
  reset()
  const stand = installed(t)
  const raw = 'sidebarRight: private runtime diagnostic'
  stand.right.openTab = () => { throw new Error(raw) }
  const row = mount(() => react.createElement(ui.ThreadRow, { thread: THREAD(1), actions: {}, rowProps: {} }))
  one(row.draw(), 'bt-thread').props.onClick()
  assert.equal(text(one(row.draw(), 'ot-thread-problem')), 'Open a conversation first; the chat opens beside it.')
  assert.equal(text(row.draw()).includes(raw), false)
  assert.equal(logged.length, 1)
  assert.equal(logged[0][1].message, raw)
})

async function nextPhoneWait() {
  const timer = timers.find(timer => timer.on && timer.ms === 50)
  assert.ok(timer, 'the pending adoption has a bounded retry')
  timer.on = false
  timer.run()
  await settle()
}

test('a thread dock retries a pending click and opens once its mounted store is adopted', async (t) => {
  reset()
  const stand = installed(t)
  const thread = THREAD(1)
  const roster = hooked([thread])
  const row = threadRow(thread, { openSession: () => {} }, roster)
  one(row.draw(), 'bt-thread').props.onClick()
  stand.put('s1')
  let attempts = 0
  const openTab = stand.right.openTab
  stand.right.openTab = (...args) => { attempts += 1; return openTab(...args) }
  const dock = dockOf('s1', roster)
  t.after(() => dock.unmount())
  dock.draw()
  assert.equal(attempts, 0, 'no openTab call before adoption')
  assert.equal(ui.hasPhoneIntent('t1'), true)
  stand.adopt('s1')
  await nextPhoneWait()
  assert.equal(dock.draw(), null)
  assert.deepEqual(stand.opened, [['omni-phone', { params: { threadId: 't1', chatId: CHAT_1 } }]])
  assert.equal(ui.hasPhoneIntent('t1'), false)
  assert.equal(attempts, 1)
})

test('a store that never adopts times out with a friendly dock message and no openTab call', async (t) => {
  reset()
  const stand = installed(t)
  const thread = THREAD(1)
  one(threadRow(thread, { openSession: () => {} }, hooked([thread])).draw(), 'bt-thread').props.onClick()
  stand.put('s1')
  let attempts = 0
  stand.right.openTab = () => { attempts += 1 }
  const dock = dockOf('s1', hooked([thread]))
  t.after(() => dock.unmount())
  dock.draw()
  for (let retry = 0; retry < 10; retry += 1) await nextPhoneWait()
  assert.equal(text(one(dock.draw(), 'op-dock-problem')), 'Open a conversation first; the chat opens beside it.')
  assert.equal(ui.hasPhoneIntent('t1'), false)
  assert.equal(attempts, 0)
  assert.equal(timers.some(timer => timer.on && timer.ms === 50), false)
})

test('unmounting a waiting dock cancels its retry; it never opens in another Session', async (t) => {
  reset()
  const stand = installed(t)
  const thread = THREAD(1)
  one(threadRow(thread, { openSession: () => {} }, hooked([thread])).draw(), 'bt-thread').props.onClick()
  stand.put('s1')
  const dock = dockOf('s1', hooked([thread]))
  dock.draw()
  assert.ok(timers.some(timer => timer.on && timer.ms === 50))
  dock.unmount()
  assert.equal(timers.some(timer => timer.on && timer.ms === 50), false)
  stand.put('s-other')
  stand.adopt('s-other')
  await settle()
  assert.deepEqual(stand.opened, [])
})


test('a pending adoption retry never opens the phone in a different mounted Session', async (t) => {
  reset()
  const stand = installed(t)
  const thread = THREAD(1)
  one(threadRow(thread, { openSession: () => {} }, hooked([thread])).draw(), 'bt-thread').props.onClick()
  stand.put('s1')
  const dock = dockOf('s1', hooked([thread]))
  t.after(() => dock.unmount())
  dock.draw()
  stand.put('s-other')
  stand.adopt('s-other')
  await nextPhoneWait()
  assert.deepEqual(stand.opened, [])
  assert.equal(timers.some(timer => timer.on && timer.ms === 50), false)
})


test('the dock catch hides raw runtime text and logs the diagnostic while adoption is pending', async (t) => {
  reset()
  const stand = installed(t)
  const thread = THREAD(1)
  one(threadRow(thread, { openSession: () => {} }, hooked([thread])).draw(), 'bt-thread').props.onClick()
  stand.put('s1')
  const dock = dockOf('s1', hooked([thread]))
  t.after(() => dock.unmount())
  dock.draw()
  const failure = new Error('PRIVATE-DOCK-ADOPTION-ERROR')
  stand.right.actionsFor = () => { throw failure }
  await nextPhoneWait()
  assert.equal(text(one(dock.draw(), 'op-dock-problem')), 'Open a conversation first; the chat opens beside it.')
  assert.equal(text(dock.draw()).includes(failure.message), false)
  assert.deepEqual(logged, [['Could not open the phone pane:', failure]])
  assert.equal(ui.hasPhoneIntent('t1'), false)
  assert.deepEqual(stand.opened, [])
  assert.equal(timers.some(timer => timer.on && timer.ms === 50), false)
})

for (const [label, actionsFor] of [['missing', undefined], ['not callable', {}]]) {
  test(`openPhone falls back to openTab when actionsFor is ${label}`, (t) => {
    reset()
    const stand = installed(t)
    stand.right.actionsFor = actionsFor
    assert.equal(ui.openPhone(THREAD(1)), null)
    assert.deepEqual(stand.opened, [['omni-phone', { params: { threadId: 't1', chatId: CHAT_1 } }]])
    assert.deepEqual(logged, [])
  })

  test(`the dock falls back to openTab when actionsFor is ${label}`, (t) => {
    reset()
    const stand = installed(t)
    const thread = THREAD(1)
    one(threadRow(thread, { openSession: () => {} }, hooked([thread])).draw(), 'bt-thread').props.onClick()
    stand.put('s1')
    stand.adopt('s1')
    stand.right.actionsFor = actionsFor
    const dock = dockOf('s1', hooked([thread]))
    t.after(() => dock.unmount())
    assert.equal(dock.draw(), null)
    assert.deepEqual(stand.opened, [['omni-phone', { params: { threadId: 't1', chatId: CHAT_1 } }]])
    assert.equal(ui.hasPhoneIntent('t1'), false)
    assert.equal(timers.some(timer => timer.on && timer.ms === 50), false)
    assert.deepEqual(logged, [])
  })
}

test('a later poll failure keeps messages visible, hides raw text, and clears on recovery', async (t) => {
  reset()
  answer = host([MESSAGES[5]])
  const roster = hooked([THREAD(1)])
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's-omni', useRoster: useRosterOf(roster) }, t)
  await drawn(view)
  const failure = 'PRIVATE-MESSAGE-POLL-STRING'
  answer = () => { throw failure }
  await nextPoll()
  let root = await drawn(view)
  assert.equal(text(all(root, 'op-note').find(node => node.props.role === 'alert')), 'Could not load messages. Retrying soon.')
  assert.equal(text(root).includes(failure), false)
  assert.equal(one(root, 'oc-bubble').children.find(child => typeof child === 'string'), 'On my way')
  assert.deepEqual(logged, [['Could not load chat messages:', failure]])
  answer = host([MESSAGES[5]])
  await nextPoll()
  root = await drawn(view)
  assert.equal(all(root, 'op-note').find(node => node.props.role === 'alert'), undefined)
  assert.equal(one(root, 'oc-bubble').children.find(child => typeof child === 'string'), 'On my way')
  assert.equal(asked('omni-messages').length, 3)
})

test('the pane\'s "Always allow send" switch sets only this thread\'s sends: on to allow, off to ask; it follows the host\'s view, and a failed save says so', async (t) => {
  reset()
  let roster = hooked([THREAD(1)])
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's1', useRoster: select => select(roster) }, t)
  let root = await drawn(view)
  const toggle = () => one(root, 'op-switch')
  assert.equal(toggle().props.role, 'switch')
  assert.equal(toggle().props['aria-checked'], false)
  assert.equal(toggle().props['aria-label'], 'Always allow send')
  // On: this thread's sends allow; the switch shows it until the host's view does.
  toggle().props.onClick()
  root = await drawn(view)
  assert.deepEqual(asked('omni-thread-permissions'), [['omni-thread-permissions', { threadId: 't1', sends: 'allow' }]])
  assert.equal(toggle().props['aria-checked'], true)
  roster = hooked([THREAD(1, CHAT_1, { permissions: { sends: 'allow', reactions: 'list' }, ownPermissions: { sends: 'allow' } })])
  root = await drawn(view)
  assert.equal(toggle().props['aria-checked'], true)
  // Off: its sends ask, whatever the default is.
  toggle().props.onClick()
  root = await drawn(view)
  assert.deepEqual(asked('omni-thread-permissions').at(-1), ['omni-thread-permissions', { threadId: 't1', sends: 'ask' }])
  assert.equal(toggle().props['aria-checked'], false)
  // A save the host refuses leaves the state in force and says so in place.
  roster = hooked([THREAD(1, CHAT_1, { permissions: { sends: 'ask', reactions: 'list' }, ownPermissions: { sends: 'ask' } })])
  root = await drawn(view)
  answer = endpoint => (endpoint === 'omni-thread-permissions' ? new Error('This host is read-only.') : host()(endpoint))
  toggle().props.onClick()
  root = await drawn(view)
  assert.equal(toggle().props['aria-checked'], false)
  assert.equal(text(one(root, 'op-send-problem')), 'Could not change this chat\'s settings. Try again.')
})

test('an answer child\'s "Always allow send" switch is its sending mode: on asks for sending, off for training, as the sidebar menu does', async (t) => {
  reset()
  let roster = hooked([THREAD(1, CHAT_1, { answerChild: true, sendingMode: 'training', permissions: { sends: 'ask', reactions: 'list' } })])
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's1', useRoster: select => select(roster) }, t)
  let root = await drawn(view)
  const toggle = () => one(root, 'op-switch')
  assert.equal(toggle().props['aria-checked'], false)
  toggle().props.onClick()
  root = await drawn(view)
  assert.deepEqual(asked('set_child_sending'), [['set_child_sending', { threadId: 't1', mode: 'sending' }]])
  assert.deepEqual(asked('omni-thread-permissions'), [])
  roster = hooked([THREAD(1, CHAT_1, { answerChild: true, sendingMode: 'sending', permissions: { sends: 'allow', reactions: 'list' } })])
  root = await drawn(view)
  assert.equal(toggle().props['aria-checked'], true)
  toggle().props.onClick()
  root = await drawn(view)
  assert.deepEqual(asked('set_child_sending').at(-1), ['set_child_sending', { threadId: 't1', mode: 'training' }])
  assert.equal(toggle().props['aria-checked'], false)
})

// -------------------------------------------------------------------------
// #1715: staff's own composer at the pane's foot (PhoneComposer), on the host's omni-phone-send.

const composerOf = root => one(root, 'op-compose')
const boxOf = root => ofType(composerOf(root), 'textarea')[0]
const sendOf = root => one(composerOf(root), 'oc-send')
const typed = (root, value) => boxOf(root).props.onChange({ target: { value } })
const key = (root, init = {}) => {
  const event = { key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, prevented: false, preventDefault() { event.prevented = true }, ...init }
  boxOf(root).props.onKeyDown(event)
  return event
}
// The host holds omni-phone-send until the test lets it answer (or fail).
function heldSend() {
  const held = []
  answer = endpoint => (endpoint === 'omni-phone-send' ? new Promise((resolve) => { held.push(resolve) }) : host()(endpoint))
  return held
}

test('the pane\'s composer: Enter sends the trimmed text to omni-phone-send, Shift+Enter adds a line, and the box waits while it is being sent', async (t) => {
  reset()
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's1', useRoster: useRosterOf(hooked([THREAD(1)])) }, t)
  let root = await drawn(view)
  assert.equal(boxOf(root).props.placeholder, 'Write your own message')
  assert.equal(boxOf(root).props.maxLength, 4096)
  assert.equal(sendOf(root).props.disabled, true, 'nothing to send yet')
  typed(root, '  Hello,\nit ships today. ')
  root = await drawn(view)
  assert.equal(sendOf(root).props.disabled, false)
  // Shift+Enter is a new line, and Enter while an input method composes is not a send.
  assert.equal(key(root, { shiftKey: true }).prevented, false)
  key(root, { nativeEvent: { isComposing: true } })
  assert.deepEqual(asked('omni-phone-send'), [])
  const held = heldSend()
  // Two Enters before the box draws again send once.
  assert.equal(key(root).prevented, true)
  key(root)
  root = await drawn(view)
  assert.deepEqual(asked('omni-phone-send'), [['omni-phone-send', { threadId: 't1', text: 'Hello,\nit ships today.' }]])
  assert.deepEqual([boxOf(root).props.disabled, sendOf(root).props.disabled], [true, true])
  held[0]({ sent: true, messageId: 'x', paused: false, draft: null })
  root = await drawn(view)
  assert.deepEqual([boxOf(root).props.value, boxOf(root).props.disabled], ['', false])
  assert.equal(all(root, 'op-compose-fail').length, 0)
})

test('a failed send says why in the pane, keeps the text, and sends nothing again until staff send it', async (t) => {
  reset()
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's1', useRoster: useRosterOf(hooked([THREAD(1)])) }, t)
  let root = await drawn(view)
  const failure = new Error('Omni answered 503: instance not connected. Nothing was sent.')
  answer = endpoint => (endpoint === 'omni-phone-send' ? failure : host()(endpoint))
  typed(root, 'On my way')
  root = await drawn(view)
  sendOf(root).props.onClick()
  root = await drawn(view)
  const problem = one(root, 'op-compose-fail')
  assert.equal(problem.props.role, 'alert')
  assert.equal(text(problem), 'Not sent: Omni answered 503: instance not connected. Nothing was sent.')
  assert.deepEqual([boxOf(root).props.value, boxOf(root).props.disabled], ['On my way', false])
  assert.deepEqual(logged.at(-1), ['Could not send the message:', failure])
  await nextPoll()
  root = await drawn(view)
  assert.equal(asked('omni-phone-send').length, 1, 'never sent again by itself')
  // Staff send it again: it goes, and the problem clears.
  answer = host()
  key(root)
  root = await drawn(view)
  assert.equal(asked('omni-phone-send').length, 2)
  assert.equal(all(root, 'op-compose-fail').length, 0)
  assert.equal(boxOf(root).props.value, '')
})

test('an answer child\'s draft waiting on its card shows with Edit; edited in the composer it goes out as typed with the draft\'s id, and the pane then asks staff to reject the card', async (t) => {
  reset()
  const DRAFT = 'Your order left today and arrives in 3 to 5 business days.'
  const EDITED = 'Your order left today.\nIt arrives on Friday.'
  const child = extra => THREAD(1, CHAT_1, { answerChild: true, sendingMode: 'training', status: 'waiting', permissions: { sends: 'ask', reactions: 'list' }, ...extra })
  let roster = hooked([child({ waitingDraft: { id: 'd1', text: DRAFT } })])
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's1', useRoster: select => select(roster) }, t)
  let root = await drawn(view)
  const draft = one(composerOf(root), 'op-draft')
  assert.equal(text(one(draft, 'op-draft-text')), DRAFT)
  assert.equal(text(one(draft, 'op-draft-head')), 'The bot\'s draft, waiting on its card' + 'Edit')
  assert.equal(boxOf(root).props.value, '')
  // Edit puts the draft in the box; emptied again, the draft waits on its card as before.
  one(draft, 'op-draft-edit').props.onClick()
  root = await drawn(view)
  assert.equal(boxOf(root).props.value, DRAFT)
  assert.equal(all(root, 'op-draft').length, 0)
  typed(root, '')
  root = await drawn(view)
  assert.equal(all(root, 'op-draft').length, 1)
  one(root, 'op-draft-edit').props.onClick()
  root = await drawn(view)
  typed(root, EDITED)
  root = await drawn(view)
  sendOf(root).props.onClick()
  root = await drawn(view)
  assert.deepEqual(asked('omni-phone-send'), [['omni-phone-send', { threadId: 't1', text: EDITED, draftId: 'd1' }]])
  // The host's view says staff replaced it: no Edit, one line asking staff to reject its card.
  roster = hooked([child({ waitingDraft: { id: 'd1', text: DRAFT, replaced: true }, paused: true })])
  root = await drawn(view)
  assert.equal(all(root, 'op-draft').length, 0)
  assert.equal(text(one(root, 'op-compose-note')), 'Reject the bot\'s draft on its card')
  // The card answered, the line goes; the next message carries no draft.
  roster = hooked([child({ status: 'idle', paused: true })])
  root = await drawn(view)
  assert.equal(all(root, 'op-compose-note').length, 0)
  typed(root, 'One more thing.')
  root = await drawn(view)
  key(root)
  root = await drawn(view)
  assert.deepEqual(asked('omni-phone-send').at(-1), ['omni-phone-send', { threadId: 't1', text: 'One more thing.' }])
})

// -------------------------------------------------------------------------
// The chat view (owner, 2026-11-14): the pane and the chat page draw one header, one log and one
// message bar (channels.js), each on its own send path.

// The overview as the sidebar reads it (omni-overview), set for one test and put back after.
function withOverview(t, patch) {
  const before = ui.omniStore.getSnapshot()
  ui.omniStore.set({ ...before, ...patch })
  t.after(() => ui.omniStore.set(before))
}
const SUPPORT = { id: 'wa', type: 'telegram', name: 'Support line', status: 'connected', answeredBy: 'Omni' }

test('the header: the chat\'s photo from the overview, else its initials; its name; the channel\'s name, or why the thread cannot reach it; never presence', async (t) => {
  reset()
  withOverview(t, { channels: [SUPPORT], chats: [{ id: CHAT_1, channelId: 'wa', name: 'Ana Lima', initials: 'AL', at: 1, unread: 0, avatarUrl: 'https://example.com/a.png' }] })
  let roster = hooked([THREAD(1, CHAT_1, { title: 'Ana Lima' })])
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's1', useRoster: select => select(roster) }, t)
  let root = await drawn(view)
  const head = () => one(root, 'op-head')
  assert.equal(text(one(head(), 'oc-chat-name')), 'Ana Lima')
  assert.equal(text(one(head(), 'oc-chat-status')), 'Support line')
  assert.equal(one(head(), 'oc-chat-status').props['data-off'], undefined)
  assert.deepEqual(ofType(one(head(), 'oc-ava'), 'img').map(img => img.props.src), ['https://example.com/a.png'])
  // The thread cut from its channel: its reason, in the sidebar's words (threadReason), takes the status line.
  roster = hooked([THREAD(1, CHAT_1, { title: 'Ana Lima', connected: false, reason: 'instance offline' })])
  root = await drawn(view)
  assert.deepEqual([text(one(head(), 'oc-chat-status')), one(head(), 'oc-chat-status').props['data-off']], ['Not connected. Try reconnecting this chat.', true])
  // A chat the overview does not list: its initials, and no status line.
  roster = hooked([THREAD(2, CHAT_2, { title: 'Bruno Reis', channelId: 'gone' })])
  const other = await drawn(pane({ params: { threadId: 't2', chatId: CHAT_2 }, sessionId: 's2', useRoster: select => select(roster) }, t))
  assert.equal(text(one(one(other, 'op-head'), 'oc-ava-face')), 'BR')
  assert.deepEqual([all(other, 'oc-chat-status').length, ofType(one(other, 'oc-ava'), 'img').length], [0, 0])
  for (const word of ['online', 'typing']) assert.equal(text(root).toLowerCase().includes(word), false, word)
  // The header asks for nothing: the pane reads the chat's messages and its files, as before.
  assert.deepEqual([...new Set(calls.map(([endpoint]) => endpoint))].sort(), ['omni-media', 'omni-messages'])
})

test('delivery marks: each status draws its mark on what staff and Omni sent, and nothing on the person\'s messages or an unknown status', async (t) => {
  reset()
  const out = (id, from, status) => ({ id, from, fromMe: true, text: id, caption: null, type: 'text', hasMedia: false, mime: null, mediaText: null, fileName: null, at: AT, status })
  answer = host([
    out('pending', 'you', 'pending'), out('sent', 'you', 'sent'), out('delivered', 'omni', 'delivered'), out('read', 'omni', 'read'), out('failed', 'you', 'failed'),
    out('unknown', 'you', 'seen'), out('none', 'you', undefined),
    { ...out('theirs', 'them', 'read'), fromMe: false },
  ])
  const root = await drawn(pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's1', useRoster: useRosterOf(hooked([THREAD(1)])) }, t))
  const bubbles = all(root, 'oc-bubble')
  const tickOf = bubble => one(bubble, 'oc-tick')
  assert.deepEqual(bubbles.map(bubble => tickOf(bubble)?.props['data-status'] ?? null), ['pending', 'sent', 'delivered', 'read', 'failed', null, null, null])
  assert.deepEqual(bubbles.slice(0, 5).map(bubble => [tickOf(bubble).props.role, tickOf(bubble).props['aria-label'], tickOf(bubble).children.length]), [
    ['img', 'Waiting to send', 1], ['img', 'Sent', 1], ['img', 'Delivered', 2], ['img', 'Seen', 2], ['img', 'Not delivered', 1],
  ])
  // The marks are the team's icons: a clock, one tick, two ticks, two ticks (accent), its info mark turned over (danger).
  const { CheckIcon, ClockIcon, InfoIcon } = omni.ui.icons
  assert.deepEqual(Object.entries(ui.TICKS).map(([status, tick]) => [status, plain(tick.marks.map(mark => [ClockIcon, CheckIcon, InfoIcon].indexOf(mark)))]), [
    ['pending', [0]], ['sent', [1]], ['delivered', [1, 1]], ['read', [1, 1]], ['failed', [2]],
  ])
  for (const rule of ['.oc-tick[data-status=read]{color:color-mix(in srgb,var(--bt-accent)', '.oc-tick[data-status=failed]{color:var(--bt-danger)}']) assert.ok(ui.CHANNELS_CSS.includes(rule), rule)
  // Each bubble keeps its time inside it, with the mark after the time.
  assert.deepEqual(one(bubbles[3], 'oc-meta').children.map(child => child.type), ['time', 'span'])
  assert.equal(text(bubbles[3]).startsWith('read'), true)
})

const barOf = (props, t) => {
  const view = mount(() => react.createElement(ui.MessageBar, props))
  t.after(() => view.unmount())
  return view
}
const keyOn = (root, init = {}) => {
  const event = { key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, prevented: false, preventDefault() { event.prevented = true }, ...init }
  ofType(root, 'textarea')[0].props.onKeyDown(event)
  return event
}

test('the message bar: Enter sends, Shift+Enter adds a line; an empty, disabled or sending bar sends nothing and its Send button waits', (t) => {
  const sends = []
  const bar = (props = {}) => barOf({ value: 'On my way', onChange: () => {}, onSend: () => sends.push(props.value ?? 'On my way'), label: 'Your message', ...props }, t).draw()
  let root = bar()
  assert.equal(one(root, 'oc-send').props.disabled, false)
  assert.equal(keyOn(root, { shiftKey: true }).prevented, false)
  assert.equal(keyOn(root, { nativeEvent: { isComposing: true } }).prevented, false)
  assert.deepEqual(sends, [])
  assert.equal(keyOn(root).prevented, true)
  assert.deepEqual(sends, ['On my way'])
  for (const props of [{ value: '  \n ' }, { disabled: true }, { sending: true }]) {
    root = bar(props)
    assert.equal(one(root, 'oc-send').props.disabled, true, JSON.stringify(props))
    assert.equal(keyOn(root).prevented, true, 'Enter never adds a line to a bar that cannot send')
    one(root, 'oc-send').props.onClick()
  }
  assert.deepEqual(sends, ['On my way'])
  // The field is the owner's text: a change goes to onChange as text.
  const changes = []
  root = barOf({ value: '', onChange: next => changes.push(next), onSend: () => {}, label: 'Reply' }, t).draw()
  ofType(root, 'textarea')[0].props.onChange({ target: { value: 'Hi' } })
  assert.deepEqual(changes, ['Hi'])
  assert.ok(ui.CHANNELS_CSS.includes('max-height:138px') && ui.CHANNELS_CSS.includes('field-sizing:content'), 'the field grows to about six lines, then scrolls')
})

test('the emoji button opens about forty emoji; a pick goes in at the caret, or in place of the selection, and Escape closes the picker', async (t) => {
  reset()
  assert.equal(ui.EMOJI.length, 40)
  assert.equal(new Set(ui.EMOJI).size, 40)
  assert.deepEqual(plain(ui.insertAt('Hello world', '😀', 5)), { text: 'Hello😀 world', caret: 7 })
  assert.deepEqual(plain(ui.insertAt('Hello world', '👍', 0, 5)), { text: '👍 world', caret: 2 })
  assert.deepEqual(plain(ui.insertAt('Hi', '✨')), { text: 'Hi✨', caret: 3 })
  assert.deepEqual(plain(ui.insertAt('Hi', '✨', 9, -3)), { text: '✨', caret: 1 })
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's1', useRoster: useRosterOf(hooked([THREAD(1)])) }, t)
  let root = await drawn(view)
  const opener = () => one(composerOf(root), 'oc-bar-emoji')
  assert.deepEqual([opener().props['aria-label'], opener().props['aria-expanded'], all(root, 'oc-emoji').length], ['Emoji', false, 0])
  typed(root, 'Hello world')
  root = await drawn(view)
  opener().props.onClick()
  root = await drawn(view)
  const picker = one(composerOf(root), 'oc-emoji')
  assert.deepEqual([picker.props.role, picker.props['aria-label'], opener().props['aria-expanded']], ['group', 'Pick an emoji', true])
  assert.deepEqual(all(picker, 'oc-emoji-pick').map(button => text(button)), [...ui.EMOJI])
  // The caret after "Hello": the pick goes there, and the picker stays open for another.
  const field = boxOf(root).props.ref.current
  Object.assign(field, { selectionStart: 5, selectionEnd: 5 })
  all(picker, 'oc-emoji-pick')[0].props.onClick()
  root = await drawn(view)
  assert.equal(boxOf(root).props.value, 'Hello😀 world')
  // A selection is replaced by the pick.
  Object.assign(field, { selectionStart: 0, selectionEnd: 5 })
  all(one(root, 'oc-emoji'), 'oc-emoji-pick').find(button => text(button) === '👍').props.onClick()
  root = await drawn(view)
  assert.equal(boxOf(root).props.value, '👍😀 world')
  // Escape closes it; Enter sends the text with its emoji, on the pane's own path.
  one(root, 'oc-emoji').props.onKeyDown({ key: 'Escape', preventDefault() {} })
  root = await drawn(view)
  assert.deepEqual([all(root, 'oc-emoji').length, opener().props['aria-expanded']], [0, false])
  key(root)
  root = await drawn(view)
  assert.deepEqual(asked('omni-phone-send'), [['omni-phone-send', { threadId: 't1', text: '👍😀 world' }]])
})

test('the bar draws no attach "+" and no microphone: its only controls are the emoji button, the field and Send', async (t) => {
  reset()
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's1', useRoster: useRosterOf(hooked([THREAD(1)])) }, t)
  const root = await drawn(view)
  const bar = one(composerOf(root), 'oc-bar')
  assert.deepEqual(nodes(bar).filter(node => ['button', 'textarea', 'input'].includes(node.type)).map(node => [node.type, node.props['aria-label']]), [['button', 'Emoji'], ['textarea', 'Your message'], ['button', 'Send']])
  assert.deepEqual([view.keys('PlusIcon'), view.keys('MicIcon'), view.keys('VoiceIcon'), view.keys('PaperclipIcon')], [[], [], [], []])
  assert.equal(nodes(root).some(node => /attach|microphone|record|voice/i.test(String(node.props?.['aria-label'] ?? '') + String(node.props?.title ?? ''))), false)
})

test('the chat page draws the same header, log and bar; its bar sends on the page\'s own path (omni-send), Enter and Shift+Enter as in the pane', async (t) => {
  reset()
  const chat = { id: 'c-ana', channelId: 'wa', name: 'Ana Lima', initials: 'AL', at: AT, unread: 0, avatarUrl: null }
  withOverview(t, { preview: false, source: { kind: 'live', origin: 'omni.example.com' }, abilities: { send: true }, channels: [SUPPORT], chats: [chat], chatId: chat.id, messages: { [chat.id]: [{ ...MESSAGES[5], id: 'x1', status: 'delivered' }] } })
  const view = mount(() => react.createElement(ui.ChatPage, { actions: { selectPanel() {} } }))
  t.after(() => view.unmount())
  let root = await drawn(view)
  assert.deepEqual(one(root, 'oc-chat').children.map(child => child.props.className.split(' ')[0]), ['oc-chat-head', 'oc-thread', 'oc-bar-wrap'])
  assert.deepEqual([text(one(root, 'oc-chat-name')), text(one(root, 'oc-chat-status'))], ['Ana Lima', 'Telegram · Support line'])
  assert.equal(one(root, 'oc-tick').props['data-status'], 'delivered')
  const field = () => ofType(one(root, 'oc-bar'), 'textarea')[0]
  assert.deepEqual([field().props.placeholder, field().props['aria-label']], ['Reply on Telegram', 'Reply'])
  field().props.onChange({ target: { value: 'See you at 10.' } })
  root = await drawn(view)
  assert.equal(keyOn(root, { shiftKey: true }).prevented, false)
  assert.deepEqual(asked('omni-send'), [])
  assert.equal(keyOn(root).prevented, true)
  root = await drawn(view)
  assert.deepEqual(asked('omni-send'), [['omni-send', { chatId: 'c-ana', text: 'See you at 10.' }]])
  assert.equal(field().props.value, '')
  assert.deepEqual([view.keys('PlusIcon'), view.keys('MicIcon')], [[], []])
})
