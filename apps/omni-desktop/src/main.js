// Omni desktop: one window on a DeepSeek Harness of the app's own (see dsh.js for where it
// keeps things). The window opens at once on its own frame (frame.js, shell.html) with the
// octopus waking up; the main process starts dsh on a loopback port, waits for the launch
// URL with dsh's per-launch token, and lays dsh's page into the frame; quitting stops dsh.
// Both pages are plain browser pages with no Node in them: context isolation and the
// renderer sandbox are on, dsh's page can navigate only within dsh's origin, web links open
// in the system browser, and the frame page never navigates.
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, WebContentsView } from 'electron'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appHome, dshEnv, freePort, installProfile, navigationOf, resourcesOf, startDsh, stopDsh, writeTools } from './dsh.js'
import { pageLayout, WINDOW_ACTIONS, windowChrome } from './frame.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const home = appHome()
let dsh = null
// dsh's process from the moment it is spawned: a quit before it is ready still stops it.
let dshChild = null
let window = null
let page = null
let quitting = false
let ready = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  app.whenReady().then(launch).catch(fail)
}

// app.exit skips before-quit, so dsh is stopped here: a start that fails after dsh came up
// must not leave it running on loopback with no window.
function fail(error) {
  quitting = true
  sendState({ status: 'Omni could not start.', problem: true })
  dialog.showErrorBox('Omni could not start', `${error?.message ?? error}\n\nLog: ${join(home, 'logs', 'dsh.log')}`)
  void stopDsh(dshChild).finally(() => app.exit(1))
}

async function launch() {
  // No menu bar on Linux; macOS keeps its app menu for the usual shortcuts.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  openWindow()
  mkdirSync(join(home, 'logs'), { recursive: true })
  const resources = resourcesOf({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() })
  installProfile({ dshHome: join(home, 'dsh'), source: resources.profile })
  const port = await freePort()
  const log = createWriteStream(join(home, 'logs', 'dsh.log'), { flags: 'a' })
  // Electron's own binary runs dsh as Node, so the app ships one runtime.
  const binDir = writeTools({ dir: join(home, 'bin'), node: process.execPath, pnpm: resources.pnpm })
  dsh = await startDsh({ node: process.execPath, bin: resources.bin, env: dshEnv({ home, electronAsNode: true, binDir }), port, cwd: home, log, onSpawn: (child) => { dshChild = child } })
  dsh.child.once('exit', (code) => {
    if (!quitting) fail(new Error(`dsh stopped (${code}).`))
  })
  const origin = new URL(dsh.url).origin
  harden(origin)
  if (!window) return
  page = new WebContentsView({
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true,
    },
  })
  page.setBackgroundColor('#060914')
  page.webContents.on('before-input-event', (event, input) => shortcut(event, input))
  page.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    if (mainFrame && code !== -3) sendState({ status: `Omni could not load (${description}).`, problem: true })
  })
  // Laid in once painted, so the frame's octopus stays up until there is something to show.
  page.webContents.once('did-finish-load', () => {
    if (!window) return
    window.contentView.addChildView(page)
    ready = true
    layout()
  })
  await page.webContents.loadURL(dsh.url)
}

const WINDOW_PREFERENCES = {
  preload: join(HERE, 'shell-preload.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webviewTag: false,
  spellcheck: false,
}

function openWindow() {
  window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    title: 'Omni',
    show: false,
    ...windowChrome(process.platform),
    webPreferences: WINDOW_PREFERENCES,
  })
  const frame = window.webContents
  frame.setWindowOpenHandler(() => ({ action: 'deny' }))
  frame.on('will-navigate', event => event.preventDefault())
  frame.on('before-input-event', (event, input) => shortcut(event, input))
  frame.once('did-finish-load', () => sendState())
  window.once('ready-to-show', () => window.show())
  for (const change of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) window.on(change, layout)
  window.on('closed', () => { window = null; page = null })
  void window.loadFile(join(HERE, 'shell.html'))
}

// Omni's page goes below the frame's title bar; see frame.js.
function layout() {
  if (!window) return
  const maximized = window.isMaximized() || window.isFullScreen()
  if (page && ready) {
    const { bounds, radius } = pageLayout(window.getContentBounds(), { platform: process.platform, maximized })
    page.setBounds(bounds)
    page.setBorderRadius(radius)
  }
  sendState()
}

function sendState(extra = {}) {
  if (!window || window.webContents.isLoading()) return
  const maximized = window.isMaximized() || window.isFullScreen()
  window.webContents.send('omni-window-state', { maximized, ready, ...extra })
}

ipcMain.on('omni-window', (event, action) => {
  if (!window || event.sender !== window.webContents || !WINDOW_ACTIONS.has(action)) return
  if (action === 'minimize') window.minimize()
  else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize()
  else window.close()
})

// Without a menu on Linux, the few shortcuts a window is expected to have.
function shortcut(event, input) {
  if (input.type !== 'keyDown' || process.platform === 'darwin') return
  const key = input.key.toLowerCase()
  const zoom = page?.webContents
  if (input.control && key === 'q') app.quit()
  else if (input.key === 'F11') window?.setFullScreen(!window.isFullScreen())
  else if (input.control && (key === '=' || key === '+') && zoom) zoom.setZoomLevel(zoom.getZoomLevel() + 0.5)
  else if (input.control && key === '-' && zoom) zoom.setZoomLevel(zoom.getZoomLevel() - 0.5)
  else if (input.control && key === '0' && zoom) zoom.setZoomLevel(0)
  else return
  event.preventDefault()
}

function harden(origin) {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (navigationOf(url, origin) === 'external') void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      const verdict = navigationOf(url, origin)
      if (verdict === 'allow') return
      event.preventDefault()
      if (verdict === 'external') void shell.openExternal(url)
    })
    // A server redirect is a navigation too.
    contents.on('will-redirect', (event, url) => {
      if (navigationOf(url, origin) !== 'allow') event.preventDefault()
    })
    contents.on('will-attach-webview', event => event.preventDefault())
  })
  // The page asks for nothing beyond notifications and the clipboard.
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(new URL(contents.getURL()).origin === origin && ['notifications', 'clipboard-sanitized-write', 'clipboard-read'].includes(permission))
  })
}

app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
  if (quitting || !dshChild) return
  quitting = true
  event.preventDefault()
  void stopDsh(dshChild).finally(() => app.quit())
})
