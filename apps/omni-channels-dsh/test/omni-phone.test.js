import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { NEEDS_NEWER_TEAM, TEAM_CONTRACT } from '../src/host/resume-hook.js'
import { all, bundleClient, column, mount as mountWith, nodes, ofType, one, plain, react, settle, text } from './client-stand-in.js'
import { omni } from './omni-client.js'

// The phone pane (omni-phone.js, phone-frame.js): a thread's chat in a drawn phone, a tab of
// DSH's right column opened only from the thread. Drawn with a stand-in React and a stand-in
// right column; the host is a stand-in `call`, so nothing leaves the test and nothing is sent.

// The stand-in React of client-stand-in.js; a host element's ref gets a stand-in node, as the
// DOM would give it.
const mount = root => mountWith(root, { refs: true })

// -------------------------------------------------------------------------
// The host and the page, stood in: `call` answers from `answer`, the poll's timers wait for
// the test to run them, and a file becomes a blob: URL.

const calls = []
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
  'export { PhonePane, PhoneTab, PhoneDock, installPhone, openPhone, openPhoneBeside, threadName, PHONE_WAIT_MS, phoneThreadOf, keepParams, keptParams, phoneTabDefinition, phoneTabId, PHONE_KIND, PHONE_TAB_ID, OMNI_PHONE_CSS } from \'./omni-phone.js\'',
  'export { PhoneFrame, frameMetrics, SIDE_BUTTONS, PHONE_FRAME_CSS } from \'./phone-frame.js\'',
  'export { ThreadRow, rowPropsOf } from \'./omni-tree.js\'',
], { globals: { URL: BundleURL, URLSearchParams, Blob, atob, setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, document, localStorage }, team: { omni: { ...omni, call: fakeCall } } })

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

const pane = (props, t) => {
  const view = mount(() => react.createElement(ui.PhonePane, props))
  t.after(() => view.unmount())
  return view
}

// -------------------------------------------------------------------------

test('the pane shows the thread\'s chat in the drawn frame: a picture, a voice note with Omni\'s text in its bubble, a video still, a document by name, a sticker (:203)', async (t) => {
  reset()
  const roster = hooked([THREAD(1)])
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's-omni', useRoster: useRosterOf(roster) }, t)
  const root = await drawn(view)
  assert.deepEqual(asked('omni-messages'), [['omni-messages', { chatId: CHAT_1 }]])
  // The frame: the device shell, its four side buttons, and the screen with the chat on it.
  const frame = one(root, 'op-frame')
  assert.ok(one(root, 'op-device') && frame)
  assert.deepEqual(all(frame, 'op-button').map(button => button.props['data-side']), ['left', 'left', 'left', 'right'])
  const screen = one(frame, 'op-screen')
  assert.equal(screen.props['aria-label'], 'Chat 1 on the phone')
  assert.equal(text(one(screen, 'op-head')), 'Chat 1')
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
  // It reads; it never writes: no composer, nothing sent.
  assert.equal(ofType(after, 'textarea').length + ofType(after, 'input').length, 0)
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

test('a hidden tab does not poll; a host refusal shows as text in the pane', async (t) => {
  reset()
  const roster = hooked([THREAD(1)])
  const hidden = pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's-omni', useRoster: useRosterOf(roster), visible: false }, t)
  await drawn(hidden)
  assert.equal(asked('omni-messages').length, 0)
  answer = endpoint => (endpoint === 'omni-messages' ? new Error('omni is not set up here') : {})
  const root = await drawn(pane({ params: { threadId: 't1', chatId: CHAT_1 }, sessionId: 's-omni', useRoster: useRosterOf(roster) }, t))
  const problem = all(root, 'op-note').find(node => node.props.role === 'alert')
  assert.equal(text(problem), 'omni is not set up here')
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

// The column's timers due now (openPhoneBeside opens after the render that brings a column).
const runDue = () => {
  const due = timers.filter(timer => timer.on && timer.ms === 0)
  timers = timers.filter(timer => !due.includes(timer))
  for (const timer of due) timer.run()
}

test('the tab type registers, and nothing opens it by itself; a click on the thread\'s row opens its Session and the pane beside it, and the thread\'s button opens it', async (t) => {
  reset()
  // Before DSH's right column is there, the action says so and throws nothing.
  assert.equal(ui.openPhone(THREAD(1)), 'The phone pane needs DSH\'s right column.')
  const stand = installed(t)
  assert.deepEqual(stand.types.map(type => [type.id, type.kind, type.title()]), [[ui.PHONE_TAB_ID, ui.PHONE_KIND, 'Phone pane']])
  assert.deepEqual([ui.PHONE_KIND, ui.PHONE_TAB_ID, ui.phoneTabId('t1')], ['omni-phone', 'ds-bot/omni-phone', 'ds-bot/omni-phone:t1'])
  assert.deepEqual(stand.bodies.map(body => [body.name, body.key, body.component === ui.PhoneTab]), [['sidebar.right.pane.tab', ui.PHONE_TAB_ID, true]])
  assert.deepEqual(stand.opened, [], 'installing opens nothing')
  // The thread row, on a team with the hook: one click opens the Session, and the pane once
  // that Session is on screen, after the render that brings its column. The row has no
  // phone button of its own.
  const thread = THREAD(1)
  const roster = hooked([thread])
  const sessions = []
  const actions = { openSession: id => sessions.push(id) }
  const row = mount(() => react.createElement(ui.ThreadRow, { thread, actions, rowProps: ui.rowPropsOf({ roster, actions }, roster.omniRowProps) }))
  assert.equal(one(row.draw(), 'ot-thread-phone'), undefined)
  one(row.draw(), 'bt-thread').props.onClick()
  assert.deepEqual(sessions, ['s1'])
  assert.deepEqual(stand.opened, [], 'not in the column of the Session still on screen')
  stand.put('s1')
  assert.deepEqual(stand.opened, [])
  runDue()
  assert.deepEqual(stand.opened, [['omni-phone', { params: { threadId: 't1', chatId: CHAT_1 } }]])
  assert.equal(stand.watching.size, 0, 'the wait ended')
  // Clicked again while its Session is on screen: the pane opens there at once.
  one(row.draw(), 'bt-thread').props.onClick()
  assert.equal(stand.opened.length, 2)
  // Another Session coming on screen first ends the wait; so does a newer click.
  stand.put('s-omni')
  one(row.draw(), 'bt-thread').props.onClick()
  stand.put('s-other')
  stand.put('s1')
  runDue()
  assert.equal(stand.opened.length, 2)
  const other = THREAD(2, CHAT_2)
  stand.put('s-omni')
  one(row.draw(), 'bt-thread').props.onClick()
  one(mount(() => react.createElement(ui.ThreadRow, { thread: other, actions, rowProps: ui.rowPropsOf({ roster, actions }, roster.omniRowProps) })).draw(), 'bt-thread').props.onClick()
  assert.equal(stand.watching.size, 1, 'the first click\'s wait was dropped')
  stand.put('s2')
  runDue()
  assert.deepEqual(stand.opened.slice(2), [['omni-phone', { params: { threadId: 't2', chatId: CHAT_2 } }]])
  assert.deepEqual(sessions, ['s1', 's1', 's1', 's1', 's2'])
  // The button in the thread's own Session, and in no other.
  const dock = sessionId => mount(() => react.createElement(ui.PhoneDock, { sessionId, useRoster: useRosterOf(roster) })).draw()
  assert.equal(dock('s-omni'), null)
  const button = one(dock('s1'), 'op-open')
  assert.equal(button.props['aria-label'], 'Show Chat 1 in the phone pane')
  button.props.onClick()
  assert.equal(stand.opened.length, 4)
  // On a team without the hook the row opens the pane beside the Session on screen; with
  // none on screen there is no column to open in: it says so.
  stand.put(undefined)
  const problemRow = mount(() => react.createElement(ui.ThreadRow, { thread, actions, rowProps: {} }))
  one(problemRow.draw(), 'bt-thread').props.onClick()
  assert.equal(text(one(problemRow.draw(), 'ot-thread-problem')), 'Open a conversation first; the phone pane opens beside it.')
  assert.equal(stand.opened.length, 4)
  // A remove that failed keeps its error when the pane then opens.
  stand.put('s-omni')
  answer = endpoint => (endpoint === 'omni-thread-remove' ? new Error('Could not reach Omni. Try again in a moment.') : {})
  const removing = mount(() => react.createElement(ui.ThreadRow, { thread, actions, rowProps: {} }))
  one(removing.draw(), 'ot-thread-remove').props.onClick()
  one(removing.draw(), 'ot-thread-remove').props.onClick()
  await settle()
  assert.equal(text(one(removing.draw(), 'ot-thread-problem')), 'Could not reach Omni. Try again in a moment.')
  one(removing.draw(), 'bt-thread').props.onClick()
  assert.equal(stand.opened.length, 5)
  assert.equal(text(one(removing.draw(), 'ot-thread-problem')), 'Could not reach Omni. Try again in a moment.')
  assert.deepEqual(sessions, ['s1', 's1', 's1', 's1', 's2'], 'a row on a team without the hook opens no Session')
})

test('on a stand-in Bot team without the hook, a click on the row opens the pane and the row never calls actions.openSession (:195)', async (t) => {
  reset()
  const stand = installed(t)
  const thread = THREAD(1, CHAT_1, { connected: false, reason: NEEDS_NEWER_TEAM })
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
  assert.equal(text(one(shown, 'op-head')), `Chat 1${NEEDS_NEWER_TEAM}`)
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
  assert.equal(await threadShown(tabIn('s-omni', undefined, 'tab-9')), 'Open the phone pane from a chat in the sidebar.')
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

test('the frame is dsh-ios\'s device frame: its shell, edge and buttons, and corners concentric at every width', () => {
  assert.deepEqual(plain(ui.frameMetrics(300)), { screen: 266, screenRadius: 37.5, shellRadius: 53.5 })
  assert.deepEqual(plain(ui.frameMetrics(240)), { screen: 206, screenRadius: 29.1, shellRadius: 45.1 })
  for (const width of [180, 240, 300]) {
    const { screenRadius, shellRadius } = ui.frameMetrics(width)
    assert.equal(Math.round((shellRadius - screenRadius) * 10) / 10, 16)
  }
  assert.deepEqual(plain(ui.SIDE_BUTTONS).map(button => [button.id, button.side, button.top, button.height]), [
    ['mute', 'left', '21%', 16], ['volume-up', 'left', '34%', 36], ['volume-down', 'left', '47%', 36], ['power', 'right', '36%', 52],
  ])
  const css = ui.PHONE_FRAME_CSS
  for (const value of ['linear-gradient(145deg,#2b2e35 0%,#101116 45%,#1c1e25 100%)', 'border:1px solid rgba(0,0,0,.6)', 'inset 0 0 0 1px rgba(255,255,255,.12),0 18px 50px rgba(0,0,0,.55)', 'padding:16px', 'background:#3a3d44', 'aspect-ratio:390/844', 'max-width:300px']) assert.ok(css.includes(value), value)
  // The shell's radius is the screen's plus the shell, from the same width.
  assert.match(css, /\.op-frame\{[^}]*border-radius:calc\(\(100cqi - 34px\) \* 55 \/ 390 \+ 16px\)/)
  assert.match(css, /\.op-screen\{[^}]*border-radius:calc\(\(100cqi - 34px\) \* 55 \/ 390\)/)
  assert.ok(ui.OMNI_PHONE_CSS.startsWith(css))
})

test('NOTICE carries the dsh-ios MIT notice, with the copyright line of its LICENSE at that commit (:203)', () => {
  const notice = readFileSync(new URL('../NOTICE', import.meta.url), 'utf8')
  // The line as that LICENSE has it, an em dash included.
  const line = 'Copyright (c) 2026 ZSeven—W'
  assert.ok(notice.includes('dsh-ios (https://github.com/automagik-genie/dsh-ios'))
  assert.ok(notice.includes(`MIT License, ${line}`))
  assert.ok(notice.includes(`  ${line}\n`))
  assert.ok(notice.includes('d9a9731ccd73b38858fcfbf2f35d7120a861654c'))
  assert.ok(notice.includes('src/client/phone-frame.js copies the look'))
  const block = notice.slice(notice.indexOf('dsh-ios ('), notice.indexOf('No other third-party code'))
  for (const words of ['Permission is hereby granted, free of charge', 'The above copyright notice and this permission notice shall be included in all', 'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND']) assert.ok(block.includes(words), words)
  const source = readFileSync(new URL('../src/client/phone-frame.js', import.meta.url), 'utf8')
  assert.match(source, /automagik-genie\/dsh-ios.*MIT; see\s*\n?\/\/ NOTICE/s)
})

test('the pane\'s header names a thread by its chat, never a raw id: "Chat" or "Group" when it has no name', async (t) => {
  reset()
  const thread = THREAD(1, CHAT_1, { title: null, kind: 'group' })
  const view = pane({ params: { threadId: 't1', chatId: CHAT_1 }, useRoster: useRosterOf(hooked([thread])) }, t)
  const shown = await drawn(view)
  assert.equal(text(one(shown, 'op-head')), 'Group')
  assert.equal(nodes(shown).find(node => node.props?.role === 'log').props['aria-label'], 'Conversation with Group')
  assert.equal(ui.threadName({ title: null, kind: 'direct' }), 'Chat')
  assert.equal(ui.threadName({ title: '+5511988887777', kind: 'direct' }), '+5511988887777')
})

test('a quick second click still gets its pane when the first click\'s Session comes on screen first; a wait ends after PHONE_WAIT_MS', (t) => {
  reset()
  const stand = installed(t)
  const roster = hooked([THREAD(1), THREAD(2, CHAT_2)])
  const actions = { openSession: () => {} }
  const click = thread => one(mount(() => react.createElement(ui.ThreadRow, { thread, actions, rowProps: ui.rowPropsOf({ roster, actions }, roster.omniRowProps) })).draw(), 'bt-thread').props.onClick()
  // A then B; DSH shows A's Session on the way to B's.
  click(THREAD(1))
  click(THREAD(2, CHAT_2))
  stand.put('s1')
  runDue()
  assert.deepEqual(stand.opened, [], 'not beside A: B was asked for last')
  assert.equal(stand.watching.size, 1, 'B still waits')
  stand.put('s2')
  runDue()
  assert.deepEqual(stand.opened, [['omni-phone', { params: { threadId: 't2', chatId: CHAT_2 } }]])
  // A wait that DSH never ends is dropped after PHONE_WAIT_MS: a much later visit opens nothing.
  stand.put('s-omni')
  click(THREAD(1))
  const late = timers.filter(timer => timer.on && timer.ms === ui.PHONE_WAIT_MS)
  assert.deepEqual([ui.PHONE_WAIT_MS, late.length], [3000, 1])
  late[0].run()
  assert.equal(stand.watching.size, 0)
  stand.put('s1')
  runDue()
  assert.equal(stand.opened.length, 1)
  // A wait that opened its pane cancels its timer.
  stand.put('s-omni')
  click(THREAD(2, CHAT_2))
  stand.put('s2')
  runDue()
  assert.equal(stand.opened.length, 2)
  assert.equal(timers.filter(timer => timer.on && timer.ms === ui.PHONE_WAIT_MS).length, 0)
})
