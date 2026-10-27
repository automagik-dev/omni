// Thread keys (wish omni-chat-threads, Group 6; criteria :186, :187, :188, :196, :200): each
// thread's own chat key, kept in a 0600 file of this plugin's, cut when the thread goes and
// handed over whenever the link key changes. A fake Omni with Group 4's three chat-key routes
// and /auth/validate, its keys and their lineage held in memory.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { open as openFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { install as installHooks } from '@automagik/bots-dsh/src/host/extend.js'
import { KEY_ROUTE_REFUSAL } from '../src/host/omni-api.js'
import { linkWithKey } from '../src/host/omni-discover.js'
import { install as installLink, LINK_FILE } from '../src/host/omni-link.js'
import { install as installOmni } from '../src/host/omni.js'
import { NEEDS_NEWER_TEAM } from '../src/host/resume-hook.js'
import { BEING_CUT, DRAIN_MS, install as installKeys, isOwnChat, KEYS_FILE, NOT_LINKED, OTHER_OMNI, UNREADABLE } from '../src/host/thread-keys.js'
import { applyBoth, fakeContext } from './team.js'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const OMNI = 'https://omni.example.com'
const OTHER = 'https://other.example.com'
const INSTANCE = '0b5f1c1e-6a51-4d5e-9a41-0c0d9b6f1a01'
const CHAT = '1c6f2d2e-7b62-4e6f-8b52-1d1e0c7f2b02'
const OWN_CHAT = '2d7a3e3f-8c73-4f7a-9c63-2e2f1d8a3c03'
const OWNER = '5511999990000'
const CHATS = {
  [CHAT]: { id: CHAT, instanceId: INSTANCE, externalId: '5511988887777@s.whatsapp.net', chatType: 'dm', name: 'Marina' },
  [OWN_CHAT]: { id: OWN_CHAT, instanceId: INSTANCE, externalId: `${OWNER}@s.whatsapp.net`, chatType: 'dm', name: 'Me' },
}

// Keys by their text: a broad sandbox key (it makes device keys, as a sandbox's own key does),
// link keys, and the chat keys they mint. Revoking a key revokes its children, as Group 1's
// cascade does; a revoked or unknown key gets 401 on every route, as the auth middleware does.
// `fail` makes one route answer 500; `down` makes Omni unreachable; `refuseWith(key)` makes
// the mint refuse in those words; `tamper(data)` changes a mint's answer; `gate`, a promise
// every request waits for.
function fakeOmni() {
  const keys = new Map()
  const asked = []
  const fail = new Set()
  const omni = { asked, fail, down: false, keys, refuseWith: null, tamper: null, gate: null }
  const add = (host, kind, extra = {}) => {
    const record = { id: randomUUID(), text: `omni_sk_${kind}_${randomUUID().slice(0, 8)}`, host, kind, revoked: false, parentId: null, chatId: null, ...extra }
    keys.set(record.text, record)
    return record
  }
  omni.sandboxKey = (base = OMNI) => add(new URL(base).host, 'sandbox').text
  omni.linkKey = (base = OMNI) => add(new URL(base).host, 'link')
  omni.revoke = (record) => {
    record.revoked = true
    for (const child of keys.values()) if (child.parentId === record.id) child.revoked = true
  }
  omni.byText = text => keys.get(text)
  omni.children = () => [...keys.values()].filter(record => record.kind === 'child')
  omni.liveChildren = () => omni.children().filter(record => !record.revoked)
  const childOf = (id, host) => [...keys.values()].find(record => record.id === id && record.kind === 'child' && record.host === host)
  omni.addChild = (host, extra) => add(host, 'child', extra)

  globalThis.fetch = async (address, init = {}) => {
    const url = new URL(String(address))
    const key = init.headers?.['x-api-key'] ?? null
    const method = init.method ?? 'GET'
    const path = url.pathname.replace(/^\/api\/v2/, '')
    asked.push({ method, host: url.host, path, key })
    if (omni.gate) await omni.gate
    if (omni.down) throw new TypeError('fetch failed')
    const json = (status, body) => new Response(JSON.stringify(body), { status })
    const caller = keys.get(key)
    if (!caller || caller.revoked || caller.host !== url.host) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } })
    const route = `${method} ${path.replace(/^\/keys\/children\/(?!self\/)[^/]+\/revoke$/, '/keys/children/:id/revoke')}`
    if (fail.has(route)) return json(500, { error: { code: 'INTERNAL', message: 'boom' } })
    switch (route) {
      case 'POST /auth/validate':
        if (caller.kind === 'child') return json(403, { error: { code: 'FORBIDDEN', message: 'Missing scope auth:validate' } })
        return json(200, { data: { valid: true, scopes: caller.kind === 'sandbox' ? ['*'] : ['chats:*', 'messages:*', 'instances:*'] } })
      case 'POST /keys': {
        if (caller.kind !== 'sandbox') return json(403, { error: { code: 'FORBIDDEN', message: 'no' } })
        const made = add(url.host, 'link')
        return json(201, { data: { id: made.id, plainTextKey: made.text, scopes: ['chats:*', 'messages:*', 'instances:*'], expiresAt: null } })
      }
      case 'POST /keys/children': {
        if (caller.kind !== 'link') return json(403, { error: { code: 'FORBIDDEN', message: 'this key cannot mint or revoke chat keys' } })
        if (omni.refuseWith) return json(403, { error: { code: 'FORBIDDEN', message: omni.refuseWith(caller.text) } })
        const chat = CHATS[JSON.parse(init.body).chatId]
        if (!chat) return json(404, { error: { code: 'NOT_FOUND', message: 'Chat not found' } })
        const previous = [...keys.values()].find(record => record.parentId === caller.id && record.chatId === chat.id && !record.revoked)
        if (previous) previous.revoked = true
        const child = add(url.host, 'child', { parentId: caller.id, chatId: chat.id })
        const data = { id: child.id, plainTextKey: child.text, parentKeyId: caller.id, chatId: chat.id, chatExternalId: chat.externalId, instanceId: chat.instanceId, scopes: ['messages:send', 'chats:read'], expiresAt: null, replacedKeyId: previous?.id ?? null }
        return json(201, { data: omni.tamper ? omni.tamper(data) : data })
      }
      case 'POST /keys/children/self/revoke':
        if (caller.kind !== 'child') return json(403, { error: { code: 'FORBIDDEN', message: 'not a chat key' } })
        caller.revoked = true
        return json(200, { data: { id: caller.id, status: 'revoked' } })
      case 'POST /keys/children/:id/revoke': {
        if (caller.kind !== 'link') return json(403, { error: { code: 'FORBIDDEN', message: 'this key cannot mint or revoke chat keys' } })
        const target = childOf(path.split('/')[3], url.host)
        if (!target) return json(404, { error: { code: 'NOT_FOUND', message: 'API key not found' } })
        if (target.parentId !== caller.id) return json(403, { error: { code: 'FORBIDDEN', message: 'not one of your chat keys' } })
        if (target.revoked) return json(200, { data: { id: target.id, status: 'already_revoked' } })
        target.revoked = true
        return json(200, { data: { id: target.id, status: 'revoked' } })
      }
      case `GET /instances/${INSTANCE}`:
        if (caller.kind === 'child') return json(403, { error: { code: 'FORBIDDEN', message: 'Missing scope instances:read' } })
        return json(200, { data: { id: INSTANCE, name: 'Pessoal', ownerIdentifier: `${OWNER}:12@s.whatsapp.net` } })
      default: {
        const chatId = path.match(/^\/chats\/([^/]+)$/)?.[1]
        if (method === 'GET' && CHATS[chatId]) {
          if (caller.kind === 'child' && caller.chatId !== chatId) return json(403, { error: { code: 'FORBIDDEN', message: 'chat lock' } })
          return json(200, { data: CHATS[chatId] })
        }
        return json(404, { error: { code: 'NOT_FOUND', message: 'Not Found' } })
      }
    }
  }
  return omni
}

// The link, the Omni requests and the thread keys on one runtime, as index.js installs them.
function runtime(t, { link, keysFile, ready = true, readOnly, settings, home: shared } = {}) {
  const home = shared ?? mkdtempSync(join(tmpdir(), 'thread-keys-'))
  if (link) writeFileSync(join(home, LINK_FILE), JSON.stringify(link))
  if (keysFile) writeFileSync(join(home, KEYS_FILE), JSON.stringify(keysFile), { mode: 0o600 })
  const disposers = []
  const warnings = []
  const rt = {
    home,
    config: {},
    ctx: { effect: (run) => { const dispose = run(); if (typeof dispose === 'function') disposers.push(dispose) }, get: () => undefined, settings },
    teamResume: { ready, reason: ready ? null : NEEDS_NEWER_TEAM },
    warn: (...args) => warnings.push(args.join(' ')),
    ...(readOnly ? { readOnly: () => readOnly } : {}),
  }
  installHooks(rt)
  installLink(rt)
  installOmni(rt)
  installKeys(rt)
  const changes = []
  rt.threadKeys.onChange(threadId => changes.push(threadId))
  t.after(async () => {
    await Promise.all(disposers.map(dispose => dispose()))
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  const file = () => JSON.parse(readFileSync(join(home, KEYS_FILE), 'utf8'))
  return { rt, home, file, changes, warnings }
}

const linked = record => ({ url: OMNI, key: record.text, keyId: record.id, scopes: ['chats:*'], pairedAt: '2026-10-27T00:00:00.000Z' })
const keyFileText = home => (existsSync(join(home, KEYS_FILE)) ? readFileSync(join(home, KEYS_FILE), 'utf8') : '')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

// setInterval and clearInterval watched for one test: each timer, its period, and whether it
// was unref'd and cleared.
function watchTimers(t) {
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  const timers = []
  globalThis.setInterval = (run, ms) => {
    const timer = realSetInterval(run, ms)
    const entry = { run, ms, unref: false, cleared: false }
    const unref = timer.unref.bind(timer)
    timer.unref = () => { entry.unref = true; return unref() }
    timers.push({ entry, timer })
    return timer
  }
  globalThis.clearInterval = (timer) => {
    const found = timers.find(item => item.timer === timer)
    if (found) found.entry.cleared = true
    return realClearInterval(timer)
  }
  t.after(() => { globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval })
  return () => timers.filter(item => item.entry.ms === DRAIN_MS).map(item => item.entry)
}

test('a thread\'s key is a child of the link key, kept only in a 0600 file beside omni.json', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const { rt, home, file, changes } = runtime(t, { link: linked(parent) })

  assert.deepEqual(await rt.threadKeys.mint('t1', CHAT), { ok: true, self: OWNER })
  const [child] = omni.children()
  assert.equal(child.parentId, parent.id)
  assert.equal(child.chatId, CHAT)
  assert.equal(statSync(join(home, KEYS_FILE)).mode & 0o777, 0o600)
  assert.deepEqual(file(), {
    version: 1,
    threads: { t1: { childId: child.id, key: child.text, chatId: CHAT, origin: OMNI, parentKeyId: parent.id, pending: null } },
    retired: [],
    waiting: {},
  })
  // Minted, and the owner's number read, with the link key.
  assert.deepEqual(omni.asked.map(call => [call.method, call.path, call.key]), [
    ['POST', '/keys/children', parent.text],
    ['GET', `/instances/${INSTANCE}`, parent.text],
  ])
  assert.equal(rt.threadKeys.keyFor('t1'), child.text)
  assert.equal(rt.threadKeys.connected('t1'), true)
  assert.equal(rt.threadKeys.reasonOf('t1'), null)
  assert.deepEqual(changes, ['t1'])
  // A thread that has a key is not given a second one.
  assert.equal((await rt.threadKeys.mint('t1', CHAT)).ok, false)
  assert.equal(omni.children().length, 1)
})

test('a failed mint writes nothing, says why, and leaves no key for the thread to run on', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const { rt, home, changes } = runtime(t, { link: linked(parent) })
  const fails = async (reason) => {
    const minted = await rt.threadKeys.mint('t1', CHAT)
    assert.equal(minted.ok, false)
    assert.match(minted.reason, reason)
    assert.equal(existsSync(join(home, KEYS_FILE)), false, 'nothing written')
    assert.equal(rt.threadKeys.keyFor('t1'), null)
    assert.equal(rt.threadKeys.connected('t1'), false)
  }
  // Omni unreachable.
  omni.down = true
  await fails(/^Could not reach Omni at omni\.example\.com\.$/)
  omni.down = false
  // The route missing (an Omni from before chat keys).
  const realAnswer = globalThis.fetch
  globalThis.fetch = async (address, init) => (String(address).endsWith('/keys/children') ? new Response('404 Not Found', { status: 404 }) : realAnswer(address, init))
  await fails(/cannot make chat keys; update it/)
  globalThis.fetch = realAnswer
  // The caller refused: a chat-locked link key may not mint.
  omni.byText(parent.text).kind = 'locked'
  await fails(/^Omni refused a chat key: this key cannot mint or revoke chat keys$/)
  omni.byText(parent.text).kind = 'link'
  // A chat Omni does not have, and an id that is not one.
  assert.equal((await rt.threadKeys.mint('t1', randomUUID())).reason, 'Chat not found')
  assert.equal((await rt.threadKeys.mint('t1', 'not-a-chat')).reason, 'Unknown chat.')
  assert.equal(omni.children().length, 0)
  assert.deepEqual(changes, [])

  // No fallback: the thread's key is null, and a request on it is not made at all.
  const before = omni.asked.length
  assert.equal(await rt.omniRequest('GET', `/chats/${CHAT}`, { key: rt.threadKeys.keyFor('t1') }), null)
  assert.equal(omni.asked.length, before)
})

test('a mint is offered only on a Bot team with the restart hook, and only with a link', async (t) => {
  const omni = fakeOmni()
  const old = runtime(t, { link: linked(omni.linkKey()), ready: false })
  assert.deepEqual(await old.rt.threadKeys.mint('t1', CHAT), { ok: false, reason: NEEDS_NEWER_TEAM })
  const none = runtime(t)
  assert.deepEqual(await none.rt.threadKeys.mint('t1', CHAT), { ok: false, reason: NOT_LINKED })
  assert.equal(omni.asked.length, 0)
  assert.equal(existsSync(join(old.home, KEYS_FILE)) || existsSync(join(none.home, KEYS_FILE)), false)
})

test('a per-call key is the only key a request uses', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const { rt } = runtime(t, { link: linked(parent) })
  await rt.threadKeys.mint('t1', CHAT)
  const child = rt.threadKeys.keyFor('t1')
  assert.equal((await rt.omniRequest('GET', `/chats/${CHAT}`, { key: child })).status, 200)
  assert.equal(omni.asked.at(-1).key, child)
  // The thread's key cannot read the channel; the link key is not tried in its place.
  assert.equal((await rt.omniRequest('GET', `/instances/${INSTANCE}`, { key: child })).status, 403)
  assert.equal(omni.asked.at(-1).key, child)
  assert.equal(await rt.omniRequest('GET', '/instances', { key: null }), null)
  assert.equal(await rt.omniRequest('GET', '/instances', { key: '' }), null)
  assert.equal(omni.asked.at(-1).key, child)
})

test('a removed thread\'s key is cut by its parent; a cut that fails stays pending and drains by the parent\'s revoke', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const { rt, file } = runtime(t, { link: linked(parent) })
  await rt.threadKeys.mint('t1', CHAT)
  await rt.threadKeys.mint('t2', OWN_CHAT)
  const [first, second] = omni.children()

  assert.deepEqual(await rt.threadKeys.revoke('t1'), { cut: true })
  assert.equal(first.revoked, true)
  assert.deepEqual(omni.asked.at(-1), { method: 'POST', host: 'omni.example.com', path: `/keys/children/${first.id}/revoke`, key: parent.text })
  assert.equal(file().threads.t1, undefined)

  omni.down = true
  assert.deepEqual(await rt.threadKeys.revoke('t2'), { cut: false })
  assert.equal(typeof file().threads.t2.pending.since, 'number')
  assert.equal(rt.threadKeys.keyFor('t2'), null)
  assert.equal(rt.threadKeys.reasonOf('t2'), BEING_CUT)
  // Still unreachable: still pending.
  await rt.threadKeys.drain()
  assert.ok(file().threads.t2.pending)
  omni.down = false
  const before = omni.asked.length
  await rt.threadKeys.drain()
  assert.equal(second.revoked, true)
  assert.deepEqual(file().threads, {})
  // The parent's revoke was enough: no self-revoke, no check.
  assert.deepEqual(omni.asked.slice(before).map(call => call.path), [`/keys/children/${second.id}/revoke`])
})

test('a pending cut the parent cannot make drains by the child\'s own self-revoke', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const { rt, file } = runtime(t, { link: linked(parent) })
  await rt.threadKeys.mint('t1', CHAT)
  const [child] = omni.children()
  omni.down = true
  await rt.threadKeys.revoke('t1')
  omni.down = false
  omni.fail.add('POST /keys/children/:id/revoke')
  const before = omni.asked.length
  await rt.threadKeys.drain()
  assert.equal(child.revoked, true)
  assert.deepEqual(file().threads, {})
  assert.deepEqual(omni.asked.slice(before).map(call => [call.path, call.key]), [
    [`/keys/children/${child.id}/revoke`, parent.text],
    ['/keys/children/self/revoke', child.text],
  ])
})

test('else only a 401 on the child\'s own key drops it: a live child\'s 403 from /auth/validate keeps it pending', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const { rt, file } = runtime(t, { link: linked(parent) })
  await rt.threadKeys.mint('t1', CHAT)
  const [child] = omni.children()
  omni.down = true
  await rt.threadKeys.revoke('t1')
  omni.down = false
  omni.fail.add('POST /keys/children/:id/revoke')
  omni.fail.add('POST /keys/children/self/revoke')
  const before = omni.asked.length
  await rt.threadKeys.drain()
  assert.deepEqual(omni.asked.slice(before).map(call => [call.path, call.key]), [
    [`/keys/children/${child.id}/revoke`, parent.text],
    ['/keys/children/self/revoke', child.text],
    ['/auth/validate', child.text],
  ])
  assert.equal(child.revoked, false)
  assert.ok(file().threads.t1.pending, 'a live child (403) is kept')
  // Cut some other way (its parent narrowed, or revoked by the owner): the 401 drops it.
  child.revoked = true
  await rt.threadKeys.drain()
  assert.deepEqual(file().threads, {})
  assert.deepEqual(omni.asked.at(-1), { method: 'POST', host: 'omni.example.com', path: '/auth/validate', key: child.text })
})

test('a sandbox update\'s re-link to the same Omni gives every thread a fresh child of the new key, after the old ones are cut', async (t) => {
  const omni = fakeOmni()
  const sandbox = omni.sandboxKey()
  const { rt, home, file, changes } = runtime(t)
  // The sandbox's own key is broad, so the link is a device key made with it (omni-discover.js);
  // a sandbox update re-links the same way (omni-local.js).
  await linkWithKey(rt, OMNI, sandbox)
  const before = omni.byText(rt.omniLink().key)
  await rt.threadKeys.mint('t1', CHAT)
  await rt.threadKeys.mint('t2', OWN_CHAT)
  const old = omni.liveChildren()
  changes.length = 0
  const asked = omni.asked.length

  await linkWithKey(rt, OMNI, sandbox)
  const after = omni.byText(rt.omniLink().key)
  assert.notEqual(after.id, before.id)
  assert.ok(old.every(child => child.revoked), 'the old children are cut')
  const fresh = ['t1', 't2'].map(id => omni.byText(rt.threadKeys.keyFor(id)))
  for (const child of fresh) {
    assert.equal(child.parentId, after.id)
    assert.equal(child.revoked, false)
  }
  assert.deepEqual(fresh.map(child => child.chatId), [CHAT, OWN_CHAT])
  // The old key cut them, before the new one minted anything.
  const calls = omni.asked.slice(asked)
  const lastCut = calls.findLastIndex(call => /^\/keys\/children\/[^/]+\/revoke$/.test(call.path))
  const firstMint = calls.findIndex(call => call.path === '/keys/children')
  assert.ok(lastCut >= 0 && lastCut < firstMint)
  assert.ok(calls.slice(0, lastCut + 1).filter(call => call.path.startsWith('/keys/children/')).every(call => call.key === before.text))
  assert.ok(calls.filter(call => call.path === '/keys/children').every(call => call.key === after.text))
  // The old key is not kept: nothing of it was left to cut.
  assert.deepEqual(file().retired, [])
  assert.deepEqual(file().waiting, {})
  assert.ok(!keyFileText(home).includes(before.text))
  assert.deepEqual([...new Set(changes)].sort(), ['t1', 't2'])
  // A later remove still cuts the fresh key.
  assert.deepEqual(await rt.threadKeys.revoke('t1'), { cut: true })
  assert.equal(fresh[0].revoked, true)
})

test('a re-link whose old cut fails keeps the old key only until the drain cuts its children, then the thread gets its fresh key', async (t) => {
  const omni = fakeOmni()
  const oldParent = omni.linkKey()
  const { rt, home, file } = runtime(t, { link: linked(oldParent) })
  await rt.threadKeys.mint('t1', CHAT)
  const [oldChild] = omni.children()
  const newParent = omni.linkKey()
  // Every way to cut the old child fails this time.
  omni.fail.add('POST /keys/children/:id/revoke')
  omni.fail.add('POST /keys/children/self/revoke')
  omni.fail.add('POST /auth/validate')
  await rt.saveOmniLink(linked(newParent))
  assert.equal(oldChild.revoked, false)
  assert.deepEqual(file().retired, [{ origin: OMNI, parentKey: oldParent.text, childIds: [oldChild.id] }])
  assert.ok(file().threads.t1.pending)
  // Not connected meanwhile, on neither key: no second live child for the chat.
  assert.equal(rt.threadKeys.keyFor('t1'), null)
  assert.equal(rt.threadKeys.reasonOf('t1'), BEING_CUT)
  assert.equal(omni.liveChildren().length, 1)

  omni.fail.clear()
  await rt.threadKeys.drain()
  assert.equal(oldChild.revoked, true)
  assert.deepEqual(file().retired, [])
  assert.ok(!keyFileText(home).includes(oldParent.text), 'the old key goes once nothing of it is left to cut')
  const fresh = omni.byText(rt.threadKeys.keyFor('t1'))
  assert.equal(fresh.parentId, newParent.id)
})

test('after Disconnect no thread key is live; the same Omni paired again gives fresh children, and a remove still cuts', async (t) => {
  const omni = fakeOmni()
  const sandbox = omni.sandboxKey()
  const { rt, home } = runtime(t)
  await linkWithKey(rt, OMNI, sandbox)
  const first = rt.omniLink().key
  await rt.threadKeys.mint('t1', CHAT)
  await rt.threadKeys.mint('t2', OWN_CHAT)

  assert.deepEqual(await rt.omniLinkEndpoint('omni-disconnect'), { status: 'disconnected' })
  assert.equal(existsSync(join(home, LINK_FILE)), false)
  assert.deepEqual(omni.liveChildren(), [])
  for (const id of ['t1', 't2']) {
    assert.equal(rt.threadKeys.keyFor(id), null)
    assert.equal(rt.threadKeys.connected(id), false)
    assert.equal(rt.threadKeys.reasonOf(id), NOT_LINKED)
  }
  // Cut with the link key while it was still there.
  assert.ok(omni.asked.filter(call => /^\/keys\/children\/[^/]+\/revoke$/.test(call.path)).every(call => call.key === first))
  for (const child of omni.children()) assert.ok(!keyFileText(home).includes(child.text))
  // The drain mints nothing without a link.
  const before = omni.asked.length
  await rt.threadKeys.drain()
  assert.equal(omni.asked.length, before)

  await linkWithKey(rt, OMNI, sandbox)
  const again = omni.byText(rt.omniLink().key)
  const fresh = omni.byText(rt.threadKeys.keyFor('t1'))
  assert.equal(fresh.parentId, again.id)
  assert.equal(omni.byText(rt.threadKeys.keyFor('t2')).parentId, again.id)
  assert.deepEqual(await rt.threadKeys.revoke('t1'), { cut: true })
  assert.equal(fresh.revoked, true)
  assert.equal(rt.threadKeys.keyFor('t1'), null)
})

test('after a different Omni is paired the old threads stay not connected, and it is asked for no key', async (t) => {
  const omni = fakeOmni()
  const { rt } = runtime(t)
  await linkWithKey(rt, OMNI, omni.sandboxKey())
  await rt.threadKeys.mint('t1', CHAT)
  const [child] = omni.children()
  await linkWithKey(rt, OTHER, omni.sandboxKey(OTHER))
  assert.equal(child.revoked, true)
  assert.equal(rt.threadKeys.keyFor('t1'), null)
  assert.equal(rt.threadKeys.reasonOf('t1'), OTHER_OMNI)
  await rt.threadKeys.drain()
  assert.deepEqual(omni.asked.filter(call => call.host === 'other.example.com' && call.path.startsWith('/keys/children')), [])
  assert.equal(omni.liveChildren().length, 0)
})

test('a new link with the same key on the same Omni keeps the threads\' keys', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const { rt } = runtime(t, { link: linked(parent) })
  await rt.threadKeys.mint('t1', CHAT)
  const key = rt.threadKeys.keyFor('t1')
  const before = omni.asked.length
  await rt.saveOmniLink(linked(parent))
  assert.equal(omni.asked.length, before)
  assert.equal(rt.threadKeys.keyFor('t1'), key)
})

test('the owner\'s own chat, added as a thread, is still seen as "self" with the thread\'s key', async (t) => {
  const omni = fakeOmni()
  const { rt } = runtime(t, { link: linked(omni.linkKey()) })
  const minted = await rt.threadKeys.mint('me', OWN_CHAT)
  assert.deepEqual(minted, { ok: true, self: OWNER })
  const key = rt.threadKeys.keyFor('me')
  // The thread's key reads its chat but not its channel, so the owner's number comes from the mint.
  assert.equal((await rt.omniRequest('GET', `/instances/${INSTANCE}`, { key })).status, 403)
  const chat = (await (await rt.omniRequest('GET', `/chats/${OWN_CHAT}`, { key })).json()).data
  assert.equal(isOwnChat(minted.self, chat.externalId), true)
  assert.equal(isOwnChat(minted.self, CHATS[CHAT].externalId), false)
  assert.equal(isOwnChat(null, chat.externalId), false)
  // Another chat's thread gets the same owner's number, and is not "self".
  const other = await rt.threadKeys.mint('marina', CHAT)
  assert.equal(isOwnChat(other.self, CHATS[CHAT].externalId), false)
})

test('pending cuts drain at start and on an unref\'d timer that goes with the plugin; a host that only reads leaves them', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const pendingFile = (child) => ({
    version: 1,
    threads: { t1: { childId: child.id, key: child.text, chatId: CHAT, origin: OMNI, parentKeyId: parent.id, pending: { since: 1 } } },
    retired: [],
  })
  const mintChild = () => {
    const record = { id: randomUUID(), text: `omni_sk_child_${randomUUID().slice(0, 8)}`, host: 'omni.example.com', kind: 'child', revoked: false, parentId: parent.id, chatId: CHAT }
    omni.keys.set(record.text, record)
    return record
  }
  const settle = async (done) => {
    for (let waited = 0; waited < 2000 && !done(); waited += 10) await new Promise(resolve => setTimeout(resolve, 10))
  }

  // A host that only reads the team leaves the drain to the one that holds it.
  const readerChild = mintChild()
  const reader = runtime(t, { link: linked(parent), keysFile: pendingFile(readerChild), readOnly: 'Another DeepSeek Harness holds the team.' })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.ok(reader.file().threads.t1.pending)
  assert.equal(readerChild.revoked, false)

  const drainTimers = watchTimers(t)
  const child = mintChild()
  const disposers = []
  const dispose = () => Promise.all(disposers.splice(0).filter(stop => typeof stop === 'function').map(stop => stop()))
  t.after(dispose)
  const home = mkdtempSync(join(tmpdir(), 'thread-keys-'))
  writeFileSync(join(home, LINK_FILE), JSON.stringify(linked(parent)))
  writeFileSync(join(home, KEYS_FILE), JSON.stringify(pendingFile(child)), { mode: 0o600 })
  const rt = { home, config: {}, ctx: { effect: (run) => { disposers.push(run()) }, get: () => undefined }, teamResume: { ready: true, reason: null } }
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }))
  installHooks(rt)
  installLink(rt)
  installOmni(rt)
  installKeys(rt)
  const read = () => JSON.parse(readFileSync(join(home, KEYS_FILE), 'utf8'))
  // At start.
  await settle(() => child.revoked && Object.keys(read().threads).length === 0)
  assert.equal(child.revoked, true)
  assert.deepEqual(read().threads, {})
  const [timer] = drainTimers()
  assert.ok(timer, 'a drain timer')
  assert.equal(timer.unref, true)

  // On the timer: a cut that failed is retried.
  await rt.threadKeys.mint('t2', OWN_CHAT)
  const second = omni.byText(rt.threadKeys.keyFor('t2'))
  omni.down = true
  await rt.threadKeys.revoke('t2')
  omni.down = false
  timer.run()
  await settle(() => second.revoked && read().threads.t2 === undefined)
  assert.equal(second.revoked, true)
  assert.equal(read().threads.t2, undefined)

  // Turning the plugin off stops it.
  await dispose()
  assert.equal(timer.cleared, true)
})

test('a key file that fails its check is not used, and says so once', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const { rt, warnings } = runtime(t, { link: linked(parent), keysFile: { version: 1, threads: { t1: { childId: 'c1', key: 'omni_sk_x', chatId: CHAT } }, retired: [] } })
  assert.equal(rt.threadKeys.keyFor('t1'), null)
  assert.equal(rt.threadKeys.keyFor('t1'), null)
  assert.equal(warnings.filter(line => line.includes(KEYS_FILE)).length, 1)
  assert.ok(!warnings.join('\n').includes('omni_sk_x'))
})

// The plugin composed on the Bot team, as DSH runs it: the key stays out of the team's state,
// the roster view the browser reads, and every tool result a model sees.
test('no thread key text is in state.json, the roster view or a tool result', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const home = mkdtempSync(join(tmpdir(), 'thread-keys-team-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify({
    version: 1, mainBotIds: ['m1'], revision: 1,
    bots: { m1: { id: 'm1', name: 'Omni', role: 'Orchestrator', instructions: '', createdAt: 1 } },
    rooms: {}, agents: {}, exchanges: [], exchangeTurns: {},
  }))
  writeFileSync(join(home, LINK_FILE), JSON.stringify(linked(parent)))
  const ctx = fakeContext()
  let sessions = 0
  Object.assign(ctx, {
    llm: { listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }], listModels: async () => [{ id: 'deepseek-v4-flash' }], resolveModelInfo: async () => ({}) },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async path => ({ id: 'w1', path }), archiveSession: async () => {} },
    sessionController: { create: async () => ({ sessionId: `s${++sessions}` }), resolveAgent: async sessionId => ({ agent: { session: { id: sessionId }, followup() {} } }), selectModel: async () => {} },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => {
    route = options
    return register(options)
  }
  const { channels } = applyBoth(ctx, { home })
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/omni-ui', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).text()
  // The restart hook is the Bot team's, which an older release lacks; the mint is what is tested.
  channels.teamResume = { ready: true, reason: null }
  assert.equal((await channels.threadKeys.mint('t1', CHAT)).ok, true)
  const key = channels.threadKeys.keyFor('t1')
  assert.match(key, /^omni_sk_child_/)
  await channels.save?.()

  const roster = await call('state', {})
  assert.match(roster, /"bots"/)
  assert.ok(!roster.includes(key), 'not in the roster view')
  assert.ok(!readFileSync(join(home, 'state.json'), 'utf8').includes(key), 'not in state.json')
  const tool = name => args => ctx.registeredTools.get(name).execute(args, { agent: { id: 'm1' } })
  for (const path of ['/keys/children', '/keys/children/self/revoke', `/keys/children/${omni.children()[0].id}/revoke`]) {
    const answer = await tool('omni_call')({ method: 'POST', path, body: JSON.stringify({ chatId: CHAT }) })
    assert.deepEqual(JSON.parse(answer), { status: 0, error: KEY_ROUTE_REFUSAL })
  }
  const answers = [
    await tool('omni_call')({ method: 'GET', path: `/chats/${CHAT}` }),
    await tool('omni_endpoints')({ search: 'chat keys' }),
  ]
  for (const answer of answers) assert.ok(!String(answer).includes(key), 'not in a tool result')
  assert.equal(omni.children().length, 1, 'no tool minted a key')
})

// Review fixes (Group 6 review 1).
test('an old link key is never sent to another Omni, and stays kept for its own', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const id = randomUUID()
  // Two pending children with one id, one on each Omni; the old key is this Omni's.
  const mine = omni.addChild('omni.example.com', { id, parentId: parent.id, chatId: CHAT })
  const theirs = omni.addChild('other.example.com', { id, chatId: CHAT })
  const pending = { pending: { since: 1 }, chatId: CHAT, childId: id, parentKeyId: null }
  const { rt, file } = runtime(t, { keysFile: {
    version: 1,
    threads: { a: { ...pending, key: theirs.text, origin: OTHER }, b: { ...pending, key: mine.text, origin: OMNI } },
    retired: [{ origin: OMNI, parentKey: parent.text, childIds: [id] }],
  } })
  await rt.threadKeys.drain()
  assert.deepEqual(omni.asked.filter(call => call.host === 'other.example.com' && call.key === parent.text), [])
  // Dropping the other Omni's child left this Omni's old key for its own, which it then cut.
  assert.ok(omni.asked.some(call => call.host === 'omni.example.com' && call.path === `/keys/children/${id}/revoke` && call.key === parent.text))
  assert.equal(mine.revoked, true)
  assert.equal(theirs.revoked, true)
  assert.deepEqual(file().threads, {})
  assert.deepEqual(file().retired, [])
})

test('a mint asked while a new link is being saved waits for it, and is a child of the new key', async (t) => {
  const omni = fakeOmni()
  const oldParent = omni.linkKey()
  const newParent = omni.linkKey()
  // Adding the Omni's market takes a while: omni.json is written after it.
  const settings = { describe: () => [{ ns: 'plugin-market', value: { indexes: [] }, revision: 1 }], update: () => delay(40) }
  const { rt } = runtime(t, { link: linked(oldParent), settings })
  await rt.threadKeys.mint('t1', CHAT)
  const saving = rt.saveOmniLink(linked(newParent))
  await delay(5)
  const minting = rt.threadKeys.mint('t2', OWN_CHAT)
  await saving
  assert.equal((await minting).ok, true)
  assert.equal(omni.byText(rt.threadKeys.keyFor('t2')).parentId, newParent.id)
  assert.equal(omni.byText(rt.threadKeys.keyFor('t1')).parentId, newParent.id)
  assert.equal(omni.liveChildren().every(child => child.parentId === newParent.id), true)
})

test('a key file that fails its check is moved aside before it is replaced, and Disconnect says it cut nothing', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const bad = { version: 1, threads: { t1: { childId: 'c1', key: 'omni_sk_unread', chatId: CHAT } }, retired: [] }
  const { rt, home, file } = runtime(t, { link: linked(parent), keysFile: bad })
  assert.deepEqual(await rt.omniLinkEndpoint('omni-disconnect'), { status: 'disconnected', notice: 'thread-keys-unreadable', message: UNREADABLE })
  assert.deepEqual(JSON.parse(readFileSync(join(home, KEYS_FILE), 'utf8')), bad, 'not overwritten')

  await rt.saveOmniLink(linked(parent))
  assert.equal((await rt.threadKeys.mint('t2', CHAT)).ok, true)
  const [aside] = readdirSync(home).filter(name => name.startsWith(`${KEYS_FILE}.unreadable-`))
  assert.ok(aside, 'moved aside')
  assert.deepEqual(JSON.parse(readFileSync(join(home, aside), 'utf8')), bad)
  assert.equal(statSync(join(home, aside)).mode & 0o777, 0o600)
  assert.deepEqual(Object.keys(file().threads), ['t2'])
})

test('two hosts on one home change the key file one at a time', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const one = runtime(t, { link: linked(parent) })
  const two = runtime(t, { home: one.home })
  const [a, b] = await Promise.all([one.rt.threadKeys.mint('t1', CHAT), two.rt.threadKeys.mint('t2', OWN_CHAT)])
  assert.equal(a.ok && b.ok, true)
  assert.deepEqual(Object.keys(one.file().threads).sort(), ['t1', 't2'])
  assert.equal(existsSync(join(one.home, `${KEYS_FILE}.lock`)), false, 'the lock is let go')
})

test('a lock whose holder is gone, or that is too old, is taken over', async (t) => {
  const omni = fakeOmni()
  const { rt, home } = runtime(t, { link: linked(omni.linkKey()) })
  const lockFile = join(home, `${KEYS_FILE}.lock`)
  writeFileSync(lockFile, JSON.stringify({ pid: 2 ** 22 + 7, token: 'gone', at: Date.now() }))
  assert.equal((await rt.threadKeys.mint('t1', CHAT)).ok, true)
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, token: 'old', at: Date.now() - 3 * 60_000 }))
  assert.equal((await rt.threadKeys.mint('t2', OWN_CHAT)).ok, true)
  // A live, fresh one is waited for.
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, token: 'live', at: Date.now() }))
  let done = false
  const minting = rt.threadKeys.revoke('t1').then((answer) => { done = true; return answer })
  await delay(60)
  assert.equal(done, false)
  rmSync(lockFile)
  assert.deepEqual(await minting, { cut: true })
})

test('an Omni that does not answer is asked once per drain, and a drain still running skips the next tick', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const children = [CHAT, OWN_CHAT, CHAT].map(chatId => omni.addChild('omni.example.com', { parentId: parent.id, chatId }))
  const keysFile = {
    version: 1,
    threads: Object.fromEntries(children.map((child, index) => [`t${index}`, { childId: child.id, key: child.text, chatId: child.chatId, origin: OMNI, parentKeyId: parent.id, pending: { since: 1 } }])),
    retired: [],
    waiting: { w: { chatId: CHAT, origin: OMNI, reason: 'x' } },
  }
  let release
  omni.gate = new Promise((resolve) => { release = resolve })
  omni.down = true
  const drainTimers = watchTimers(t)
  const { rt, file } = runtime(t, { link: linked(parent), keysFile })
  const [timer] = drainTimers()
  await delay(10)
  timer.run()
  timer.run()
  await delay(10)
  assert.equal(omni.asked.length, 1, 'the start drain waits on its first request; the ticks add none')
  release()
  omni.gate = null
  await delay(30)
  // The first unanswered request ends the pass: no other entry, and no mint, asked.
  assert.equal(omni.asked.length, 1)
  assert.equal(Object.keys(file().threads).length, 3)
  omni.down = false
  await rt.threadKeys.drain()
  // Answering again: the cuts drain, and the keyless thread gets its key.
  assert.deepEqual(Object.keys(file().threads), ['w'])
  assert.equal(file().threads.w.pending, null)
})

test('a mint answer that is not for the chat asked is not kept, and its key cuts itself', async (t) => {
  const omni = fakeOmni()
  const { rt, home } = runtime(t, { link: linked(omni.linkKey()) })
  omni.tamper = data => ({ ...data, chatId: OWN_CHAT })
  assert.equal((await rt.threadKeys.mint('t1', CHAT)).ok, false)
  omni.tamper = ({ id, ...rest }) => rest
  assert.equal((await rt.threadKeys.mint('t1', CHAT)).ok, false)
  assert.equal(omni.children().length, 2)
  assert.deepEqual(omni.liveChildren(), [])
  assert.equal(existsSync(join(home, KEYS_FILE)), false)
})

test('the key file is rewritten 0600 whatever it was, and a failed write leaves no temp file and no live key', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const loose = runtime(t, { link: linked(parent) })
  writeFileSync(join(loose.home, KEYS_FILE), JSON.stringify({ version: 1, threads: {}, retired: [] }), { mode: 0o644 })
  assert.equal(statSync(join(loose.home, KEYS_FILE)).mode & 0o777, 0o644)
  await loose.rt.threadKeys.mint('t1', CHAT)
  assert.equal(statSync(join(loose.home, KEYS_FILE)).mode & 0o777, 0o600)

  // The file's place is taken by a folder: the rename fails.
  const blocked = runtime(t, { link: linked(parent) })
  mkdirSync(join(blocked.home, KEYS_FILE, 'x'), { recursive: true })
  const minted = await blocked.rt.threadKeys.mint('t2', OWN_CHAT)
  assert.deepEqual(minted, { ok: false, reason: 'This app could not keep the chat key.' })
  assert.deepEqual(readdirSync(blocked.home).filter(name => name.endsWith('.tmp')), [])
  assert.equal(omni.children().filter(child => child.chatId === OWN_CHAT && !child.revoked).length, 0)
})

test('the same Omni is the same API address, path included', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const child = omni.addChild('omni.example.com', { parentId: parent.id, chatId: CHAT })
  const { rt } = runtime(t, {
    link: { ...linked(parent), url: `${OMNI}/a` },
    keysFile: { version: 1, threads: { t1: { childId: child.id, key: child.text, chatId: CHAT, origin: `${OMNI}/b`, parentKeyId: parent.id, pending: null } }, retired: [] },
  })
  assert.equal(rt.threadKeys.keyFor('t1'), null)
  assert.equal(rt.threadKeys.reasonOf('t1'), OTHER_OMNI)
})

test('Omni\'s refusal never carries the link key into the reason', async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  const { rt } = runtime(t, { link: linked(parent) })
  omni.refuseWith = key => `key ${key} may not mint`
  const minted = await rt.threadKeys.mint('t1', CHAT)
  assert.equal(minted.ok, false)
  assert.ok(!minted.reason.includes(parent.text))
  assert.match(minted.reason, /may not mint/)
})

// Review fixes (Group 6 review 2): the lock.
const lockOf = home => join(home, `${KEYS_FILE}.lock`)
const holderIn = home => JSON.parse(readFileSync(lockOf(home), 'utf8'))

test('a lock file with no holder in it is taken over once it is old, not before', { timeout: 10_000 }, async (t) => {
  const omni = fakeOmni()
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const { rt, home } = runtime(t, { link: linked(omni.linkKey()) })
  writeFileSync(lockOf(home), '')
  let done = false
  const minting = rt.threadKeys.mint('t1', CHAT).then((answer) => { done = true; return answer })
  await delay(60)
  assert.equal(done, false, 'a fresh empty lock may be one being made')
  t.mock.timers.tick(11_000)
  const answer = await Promise.race([minting, delay(3000).then(() => 'still waiting')])
  // Let a stuck one go, so the plugin can stop.
  if (answer === 'still waiting') rmSync(lockOf(home), { force: true })
  assert.notEqual(answer, 'still waiting')
  assert.equal(answer.ok, true)
  assert.equal(existsSync(lockOf(home)), false)
})

test('a holder that cannot write itself into the lock leaves no lock behind, and the mint says why', { timeout: 10_000 }, async (t) => {
  const omni = fakeOmni()
  const { rt, home } = runtime(t, { link: linked(omni.linkKey()) })
  const probe = await openFile(join(home, 'probe'), 'w')
  const FileHandle = Object.getPrototypeOf(probe)
  await probe.close()
  const realWrite = FileHandle.writeFile
  FileHandle.writeFile = async function () { throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }) }
  t.after(() => { FileHandle.writeFile = realWrite })
  assert.deepEqual(await rt.threadKeys.mint('t1', CHAT), { ok: false, reason: 'This app could not keep the chat key.' })
  FileHandle.writeFile = realWrite
  assert.equal(existsSync(lockOf(home)), false)
  assert.equal((await rt.threadKeys.mint('t1', CHAT)).ok, true)
})

test('a live holder renews its lock, so a long hand-over is not taken over', { timeout: 10_000 }, async (t) => {
  const omni = fakeOmni()
  const parent = omni.linkKey()
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.now() })
  const one = runtime(t, { link: linked(parent) })
  const two = runtime(t, { home: one.home })
  let release
  omni.gate = new Promise((resolve) => { release = resolve })
  const first = one.rt.threadKeys.mint('t1', CHAT)
  for (let waited = 0; waited < 1000 && !existsSync(lockOf(one.home)); waited += 5) await delay(5)
  const { token } = holderIn(one.home)
  // Three minutes of a slow Omni, renewed every 30 s.
  for (let beat = 0; beat < 6; beat += 1) {
    t.mock.timers.tick(30_000)
    await delay(15)
  }
  assert.equal(holderIn(one.home).token, token)
  assert.ok(Date.now() - holderIn(one.home).at < 60_000, 'renewed')
  let done = false
  const second = two.rt.threadKeys.mint('t2', OWN_CHAT).then((answer) => { done = true; return answer })
  await delay(80)
  assert.equal(done, false, 'not taken over')
  omni.gate = null
  release()
  assert.equal((await first).ok, true)
  assert.equal((await second).ok, true)
  assert.deepEqual(Object.keys(one.file().threads).sort(), ['t1', 't2'])
})

test('letting go of a lock never removes another holder\'s', { timeout: 10_000 }, async (t) => {
  const omni = fakeOmni()
  const { rt, home } = runtime(t, { link: linked(omni.linkKey()) })
  let release
  omni.gate = new Promise((resolve) => { release = resolve })
  const minting = rt.threadKeys.mint('t1', CHAT)
  for (let waited = 0; waited < 1000 && !existsSync(lockOf(home)); waited += 5) await delay(5)
  // Taken over meanwhile (this one looked gone to another host).
  const other = JSON.stringify({ pid: process.pid, token: 'other', at: Date.now() })
  writeFileSync(lockOf(home), other)
  omni.gate = null
  release()
  assert.equal((await minting).ok, true)
  assert.equal(readFileSync(lockOf(home), 'utf8'), other)
  rmSync(lockOf(home))
})

test('on a home this host cannot write, a mint answers with the reason', { timeout: 10_000 }, async (t) => {
  const omni = fakeOmni()
  const { rt, home } = runtime(t, { link: linked(omni.linkKey()) })
  chmodSync(home, 0o500)
  try {
    assert.deepEqual(await rt.threadKeys.mint('t1', CHAT), { ok: false, reason: 'This app could not keep the chat key.' })
    assert.equal(omni.asked.length, 0, 'nothing minted')
  } finally {
    chmodSync(home, 0o700)
  }
})
