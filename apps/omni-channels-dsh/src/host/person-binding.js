// #1704 person binding: an answer bot with `personBinding` on (a staff setting, off by default)
// binds each child to the one Omni access rule that admitted its person, the first time a rule
// that names one person admits a message for that chat, and never binds it again. The rule is
// the person's only record: its `metadata` may hold
//   context     text staff write about the person; it reaches that child's instructions only
//   capability  an MCP capability for that person: its name, or { name, secrets: [NAME, ...] }
//               with the secrets it uses; mounted into that child's Session only
// The intake reads the rule with each access check (cached 30 s with it); nothing else keeps it.
import { z } from 'zod'

// As much of a person's context as a child's own notes hold.
export const PERSON_CONTEXT_MAX = 8000
export const PERSON_HELD = 'Held: this chat\'s child answers only the person its access rule bound, and another rule (or none) admitted this message.'
export const PERSON_COLLECTIVE = 'Person binding needs isolated visibility: in collective visibility a child reads the other people\'s chats.'
export const PERSON_UNLIMITED_READS = 'Person binding needs the read tools (read, read_image, glob, grep) off, or limited to a knowledge folder.'
export const PERSON_NO_HOST = 'This DeepSeek Harness cannot mount a capability into one Session yet (it needs a newer Bot team), so the child answers without it.'

const Name = z.string().trim().min(1).max(200)
const Capability = z.union([
  Name.transform(name => ({ name, secrets: [] })),
  z.object({ name: Name, secrets: z.array(Name).max(20).optional() }).transform(({ name, secrets = [] }) => ({ name, secrets: [...new Set(secrets)].sort() })),
])
// What /access/check answers about the rule that decided; anything else here binds nothing.
const Rule = z.object({
  id: z.string().min(1), ruleType: z.string(),
  platformUserId: z.string().nullish(), phonePattern: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
}).passthrough()

/**
 * The person an allow rule names, as `{ ruleId, context, capability }`, or null for a rule that
 * does not name one person: a deny, one with no exact sender, or any wildcard pattern (then it
 * cannot tell which person it matched, even beside an exact id).
 */
export function personOfRule(raw) {
  const rule = Rule.safeParse(raw)
  if (!rule.success || rule.data.ruleType !== 'allow') return null
  const { id, platformUserId, phonePattern, metadata } = rule.data
  if (String(phonePattern ?? '').includes('*') || (!platformUserId && !phonePattern)) return null
  const context = typeof metadata?.context === 'string' ? metadata.context.trim().slice(0, PERSON_CONTEXT_MAX) : ''
  const capability = Capability.safeParse(metadata?.capability)
  return { ruleId: id, context, capability: capability.success ? capability.data : null }
}

/** Why an answer bot's settings cannot bind persons, or undefined when they can. */
export function personBindingRefusal(answer) {
  if (answer.visibility === 'collective') return PERSON_COLLECTIVE
  // A knowledge folder limits every read tool to itself (thread-tools.js knowledgeRefusal).
  if (answer.allowedTools.length > 0 && !answer.knowledgeFolder) return PERSON_UNLIMITED_READS
  return undefined
}

// The Bot team's call that mounts one capability into one Session (bots-dsh contract v1,
// rt.mountCapability / rt.unmountCapability). Its tools carry `mcp__<name>__` and live in that
// Session's agent scope only.
const MOUNT_STATES = ['ready', 'connecting', 'needs-approval', 'error']
const Mounted = z.object({ state: z.enum(MOUNT_STATES), toolPrefix: z.string(), error: z.string().optional() }).passthrough()
export const toolPrefixOf = name => `mcp__${name}__`

/**
 * The one adapter between person binding and the Bot team's mount call, found at call time so a
 * newer team is used as soon as it is there. `mount` answers `{ ok: true, toolPrefix, state }`
 * when the Session holds the capability's tools (ready, or connecting in the background), else
 * `{ ok: false, reason }`; it never binds while the host call is missing.
 */
export function capabilityHost(rt) {
  const available = () => typeof rt.mountCapability === 'function' && typeof rt.unmountCapability === 'function'
  return {
    available,
    async mount(sessionId, capability) {
      if (!available()) return { ok: false, reason: PERSON_NO_HOST }
      let reply
      try {
        reply = Mounted.safeParse(await rt.mountCapability(sessionId, capability.name, { secrets: capability.secrets }))
      } catch (error) {
        return { ok: false, reason: error?.message ?? String(error) }
      }
      if (!reply.success) return { ok: false, reason: 'The Bot team answered the mount in a form this plugin does not know.' }
      const { state, toolPrefix, error } = reply.data
      // Only the exact prefix: a wider one would let the child call other tools by name.
      if (toolPrefix !== toolPrefixOf(capability.name)) return { ok: false, reason: `The Bot team answered tool prefix ${JSON.stringify(toolPrefix)} for capability ${JSON.stringify(capability.name)}.` }
      if (state === 'ready' || state === 'connecting') return { ok: true, toolPrefix, state }
      return { ok: false, reason: state === 'needs-approval' ? 'The capability\'s server is not approved yet.' : `The capability failed: ${error ?? 'no reason given'}` }
    },
    async unmount(sessionId, name) {
      if (!available()) return false
      return (await rt.unmountCapability(sessionId, name)) === true
    },
  }
}
