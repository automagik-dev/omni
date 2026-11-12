// RFC-0001: an Omni automation's actual dry-run match keeps this message out of
// answer mode. The plugin's subscriptions are local state (subscriptions.js),
// and its receipt streams are /events/consumers (omni-events.js): neither is an
// Omni /automations row. Do not combine those inventories here.
import { z } from 'zod'

const CACHE_MS = 30_000
const conditionSchema = z.object({ field: z.string(), operator: z.string(), value: z.unknown().optional() })
const listSchema = z.object({ items: z.array(z.object({
  id: z.string().min(1), enabled: z.boolean(), triggerEventType: z.string(),
  triggerConditions: z.array(conditionSchema).nullish(), conditionLogic: z.enum(['and', 'or']).nullish(),
})) })
const testSchema = z.object({ matched: z.boolean(), dryRun: z.literal(true), eventId: z.string() })

// Automations have no instanceId column. Only prune a rule when its instance
// conditions prove it cannot apply; unknown conditions still go to Omni's own
// evaluator. Under OR, an unrelated condition can still match this instance.
function couldApply(automation, instanceId) {
  const conditions = (automation.triggerConditions ?? []).map(condition => {
    if (condition.field !== 'instanceId') return undefined
    if (condition.operator === 'eq') return instanceId === condition.value
    if (condition.operator === 'neq') return instanceId !== condition.value
    return undefined
  })
  if (!conditions.length) return true
  return automation.conditionLogic === 'or' ? conditions.some(value => value !== false) : !conditions.includes(false)
}

export function answerAutomationMatcher(rt) {
  let cached, loading
  const warned = new Set()
  const warn = instanceId => {
    if (warned.has(instanceId)) return
    warned.add(instanceId)
    rt.warn('ds-bot: could not check Omni automations for instance %s; answer mode continues', instanceId)
  }
  async function list() {
    if (cached && Date.now() - cached.at < CACHE_MS) {
      if (cached.failed) throw new Error('automation list unavailable')
      return cached.items
    }
    if (!loading) loading = (async () => {
      try {
        const response = await rt.omniRequest('GET', '/automations?enabled=true')
        if (!response?.ok) throw new Error('automation list unavailable')
        const { items } = listSchema.parse(await response.json())
        cached = { at: Date.now(), items: items.filter(item => item.enabled && item.triggerEventType === 'message.received') }
        return cached.items
      } catch (error) {
        // Cache failure briefly too: an unavailable scope must not cause a list
        // request on every message, nor keep a stale positive match alive.
        cached = { at: Date.now(), failed: true }
        throw error
      } finally { loading = undefined }
    })()
    return loading
  }
  return async row => {
    if (row.eventType !== 'message.received' || row.direction !== 'inbound' || !row.instanceId) return false
    let failed = false
    try {
      for (const automation of await list()) {
        if (!couldApply(automation, row.instanceId)) continue
        try {
          const response = await rt.omniRequest('POST', `/automations/${encodeURIComponent(automation.id)}/test`, { body: { eventId: row.id } })
          if (!response?.ok) throw new Error('automation dry run unavailable')
          const result = testSchema.parse(await response.json())
          if (result.eventId !== row.id) throw new Error('automation dry run event mismatch')
          if (result.matched) { if (failed) warn(row.instanceId); return true }
        } catch { failed = true }
      }
    } catch { failed = true }
    if (failed) warn(row.instanceId)
    return false
  }
}
