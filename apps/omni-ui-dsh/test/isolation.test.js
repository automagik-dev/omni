// Installed into someone's own DSH, Omni keeps its files in $OMNI_HOME/ui and writes
// nothing under DSH_HOME (DSH's own Sessions and workspaces are DSH's business, and the
// fake context keeps those in memory).
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'

const filesUnder = (dir) => {
  const out = []
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path)
      else out.push(relative(dir, path))
    }
  }
  if (existsSync(dir)) walk(dir)
  return out.sort()
}

function start(config = {}) {
  const root = mkdtempSync(join(tmpdir(), 'omni-isolation-'))
  const dshHome = join(root, 'dsh')
  const omniHome = join(root, 'omni')
  mkdirSync(dshHome)
  const saved = { DSH_HOME: process.env.DSH_HOME, OMNI_HOME: process.env.OMNI_HOME }
  process.env.DSH_HOME = dshHome
  process.env.OMNI_HOME = omniHome
  const ctx = fakeContext()
  const rt = createRuntime(ctx, config)
  const stop = async () => {
    await ctx.dispose()
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 5 })
  }
  return { root, dshHome, omniHome, rt, stop }
}

test('with no home configured, the team lives in $OMNI_HOME/ui and nothing lands under DSH_HOME', async (t) => {
  const { dshHome, omniHome, rt, stop } = start()
  t.after(stop)
  assert.equal(rt.home, join(omniHome, 'ui'))
  await rt.load()
  rt.state.prefs.quiet = true
  await rt.save()
  assert.deepEqual(filesUnder(join(omniHome, 'ui')).filter(name => name.startsWith('state.')), ['state.json', 'state.lock'])
  assert.deepEqual(filesUnder(dshHome), [])
})

test('a team kept under ~/.dsh/bot before is copied in only when asked, and left where it was', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-import-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const old = join(root, 'old-bot')
  mkdirSync(old)
  const team = JSON.stringify({ version: 1, mainBotIds: [], bots: {}, rooms: {}, agents: {}, exchanges: [], revision: 7 })
  writeFileSync(join(old, 'state.json'), team)
  writeFileSync(join(old, 'state.lock'), '{"pid":1}')

  const plain = start()
  t.after(plain.stop)
  assert.equal(existsSync(join(plain.omniHome, 'ui', 'state.json')), false)

  const asked = start({ importHome: old })
  t.after(asked.stop)
  assert.equal(existsSync(join(asked.omniHome, 'ui', 'state.json')), true)
  assert.equal(filesUnder(old).join(','), 'state.json,state.lock')
})
