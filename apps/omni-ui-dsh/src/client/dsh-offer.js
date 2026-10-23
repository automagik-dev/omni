// Whether the update card shows a DSH row. An npm DSH is swapped for the verified
// version itself; a packaged app installs only what its own updater found, its
// newest release, so its row waits until that release is the verified one.
const APP_OFFER = new Set(['available', 'downloading', 'verifying', 'installing', 'ready'])

const bare = value => String(value ?? '').trim().replace(/^v/i, '').split('+')[0]

export const sameVersion = (a, b) => bare(a) !== '' && bare(a) === bare(b)

export function showsDshRow(dsh, app) {
  if (!dsh?.verified || !dsh.current || sameVersion(dsh.verified, dsh.current)) return false
  if (dsh.kind === 'npm') return true
  return dsh.kind === 'app' && APP_OFFER.has(app?.phase) && sameVersion(app.version, dsh.verified)
}
