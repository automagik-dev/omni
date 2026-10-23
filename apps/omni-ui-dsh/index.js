// Omni: a team of long-lived Bots on top of ordinary dsh root Sessions.
// Every Bot is one root Session; the roster, rooms, and the bot-to-bot exchange log live
// in one JSON file in Omni's own home so they survive restarts without new Session event
// types. That home is $OMNI_HOME/ui (~/.omni/ui), never under DSH_HOME: installed into
// someone's own DSH, Omni keeps its files apart from DSH's and from other plugins'.
import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as diagnostics from './src/host/diagnostics.js'
import * as extend from './src/host/extend.js'
import * as store from './src/host/store.js'
import * as models from './src/host/models.js'
import * as providers from './src/host/providers.js'
import * as permissions from './src/host/permissions.js'
import * as turns from './src/host/turns.js'
import * as handoffs from './src/host/handoffs.js'
import * as delivery from './src/host/delivery.js'
import * as roster from './src/host/roster.js'
import * as folders from './src/host/folders.js'
import * as agents from './src/host/agents.js'
import * as prompt from './src/host/prompt.js'
import * as timeContext from './src/host/time-context.js'
import * as tools from './src/host/tools.js'
import * as chatIndex from './src/host/chat-index.js'
import * as groups from './src/host/groups.js'
import * as approvals from './src/host/approvals.js'
import * as resume from './src/host/resume.js'
import * as memory from './src/host/memory.js'
import * as parts from './src/host/parts.js'
import * as images from './src/host/images.js'
import * as browser from './src/host/browser.js'
import * as secrets from './src/host/secrets.js'
import * as connectors from './src/host/connectors.js'
import * as capabilities from './src/host/capabilities.js'
import * as schedules from './src/host/schedules.js'
import * as usage from './src/host/usage.js'
import * as update from './src/host/update.js'
import * as dshUpdate from './src/host/dsh-update.js'
import * as thinking from './src/host/thinking.js'
import * as channel from './src/host/channel.js'
import * as feed from './src/host/feed.js'

export { COLORS } from './src/host/constants.js'

export const name = 'omni-ui'
export const inject = ['llm', 'tools', 'systemPrompt', 'sessionController', 'sessions', 'sessionTitle', 'workspaceRegistry', 'connection']

// Each module's install(rt) registers its listeners, tools, and effects, and puts on `rt`
// the functions other modules call; they call them through `rt` at run time, never during
// install. Listeners run and tools are listed in registration order, so this order holds:
// usage meters model requests after every listener that rewrites them.
const MODULES = [diagnostics, extend, store, models, providers, permissions, turns, handoffs, delivery, roster, folders, agents, prompt, timeContext, tools, chatIndex, groups, approvals, resume, memory, parts, images, secrets, connectors, capabilities, schedules, browser, usage, update, dshUpdate, thinking, feed, channel]

// Other Omni plugins inject the runtime as `omniTeam` and add to it through rt.hooks
// (src/host/extend.js): Omni's channels and automations (@automagik/omni-channels-dsh),
// its canvases (@automagik/omni-canvas-dsh).
export function apply(ctx, config = {}) {
  const rt = createRuntime(ctx, config)
  ctx.provide('omniTeam', rt)
}

// A team kept elsewhere before (config.importHome, e.g. ~/.dsh/bot) is copied in once,
// when the home has no team yet. Only on request: the source is left as it was.
function importTeam(home, from) {
  if (!from || existsSync(join(home, 'state.json')) || !existsSync(join(from, 'state.json'))) return false
  cpSync(from, home, { recursive: true, force: false, filter: source => !source.endsWith('state.lock') })
  return true
}

export function createRuntime(ctx, config = {}) {
  const dshHome = folders.dshHomeOf(process.env.DSH_HOME)
  const home = folders.expandPath(config.home ?? join(folders.omniHomeOf(process.env.OMNI_HOME), 'ui'))
  const imported = importTeam(home, config.importHome && folders.expandPath(config.importHome))
  const rt = {
    ctx,
    config,
    dshHome,
    home,
    statePath: join(home, 'state.json'),
    defaults: {
      mainName: config.mainName ?? 'Omni',
      mainRole: config.mainRole ?? 'Channel orchestrator',
    },
  }
  for (const module of MODULES) module.install(rt)
  if (imported) rt.warn?.('omni-ui: copied the team from %s into %s', config.importHome, home)
  return rt
}
