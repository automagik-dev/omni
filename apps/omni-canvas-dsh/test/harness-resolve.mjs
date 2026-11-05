// Tests import index.js outside a dsh profile, so its peers resolve as a profile would
// supply them. The @deepseek-ai packages come from a DeepSeek Harness: DSH_HARNESS, else
// the packages that `bun run harness` installs in dev/harness, else the nearest
// deepseek-harness/ checkout in a folder above the plugin, else the same search from the
// plugin's place in the main worktree (a git worktree has no checkout of its own). The
// Bot team (@automagik/bots-dsh, formerly @automagik/omni-dsh) is automagik-dev/automagik's
// apps/bots-dsh at the release apps/automagik.json pins (apps/automagik.mjs fetches it into
// apps/.automagik), and the channels (@automagik/omni-channels-dsh) this repository's
// apps/omni-channels-dsh; or OMNI_DSH_CORE and OMNI_DSH_CHANNELS. Tests compose their
// runtimes with this plugin's.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkoutSource } from '../../automagik.mjs'

const plugin = resolve(import.meta.dirname, '..')
const core = resolve(process.env.OMNI_DSH_CORE ?? join(checkoutSource(), 'apps', 'bots-dsh'))
const channels = resolve(process.env.OMNI_DSH_CHANNELS ?? join(plugin, '..', 'omni-channels-dsh'))
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
// Tests that load other harness packages read the same checkout; the helpers find the
// other plugins' files here.
process.env.DSH_HARNESS = harness
process.env.OMNI_DSH_CORE = core
process.env.OMNI_DSH_CHANNELS = channels
// A checkout links the packages into its base bundle; an install has them at its root.
const base = resolve(harness, 'packages/bundle/base/package.json')
const anchor = pathToFileURL(existsSync(base) ? base : resolve(harness, 'package.json')).href
const owners = [plugin, core, channels].map(dir => `${pathToFileURL(dir).href}/`)
const SIBLINGS = { '@automagik/bots-dsh': core, '@automagik/omni-dsh': core, '@automagik/omni-channels-dsh': channels }
const clientShim = pathToFileURL(join(plugin, 'test', 'omni-client.js')).href
// omni-ui.js imports React and react-lang for the browser renderer; tests that inspect the
// renderer map use small stand-ins rather than a second React install.
const reactShim = pathToFileURL(join(plugin, 'test', 'react-shim.js')).href
const reactLangShim = pathToFileURL(join(plugin, 'test', 'react-lang-shim.js')).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromOurs = owners.some(owner => context.parentURL?.startsWith(owner))
    if (specifier.startsWith('@deepseek-ai/') && fromOurs) return nextResolve(specifier, { ...context, parentURL: anchor })
    // The other plugins' client bundles as DSH hands them over (omni-client.js); their
    // entries, or any file of theirs, by path rather than exports.
    if (['@automagik/bots-dsh/client', '@automagik/omni-dsh/client', '@automagik/omni-channels-dsh/client'].includes(specifier)) return nextResolve(clientShim, context)
    // Only this plugin's renderer source gets the stand-ins, not a dependency that might
    // have its own React expectations.
    if (context.parentURL?.startsWith(`${pathToFileURL(plugin).href}/`) && specifier === 'react') return nextResolve(reactShim, context)
    if (context.parentURL?.startsWith(`${pathToFileURL(plugin).href}/`) && specifier === '@openuidev/react-lang') return nextResolve(reactLangShim, context)
    for (const [name, dir] of Object.entries(SIBLINGS)) {
      const url = `${pathToFileURL(dir).href}/`
      if (specifier === name) return nextResolve(`${url}index.js`, context)
      if (specifier.startsWith(`${name}/`)) return nextResolve(`${url}${specifier.slice(name.length + 1)}`, context)
    }
    return nextResolve(specifier, context)
  },
})
