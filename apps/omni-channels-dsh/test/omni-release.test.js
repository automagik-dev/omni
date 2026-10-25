import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DEFAULT_REGISTRY, forgetReleases, installRelease, pickRelease, registryOf } from '../src/host/omni-release.js'
import { minimumOf, newer, OMNI_MINIMUM, PLUGIN_VERSION } from '../src/host/version.js'

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('the minimum is what engines.omni declares, a release no newer than the plugin', () => {
  assert.equal(OMNI_MINIMUM, minimumOf(PKG.engines.omni))
  assert.match(OMNI_MINIMUM, /^\d+\.\d{6}\.\d+$/)
  assert.equal(newer(OMNI_MINIMUM, PLUGIN_VERSION), false)
  assert.equal(minimumOf('>=2.261025.2 <3'), '2.261025.2')
  assert.equal(minimumOf('^2.261025.2'), null)
})

test('a new Omni is the newest release that meets the minimum: latest, else next, else the plugin\'s own', () => {
  const at = { minimum: '2.261025.2', fallback: '2.261025.2' }
  assert.deepEqual(pickRelease({ latest: '2.261030.1', next: '2.261031.4' }, at), { version: '2.261030.1', from: 'latest' })
  // The minimum is newer than stable (a plugin from a dev market): the dev channel's.
  assert.deepEqual(pickRelease({ latest: '2.261024.6', next: '2.261031.4' }, at), { version: '2.261031.4', from: 'next' })
  // Exactly the minimum meets it.
  assert.deepEqual(pickRelease({ latest: '2.261025.2' }, at), { version: '2.261025.2', from: 'latest' })
  // Nothing meets it, or nothing answered: the plugin's own version, an Omni release.
  assert.deepEqual(pickRelease({ latest: '2.261024.6', next: '2.261025.1' }, at), { version: '2.261025.2', from: 'plugin' })
  assert.deepEqual(pickRelease(null, at), { version: '2.261025.2', from: 'plugin' })
  // Never below the minimum, even when the plugin's own version is (a pending minimum).
  assert.deepEqual(pickRelease(null, { minimum: '2.261026.1', fallback: '2.261025.2' }), { version: '2.261026.1', from: 'plugin' })
})

test('only an exact release version is taken from the registry, never a range, tag or prerelease', () => {
  const at = { minimum: '2.261025.2', fallback: '2.261025.2' }
  for (const latest of ['latest', '>=2.261025.2', '2.261030.1-rc.1', '2.261030.1; rm -rf /', '9'.repeat(80), 42])
    assert.deepEqual(pickRelease({ latest }, at), { version: '2.261025.2', from: 'plugin' }, String(latest))
  assert.deepEqual(pickRelease({ latest: 'nope', next: '2.261030.1' }, at), { version: '2.261030.1', from: 'next' })
})

test('the registry is the one `bun x` installs from, when it is an https URL without credentials', () => {
  assert.equal(registryOf({}), DEFAULT_REGISTRY)
  assert.equal(registryOf({ BUN_CONFIG_REGISTRY: 'https://npm.example.com/r' }), 'https://npm.example.com/r/')
  assert.equal(registryOf({ npm_config_registry: 'https://npm.example.com/' }), 'https://npm.example.com/')
  assert.equal(registryOf({ NPM_CONFIG_REGISTRY: 'http://npm.example.com/' }), DEFAULT_REGISTRY)
  assert.equal(registryOf({ NPM_CONFIG_REGISTRY: 'https://user:secret@npm.example.com/' }), DEFAULT_REGISTRY)
})

test('installRelease reads the dist-tags once, remembers an answer, and asks again after none', async () => {
  forgetReleases()
  const asked = []
  let up = false
  const fetchImpl = async (url) => {
    asked.push(String(url))
    if (!up) throw new TypeError('fetch failed')
    return new Response(JSON.stringify({ latest: '2.999999.1', next: '2.999999.2' }))
  }
  let now = 0
  const clock = () => now
  assert.deepEqual(await installRelease({ fetchImpl, env: {}, now: clock }), { version: newer(OMNI_MINIMUM, PLUGIN_VERSION) ? OMNI_MINIMUM : PLUGIN_VERSION, from: 'plugin' })
  up = true
  assert.deepEqual(await installRelease({ fetchImpl, env: {}, now: clock }), { version: '2.999999.1', from: 'latest' })
  assert.deepEqual(await installRelease({ fetchImpl, env: {}, now: clock }), { version: '2.999999.1', from: 'latest' })
  assert.deepEqual(asked, Array(2).fill('https://registry.npmjs.org/-/package/@automagik%2fomni/dist-tags'))
  now += 11 * 60_000
  await installRelease({ fetchImpl, env: {}, now: clock })
  assert.equal(asked.length, 3)
  forgetReleases()
})

test('a registry that answers with an error or too much is no answer', async () => {
  forgetReleases()
  assert.equal((await installRelease({ fetchImpl: async () => new Response('', { status: 503 }), env: {} })).from, 'plugin')
  assert.equal((await installRelease({ fetchImpl: async () => new Response(`{"latest":"2.999999.1","x":"${'a'.repeat(70_000)}"}`), env: {} })).from, 'plugin')
  assert.equal((await installRelease({ fetchImpl: async () => new Response('not json'), env: {} })).from, 'plugin')
  forgetReleases()
})
