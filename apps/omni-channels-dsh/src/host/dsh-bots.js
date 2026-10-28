// The owner's DSH bots as automation workers and hand-off targets (wish omni-chat-threads,
// design row 19, Decisions 27-29). A DSH bot is the Bot team's (its agents.js, `kind: 'dsh'`
// in state.agents): a name, a folder and a DSH agent preset, whose Sessions are plain DSH
// Sessions there, drawn under that bot. This plugin reaches them through one adapter,
// rt.omniDshBots, over the team's two calls (TEAM_CONTRACT.dshBotsList, dshBotsCreate) and its
// roster signal (dshBotsChanged), read from the team object itself: this plugin's runtime is
// Object.create(team), so a property of its own would shadow the team's.
//
// They are offered only while both calls exist, read at start and whenever the team says its
// DSH bots changed: then an automation whose DSH bot is gone, or whose team lost the calls,
// pauses with why (rt.pauseStrandedThreads). The Tasks record is not a DSH bot and never in
// the team's list. An "ongoing" automation keeps one Session under its bot on its record
// (sub.ongoingSessionId), made again, the board told why, once the owner archived it or took
// it out of the bot.
//
// A DSH bot's Session is the owner's own: this plugin never sets its preset, model or tool
// list. A run there is held by the ask gate of its own tagged turn only (standing-runs.js),
// and the team's restart pass finds the Session through state.agents and through the hook.
import { z } from 'zod'
import { archivedIds } from './omni-rows.js'
import { fromTeam, TEAM_CONTRACT } from './resume-hook.js'
import { ongoingSessions } from './standing-runs.js'

// Why a DSH bot is not offered, and an automation or a hand-off naming one is refused or paused.
export const DSH_BOT_NEEDS_TEAM = 'Handing work to a DSH bot needs a newer Bot team.'
export const DSH_BOT_GONE = 'Its DSH bot was deleted. Save the automation with another DSH bot.'
// A DSH bot's record in the team's state.agents (agents.js DSH_BOT).
const DSH_KIND = 'dsh'
const TITLE_MAX = 80

// The team's answers. One bad entry in the list drops only itself.
const DshBot = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  workDir: z.string().nullish().transform(value => value ?? null),
  profile: z.string().nullish().transform(value => value ?? null),
})
const Made = z.object({ sessionId: z.string().min(1).max(200) })
const listOf = answer => (Array.isArray(answer) ? answer : []).flatMap((item) => {
  const parsed = DshBot.safeParse(item)
  return parsed.success ? [parsed.data] : []
})

export function install(rt) {
  const { ctx, state } = rt
  const team = Object.getPrototypeOf(rt)
  const warn = (what, error) => rt.warn(`omni-channels: ${what}: %s`, error?.message ?? error)
  const teamCall = name => fromTeam(team, TEAM_CONTRACT[name])
  const ready = () => typeof teamCall('dshBotsList') === 'function' && typeof teamCall('dshBotsCreate') === 'function'
  const reason = () => (ready() ? null : DSH_BOT_NEEDS_TEAM)

  // The DSH bots now, read without waiting (the release lists them synchronously); none
  // without the calls, or when the list cannot be read.
  function now() {
    if (!ready()) return []
    try {
      return listOf(teamCall('dshBotsList')())
    } catch (error) {
      warn('the DSH bots could not be read', error)
      return []
    }
  }
  const list = async () => (ready() ? listOf(await teamCall('dshBotsList')()) : [])
  // A DSH bot by its id, else by its name, case aside.
  const find = (ref) => {
    const wanted = String(ref ?? '').trim()
    const bots = now()
    return bots.find(bot => bot.id === wanted) ?? bots.find(bot => bot.name.toLowerCase() === wanted.toLowerCase())
  }
  // Why a saved worker naming this DSH bot cannot take events now; null when it can.
  const problem = agentId => reason() ?? (now().some(bot => bot.id === agentId) ? null : DSH_BOT_GONE)

  async function createSession(botId, { title, firstMessage } = {}) {
    if (!ready()) throw new Error(DSH_BOT_NEEDS_TEAM)
    const clean = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
    return Made.parse(await teamCall('dshBotsCreate')(botId, { title: clean, ...(firstMessage ? { firstMessage } : {}) }))
  }
  // Told when the team's DSH bots change; a team without the signal never tells.
  function onChange(fn) {
    const on = teamCall('dshBotsChanged')
    return typeof on === 'function' ? on(() => fn()) : () => {}
  }

  // Whether a Session is one of a DSH bot's now: the owner archives a Session out of its bot.
  const agents = () => state.agents ?? {}
  const holds = (agentId, sessionId) => {
    const agent = Object.hasOwn(agents(), agentId) ? agents()[agentId] : undefined
    return agent?.kind === DSH_KIND && Array.isArray(agent.sessions) && agent.sessions.includes(sessionId)
  }
  const takes = sessionId => typeof sessionId === 'string' && !archivedIds(ctx).has(sessionId)
    && Object.keys(agents()).some(agentId => holds(agentId, sessionId))

  // An "ongoing" automation's one Session under its DSH bot (ongoingSessions).
  const { of: ongoingOf, ensure: ensureOngoing } = ongoingSessions({
    subs: () => (state.subscriptions ??= {}),
    fits: sub => sub?.worker?.kind === 'dshbot' && sub.worker.mode === 'ongoing',
    stateOf: (sessionId, sub) => (archivedIds(ctx).has(sessionId) ? 'archived' : holds(sub.worker.agentId, sessionId) ? 'live' : 'removed'),
    make: async sub => (await createSession(sub.worker.agentId, { title: sub.name })).sessionId,
    keep: () => rt.save(),
  })

  // At start the stranded automations pause (standing-runs.js); here, whenever the DSH bots change.
  ctx.effect(() => onChange(() => {
    void Promise.resolve(rt.load()).then(() => rt.pauseStrandedThreads?.()).catch(error => warn('pausing the automations of a deleted DSH bot failed', error))
  }), 'omni-channels: DSH bots changed')

  rt.omniDshBots = { ready, reason, list, now, find, problem, createSession, onChange, takes, ongoingOf, ensureOngoing }
}
