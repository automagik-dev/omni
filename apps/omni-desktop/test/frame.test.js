import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BAR_HEIGHT, pageLayout, RADIUS, WINDOW_ACTIONS, windowChrome } from '../src/frame.js'

test('no system frame on either platform: a transparent frameless window on Linux, a hidden title bar on macOS', () => {
  assert.deepEqual(
    { frame: windowChrome('linux').frame, transparent: windowChrome('linux').transparent, menu: windowChrome('linux').autoHideMenuBar },
    { frame: false, transparent: true, menu: true },
  )
  assert.equal(windowChrome('darwin').titleBarStyle, 'hiddenInset')
  assert.equal(windowChrome('darwin').frame, undefined)
})

test("Omni's page fills the window below the bar, with no border; its corners round with the window on Linux", () => {
  const size = { width: 1360, height: 860 }
  const page = { x: 0, y: BAR_HEIGHT, width: 1360, height: 860 - BAR_HEIGHT }
  assert.deepEqual(pageLayout(size, { platform: 'linux', maximized: false }), { bounds: page, radius: RADIUS })
  assert.deepEqual(pageLayout(size, { platform: 'linux', maximized: true }), { bounds: page, radius: 0 })
  assert.equal(pageLayout(size, { platform: 'darwin', maximized: false }).radius, 0)
  assert.equal(pageLayout({ width: 4, height: 10 }, { platform: 'linux', maximized: false }).bounds.height, 0)
})

test("the frame page can ask for the three window buttons and the update's restart, and nothing else", () => {
  assert.deepEqual([...WINDOW_ACTIONS].sort(), ['close', 'maximize', 'minimize', 'update'])
})
