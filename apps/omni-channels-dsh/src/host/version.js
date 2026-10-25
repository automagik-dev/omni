// This plugin's version and the oldest Omni it works with. The version is the Omni release of
// its last change (an Omni release moves it only when this folder changed), so it can be well
// behind the newest Omni. The oldest Omni it works with is what package.json declares in
// `engines.omni` (`>=<release>`), which Omni's repository checks against that release's API
// (scripts/plugin-compat.ts). Which Omni it installs is omni-release.js's.
import { readFileSync } from 'node:fs'

const PKG = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

export const PLUGIN_VERSION = PKG.version

// The release `engines.omni` names (`>=2.261025.2`, optionally with an upper bound), else this
// plugin's own version.
export const minimumOf = range => /^>=\s*(\d+\.\d{6}\.\d+)(?:\s|$)/.exec(String(range ?? '').trim())?.[1] ?? null
export const OMNI_MINIMUM = minimumOf(PKG.engines?.omni) ?? PLUGIN_VERSION

// Omni versions are <major>.<yymmdd>.<n>, with a suffix on a prerelease (2.261023.6-labs.2).
// True when `a` is a later release than `b`; the suffix does not count.
export function newer(a, b) {
  const parts = version => String(version ?? '').split(/[.-]/).slice(0, 3).map(Number)
  const [x, y] = [parts(a), parts(b)]
  if (x.length < 3 || y.length < 3 || [...x, ...y].some(Number.isNaN)) return false
  for (let index = 0; index < 3; index++) if (x[index] !== y[index]) return x[index] > y[index]
  return false
}
