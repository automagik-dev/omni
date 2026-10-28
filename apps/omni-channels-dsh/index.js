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
import * as dshBots from './src/host/dsh-bots.js'
import * as grants from './src/host/grants.js'
import * as subscriptions from './src/host/subscriptions.js'
import * as asks from './src/host/asks.js'
import * as omniApi from './src/host/omni-api.js'
import * as omniLink from './src/host/omni-link.js'
import * as omniDiscover from './src/host/omni-discover.js'
import * as omniLocal from './src/host/omni-local.js'
import * as omniTerminal from './src/host/omni-terminal.js'
import * as omniUpdate from './src/host/omni-update.js'
import * as omni from './src/host/omni.js'
import * as omniEvents from './src/host/omni-events.js'
import * as omniChannelActions from './src/host/omni-channel-actions.js'
import * as threadKeys from './src/host/thread-keys.js'
import * as threads from './src/host/threads.js'
import * as threadTools from './src/host/thread-tools.js'
import * as standingRecovery from './src/host/standing-recovery.js'
import * as standingRuns from './src/host/standing-runs.js'
import * as omniRows from './src/host/omni-rows.js'
import * as handoff from './src/host/handoff.js'

export const name = 'omni-channels'
// The chat threads take their instructions from a prompt section and archive their Sessions in
// DSH's workspaces; the team needs both too, so they are there wherever it runs.
export const inject = ['omniTeam', 'tools', 'sessions', 'settings', 'systemPrompt', 'workspaceRegistry']

// The team's restart hook first, before any other work, so the team's restart pass hears of
// this plugin's Sessions (resume-hook.js), then the adapter over the team's DSH bots
// (dsh-bots.js), which the automations' tools offer as they register. Then the team's
// install order, kept: automations and Omni's tools first, the link (the Omnis found on
// this computer to link, one to run here, the terminal that updates or sets one up, and
// updating them) and its events after.
// Asking the Omni Bot from a thread (asks.js) comes right after the automations, whose run
// log it shares. Permissions come before the tools that check them. The threads' own keys
// come after omni.js, whose requests they make, the threads after their keys, and the
// threads' own tools after the threads, whose additions they restrict. The standing-Session
// runs (automations that hand events to a thread or a session) after the threads, whose
// removals they hear, their restart recovery right after them, then the session rows under
// the Omni Bot (omni-rows.js), which follow the Omni Bot's model through the threads and hear
// the standing runs end, and the Omni Bot's hand-off (handoff.js), whose Sessions are rows,
// before the events, which queue for them. Changing channels from the Channels page comes
// last: it only calls omni through omni.js.
const MODULES = [resumeHook, dshBots, grants, subscriptions, asks, omniApi, omniLink, omniDiscover, omniLocal, omniTerminal, omniUpdate, omni, threadKeys, threads, threadTools, standingRuns, standingRecovery, omniRows, handoff, omniEvents, omniChannelActions]

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
