// RFC-0001: answer subscriptions obey the instance's intake policy before any child
// is created or woken. Ordinary automations keep their own admission contract.
import { z } from 'zod'

const TTL_MS = 30_000
const CACHE_MAX = 1_000
const instanceReply = z.object({ data: z.object({ channel: z.string().min(1), inboundMaxAgeMinutes: z.number().finite() }) })
const chatReply = z.object({ data: z.object({ chatType: z.string(), externalId: z.string(), instanceId: z.string() }) })
const accessReply = z.object({ data: z.object({ allowed: z.boolean() }) })
const rawSchema = z.object({
  isFromMe: z.boolean().optional(), isHistorySync: z.boolean().optional(), ingestMode: z.string().optional(),
  upsertType: z.string().optional(), resolvedSenderPhone: z.string().optional(),
  messageTimestamp: z.union([z.number(), z.string(), z.object({ low: z.number(), high: z.number().optional() })]).nullish(),
  key: z.object({ remoteJid: z.string().nullish(), participantAlt: z.string().nullish() }).passthrough().nullish(),
}).passthrough()

// Same seconds/milliseconds and unsigned protobuf Long handling as Omni's
// extractPlatformTimestamp/isInboundTooStale. Missing timestamps mean now.
function tooOld(raw, minutes) {
  if (minutes <= 0) return false
  const value = raw.messageTimestamp
  const timestamp = typeof value === 'object' && value !== null
    ? ((value.high ?? 0) >>> 0) * 0x100000000 + (value.low >>> 0) : Number(value)
  if (!timestamp || Number.isNaN(timestamp)) return false
  return Date.now() - new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).getTime() > minutes * 60_000
}

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
  return async row => {
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
      if (tooOld(raw, instance.inboundMaxAgeMinutes)) return false
      const chat = await cached(`chat:${row.chatUuid}`, () => read('GET', `/chats/${encodeURIComponent(row.chatUuid)}`, chatReply))
      if (chat.instanceId !== row.instanceId || chat.chatType !== 'dm' || forbiddenJid(chat.externalId)) return false
      // Proven staff receipts are checked separately against the canonical message.
      // Staff is not the external sender and must not depend on the person's allowlist.
      if (raw.isFromMe === true) return true
      const primary = row.metadata?.from
      if (typeof primary !== 'string' || !primary) return false
      const phone = value => typeof value === 'string' && /^\d{7,15}$/.test(value) ? value : undefined
      const ids = [...new Set([primary, phone(raw.key?.participantAlt?.replace(/@.*$/, '')), phone(raw.resolvedSenderPhone)].filter(Boolean))]
      return await cached(JSON.stringify(['access', row.instanceId, instance.channel, ids]), async () => {
        for (const platformUserId of ids) {
          const result = await read('POST', '/access/check', accessReply, { instanceId: row.instanceId, platformUserId, channel: instance.channel })
          if (result.allowed) return true
        }
        return false
      }, value => value === true)
    } catch {
      if (!warned.has(row.instanceId)) {
        warned.add(row.instanceId)
        rt.warn('ds-bot: answer intake check failed for instance %s; refusing messages', row.instanceId)
      }
      return false
    }
  }
}
