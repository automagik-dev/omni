import test from 'node:test'
import assert from 'node:assert/strict'
import { sameVersion, showsDshRow } from '../src/client/dsh-offer.js'

const npm = (verified, current = '0.2.0-rc.2') => ({ kind: 'npm', verified, current })
const app = (verified, current = '0.2.0-rc.2') => ({ kind: 'app', verified, current })

test('an npm DSH shows the row while the verified version differs from the running one', () => {
  assert.equal(showsDshRow(npm('0.2.1-alpha.1')), true)
  assert.equal(showsDshRow(npm('0.2.0-rc.2')), false)
  assert.equal(showsDshRow(npm(null)), false)
  assert.equal(showsDshRow({ ...npm('0.2.1-alpha.1'), current: null }), false)
})

test('a packaged app shows the row only when its own updater found the verified version', () => {
  const dsh = app('0.2.1-alpha.1')
  assert.equal(showsDshRow(dsh, undefined), false)
  assert.equal(showsDshRow(dsh, { phase: 'idle' }), false)
  assert.equal(showsDshRow(dsh, { phase: 'available', version: '0.2.1-alpha.2' }), false)
  assert.equal(showsDshRow(dsh, { phase: 'available', version: '0.2.1-alpha.1' }), true)
  assert.equal(showsDshRow(dsh, { phase: 'downloading', version: 'v0.2.1-alpha.1' }), true)
  assert.equal(showsDshRow(dsh, { phase: 'error', version: '0.2.1-alpha.1' }), false)
})

test('a packaged app without a verified version shows nothing, whatever its updater found', () => {
  assert.equal(showsDshRow(app(null), { phase: 'available', version: '0.2.1-alpha.2' }), false)
})

test('sameVersion ignores a leading v and build metadata, and never matches an empty version', () => {
  assert.equal(sameVersion('v0.2.1', '0.2.1+build.7'), true)
  assert.equal(sameVersion('0.2.1-alpha.1', '0.2.1-alpha.2'), false)
  assert.equal(sameVersion(undefined, ''), false)
})
