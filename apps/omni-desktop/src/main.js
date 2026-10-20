// Omni desktop: one window on a DeepSeek Harness of the app's own (see dsh.js for where it
// keeps things). The main process starts dsh on a loopback port, waits for the launch URL
// with dsh's per-launch token, and opens it; quitting stops dsh. The window is a plain
// browser page with no Node in it: context isolation and the renderer sandbox are on, and
// it can navigate only within dsh's origin; web links open in the system browser.
import { app, BrowserWindow, dialog, session, shell } from 'electron'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appHome, dshEnv, freePort, installProfile, navigationOf, resourcesOf, startDsh, stopDsh } from './dsh.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const home = appHome()
let dsh = null
let window = null
let quitting = false

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

function fail(error) {
  dialog.showErrorBox('Omni could not start', `${error?.message ?? error}\n\nLog: ${join(home, 'logs', 'dsh.log')}`)
  app.exit(1)
}

async function launch() {
  mkdirSync(join(home, 'logs'), { recursive: true })
  const resources = resourcesOf({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() })
  installProfile({ dshHome: join(home, 'dsh'), source: resources.profile })
  const port = await freePort()
  const log = createWriteStream(join(home, 'logs', 'dsh.log'), { flags: 'a' })
  // Electron's own binary runs dsh as Node, so the app ships one runtime.
  dsh = await startDsh({ node: process.execPath, bin: resources.bin, env: dshEnv({ home, electronAsNode: true }), port, cwd: home, log })
  dsh.child.once('exit', (code) => {
    if (!quitting) fail(new Error(`dsh stopped (${code}).`))
  })
  const origin = new URL(dsh.url).origin
  harden(origin)
  window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    title: 'Omni',
    show: false,
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true,
    },
  })
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => { window = null })
  await window.loadURL(dsh.url)
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
    contents.on('will-attach-webview', event => event.preventDefault())
  })
  // The page asks for nothing beyond notifications and the clipboard.
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(new URL(contents.getURL()).origin === origin && ['notifications', 'clipboard-sanitized-write', 'clipboard-read'].includes(permission))
  })
}

app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
  if (quitting || !dsh) return
  quitting = true
  event.preventDefault()
  void stopDsh(dsh.child).finally(() => app.quit())
})
