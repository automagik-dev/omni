// The Omni team, its channels and this plugin, as DSH composes them: the team's
// createRuntime (@automagik/bots-dsh), the channels runtime on top of it
// (@automagik/omni-channels-dsh), then this plugin's on top of that. All three share one
// fake plugin context, so its records hold what any of them registered, in order.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { apply as applyTeam, createRuntime as createTeam } from '@automagik/bots-dsh'
import { apply as applyChannels, createRuntime as createChannels } from '@automagik/omni-channels-dsh'
import { fakeContext } from '@automagik/bots-dsh/test/fake-ctx.js'
import { apply, createRuntime } from '../index.js'

export { fakeContext }

// A file of the team's checkout (harness-resolve.mjs finds it), such as a test fixture.
export const teamFile = path => new URL(path, `${pathToFileURL(process.env.OMNI_DSH_CORE).href}/`)

// The three applied as DSH applies them, each injecting what the one before provided.
export function applyAll(ctx, config = {}, channelsConfig = {}, canvasConfig = {}) {
  applyTeam(ctx, config)
  ctx.omniTeam = ctx.provided.get('omniTeam')
  applyChannels(ctx, channelsConfig)
  ctx.omniChannels = ctx.provided.get('omniChannels')
  apply(ctx, canvasConfig)
  return { team: ctx.omniTeam, channels: ctx.omniChannels }
}

// The three runtimes on a fresh home, with the team in `state` saved there first.
export function composed(state, { config = {}, channelsConfig = {}, services } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'omni-canvas-'))
  if (state) writeFileSync(join(home, 'state.json'), JSON.stringify(state))
  const ctx = fakeContext({ services })
  const team = createTeam(ctx, { home, ...config })
  const channels = createChannels(ctx, team, channelsConfig)
  const canvas = createRuntime(ctx, channels)
  const stop = async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  }
  return { ctx, team, channels, canvas, home, stop }
}
