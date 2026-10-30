import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { omni } from './omni-client.js'

// The automations board's quieter first run and the warning Omni's confirmation carries,
// out of their React. Bundled as DSH bundles the client, with stand-in React.
async function load() {
  const entry = 'export { AutomationRow, headCount, savedOf, savedNotice, SavedAutomationCard, SubscriptionsButton, workerOf } from \'./subscriptions.js\''
  const bundle = await build({
    stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../src/client/', import.meta.url)), loader: 'js' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom', '@automagik/bots-dsh/client'],
    loader: { '.css': 'text' },
  })
  const module = { exports: {} }
  // Elements come back as plain data, so a test can read what a component draws.
  const react = { createElement: (type, props, ...children) => ({ type: typeof type === 'function' ? type.name : type, props: props ?? {}, children: children.flat() }), Fragment: 'Fragment', useState: initial => [initial, () => {}], useEffect: () => {}, useSyncExternalStore: (_subscribe, get) => get() }
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, URL, require: name => ({ react, 'react-dom': { createPortal: node => node }, '@automagik/bots-dsh/client': { omni } })[name] })
  return module.exports
}
const ui = await load()

const roster = (subscriptions = []) => ({ eventsBotId: 'm1', byId: { m1: { id: 'm1', name: 'Omni' }, b2: { id: 'b2', name: 'Ops' } }, subscriptions })
const textOf = node => (node === null || node === undefined ? '' : typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''))

// The board took most of the window next to Omni's chat, by itself, again with each fresh part
// of that chat. Only the header's Automations button opens it now; the phone pane opens only
// from a click on a thread's row (or the pick that added it) and the thread's own button
// (omni-phone.js).
test('the board never opens by itself: only the header button opens it; the phone pane only from the thread', () => {
  const dir = new URL('../src/client/', import.meta.url)
  const opens = []
  const calls = pattern => readdirSync(dir).filter(file => file.endsWith('.js')).sort().flatMap(name => [...readFileSync(new URL(name, dir), 'utf8').matchAll(pattern)].map(match => `${name}: ${match[0].trim()}`))
  const phoneCalls = calls(/^.*\bopenPhone\(.*$/gm).filter(line => !line.includes('export function openPhone('))
  for (const name of readdirSync(dir).filter(file => file.endsWith('.js'))) {
    const text = readFileSync(new URL(name, dir), 'utf8')
    for (const match of text.matchAll(/\.openTab\(/g)) opens.push(`${name}: ${text.slice(0, match.index).split('\n').length}`)
  }
  assert.equal(opens.length, 2, `the column opens from ${opens.join(', ')}`)
  const index = readFileSync(new URL('index.js', dir), 'utf8')
  const toggle = index.slice(index.indexOf('function toggleBoard('), index.indexOf('function installBoard('))
  assert.match(toggle, /right\.openTab\(BOARD_KIND\)/)
  assert.doesNotMatch(index, /omni\.board\.opened|localStorage/)
  const phone = readFileSync(new URL('omni-phone.js', dir), 'utf8')
  const open = phone.slice(phone.indexOf('export function openPhone('), phone.indexOf('function useChatPoll('))
  assert.match(open, /right\.openTab\(PHONE_KIND, \{ params: phoneParams\(thread\) \}\)/)
  // Each way to the pane starts at a click: the thread's button; a row's click on a team
  // without the hook; and openPhoneBeside, which only openThread calls, itself run by the row's
  // click or, for a thread the picker just added, by the pick itself through the row's own
  // opener (rowOpeners), or by its row's arrival, which only the pick marks.
  assert.deepEqual(phoneCalls, [
    'omni-phone.js: if (typeof mounted?.subscribe !== \'function\' || mounted.getSnapshot() === thread.sessionId) return openPhone(thread)',
    'omni-phone.js: if (now === thread.sessionId) setTimeout(() => openPhone(thread), 0)',
    'omni-phone.js: onClick: () => setProblem(openPhone(thread)),',
    'omni-tree.js: const why = openPhone(thread)',
  ])
  assert.deepEqual(calls(/^.*\bopenPhoneBeside\(.*$/gm).filter(line => !line.includes('export function')), ['omni-tree.js: const reason = openPhoneBeside(thread)'])
  assert.deepEqual(calls(/^.*\bopenThread\(.*$/gm).filter(line => !line.includes('function openThread(')).map(line => line.split(': ')[1]), [
    'if (opens && openOnArrival.delete(thread.id)) openThread(thread, actions, setProblem)',
    'const opener = () => openThread(thread, actions, setProblem)',
    'openThread(thread, actions, setProblem)',
  ])
  assert.deepEqual(calls(/^.*\browOpeners\.get\(.*$/gm), ['omni-tree.js: return () => { if (rowOpeners.get(thread.id) === opener) rowOpeners.delete(thread.id) }', 'omni-tree.js: const opener = rowOpeners.get(result.threadId)'])
  const tree = readFileSync(new URL('omni-tree.js', dir), 'utf8')
  const row = tree.slice(tree.indexOf('export function ThreadRow('), tree.indexOf('function PickerChat('))
  assert.match(row.slice(row.indexOf('const onClick = () => {')), /^const onClick = \(\) => \{\n {4}if \(opens\) \{\n {6}openThread\(thread, actions, setProblem\)\n {6}return\n {4}\}\n.*\n {4}const why = openPhone\(thread\)/)
  assert.deepEqual(calls(/^.*\bopenOnArrival\.(add|delete)\(.*$/gm), [
    'omni-tree.js: if (opens && openOnArrival.delete(thread.id)) openThread(thread, actions, setProblem)',
    'omni-tree.js: else openOnArrival.add(result.threadId)',
  ])
})

test('the header button counts automations only once there is one, and shows who waits', () => {
  assert.equal(ui.headCount(roster()), null)
  assert.equal(ui.headCount({}), null)
  assert.equal(ui.headCount(roster([{ id: 'sub-a', on: false }])), 1)
  assert.equal(ui.headCount(roster([{ id: 'sub-a', on: true }, { id: 'sub-b', on: false }])), 2)
  const button = (subs, approvals = []) => ui.SubscriptionsButton({ roster: { ...roster(subs), subscriptionRuns: [{ id: 'r1', status: 'working', sessionId: 's1' }] }, onToggle: () => {}, useWork: pick => pick({ approvals }) })
  assert.deepEqual(button([]).children.filter(Boolean).map(textOf), ['Automations'])
  assert.deepEqual(button([], [{ sessionId: 's1' }]).children.filter(Boolean).map(child => [child.props?.className ?? '', textOf(child)]), [['', 'Automations'], ['os-pending', '1']])
  assert.deepEqual(button([{ id: 'sub-a', on: true }]).children.filter(Boolean).map(child => [child.props?.className ?? '', textOf(child)]), [['', 'Automations'], ['os-head-count', '1']])
})

test('Omni\'s confirmation of a saved automation carries the steering warning, loudly when it acts without asking', () => {
  const saved = 'Saved sub-mh2k9x1abcd · Pins: when you react 📌 in Grupo Obras → Ops (one task per event). It is in the Automations panel now.'
  assert.equal(ui.savedOf('Not saved: Which chats?', roster(), undefined), null)
  assert.deepEqual(JSON.parse(JSON.stringify(ui.savedOf(saved, roster(), undefined))), { id: 'sub-mh2k9x1abcd', name: 'Pins', askFirst: true })
  assert.equal(ui.savedOf(saved, roster(), false).askFirst, false)
  assert.equal(ui.savedOf(saved, roster(), 'false').askFirst, false)
  // Read as the host reads it: anything but true, "true" or "yes" turns it off.
  assert.equal(ui.savedOf(saved, roster(), 'no').askFirst, false)
  assert.equal(ui.savedOf(saved, roster(), '').askFirst, false)
  assert.equal(ui.savedOf(saved, roster(), 'yes').askFirst, true)
  // An edit that leaves ask first alone shows the automation's own.
  const off = { id: 'sub-mh2k9x1abcd', name: 'Pins', askFirst: false, trigger: { kind: 'reaction', emoji: '📌' } }
  assert.equal(ui.savedOf(saved, roster([off]), undefined).askFirst, false)
  assert.equal(ui.savedOf(saved, roster([off]), true).askFirst, true)

  const quiet = ui.savedNotice({ askFirst: true, main: 'Omni' })
  assert.equal(quiet.loud, false)
  assert.match(quiet.text, /tries to steer a Bot\. The work this starts reads on its own and asks you before anything else\./)
  const loud = ui.savedNotice({ askFirst: false, main: 'Omni' })
  assert.equal(loud.loud, true)
  assert.match(loud.text, /^This automation acts without asking you\. .*steer a Bot.*own permissions and keys\. Tell Omni to ask first/)

  const card = (askFirst, subs = []) => ui.SavedAutomationCard({ done: true, content: saved, roster: roster(subs), argValue: key => (key === 'ask_first' ? askFirst : undefined) })
  assert.equal(card(undefined).props['data-loud'], undefined)
  assert.match(textOf(card(undefined)), /Saved automationPins.*asks you before anything else/)
  const acting = card(false)
  assert.equal(acting.props['data-loud'], true)
  assert.match(textOf(acting), /acts without asking you/)
  assert.equal(ui.SavedAutomationCard({ done: false, content: '', roster: roster() }), null)
  assert.equal(ui.SavedAutomationCard({ done: true, content: 'Not saved: Which chats?', roster: roster() }).props.className, 'bt-event')
})

// A chat-thread worker runs each event in the thread of its chat: the board names the thread a
// run went to, the one chat an automation watches, or each chat's own thread; a moved
// automation's one line from the host shows on its row.
test('the board names a chat-thread worker by its thread, its one chat, or each chat\'s own; a moved automation says so on its row', () => {
  const threads = { ...roster(), omniThreads: [{ id: 't1', sessionId: 's1', chatId: 'c1', title: 'Marina' }, { id: 't2', sessionId: 's2', chatId: 'c2', title: 'Obra' }] }
  const chat = (id, name) => ({ kind: 'chat', id, name, chatKind: 'direct' })
  const worker = { kind: 'thread' }
  assert.deepEqual([ui.workerOf(worker, threads, { sources: [chat('c1', 'Marina')] }).name, ui.workerOf(worker, threads, { sources: [chat('c1', 'Marina')] }).chat], ['The thread of Marina', 'Marina'])
  // A chat with no thread yet goes by its own name.
  assert.equal(ui.workerOf(worker, threads, { sources: [chat('c9', 'Ana')] }).name, 'The thread of Ana')
  const many = { sources: [chat('c1', 'Marina'), { kind: 'channel', id: 'i1', name: 'Pessoal' }] }
  assert.deepEqual([ui.workerOf(worker, threads, many).name, ui.workerOf(worker, threads, many).session], ['Each chat\'s own thread', true])
  // A run names the thread it went to.
  assert.equal(ui.workerOf(worker, threads, { ...many, sessionId: 's2' }).name, 'The thread of Obra')
  // A thread whose chat has no name goes by the word its row shows, never by none.
  const nameless = { ...roster(), omniThreads: [{ id: 't3', sessionId: 's3', chatId: 'c3', title: null, kind: 'group' }] }
  assert.equal(ui.workerOf(worker, nameless, { ...many, sessionId: 's3' }).name, 'The thread of Group')
  const sub = { id: 'sub-a', name: 'Moved', on: true, askFirst: true, sources: [chat('c1', 'Marina')], trigger: { kind: 'message' }, worker, outputs: {}, updatedAt: 0 }
  const notes = row => (function walk(node) {
    if (node === null || node === undefined || typeof node !== 'object') return []
    return [...(node.props?.className === 'os-row-note' ? [textOf(node)] : []), ...(node.children ?? []).flatMap(walk)]
  })(row)
  const note = 'It handed every event to one ongoing session; now each event runs in the thread of its chat.'
  assert.deepEqual(notes(ui.AutomationRow({ sub: { ...sub, note }, roster: threads, runs: [] })), [note])
  assert.deepEqual(notes(ui.AutomationRow({ sub, roster: threads, runs: [] })), [])
})
