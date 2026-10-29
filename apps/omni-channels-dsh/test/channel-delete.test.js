import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bundleClient, mount, ofType, plain, react, settle, text } from './client-stand-in.js'
import { omni } from './omni-client.js'

const calls = []
let answer = async () => ({ ok: true })
const ui = await bundleClient([
  'export { ChannelsPage } from \'./channels.js\'',
  'export { omniStore, omniActions, refreshLive } from \'./omni-store.js\'',
], { globals: { setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, URL, URLSearchParams }, team: { omni: { ...omni, call: async (endpoint, body) => { calls.push([endpoint, plain(body)]); return answer(endpoint, body) } } } })
const fresh = ui.omniStore.getSnapshot()
const ID = '11111111-2222-4333-8444-555555555555'
const channel = { id: ID, name: 'Sales <script>', type: 'whatsapp-baileys', detail: '+55', status: 'connected', answeredBy: 'You', health: { lastEventAt: null, messagesToday: null, replyMedianSec: null, uptime: null } }
const chat = { id: 'chat', channelId: ID, name: 'Marina', initials: 'MA', at: 1, unread: 0 }
const setup = (extra = {}, writable = true) => {
  calls.length = 0
  answer = async endpoint => endpoint === 'omni-overview' ? { configured: true, origin: 'omni.example.com', channels: [], chats: [] } : { ok: true }
  ui.omniStore.set({ ...fresh, preview: false, source: { kind: 'live', origin: 'omni.example.com' }, abilities: { changeChannels: writable }, channels: [{ ...channel, ...extra }], chats: [chat], messages: { chat: [{ id: 'm' }] }, page: { view: 'channel', channelId: ID }, link: { origin: 'omni.example.com', version: '2.261028.11', outdated: false } })
  const actions = { selectPanel: () => assert.fail('delete must not change selected panel') }
  return mount(() => react.createElement(ui.ChannelsPage, { actions }))
}
const button = (root, label) => ofType(root, 'button').find(node => text(node) === label)
const click = node => { assert.ok(node); assert.notEqual(node.props.disabled, true); node.props.onClick() }

test('every live state/type has a destructive action; first click and Cancel send nothing', () => {
  for (const type of ['whatsapp-baileys', 'whatsapp-business', 'slack', 'telegram', 'discord', 'future-channel']) {
    for (const status of ['connected', 'connecting', 'attention', 'paused']) {
      const page = setup({ type, status })
      click(button(page.draw(), 'Delete instance'))
      let root = page.draw()
      assert.ok(text(root).includes(`Delete instance ${channel.name} (${ID})?`))
      assert.match(text(root), /Permanently deletes this instance configuration and its local chats and messages/)
      assert.match(text(root), /External token revocation or account unlinking is not guaranteed/)
      assert.match(text(root), /Events are not all erased/)
      click(button(root, 'Cancel'))
      root = page.draw()
      assert.equal(button(root, 'Permanently delete instance'), undefined)
      assert.deepEqual(calls, [])
      page.unmount()
    }
  }
})

test('read-only and busy actions stay visible but cannot arm deletion', () => {
  for (const [extra, writable] of [[{}, false], [{ busy: 'pause' }, true]]) {
    const page = setup(extra, writable)
    const action = button(page.draw(), 'Delete instance')
    assert.equal(action.props.disabled, true)
    action.props.onClick()
    assert.equal(button(page.draw(), 'Permanently delete instance'), undefined)
    assert.deepEqual(calls, [])
    page.unmount()
  }
})

test('confirmed delete is synchronous-busy across redraw/poll, retaining the UI until success', async () => {
  const page = setup()
  let resolve
  const pending = new Promise(yes => { resolve = yes })
  answer = async endpoint => endpoint === 'omni-channel-act' ? pending : { configured: true, origin: 'omni.example.com', channels: [], chats: [] }
  click(button(page.draw(), 'Delete instance'))
  const confirm = button(page.draw(), 'Permanently delete instance')
  click(confirm)
  // Stale handler and newly created action objects cannot issue a second delete.
  confirm.props.onClick()
  await ui.omniActions(() => {}, async () => assert.fail('duplicate')).deleteInstance(ID)
  await ui.refreshLive(async () => ({ configured: true, channels: [], chats: [] }))
  let root = page.draw()
  assert.equal(button(root, 'Deleting instance…').props.disabled, true)
  assert.equal(button(root, 'Cancel').props.disabled, true)
  assert.ok(text(root).includes(channel.name))
  assert.equal(ui.omniStore.getSnapshot().chats.length, 1)
  assert.deepEqual(calls, [['omni-channel-act', { id: ID, action: 'delete' }]])
  resolve({ ok: true })
  await settle()
  root = page.draw()
  assert.equal(button(root, 'Delete instance'), undefined)
  assert.equal(ui.omniStore.getSnapshot().channels.length, 0)
  assert.equal(ui.omniStore.getSnapshot().chats.length, 0)
  page.unmount()
})

test('failed delete keeps details and chats, shows actionable error and supports retry', async () => {
  const page = setup()
  answer = async () => { throw new Error('Connection lost') }
  click(button(page.draw(), 'Delete instance'))
  click(button(page.draw(), 'Permanently delete instance'))
  await settle()
  const root = page.draw()
  assert.match(text(root), /Could not delete instance: Connection lost. Check your access or connection, then try again/)
  assert.equal(ui.omniStore.getSnapshot().chats.length, 1)
  assert.equal(ui.omniStore.getSnapshot().messages.chat.length, 1)
  assert.ok(text(root).includes(channel.name))
  answer = async endpoint => endpoint === 'omni-overview' ? { configured: true, origin: 'omni.example.com', channels: [], chats: [] } : { ok: true }
  click(button(root, 'Permanently delete instance'))
  await settle()
  assert.equal(ui.omniStore.getSnapshot().channels.length, 0)
  page.unmount()
})

test('preview Disconnect never reaches the backend and live remove is not a shortcut', () => {
  calls.length = 0
  ui.omniStore.set({ ...fresh, page: { view: 'channel', channelId: 'wa-sales' } })
  const page = mount(() => react.createElement(ui.ChannelsPage, { actions: { selectPanel() {} } }))
  assert.equal(button(page.draw(), 'Delete instance'), undefined)
  click(button(page.draw(), 'Disconnect'))
  click(button(page.draw(), 'Click again to disconnect'))
  assert.equal(ui.omniStore.getSnapshot().channels.some(item => item.id === 'wa-sales'), false)
  assert.deepEqual(calls, [])
  page.unmount()
})
