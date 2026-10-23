// The Omni team with this plugin on it, as DSH composes them: the team's createRuntime
// (@automagik/bots-dsh, its index.js) on a fake plugin context, then this plugin's own
// runtime on top of the team's. Both share the one fake context, so its records (tools,
// listeners, effects, the POST route) hold what either registered, in order.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { apply as applyTeam, createRuntime as createTeam } from '@automagik/bots-dsh'
import { fakeContext } from '@automagik/bots-dsh/test/fake-ctx.js'
import { apply, createRuntime } from '../index.js'

export { fakeContext }

// A file of the team's checkout (harness-resolve.mjs finds it), such as a test fixture.
export const teamFile = path => new URL(path, `${pathToFileURL(process.env.OMNI_DSH_CORE).href}/`)

// Both plugins applied as DSH applies them: the team provides omniTeam, this plugin injects it.
export function applyBoth(ctx, config = {}, channelsConfig = {}) {
  applyTeam(ctx, config)
  ctx.omniTeam = ctx.provided.get('omniTeam')
  apply(ctx, channelsConfig)
  return { team: ctx.omniTeam, channels: ctx.provided.get('omniChannels') }
}

// The two runtimes on a fresh home, with the team in `state` saved there first.
export function composed(state, { config = {}, channelsConfig = {}, services } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'omni-channels-'))
  if (state) writeFileSync(join(home, 'state.json'), JSON.stringify(state))
  const ctx = fakeContext({ services })
  const team = createTeam(ctx, { home, ...config })
  const channels = createRuntime(ctx, team, channelsConfig)
  ctx.provided.set('omniChannels', channels)
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { ctx, team, channels, home, stop }
}
