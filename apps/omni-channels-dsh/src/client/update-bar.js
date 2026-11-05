// The slim notice on the Channels page that a newer Omni is out (omni-update-status), without
// React. What it says, and what its one action is, follow from whether this Omni can be
// updated from here. A dismissal hides it until the next version, per Omni, in this
// plugin's browser storage.

const KEY = 'omni-ui:update-dismissed:'

// null: nothing to show. Otherwise the bar's kind, its words and its action:
// update (ask the Omni, then confirm on WhatsApp, or here when `confirm` is 'app'), how (a
// note on who updates it), or none.
export function updateBar(status, dismissed = null) {
  const latest = status?.latest
  switch (status?.state) {
    case 'available':
      if (dismissed === latest) return null
      return { kind: 'available', latest, current: status.current ?? null, action: 'update', ...(status.confirm === 'app' ? { confirm: 'app' } : {}) }
    case 'off':
    case 'forbidden':
      if (!latest || dismissed === latest) return null
      return { kind: 'admin', latest, action: 'how', command: status.command ?? null }
    case 'pending':
      return { kind: 'pending', version: status.version, action: 'none' }
    case 'updating':
      return { kind: 'updating', version: status.version, action: 'none' }
    default:
      return null
  }
}

// A bar can sit on screen while its Omni moves on (updated elsewhere, or by itself), so what
// it offers is looked at again: now, whenever the window comes back, and every few minutes.
// Returns the stop.
export function watchStatus(look, { every = 10 * 60_000, doc = globalThis.document, timers = globalThis } = {}) {
  look()
  const interval = timers.setInterval(look, every)
  const onVisible = () => { if (doc?.visibilityState === 'visible') look() }
  doc?.addEventListener?.('visibilitychange', onVisible)
  return () => {
    timers.clearInterval(interval)
    doc?.removeEventListener?.('visibilitychange', onVisible)
  }
}

// Whether a look still offers updating to `latest`.
const stillOffers = (status, latest) => {
  const bar = updateBar(status)
  return bar?.kind === 'available' && bar.latest === latest
}

// Asking for the update to `latest`, after a fresh look: { status } when that look no longer
// offers it (the bar redraws from it, and nothing is asked), else { reply }. A refusal throws
// with the look taken after it as `error.status`, so one that says the Omni already runs it
// (ALREADY_CURRENT) lets the bar go instead of offering it again.
export async function askUpdate(call, latest) {
  const now = await call('omni-update-status', {})
  if (!stillOffers(now, latest)) return { status: now }
  try {
    return { reply: await call('omni-update-request', { version: latest }) }
  } catch (error) {
    const after = await call('omni-update-status', {}).catch(() => null)
    throw Object.assign(error, { status: after, stale: after !== null && !stillOffers(after, latest) })
  }
}

const storage = () => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function dismissedFor(origin, store = storage()) {
  try {
    return store?.getItem(KEY + origin) ?? null
  } catch {
    return null
  }
}

export function dismiss(origin, version, store = storage()) {
  try {
    store?.setItem(KEY + origin, version)
  } catch { /* storage unavailable: it shows again next time */ }
}
