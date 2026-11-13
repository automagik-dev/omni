// RFC-0001: answer subscriptions obey the instance's intake policy before any child
// is created or woken. Ordinary automations keep their own admission contract.
import { z } from 'zod'
import { personOfRule } from './person-binding.js'

const TTL_MS = 30_000
const CACHE_MAX = 1_000
const instanceReply = z.object({ data: z.object({ channel: z.string().min(1), inboundMaxAgeMinutes: z.number().finite() }) })
const chatReply = z.object({ data: z.object({ chatType: z.string(), externalId: z.string(), instanceId: z.string() }) })
// #1704: the rule that decided rides along; only person binding reads it (person-binding.js).
const accessReply = z.object({ data: z.object({ allowed: z.boolean(), rule: z.unknown().optional() }) })
const rawSchema = z.object({
  isFromMe: z.boolean().optional(), isHistorySync: z.boolean().optional(), ingestMode: z.string().optional(),
  upsertType: z.string().optional(), resolvedSenderPhone: z.string().optional(),
  messageTimestamp: z.union([z.number(), z.string(), z.object({ low: z.number(), high: z.number().optional() })]).nullish(),
  key: z.object({ remoteJid: z.string().nullish(), participantAlt: z.string().nullish() }).passthrough().nullish(),
}).passthrough()

// Same seconds/milliseconds and unsigned protobuf Long handling as Omni's
// extractPlatformTimestamp/isInboundTooStale. Missing timestamps mean now (undefined here).
export function platformTimeOf(raw) {
  const value = raw?.messageTimestamp
  const timestamp = typeof value === 'object' && value !== null
    ? ((value.high ?? 0) >>> 0) * 0x100000000 + (value.low >>> 0) : Number(value)
  if (!timestamp || Number.isNaN(timestamp)) return undefined
  return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).getTime()
}
function tooOld(raw, minutes) {
  if (minutes <= 0) return false
  const at = platformTimeOf(raw)
  return at !== undefined && Date.now() - at > minutes * 60_000
}
// #1706: a sender Omni knows only by their lid, with no phone beside it yet.
const lidAddressed = (row, raw, primary) => primary.endsWith('@lid') || raw.addressingMode === 'lid' || raw.senderIsLid === true
  || [row.chatId, raw.key?.remoteJid].some(jid => typeof jid === 'string' && jid.endsWith('@lid'))

export function answerIntake(rt) {
  const cache = new Map(), warned = new Set()
  async function cached(key, read, cacheWhen = () => true) {
    const now = Date.now(), hit = cache.get(key)
    if (hit && now - hit.at < TTL_MS) return hit.value
    const value = await read()
    if (!cacheWhen(value)) return value
    for (const [key, entry] of cache) if (now - entry.at >= TTL_MS) cache.delete(key)
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
    cache.set(key, { at: now, value })
    return value
  }
  async function read(method, path, schema, body) {
    const response = await rt.omniRequest(method, path, body ? { body } : undefined)
    if (!response?.ok) throw new Error('answer intake unavailable')
    return schema.parse(await response.json()).data
  }
  // `detail`: false, or what admitted the message: `{ person }`, the person the allow rule names
  // (null when no rule, or a rule that names no one person, admitted it), or `{ staff: true }`.
  // `refused(why, { minutes })`, told once for a refusal (#1706): `unmatched`, a sender known
  // only by their lid whom no rule matched (their phone may resolve later); `denied`, any other
  // sender no rule matched; `failed`, a check that could not be made; `stale`, older than the
  // instance's inboundMaxAgeMinutes; `filtered`, any other gate. The answer stays false.
  // #1713: `blocked` beside `unmatched` or `denied`: a rule of its own (block or silent_block)
  // refused one of the sender's ids, not the allowlist's default.
  return async (row, { detail = false, refused } = {}) => {
    let why = 'filtered', minutes, blocked = false
    const admitted = await admit(row, (reason, value, ruled = false) => { why = reason; minutes = value; blocked = ruled })
    if (admitted === false) refused?.(why, { minutes, blocked })
    return detail || admitted === false ? admitted : true
  }
  async function admit(row, refusal) {
    if (!row.instanceId || !row.chatUuid) return false
    const parsed = rawSchema.safeParse(row.rawPayload ?? {})
    if (!parsed.success) return false
    const raw = parsed.data
    if (raw.isHistorySync === true || raw.ingestMode === 'history-sync'
      || row.ingestMode === 'history-sync' || row.metadata?.ingestMode === 'history-sync') return false
    const forbiddenJid = jid => typeof jid === 'string' && (jid.endsWith('@g.us') || jid === 'status@broadcast')
    if (forbiddenJid(row.chatId) || forbiddenJid(raw.key?.remoteJid)
      || (row.chatType != null && row.chatType !== 'dm')) return false
    try {
      const instance = await cached(`instance:${row.instanceId}`, () => read('GET', `/instances/${encodeURIComponent(row.instanceId)}`, instanceReply))
      // The journal drops envelope ingestMode. Baileys annotates live upserts with
      // notify; initial history has no upsertType. Require that positive live proof
      // only for Baileys, preserving Cloud API and other channels.
      if (instance.channel === 'whatsapp-baileys' && raw.upsertType !== 'notify') return false
      if (tooOld(raw, instance.inboundMaxAgeMinutes)) { refusal('stale', instance.inboundMaxAgeMinutes); return false }
      const chat = await cached(`chat:${row.chatUuid}`, () => read('GET', `/chats/${encodeURIComponent(row.chatUuid)}`, chatReply))
      if (chat.instanceId !== row.instanceId || chat.chatType !== 'dm' || forbiddenJid(chat.externalId)) return false
      // Proven staff receipts are checked separately against the canonical message.
      // Staff is not the external sender and must not depend on the person's allowlist.
      if (raw.isFromMe === true) return { staff: true }
      const primary = row.metadata?.from
      if (typeof primary !== 'string' || !primary) return false
      const phone = value => typeof value === 'string' && /^\d{7,15}$/.test(value) ? value : undefined
      const ids = [...new Set([primary, phone(raw.key?.participantAlt?.replace(/@.*$/, '')), phone(raw.resolvedSenderPhone)].filter(Boolean))]
      let ruled = false
      const admitted = await cached(JSON.stringify(['access', row.instanceId, instance.channel, ids]), async () => {
        for (const platformUserId of ids) {
          const result = await read('POST', '/access/check', accessReply, { instanceId: row.instanceId, platformUserId, channel: instance.channel })
          if (result.allowed) return { person: personOfRule(result.rule) }
          if (result.rule != null) ruled = true
        }
        return false
      }, value => value !== false)
      if (admitted === false) refusal(ids.length === 1 && lidAddressed(row, raw, primary) ? 'unmatched' : 'denied', instance.inboundMaxAgeMinutes, ruled)
      return admitted
    } catch {
      refusal('failed')
      if (!warned.has(row.instanceId)) {
        warned.add(row.instanceId)
        rt.warn('ds-bot: answer intake check failed for instance %s; refusing messages', row.instanceId)
      }
      return false
    }
  }
}
