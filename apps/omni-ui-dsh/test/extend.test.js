import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import { install } from '../src/host/extend.js'
import { fakeContext } from './fake-ctx.js'

function start() {
  const home = mkdtempSync(join(tmpdir(), 'omni-extend-'))
  // A saved team, so the state answer needs no Session services.
  writeFileSync(join(home, 'state.json'), JSON.stringify({ version: 1, mainBotIds: ['m1'], revision: 1, bots: { m1: { id: 'm1', name: 'Omni', role: 'Channel orchestrator', instructions: '', createdAt: 1 } }, rooms: {}, exchanges: [], exchangeTurns: {}, questions: {} }))
  const ctx = fakeContext()
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => {
    route = options
    return register(options)
  }
  apply(ctx, { home })
  const call = async (endpoint, payload) => (await route.fetch(new Request('http://localhost/api/omni-ui', { method: 'POST', body: JSON.stringify({ endpoint, payload }) }))).json()
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { rt: ctx.provided.get('omniTeam'), call, stop }
}

test('apply provides the runtime as omniTeam, with the hooks other Omni plugins add through', async (t) => {
  const { rt, stop } = start()
  t.after(stop)
  assert.deepEqual(Object.keys(rt.hooks).sort(), ['endpoint', 'live', 'mainRules', 'view'])
  for (const name of ['load', 'save', 'botOf', 'isMain', 'selfOf', 'createTaskSession', 'deliver', 'resolveAgent', 'home']) assert.ok(name in rt, name)
})

test('an added endpoint is served until its disposer runs, and the view and live answers carry added fields', async (t) => {
  const { rt, call, stop } = start()
  t.after(stop)
  const asked = []
  const off = rt.hooks.endpoint('hello', (body) => { asked.push(body); return { hi: body.name } })
  const offView = rt.hooks.view(() => ({ extra: 1 }))
  const offLive = rt.hooks.live(() => ({ pulse: 2 }))
  assert.deepEqual(await call('hello', { name: 'Ana' }), { ok: true, value: { hi: 'Ana' } })
  const state = (await call('state')).value
  assert.equal(state.extra, 1)
  assert.equal(state.pulse, 2)
  assert.throws(() => rt.hooks.endpoint('hello', () => null), /already served/)
  off()
  offView()
  offLive()
  assert.equal((await call('hello', {})).error.code, 'bot/not-found')
  const after = (await call('state')).value
  assert.equal('extra' in after, false)
  assert.equal('pulse' in after, false)
  assert.deepEqual(asked, [{ name: 'Ana' }])
})

test('an added endpoint says whether a host that only reads the team may answer it', () => {
  const rt = { warn() {} }
  install(rt)
  rt.hooks.endpoint('reads', () => 1, { read: true })
  rt.hooks.endpoint('writes', () => 2)
  assert.equal(rt.extended.endpointOf('reads').read, true)
  assert.equal(rt.extended.endpointOf('writes').read, false)
  assert.equal(rt.extended.endpointOf('toString'), undefined)
})

test('Main Bot rules come in their order, and a hook with nothing to add is left out', () => {
  const rt = {}
  install(rt)
  const offLate = rt.hooks.mainRules(() => 'late', { order: 200 })
  rt.hooks.mainRules(self => `early for ${self}`, { order: 100 })
  rt.hooks.mainRules(() => null, { order: 150 })
  assert.deepEqual(rt.extended.rules('m1'), ['early for m1', 'late'])
  offLate()
  assert.deepEqual(rt.extended.rules('m1'), ['early for m1'])
  // A failing view hook leaves its own fields out, not the answer.
  const warned = []
  const viewed = { warn: (...args) => warned.push(args) }
  install(viewed)
  viewed.hooks.view(() => { throw new Error('boom') })
  viewed.hooks.view(() => ({ ok: true }))
  assert.deepEqual(viewed.extended.view(), { ok: true })
  assert.equal(warned.length, 1)
})

test('a team linked to an Omni without the channels plugin learns that channels moved', async (t) => {
  const { rt, call, stop } = start()
  t.after(stop)
  assert.equal((await call('state')).value.channelsMoved, false)
  writeFileSync(join(rt.home, 'omni.json'), '{}')
  assert.equal((await call('state')).value.channelsMoved, true)
})

test('a Main Bot rule that throws is left out, and the other rules still come', () => {
  const warned = []
  const rt = { warn: (...args) => warned.push(args) }
  install(rt)
  rt.hooks.mainRules(() => 'first', { order: 1 })
  rt.hooks.mainRules(() => { throw new Error('broken plugin') }, { order: 2 })
  rt.hooks.mainRules(() => 'third', { order: 3 })
  assert.deepEqual(rt.extended.rules({}), ['first', 'third'])
  assert.equal(warned.length, 1)
})
