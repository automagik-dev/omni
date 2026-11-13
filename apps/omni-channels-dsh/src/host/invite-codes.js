// #1716: the invite code list, the interim source behind Redeem (invite-redeem.js). Codes are
// minted elsewhere; staff upload them here (answer-invites.js), install-wide, kept in the
// team's saved state (omniInviteCodes), the newest INVITE_CODES_MAX. Each code belongs to one
// project and is used once, before its expiry; its record holds the project, the invite's id,
// and the context and capability its person's access rule gets (person-binding.js).
//
// A code is "INV-" and 9 Crockford base32 characters (0-9 and A-Z but I, L, O, U). Found in a
// message, and stored at upload, the same way: upper-cased, then in the 9-character tail only,
// O read as 0 and I and L as 1, then kept only when the tail is Crockford. So a hand-typed
// "inv-7k2qx9mdo" is the code INV-7K2QX9MD0. Nothing else in a message is ever read as a code.
//
// Codes never appear in a log or warning: every message here names a code by its place.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

export const INVITE_CODES_MAX = 5_000
// At most this many codes are read from one message.
export const CODES_PER_MESSAGE = 2
// Omni's own cap on a rule's metadata (routes/v2/access.ts RULE_METADATA_MAX_BYTES).
export const RULE_METADATA_MAX_BYTES = 16 * 1024
export const INVITE_CONTEXT_MAX = 8000

const LOOSE = /\bINV-[0-9A-Z]{9}\b/g
const STRICT = /^[0-9A-HJKMNP-TV-Z]{9}$/
const tailOf = tail => tail.replace(/O/g, '0').replace(/[IL]/g, '1')

/** The code a loose `INV-xxxxxxxxx` stands for, or undefined when it is none. */
export function normalizeCode(value) {
  if (typeof value !== 'string') return undefined
  const loose = /^\s*INV-([0-9A-Z]{9})\s*$/.exec(value.toUpperCase())
  const tail = loose ? tailOf(loose[1]) : ''
  return STRICT.test(tail) ? `INV-${tail}` : undefined
}

/** The codes a message's text carries, normalised, in their order, at most CODES_PER_MESSAGE. */
export function codesIn(text) {
  if (typeof text !== 'string' || text === '') return []
  const found = []
  for (const [loose] of text.toUpperCase().matchAll(LOOSE)) {
    const tail = tailOf(loose.slice(4))
    const code = `INV-${tail}`
    if (STRICT.test(tail) && !found.includes(code)) found.push(code)
    if (found.length === CODES_PER_MESSAGE) break
  }
  return found
}

const Name = z.string().trim().min(1).max(200)
// The capability shape person binding reads (person-binding.js).
const Capability = z.union([Name, z.object({ name: Name, secrets: z.array(Name).max(20).optional() }).strict()])
const Entry = z.object({
  code: z.string().max(64),
  project: Name,
  expiresAt: z.iso.datetime({ offset: true }),
  context: z.string().max(INVITE_CONTEXT_MAX).optional(),
  capability: Capability.optional(),
  inviteId: Name.optional(),
}).strict()
export const Upload = z.object({ entries: z.array(z.unknown()).min(1).max(INVITE_CODES_MAX) }).strict()
const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })

// The allow rule's metadata for a code's record, or for Redeem's ok (answer-invites.js writes it).
export const ruleMetadataOf = entry => ({
  source: 'invite', project: entry.project, inviteId: entry.inviteId,
  ...(entry.context ? { context: entry.context } : {}), ...(entry.capability ? { capability: entry.capability } : {}),
})

/** The list's state of a code record: `open`, `used` or `expired`. */
export const stateOf = (record, now = Date.now()) => (record.used ? 'used' : Date.parse(record.expiresAt) <= now ? 'expired' : 'open')

export function inviteCodes(rt) {
  const list = () => (rt.state.omniInviteCodes ??= {})

  // Staff's upload: every entry is checked first, so one bad entry changes nothing. An open code
  // already listed takes the new project, expiry, context and capability, and keeps its invite's
  // id unless one is given. A used code is left as it is, so its person's retry still gets the
  // same ok.
  async function add(body) {
    const { entries } = Upload.parse(body ?? {})
    const checked = entries.map((raw, index) => {
      const entry = Entry.safeParse(raw)
      const where = `Entry ${index + 1}`
      if (!entry.success) throw refused(`${where}: ${entry.error.issues[0]?.path.join('.') || 'entry'} is not valid (${entry.error.issues[0]?.message ?? 'unreadable'}).`)
      const code = normalizeCode(entry.data.code)
      if (code === undefined) throw refused(`${where}: the code is not an invite code (INV- and 9 letters or digits).`)
      const { code: _typed, ...fields } = entry.data
      const record = { ...fields, code, inviteId: fields.inviteId ?? list()[code]?.inviteId ?? randomUUID() }
      if (new TextEncoder().encode(JSON.stringify(ruleMetadataOf(record))).length > RULE_METADATA_MAX_BYTES) throw refused(`${where}: its context and capability are more than an access rule holds (16 KB).`)
      return record
    })
    const before = structuredClone(list())
    let added = 0, updated = 0, used = 0
    for (const record of checked) {
      const known = list()[record.code]
      if (known?.used) { used += 1; continue }
      if (known) updated += 1
      else added += 1
      // Re-inserted, so it counts as the newest.
      delete list()[record.code]
      list()[record.code] = { ...record, addedAt: Date.now() }
    }
    const codes = Object.keys(list())
    for (const code of codes.slice(0, Math.max(0, codes.length - INVITE_CODES_MAX))) delete list()[code]
    try { await rt.save() } catch (error) {
      rt.state.omniInviteCodes = before
      throw error
    }
    return { added, updated, used, count: Object.keys(list()).length }
  }

  // Newest first, with each code's state.
  function view(now = Date.now()) {
    return Object.values(list()).reverse().map(record => ({
      code: record.code, project: record.project, expiresAt: record.expiresAt, inviteId: record.inviteId,
      state: stateOf(record, now), ...(record.used ? { usedAt: record.used.at } : {}),
      ...(record.context ? { context: record.context } : {}),
    }))
  }

  // Redeem from the list (the contract in invite-redeem.js). The used mark is saved before ok is
  // answered; a failed save takes it back and throws, so the code stays open.
  async function redeem({ code: typed, sender }) {
    const code = normalizeCode(typed)
    const record = code === undefined ? undefined : list()[code]
    if (!record) return { ok: false, reason: 'unknown' }
    const ids = [sender.lid, sender.phone].filter(Boolean)
    const ok = () => ({ ok: true, project: record.project, inviteId: record.inviteId, ...(record.context ? { context: record.context } : {}), ...(record.capability ? { capability: record.capability } : {}) })
    if (record.used) {
      const by = [record.used.by?.lid, record.used.by?.phone].filter(Boolean)
      return ids.some(id => by.includes(id)) ? ok() : { ok: false, reason: 'used' }
    }
    if (stateOf(record) === 'expired') return { ok: false, reason: 'expired' }
    // Marked with no wait before it, so a second redeem at once finds it used.
    const used = { by: { ...(sender.lid ? { lid: sender.lid } : {}), ...(sender.phone ? { phone: sender.phone } : {}) }, at: Date.now() }
    record.used = used
    try { await rt.save() } catch (error) {
      if (record.used === used) delete record.used
      throw new Error(`the invite code list was not saved: ${error?.message ?? error}`)
    }
    return ok()
  }

  return { add, view, redeem }
}
