// Browser storage keys, under this plugin's own prefix. A DSH may run upstream DS Bot
// beside Omni on the same origin, and DS Bot keeps its own values under ds-bot: and its
// earlier names, so Omni never reads, moves or removes keys outside its prefix.
export const STORAGE = {
  unread: 'omni-ui:unread',
  reactions: 'omni-ui:reactions',
  seen: 'omni-ui:seen',
  prefs: 'omni-ui:prefs',
  surface: 'omni-ui:surface',
  agentSessions: 'omni-ui:agent-sessions',
  browserWidth: 'omni-ui:browser-width',
  browsers: 'omni-ui.browser.v2',
}

// No legacy names: the keys before this prefix were shared with DS Bot.
const LEGACY_PREFIXES = []
// The v1 store kept one page per Bot; v2 keeps a tab strip per Bot.
const LEGACY_BROWSER_KEYS = []
// The saved theme only paints the first frame before the team loads; it follows the
// host's rename of the theme ids.
const LEGACY_THEMES = { grok: 'mono' }

export function legacyKeys(key) {
  if (key === STORAGE.browsers) return LEGACY_BROWSER_KEYS
  const name = key.slice(key.indexOf(':') + 1)
  return LEGACY_PREFIXES.map(prefix => `${prefix}${name}`)
}

// One page per Bot becomes one tab per Bot; a v2 store already present wins.
const migrateBrowsers = (storage) => {
  if (storage.getItem(STORAGE.browsers) !== null) {
    for (const key of LEGACY_BROWSER_KEYS) storage.removeItem(key)
    return
  }
  for (const key of LEGACY_BROWSER_KEYS) {
    try {
      const value = storage.getItem(key)
      if (value === null) continue
      const previous = JSON.parse(value) ?? {}
      const tabs = Object.fromEntries(Object.entries(previous)
        .filter(([, page]) => page && typeof page === 'object')
        .map(([botId, page]) => {
          const tab = { id: `v1-${botId}`, url: page.url ?? '', title: page.title ?? '' }
          return [botId, { tabs: [tab], active: tab.id }]
        }))
      storage.setItem(STORAGE.browsers, JSON.stringify(tabs))
      for (const earlier of LEGACY_BROWSER_KEYS) storage.removeItem(earlier)
      return
    } catch { /* unreadable entry: try the older name */ }
  }
}

export function migrateStorage(storage = globalThis.localStorage) {
  for (const key of Object.values(STORAGE)) {
    if (key === STORAGE.browsers) continue
    for (const legacy of legacyKeys(key)) {
      try {
        const value = storage.getItem(legacy)
        if (value !== null && storage.getItem(key) === null) storage.setItem(key, value)
        storage.removeItem(legacy)
      } catch { /* storage unavailable */ }
    }
  }
  try { migrateBrowsers(storage) } catch { /* storage unavailable */ }
  try {
    const prefs = JSON.parse(storage.getItem(STORAGE.prefs) ?? 'null')
    if (prefs && Object.hasOwn(LEGACY_THEMES, prefs.theme ?? '')) {
      storage.setItem(STORAGE.prefs, JSON.stringify({ ...prefs, theme: LEGACY_THEMES[prefs.theme] }))
    }
  } catch { /* storage unavailable or not JSON */ }
}
