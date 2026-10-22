import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { compareVersions, feedFileOf, feedOverride, pickUpdate, startUpdates, updatesEnabled } from '../src/update.js'

const release = (tag, assets = ['latest-mac.yml', 'latest-linux.yml'], extra = {}) => ({ tag_name: tag, draft: false, assets: assets.map(name => ({ name })), ...extra })

test('versions compare by semver: a dev cut is newer than the labs build of the version before it', () => {
  assert.equal(compareVersions('2.261022.1', '2.261019.10-labs.14'), 1)
  assert.equal(compareVersions('2.261019.10', '2.261019.10-labs.14'), 1)
  assert.equal(compareVersions('2.261019.10-labs.14', '2.261019.10-labs.9'), 1)
  assert.equal(compareVersions('2.261019.9', '2.261019.10'), -1)
  assert.equal(compareVersions('2.261019.10', '2.261019.10'), 0)
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1)
  assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1)
  assert.ok(Number.isNaN(compareVersions('v2', '2.0.0')))
})

test("the update is the newest desktop release above this one with this platform's feed; Omni's own releases are not", () => {
  const releases = [
    release('v2.261030.1'),
    release('omni-desktop-v2.261025.1', ['latest-linux.yml']),
    release('omni-desktop-v2.261024.2', ['latest-mac.yml', 'latest-linux.yml'], { draft: true }),
    release('omni-desktop-v2.261023.1'),
    release('omni-desktop-v2.261022.1'),
    release('omni-desktop-v2.261019.1'),
    { tag_name: 7 },
    null,
  ]
  assert.deepEqual(pickUpdate(releases, { current: '2.261019.10-labs.14', platform: 'darwin' }), {
    version: '2.261023.1',
    url: 'https://github.com/automagik-dev/omni/releases/download/omni-desktop-v2.261023.1/',
  })
  assert.equal(pickUpdate(releases, { current: '2.261019.10-labs.14', platform: 'linux' }).version, '2.261025.1')
  assert.equal(pickUpdate(releases, { current: '2.261025.1', platform: 'linux' }), null)
  assert.equal(pickUpdate(releases, { current: '2.261019.10', platform: 'win32' }), null)
  assert.equal(pickUpdate({ message: 'rate limited' }, { current: '2.261019.10', platform: 'darwin' }), null)
})

test('only a packaged build updates itself: on macOS, or from an AppImage; OMNI_DESKTOP_UPDATES=off turns it off', () => {
  assert.equal(updatesEnabled({ packaged: true, platform: 'darwin', env: {} }), true)
  assert.equal(updatesEnabled({ packaged: true, platform: 'darwin', env: { OMNI_DESKTOP_UPDATES: 'off' } }), false)
  assert.equal(updatesEnabled({ packaged: false, platform: 'darwin', env: {} }), false)
  assert.equal(updatesEnabled({ packaged: true, platform: 'linux', env: { APPIMAGE: '/home/u/Omni.AppImage' } }), true)
  assert.equal(updatesEnabled({ packaged: true, platform: 'linux', env: {} }), false)
  assert.equal(updatesEnabled({ packaged: true, platform: 'win32', env: {} }), false)
  assert.equal(feedFileOf('darwin'), 'latest-mac.yml')
  assert.equal(feedFileOf('linux'), 'latest-linux.yml')
})

test('a feed override is https, or http on loopback only', () => {
  assert.equal(feedOverride({ OMNI_DESKTOP_UPDATE_FEED: 'https://example.com/feed' }), 'https://example.com/feed/')
  assert.equal(feedOverride({ OMNI_DESKTOP_UPDATE_FEED: 'http://127.0.0.1:8099/' }), 'http://127.0.0.1:8099/')
  assert.equal(feedOverride({ OMNI_DESKTOP_UPDATE_FEED: 'http://example.com/feed' }), null)
  assert.equal(feedOverride({ OMNI_DESKTOP_UPDATE_FEED: 'file:///tmp/feed' }), null)
  assert.equal(feedOverride({ OMNI_DESKTOP_UPDATE_FEED: 'not a url' }), null)
  assert.equal(feedOverride({}), null)
})

function fakeUpdater() {
  const updater = new EventEmitter()
  updater.feeds = []
  updater.installs = []
  updater.setFeedURL = feed => updater.feeds.push(feed)
  updater.checkForUpdates = async () => ({ checked: true })
  updater.quitAndInstall = (...args) => updater.installs.push(args)
  return updater
}
const quiet = { info() {}, warn() {}, error() {}, debug() {} }
const noTimers = { setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {} }

test('a check points electron-updater at the chosen release, reports the download, and installs only once it is ready', async () => {
  const updater = fakeUpdater()
  const states = []
  const updates = startUpdates({
    updater, current: '2.261019.10-labs.14', platform: 'darwin', env: {}, log: quiet, timers: noTimers,
    onState: state => states.push(state),
    releases: async () => [release('omni-desktop-v2.261022.1')],
  })
  assert.equal(updater.autoDownload, true)
  assert.equal(updater.allowDowngrade, false)
  updates.install()
  assert.deepEqual(updater.installs, [])
  assert.deepEqual(await updates.check(), { checked: true })
  assert.deepEqual(updater.feeds, [{ provider: 'generic', url: 'https://github.com/automagik-dev/omni/releases/download/omni-desktop-v2.261022.1/' }])
  updater.emit('download-progress', { percent: 41.6 })
  updater.emit('update-downloaded', { version: '2.261022.1' })
  assert.deepEqual(states, [{ version: '2.261022.1', state: 'downloading', percent: 42 }, { version: '2.261022.1', state: 'ready' }])
  assert.equal(updates.ready, '2.261022.1')
  assert.equal(await updates.check(), null)
  updates.install()
  assert.deepEqual(updater.installs, [[false, true]])
})

test('on macOS the update is ready only once Squirrel has it, since quitting earlier would not install it', async () => {
  const updater = fakeUpdater()
  updater.nativeUpdater = new EventEmitter()
  const states = []
  const updates = startUpdates({
    updater, current: '2.261019.10-labs.14', platform: 'darwin', env: {}, log: quiet, timers: noTimers,
    onState: state => states.push(state),
    releases: async () => [release('omni-desktop-v2.261022.1')],
  })
  await updates.check()
  updater.emit('update-downloaded', { version: '2.261022.1' })
  assert.equal(updates.ready, null)
  updates.install()
  assert.deepEqual(updater.installs, [])
  updater.nativeUpdater.emit('update-downloaded')
  assert.equal(updates.ready, '2.261022.1')
  assert.deepEqual(states.at(-2), { version: '2.261022.1', state: 'downloading', percent: 100 })
  assert.deepEqual(states.at(-1), { version: '2.261022.1', state: 'ready' })
})

test('no newer release, or GitHub failing, is a quiet no-op', async () => {
  const updater = fakeUpdater()
  const warnings = []
  const log = { ...quiet, warn: message => warnings.push(message) }
  const none = startUpdates({ updater, current: '2.261022.1', platform: 'linux', env: {}, log, timers: noTimers, onState() {}, releases: async () => [release('omni-desktop-v2.261022.1')] })
  assert.equal(await none.check(), null)
  const down = startUpdates({ updater, current: '2.261022.1', platform: 'linux', env: {}, log, timers: noTimers, onState() {}, releases: async () => { throw new Error('offline') } })
  assert.equal(await down.check(), null)
  assert.deepEqual(updater.feeds, [])
  assert.deepEqual(warnings, ['update check: offline'])
})
