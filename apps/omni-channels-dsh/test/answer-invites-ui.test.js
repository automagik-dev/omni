// #1716 in the answer settings: the welcome after an invite code, and the code list staff paste
// and read (host answer-invites.js).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INVITE_WELCOME_MAX } from '../src/host/threads.js'
import { bundleClient, mount, nodes, one, plain, react, settle, text } from './client-stand-in.js'
import { omni } from './omni-client.js'

const calls = []
let answer = () => ({})
const fakeCall = async (endpoint, body) => {
  calls.push([endpoint, plain(body)])
  const reply = await answer(endpoint, body)
  if (reply instanceof Error) throw reply
  return reply
}
const ui = await bundleClient([
  'export { AnswerSettings } from \'./omni-tree.js\'',
  'export { parseInviteLines, dayOf } from \'./invite-codes.js\'',
], { globals: { console, URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, document: { body: { dataset: {} }, addEventListener() {}, removeEventListener() {} } }, team: { omni: { ...omni, call: fakeCall } } })

// Made-up codes of the invite shape.
const CODE = 'INV-7K2QX9MD0'
const OTHER = 'INV-3N8RW4HT5'
const endOfDay = (year, month, day) => new Date(year, month - 1, day, 23, 59, 59, 999).toISOString()

function settings(t, value = {}) {
  const shown = { value }
  const view = mount(() => react.createElement(ui.AnswerSettings, { bot: { id: 'dedicated' }, value: shown.value }))
  t.after(() => { view.unmount(); answer = () => ({}) })
  const open = async () => {
    nodes(view.draw()).find(node => node.type === 'button' && text(node) === 'Answer mode').props.onClick()
    view.draw()
    await settle()
  }
  const save = async () => { nodes(view.draw()).find(node => node.type === 'button' && text(node) === 'Save answer settings').props.onClick(); await settle() }
  const group = () => nodes(view.draw()).find(node => node.props?.['aria-label'] === 'Invite codes')
  const button = label => nodes(group()).find(node => node.type === 'button' && text(node) === label)
  return { view, shown, open, save, group, button }
}

test('invite lines: code, project, expiry day and an optional note, or a JSON list; a bad line is named by its number only', () => {
  assert.deepEqual(plain(ui.parseInviteLines(`${CODE}, proj-a, expires 2026-12-31, Met at the fair, table 4\n\n# a comment\ninv-3n8rw4ht5,proj-b,2027-01-15`)), { entries: [
    { code: CODE, project: 'proj-a', expiresAt: endOfDay(2026, 12, 31), context: 'Met at the fair, table 4' },
    { code: 'inv-3n8rw4ht5', project: 'proj-b', expiresAt: endOfDay(2027, 1, 15) },
  ] })
  const json = [{ code: CODE, project: 'proj-a', expiresAt: '2026-12-31T23:59:59Z', capability: 'proj-a-tools' }]
  assert.deepEqual(plain(ui.parseInviteLines(JSON.stringify(json))), { entries: json })
  for (const [pasted, problem] of [
    [`${CODE}, proj-a, 2026-12-31\n${OTHER}, proj-b, 31/12/2026`, /^Line 2: /],
    [`${CODE}, proj-a, 2026-02-30`, /^Line 1: /],
    [`${CODE}, , 2026-12-31`, /^Line 1: /],
    ['', /at least one code/],
    ['[', /could not be read/],
    ['{"code":"x"}', /^Line 1: /],
    ['[]', /must be a list of codes/],
  ]) {
    const parsed = ui.parseInviteLines(pasted)
    assert.match(parsed.problem, problem)
    assert.equal(parsed.problem.includes(OTHER) || parsed.problem.includes(CODE), false)
  }
  assert.equal(ui.dayOf(endOfDay(2026, 12, 31)), '2026-12-31')
})

test('answer settings take the welcome after an invite code, and send it only while set or cleared', async t => {
  calls.length = 0
  const s = settings(t)
  await s.open()
  // Nothing is read when the settings open: the code list waits for Show.
  assert.deepEqual(calls, [])
  const field = () => one(s.view.draw(), 'ot-answer-welcome')
  assert.ok(nodes(s.view.draw()).find(node => node.type === 'label' && text(node).startsWith('Welcome after an invite code')))
  assert.deepEqual([field().props.value, field().props.maxLength, INVITE_WELCOME_MAX], ['', 1000, 1000])
  await s.save()
  assert.equal('inviteWelcome' in calls.at(-1)[1], false)
  await s.open()
  field().props.onChange({ target: { value: '  Welcome in!  ' } })
  await s.save()
  assert.equal(calls.at(-1)[1].inviteWelcome, 'Welcome in!')
  s.shown.value = { inviteWelcome: 'Welcome in!' }
  await s.open()
  assert.equal(field().props.value, 'Welcome in!')
  field().props.onChange({ target: { value: '' } })
  await s.save()
  assert.equal(calls.at(-1)[1].inviteWelcome, null)
})

test('the invite codes section lists the codes when shown, and adds pasted lines', async t => {
  calls.length = 0
  let codes = [
    { code: OTHER, project: 'proj-b', expiresAt: endOfDay(2026, 12, 1), inviteId: 'i2', state: 'used', usedAt: 1 },
    { code: CODE, project: 'proj-a', expiresAt: endOfDay(2026, 12, 31), inviteId: 'i1', state: 'open', context: 'A note.' },
  ]
  answer = (endpoint, body) => {
    if (endpoint === 'omni-invite-codes') return { count: codes.length, codes }
    if (endpoint === 'omni-invite-codes-add') {
      if (body.entries[0].project === 'proj-z') return new Error('Entry 1: the code is not an invite code (INV- and 9 letters or digits).')
      codes = [{ code: 'INV-5G4ZB7KA2', project: 'proj-c', expiresAt: body.entries[0].expiresAt, inviteId: 'i3', state: 'open' }, ...codes]
      return { added: 1, updated: 0, used: 0, count: codes.length }
    }
    return {}
  }
  const s = settings(t)
  await s.open()
  assert.equal(text(nodes(s.group()).find(node => node.props?.className === 'bt-field-label')), 'Invite codes')
  s.button('Show').props.onClick()
  s.view.draw()
  await settle()
  assert.deepEqual(calls, [['omni-invite-codes', {}]])
  assert.equal(text(nodes(s.group()).find(node => node.props?.className === 'bt-field-label')), 'Invite codes (2)')
  const rows = () => nodes(s.group()).filter(node => node.type === 'li').map(row => [text(one(row, 'ot-invite-code')), text(one(row, 'ot-invite-state')), text(one(row, 'ot-invite-meta'))])
  assert.deepEqual(rows(), [[OTHER, 'Used', 'proj-b · expires 2026-12-01'], [CODE, 'Open', 'proj-a · expires 2026-12-31']])
  // Add is off until something is pasted; a bad line is said and nothing is sent.
  const paste = () => one(s.group(), 'ot-invites-paste')
  assert.equal(s.button('Add codes').props.disabled, true)
  paste().props.onChange({ target: { value: 'INV-5G4ZB7KA2, proj-c' } })
  s.button('Add codes').props.onClick()
  await settle()
  assert.equal(calls.length, 1)
  assert.match(text(nodes(s.group()).find(node => node.props?.role === 'alert')), /^Line 1: /)
  // Good lines go up, the list is read again, and the box empties.
  paste().props.onChange({ target: { value: 'INV-5G4ZB7KA2, proj-c, 2027-01-31' } })
  s.button('Add codes').props.onClick()
  await settle()
  s.view.draw()
  await settle()
  assert.deepEqual(calls.slice(1), [['omni-invite-codes-add', { entries: [{ code: 'INV-5G4ZB7KA2', project: 'proj-c', expiresAt: endOfDay(2027, 1, 31) }] }], ['omni-invite-codes', {}]])
  assert.equal(text(nodes(s.group()).find(node => node.props?.role === 'status')), 'Added 1, updated 0.')
  assert.equal(paste().props.value, '')
  assert.equal(rows().length, 3)
  // The host's refusal is shown as it says it.
  paste().props.onChange({ target: { value: 'INV-5G4ZB7KAU, proj-z, 2027-01-31' } })
  s.button('Add codes').props.onClick()
  await settle()
  assert.match(text(nodes(s.group()).find(node => node.props?.role === 'alert')), /^Entry 1: the code is not an invite code/)
})
