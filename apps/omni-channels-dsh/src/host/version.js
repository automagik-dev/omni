// This plugin's version, which is the Omni release it belongs to: a sandboxed Omni it
// installs runs that same version.
import { readFileSync } from 'node:fs'

export const PLUGIN_VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

// Omni versions are <major>.<yymmdd>.<n>, with a suffix on a prerelease (2.261023.6-labs.2).
// True when `a` is a later release than `b`; the suffix does not count.
export function newer(a, b) {
  const parts = version => String(version ?? '').split(/[.-]/).slice(0, 3).map(Number)
  const [x, y] = [parts(a), parts(b)]
  if (x.length < 3 || y.length < 3 || [...x, ...y].some(Number.isNaN)) return false
  for (let index = 0; index < 3; index++) if (x[index] !== y[index]) return x[index] > y[index]
  return false
}
