// A Session's tool series, as DSH keeps it (dsh-session ToolHistoryProjection, dsh-llm
// toolDeclarations): the tools of the series' first request go to the model in full, every
// tool that joins later goes deferred (defer_loading), and a tool that leaves stays in the
// history as removed. Once no tool of that first request is still offered (it had none, or
// the host has since taken each one away), the model provider refuses every request of the
// Session, its compaction included: "at least one tool must have defer_loading=false". A
// Session that Omni hosts cannot move to a fresh one (the team pins it), so this plugin
// starts a new series there instead: the step's pre-step decision says so, and its request
// declares the tools of today in full. The Session, its id and everything that points at it
// (channels, threads, automations, answer children, settings) stay as they are.
import { z } from 'zod'
import { isThreadSession, operatesOmni } from './grants.js'

const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })

// DSH's code-mode (PTC) executor declares this one tool for all the others; no plugin can
// register it, so it is never among the agent's served tools.
const RUN_CODE = 'run_code'

const Repair = z.object({ botId: z.string().min(1).max(200) }).strict()

/**
 * Whether no tool of the Session's current series baseline is still offered: neither among
 * the tools served to the agent now (what its next request declares) nor among those its last
 * request declared. False before the Session's first request, which starts the series anyway.
 * @param session - the agent's DSH Session (requestHeader, toolHistory).
 * @param offered - names of the tools served to the agent now.
 * @returns whether the next request would offer the model no tool it can call directly.
 */
export function strandedSeries(session, offered) {
  const last = session?.requestHeader?.()
  if (last === undefined) return false
  const baseline = new Set((session.toolHistory?.()?.tools ?? []).map(tool => tool.name))
  const declared = (last.tools ?? []).map(tool => tool.name)
  const next = [...offered, ...declared.filter(name => name === RUN_CODE)]
  const noneKept = names => names.length > 0 && names.every(name => !baseline.has(name))
  return noneKept(next) || noneKept(declared)
}

export function install(rt) {
  const { ctx } = rt
  // Bots whose next step starts a new series because staff asked (repair_tool_series).
  const asked = new Set()
  const offeredTo = (agent) => {
    try { return ctx.tools.schemas(agent).map(schema => schema.name) } catch { return [] }
  }
  // Only the Sessions of a Bot that operates Omni: this plugin takes tools away from them
  // (omni-api.js), and the one Omni hosts has no fresh Session to move to.
  ctx.on('agent/pre-step', async (event, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter' || event.signal?.aborted) return decision
    const session = event.agent?.session
    try {
      await rt.load()
      const botId = rt.selfOf(session?.id)
      if (!operatesOmni(rt, botId) || isThreadSession(rt, session.id)) return decision
      const forced = asked.delete(botId)
      if (!forced && !strandedSeries(session, offeredTo(event.agent))) return decision
      rt.warn('omni-channels: Session %s starts a new tool series: %s', session.id, forced ? 'staff asked for it' : 'no tool of its first request is offered any more')
      return { ...decision, startsRequestSeries: true }
    } catch (error) {
      rt.warn('omni-channels: the tool series of Session %s was not checked: %s', session?.id, error?.message ?? error)
      return decision
    }
  })
  // Staff only, from the Bot's own place in the sidebar: its next step starts a new series,
  // whatever the check above finds. Nothing is saved or moved.
  ctx.effect(() => rt.hooks.endpoint('repair_tool_series', async (body) => {
    const { botId } = Repair.parse(body)
    await rt.load()
    if (rt.readOnly?.() !== undefined) throw refused(rt.readOnly())
    if (rt.botOf(botId) === undefined || !operatesOmni(rt, botId)) throw refused('Only a Bot that operates Omni has its tools repaired here.')
    asked.add(botId)
    return { botId, next: 'fresh-tools' }
  }), 'omni-channels: repair_tool_series')
}
