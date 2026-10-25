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
