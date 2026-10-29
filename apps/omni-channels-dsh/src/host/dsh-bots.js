// The owner's DSH bots as hand-off targets (wish omni-chat-threads, design row 19, Decisions
// 27-29; handoff.js). A DSH bot is the Bot team's (its agents.js, `kind: 'dsh'` in
// state.agents): a name, a folder and a DSH agent preset, whose Sessions are plain DSH
// Sessions there, drawn under that bot. This plugin reaches them through one adapter,
// rt.omniDshBots, over the team's two calls (TEAM_CONTRACT.dshBotsList, dshBotsCreate), read
// from the team object itself: this plugin's runtime is Object.create(team), so a property of
// its own would shadow the team's.
//
// They are offered only while both calls exist. The Tasks record is not a DSH bot and never
// in the team's list. A DSH bot's Session is the owner's own: this plugin never sets its
// preset, model or tool list, and the team's restart pass finds it through state.agents and
// through the hook.
import { z } from 'zod'
import { fromTeam, TEAM_CONTRACT } from './resume-hook.js'

// Why a DSH bot is not offered, and a hand-off naming one is refused.
export const DSH_BOT_NEEDS_TEAM = 'Handing work to a DSH bot needs a newer Bot team.'
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
  const team = Object.getPrototypeOf(rt)
  const warn = (what, error) => rt.warn(`omni-channels: ${what}: %s`, error?.message ?? error)
  const teamCall = name => fromTeam(team, TEAM_CONTRACT[name])
  const ready = () => typeof teamCall('dshBotsList') === 'function' && typeof teamCall('dshBotsCreate') === 'function'

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
  // A DSH bot by its id, else by its name, case aside.
  const find = (ref) => {
    const wanted = String(ref ?? '').trim()
    const bots = now()
    return bots.find(bot => bot.id === wanted) ?? bots.find(bot => bot.name.toLowerCase() === wanted.toLowerCase())
  }

  async function createSession(botId, { title, firstMessage } = {}) {
    if (!ready()) throw new Error(DSH_BOT_NEEDS_TEAM)
    const clean = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
    return Made.parse(await teamCall('dshBotsCreate')(botId, { title: clean, ...(firstMessage ? { firstMessage } : {}) }))
  }

  rt.omniDshBots = { ready, find, createSession }
}
