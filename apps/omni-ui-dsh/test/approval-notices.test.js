import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/approval-notices.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
})

// One window: the platform's Notification, whether the page shows, and the work source.
function windowWith({ permission = 'granted', visibility = 'visible' } = {}) {
  const shown = []
  const opened = []
  function Notification(title, options) {
    const note = { title, ...options, closed: false, close() { note.closed = true } }
    shown.push(note)
    return note
  }
  Notification.permission = permission
  const listeners = new Set()
  let snapshot = { bots: {}, approvals: [] }
  const work = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    set: (next) => { snapshot = next; for (const listener of listeners) listener() },
  }
  const roster = { getSnapshot: () => ({ byId: { b: { id: 'b', name: 'Writer' } }, roomsById: { r1: { id: 'r1', name: 'Ops' } } }) }
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, Notification,
    document: { visibilityState: visibility },
    window: { focus() {} },
  })
  return { ...module.exports, shown, opened, work, roster, openSession: id => opened.push(id) }
}

test('an approval that starts waiting while another conversation shows gets one notification', () => {
  const page = windowWith()
  page.noticeApprovals({ work: page.work, roster: page.roster, shownSession: () => 'a', openSession: page.openSession, since: 100 })
  page.work.set({ bots: {}, approvals: [{ id: 'x1', botId: 'b', roomId: 'r1', sessionId: 'gb', tool: 'pwsh', at: 200 }] })
  page.work.set({ bots: {}, approvals: [{ id: 'x1', botId: 'b', roomId: 'r1', sessionId: 'gb', tool: 'pwsh', at: 200 }] })
  assert.deepEqual(page.shown.map(note => [note.title, note.body, note.tag]), [['Writer is waiting for your approval', 'Ops · pwsh', 'ds-bot-approval-x1']])
  page.shown[0].onclick()
  assert.deepEqual([page.opened, page.shown[0].closed], [['r1'], true])
})

test('no notification for the conversation on screen, for approvals older than the window, or without permission', () => {
  const onScreen = windowWith()
  onScreen.noticeApprovals({ work: onScreen.work, roster: onScreen.roster, shownSession: () => 'r1', openSession: onScreen.openSession, since: 100 })
  onScreen.work.set({ bots: {}, approvals: [{ id: 'x1', botId: 'b', roomId: 'r1', tool: 'pwsh', at: 200 }, { id: 'x2', botId: 'b', sessionId: 'b', tool: 'pwsh', at: 50 }] })
  assert.equal(onScreen.shown.length, 0)

  const hidden = windowWith({ visibility: 'hidden' })
  hidden.noticeApprovals({ work: hidden.work, roster: hidden.roster, shownSession: () => 'r1', openSession: hidden.openSession, since: 100 })
  hidden.work.set({ bots: {}, approvals: [{ id: 'x1', botId: 'b', roomId: 'r1', tool: 'pwsh', at: 200 }] })
  assert.equal(hidden.shown.length, 1)

  const denied = windowWith({ permission: 'default' })
  denied.noticeApprovals({ work: denied.work, roster: denied.roster, shownSession: () => 'a', openSession: denied.openSession, since: 100 })
  denied.work.set({ bots: {}, approvals: [{ id: 'x1', botId: 'b', roomId: 'r1', tool: 'pwsh', at: 200 }] })
  assert.equal(denied.shown.length, 0)
})
