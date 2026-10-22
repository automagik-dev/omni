// Updates: the app follows the Omni desktop releases, `omni-desktop-v<version>` on GitHub (the
// ones `omni desktop` downloads). A newer one downloads in the background and installs when
// the app quits, or at once from the title bar's Restart button. electron-updater downloads
// it, checks its sha512 and installs it (on macOS through Squirrel, which also requires the
// update to carry the running app's signature). This module only picks the release, since
// the repository's other releases (Omni's own v* tags) are not the app's.

export const RELEASES_URL = 'https://api.github.com/repos/automagik-dev/omni/releases?per_page=50'
export const DESKTOP_TAG_PREFIX = 'omni-desktop-v'
const DOWNLOADS = 'https://github.com/automagik-dev/omni/releases/download/'
export const FIRST_CHECK_MS = 20_000
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

/** The update feed electron-updater reads for `platform`, or null where the app does not update. */
export function feedFileOf(platform) {
  if (platform === 'darwin') return 'latest-mac.yml'
  if (platform === 'linux') return 'latest-linux.yml'
  return null
}

/**
 * Whether this copy of the app updates itself: a packaged build, on macOS or from an AppImage
 * (a deb belongs to the system's package manager, and an unpacked AppImage cannot be replaced),
 * unless OMNI_DESKTOP_UPDATES is `off`.
 */
export function updatesEnabled({ packaged, platform, env }) {
  if (!packaged || env.OMNI_DESKTOP_UPDATES === 'off') return false
  if (platform === 'darwin') return true
  return platform === 'linux' && Boolean(env.APPIMAGE)
}

/** OMNI_DESKTOP_UPDATE_FEED: a feed folder to take updates from instead (https, or http on loopback). */
export function feedOverride(env) {
  const raw = env.OMNI_DESKTOP_UPDATE_FEED?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return url.href.endsWith('/') ? url.href : `${url.href}/`
  } catch {}
  return null
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Semver precedence: negative when `a` is older than `b`, 0 when equal, NaN when either is not a version. */
export function compareVersions(a, b) {
  const x = VERSION.exec(a)
  const y = VERSION.exec(b)
  if (!x || !y) return Number.NaN
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i])
    if (d !== 0) return Math.sign(d)
  }
  if (!x[4] || !y[4]) return x[4] ? -1 : y[4] ? 1 : 0
  const p = x[4].split('.')
  const q = y[4].split('.')
  for (let i = 0; i < Math.min(p.length, q.length); i++) {
    if (p[i] === q[i]) continue
    const pn = /^\d+$/.test(p[i])
    const qn = /^\d+$/.test(q[i])
    if (pn && qn) return Math.sign(Number(p[i]) - Number(q[i]))
    if (pn !== qn) return pn ? -1 : 1
    return p[i] < q[i] ? -1 : 1
  }
  return Math.sign(p.length - q.length)
}

/**
 * The newest desktop release above `current` that carries `platform`'s update feed, as the
 * folder electron-updater reads it from; null when there is none.
 */
export function pickUpdate(releases, { current, platform }) {
  const feed = feedFileOf(platform)
  let best = null
  for (const release of Array.isArray(releases) ? releases : []) {
    const tag = release?.tag_name
    if (release?.draft || typeof tag !== 'string' || !tag.startsWith(DESKTOP_TAG_PREFIX)) continue
    const version = tag.slice(DESKTOP_TAG_PREFIX.length)
    if (!(compareVersions(version, current) > 0)) continue
    if (!release.assets?.some(asset => asset?.name === feed)) continue
    if (!best || compareVersions(version, best.version) > 0) best = { version, url: `${DOWNLOADS}${encodeURIComponent(tag)}/` }
  }
  return best
}

export async function fetchReleases(fetchImpl = fetch) {
  const response = await fetchImpl(RELEASES_URL, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'omni-desktop' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for the desktop releases`)
  return response.json()
}

/**
 * Checks now (after FIRST_CHECK_MS) and every CHECK_EVERY_MS, and reports to `onState`:
 * `{ version, state: 'downloading', percent }`, then `{ version, state: 'ready' }`.
 * `install()` restarts into the downloaded update.
 */
export function startUpdates({ updater, current, platform, env, log, onState, releases = fetchReleases, timers = globalThis }) {
  let busy = false
  let pending = null
  let ready = null
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.allowDowngrade = false
  updater.logger = log
  // On macOS the download is handed to Squirrel, which swaps the app on quit only once it has
  // the update too: until Squirrel says so, the update is not ready.
  const squirrel = platform === 'darwin' ? updater.nativeUpdater : null
  const markReady = () => {
    if (ready) return
    ready = pending
    log.info(`update: ${ready} is ready and installs on quit`)
    onState({ version: ready, state: 'ready' })
  }
  updater.on('download-progress', progress => onState({ version: pending, state: 'downloading', percent: Math.round(progress?.percent ?? 0) }))
  updater.on('update-downloaded', info => {
    pending = info?.version ?? pending
    if (!squirrel) return markReady()
    log.info(`update: ${pending} is downloaded; macOS is preparing it`)
    onState({ version: pending, state: 'downloading', percent: 100 })
  })
  squirrel?.on('update-downloaded', markReady)
  squirrel?.on('error', error => log.warn(`update (macOS): ${error?.message ?? error}`))
  updater.on('error', error => log.warn(`update: ${error?.message ?? error}`))

  async function check() {
    if (busy || ready) return null
    busy = true
    try {
      const override = feedOverride(env)
      const update = override ? { version: null, url: override } : pickUpdate(await releases(), { current, platform })
      if (!update) return null
      pending = update.version
      updater.setFeedURL({ provider: 'generic', url: update.url })
      return await updater.checkForUpdates()
    } catch (error) {
      log.warn(`update check: ${error?.message ?? error}`)
      return null
    } finally {
      busy = false
    }
  }

  const first = timers.setTimeout(check, FIRST_CHECK_MS)
  const every = timers.setInterval(check, CHECK_EVERY_MS)
  return {
    check,
    get ready() { return ready },
    install: () => { if (ready) updater.quitAndInstall(false, true) },
    stop: () => { timers.clearTimeout(first); timers.clearInterval(every) },
  }
}
