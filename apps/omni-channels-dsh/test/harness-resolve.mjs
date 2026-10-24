// Tests import index.js outside a dsh profile, so its peers resolve as a profile would
// supply them. The @deepseek-ai packages come from a DeepSeek Harness: DSH_HARNESS, else
// the packages that `bun run harness` installs in dev/harness, else the nearest
// deepseek-harness/ checkout in a folder above the plugin, else the same search from the
// plugin's place in the main worktree (a git worktree has no checkout of its own). The
// Bot team (@automagik/bots-dsh, formerly @automagik/omni-dsh) is automagik-dev/automagik's
// apps/bots-dsh at the release apps/automagik.json pins (apps/automagik.mjs fetches it into
// apps/.automagik), or OMNI_DSH_CORE; tests compose its runtime with this plugin's, so they
// may read its files too.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkoutSource } from '../../automagik.mjs'

const plugin = resolve(import.meta.dirname, '..')
const core = resolve(process.env.OMNI_DSH_CORE ?? join(checkoutSource(), 'apps', 'bots-dsh'))
const above = (start) => {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'deepseek-harness'))) return join(dir, 'deepseek-harness')
    if (dirname(dir) === dir) return undefined
  }
}
const installed = join(plugin, 'dev', 'harness')
const findHarness = () => {
  if (process.env.DSH_HARNESS) return process.env.DSH_HARNESS
  if (existsSync(join(installed, 'node_modules'))) return installed
  const near = above(dirname(plugin))
  if (near) return near
  const beside = resolve(plugin, '../deepseek-harness')
  try {
    const git = (...args) => execFileSync('git', ['-C', dirname(plugin), 'rev-parse', ...args], { encoding: 'utf8' }).trim()
    return above(join(dirname(git('--path-format=absolute', '--git-common-dir')), git('--show-prefix'))) ?? beside
  } catch {
    return beside
  }
}
const harness = findHarness()
// Tests that load other harness packages (jsdom) read the same checkout; the team helper
// finds the team's files here.
process.env.DSH_HARNESS = harness
process.env.OMNI_DSH_CORE = core
// A checkout links the packages into its base bundle; an install has them at its root.
const base = resolve(harness, 'packages/bundle/base/package.json')
const anchor = pathToFileURL(existsSync(base) ? base : resolve(harness, 'package.json')).href
const owners = [plugin, core].map(dir => `${pathToFileURL(dir).href}/`)
const coreUrl = `${pathToFileURL(core).href}/`
const clientShim = pathToFileURL(join(plugin, 'test', 'omni-client.js')).href
const TEAM_NAMES = ['@automagik/bots-dsh', '@automagik/omni-dsh']

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromOurs = owners.some(owner => context.parentURL?.startsWith(owner))
    if (specifier.startsWith('@deepseek-ai/') && fromOurs) return nextResolve(specifier, { ...context, parentURL: anchor })
    // The team's entry, or any file of it (its test helpers), by path rather than exports;
    // its client bundle as DSH hands it over (omni-client.js).
    // Under its name and its former one.
    for (const name of TEAM_NAMES) {
      if (specifier === name) return nextResolve(`${coreUrl}index.js`, context)
      if (specifier === `${name}/client`) return nextResolve(clientShim, context)
      if (specifier.startsWith(`${name}/`)) return nextResolve(`${coreUrl}${specifier.slice(name.length + 1)}`, context)
    }
    return nextResolve(specifier, context)
  },
})
