// #1706: a person's message is never lost because Omni knew them only by their lid when it
// arrived. A WhatsApp sender can arrive as a lid with no phone beside it while their phone is
// still being looked up; a phone access rule cannot match them yet. The intake refuses such a
// message as `unmatched` (answer-intake.js); it is kept here, in the plugin's saved state, and
// checked again with the phone Omni learns afterwards: the chat's canonicalId, which Omni sets
// to the phone JID once it knows it (GET /chats/{id}). The person is answered when the re-check
// admits them, or when a later message of theirs in that chat is admitted, oldest first and
// once. A message still unmatched at the end of the re-check window shows for staff (one
// warning and the bot's sidebar marker) when the instance has an allow rule by phone; an
// instance with no phone allow rule refuses it as before, without staff noise. A kept message
// is dropped once older than the instance's inboundMaxAgeMinutes, by its platform timestamp.
import { z } from 'zod'
import { platformTimeOf } from './answer-intake.js'

// When to check a kept message again, after it was kept; then every minute until it is too old.
// The window ends with the last of these.
const RECHECK_MS = [2_000, 10_000, 30_000]
const RECHECK_EVERY_MS = 60_000
const DEFAULT_MINUTES = 10
const PER_CHAT_MAX = 20
const KEPT_MAX = 200
const TEXT_MAX = 2_000
const chatReply = z.object({ data: z.object({ instanceId: z.string(), chatType: z.string(), canonicalId: z.string().nullish() }).passthrough() })
const rulesReply = z.object({ items: z.array(z.object({ phonePattern: z.string().nullish(), enabled: z.boolean().nullish() }).passthrough()) })
const text = z.string().nullish()
const keptSchema = z.object({
  row: z.object({ id: z.string(), journalSeq: z.number().optional(), chatUuid: z.string(), instanceId: z.string(), externalId: text }).passthrough(),
  botId: z.string(), keptAt: z.number(), until: z.number(), checks: z.number().int().nonnegative(), nextAt: z.number(),
  waiting: z.boolean(),
})

// Only what admission, dispatch and the worker's event read, so the saved state stays small.
function keptRow(row) {
  const raw = row.rawPayload ?? {}
  const key = raw.key && typeof raw.key === 'object' ? raw.key : undefined
  const pick = (from, names) => Object.fromEntries(names.filter(name => from?.[name] !== undefined).map(name => [name, from[name]]))
  return {
    ...pick(row, ['id', 'eventType', 'journalSeq', 'direction', 'chatUuid', 'instanceId', 'externalId', 'receivedAt', 'contentType', 'mediaUrl', 'mediaMimeType', 'chatId', 'chatType', 'ingestMode']),
    ...(typeof row.textContent === 'string' ? { textContent: row.textContent.slice(0, TEXT_MAX) } : {}),
    metadata: pick(row.metadata, ['from', 'ingestMode']),
    rawPayload: {
      ...pick(raw, ['upsertType', 'isFromMe', 'isHistorySync', 'ingestMode', 'messageTimestamp', 'resolvedSenderPhone', 'resolvedPhoneJid', 'addressingMode', 'senderIsLid', 'isMentioningInstance']),
      ...(key ? { key: pick(key, ['id', 'remoteJid', 'remoteJidAlt', 'participant', 'participantAlt', 'fromMe']) } : {}),
    },
  }
}

// When a kept message is next looked at: its next check, or the moment it gets too old, so it is
// dropped then and not up to a minute later.
const dueAt = entry => Math.min(entry.nextAt, entry.until + 1)

// The phone a chat's canonicalId names, when it is a phone JID.
const phoneOf = canonicalId => /^(\d{7,15})(?::\d+)?@s\.whatsapp\.net$/.exec(canonicalId ?? '')?.[1]

/**
 * `admit`: the answer intake (answer-intake.js). `dispatch(row, admission)`: hand a kept row to
 * its answer child the way a live row goes (omni-events.js dispatch); it answers `cancelled`
 * when the plugin is stopping, so the row stays kept for the next start.
 */
export function answerKept(rt, { admit, dispatch }) {
  const { state } = rt
  const kept = () => (state.omniAnswerKept ??= {})
  let tail = Promise.resolve(), timer, stopped = false
  // One thing at a time: a re-check, a later message releasing its chat, a keep.
  const serial = work => (tail = tail.then(work, work))

  function entries(chatUuid) {
    return Object.values(kept()).filter(entry => keptSchema.safeParse(entry).success && (chatUuid === undefined || entry.row.chatUuid === chatUuid))
      // Oldest first: kept in the journal's order, which a frozen or coarse clock cannot tell apart.
      .sort((a, b) => a.keptAt - b.keptAt || (a.row.journalSeq ?? 0) - (b.row.journalSeq ?? 0) || a.row.id.localeCompare(b.row.id))
  }

  function schedule() {
    clearTimeout(timer)
    timer = undefined
    if (stopped) return
    const next = Math.min(...entries().map(dueAt))
    if (!Number.isFinite(next)) return
    timer = setTimeout(() => { timer = undefined; serial(recheckDue) }, Math.max(0, next - Date.now()))
  }

  function drop(entry, reason) {
    delete kept()[entry.row.id]
    if (entry.waiting) rt.warn('omni-channels: a message waiting in chat %s was dropped: %s', entry.row.chatUuid, reason)
  }

  // A message the intake refused only because its sender is known by their lid alone. Saved
  // before the events stream acks its row; a replayed row keeps its first entry.
  async function keep(row, { botId, minutes }) {
    await serial(async () => {
      if (kept()[row.id]) return
      const now = Date.now()
      const at = platformTimeOf(row.rawPayload) ?? now
      const limit = typeof minutes === 'number' && minutes > 0 ? minutes : DEFAULT_MINUTES
      kept()[row.id] = { row: keptRow(row), botId, keptAt: now, until: at + limit * 60_000, checks: 0, nextAt: now + RECHECK_MS[0], waiting: false }
      const chat = entries(row.chatUuid)
      for (const entry of chat.slice(0, Math.max(0, chat.length - PER_CHAT_MAX))) drop(entry, 'too many messages waiting in one chat')
      const all = entries()
      for (const entry of all.slice(0, Math.max(0, all.length - KEPT_MAX))) drop(entry, 'too many messages waiting')
      schedule()
      await rt.save()
    })
  }

  // Hand one kept message over, then forget it. A crash in between replays it, and the answer
  // run's own record (subscriptions.js answerIdentity) keeps it from running twice.
  async function hand(entry, admission) {
    if (Date.now() > entry.until) { drop(entry, 'older than the channel answers'); return }
    let result
    try { result = await dispatch(entry.row, admission) } catch (error) {
      rt.warn('omni-channels: a kept message in chat %s was not handed over: %s', entry.row.chatUuid, error?.message ?? error)
    }
    if (result === 'cancelled') return
    delete kept()[entry.row.id]
  }

  // A later message from the chat was admitted (`admission`): its kept messages go first,
  // oldest first, bound by the rule that admitted it.
  async function release(chatUuid, admission) {
    if (!chatUuid || entries(chatUuid).length === 0) return
    await serial(async () => {
      const waiting = entries(chatUuid)
      if (waiting.length === 0) return
      for (const entry of waiting) await hand(entry, admission)
      schedule()
      await rt.save()
    })
  }

  async function chatPhone(row) {
    try {
      const response = await rt.omniRequest('GET', `/chats/${encodeURIComponent(row.chatUuid)}`)
      if (!response?.ok) return undefined
      const chat = chatReply.parse(await response.json()).data
      return chat.instanceId === row.instanceId && chat.chatType === 'dm' ? phoneOf(chat.canonicalId) : undefined
    } catch { return undefined }
  }

  // Whether the instance has an enabled allow rule by phone; true when that cannot be read,
  // so staff see the message rather than miss it.
  async function phoneRules(instanceId) {
    try {
      const response = await rt.omniRequest('GET', `/access/rules?instanceId=${encodeURIComponent(instanceId)}&type=allow`)
      if (!response?.ok) return true
      return rulesReply.parse(await response.json()).items.some(rule => rule.enabled !== false && typeof rule.phonePattern === 'string' && rule.phonePattern.trim() !== '')
    } catch { return true }
  }

  async function recheck(entry) {
    const phone = await chatPhone(entry.row)
    const row = phone ? { ...entry.row, rawPayload: { ...entry.row.rawPayload, resolvedSenderPhone: phone } } : entry.row
    let why, blocked
    const admission = await admit(row, { detail: true, refused: (reason, info) => { why = reason; blocked = info?.blocked } })
    if (admission !== false) {
      // Releasing hands over the chat's older kept messages too, oldest first.
      for (const earlier of entries(entry.row.chatUuid)) await hand(earlier, admission)
      return
    }
    // A known phone that no rule allows, a message too old, or one another gate refuses now:
    // refused as before. Unmatched, or a check that failed: kept for the next check.
    // #1713: with the bot's reply set (answer-strangers.js), a phone no rule allows, or a sender
    // still unmatched once the window ends, gets it and leaves at once, with no warning or marker.
    const replied = async () => { if (!await rt.answerStranger?.(row, entry.botId, { blocked })) return false; delete kept()[entry.row.id]; return true }
    if (why === 'denied' && await replied()) return
    if (!['unmatched', 'failed'].includes(why)) { drop(entry, `refused (${why})`); return }
    entry.checks += 1
    const windowEnded = entry.checks >= RECHECK_MS.length
    if (windowEnded && why === 'unmatched' && await replied()) return
    if (windowEnded && !entry.waiting && !phone && await phoneRules(entry.row.instanceId)) {
      entry.waiting = true
      const minutes = Math.round((entry.until - (platformTimeOf(entry.row.rawPayload) ?? entry.keptAt)) / 60_000)
      rt.warn('omni-channels: a message in chat %s is waiting: its sender is not matched yet (Omni does not know their phone); it is answered once their phone is known or they write again, or dropped after %d minutes', entry.row.chatUuid, minutes)
    }
    entry.nextAt = windowEnded ? Date.now() + RECHECK_EVERY_MS : entry.keptAt + RECHECK_MS[entry.checks]
  }

  async function recheckDue() {
    if (stopped) return
    const now = Date.now()
    for (const entry of entries()) {
      if (stopped) break
      if (!kept()[entry.row.id] || dueAt(entry) > now) continue
      if (now > entry.until) { drop(entry, 'older than the channel answers'); continue }
      try { await recheck(entry) } catch (error) {
        entry.nextAt = Date.now() + RECHECK_EVERY_MS
        rt.warn('omni-channels: re-checking a kept message failed: %s', error?.message ?? error)
      }
    }
    // The next check is set before the save, so it runs from the times just decided.
    schedule()
    await rt.save().catch(error => rt.warn('omni-channels: saving kept messages failed: %s', error?.message ?? error))
  }

  return {
    keep,
    release,
    // After a start: the saved messages are checked again from their saved times.
    arm() {
      for (const [id, entry] of Object.entries(kept())) if (!keptSchema.safeParse(entry).success || Date.now() > entry.until) delete kept()[id]
      schedule()
    },
    // Stopping: no check starts from now on; `settled` waits for the one in hand.
    stop() {
      stopped = true
      clearTimeout(timer)
      timer = undefined
    },
    settled: () => tail,
    // Per Bot, how many of its messages wait for staff's eyes (the sidebar marker).
    waitingView() {
      const view = {}
      for (const entry of entries()) if (entry.waiting) view[entry.botId] = (view[entry.botId] ?? 0) + 1
      return view
    },
  }
}
