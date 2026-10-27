// Omni's channels for DeepSeek Harness, on the Bot team (@automagik/bots-dsh): the Omni
// this DSH is linked to (omni.json, pairing), its channels and chats, the Main Bot's tools
// that operate it, the events it streams and the automations that act on them.
//
// The team's runtime arrives as the omniTeam service. This plugin's modules install on a
// runtime of their own whose prototype is the team's: they call the team's functions
// (load, save, botOf, deliver…) as before, while their tools, listeners and effects sit on
// this plugin's fiber, and they add to the team only through its hooks (rt.hooks), so
// turning this plugin off takes all of it away. Its own runtime is provided as
// omniChannels for the canvas plugin, which reads omni through it.
import * as resumeHook from './src/host/resume-hook.js'
import * as grants from './src/host/grants.js'
import * as subscriptions from './src/host/subscriptions.js'
import * as omniApi from './src/host/omni-api.js'
import * as omniLink from './src/host/omni-link.js'
import * as omniDiscover from './src/host/omni-discover.js'
import * as omniLocal from './src/host/omni-local.js'
import * as omniTerminal from './src/host/omni-terminal.js'
import * as omniUpdate from './src/host/omni-update.js'
import * as omni from './src/host/omni.js'
import * as omniEvents from './src/host/omni-events.js'
import * as omniChannelActions from './src/host/omni-channel-actions.js'

export const name = 'omni-channels'
export const inject = ['omniTeam', 'tools', 'sessions', 'settings']

// The team's restart hook first, before any other work, so the team's restart pass hears of
// this plugin's Sessions (resume-hook.js). Then the team's install order, kept: automations
// and Omni's tools first, the link (the Omnis found on this computer to link, one to run
// here, the terminal that updates or sets one up, and updating them) and its events after.
// Permissions come before the tools that check them. Changing channels from the Channels page
// comes last: it only calls omni through omni.js.
const MODULES = [resumeHook, grants, subscriptions, omniApi, omniLink, omniDiscover, omniLocal, omniTerminal, omniUpdate, omni, omniEvents, omniChannelActions]

export function apply(ctx, config = {}) {
  ctx.provide('omniChannels', createRuntime(ctx, ctx.omniTeam, config))
}

export function createRuntime(ctx, team, config = {}) {
  // Before this plugin, a profile named the Omni with omni.url on the team's row (omni-ui);
  // it still works there.
  const rt = Object.assign(Object.create(team), { ctx, config: { ...config, omni: config.omni ?? team.config?.omni } })
  for (const module of MODULES) module.install(rt)
  return rt
}
