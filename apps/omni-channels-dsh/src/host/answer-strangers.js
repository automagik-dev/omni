// #1713: a person no allow rule lets in gets one reply instead of silence. The text is the
// answer bot's own (strangerReply in its answer settings, threads.js); with none set, such a
// sender stays refused in silence, as before. Who gets it: a sender the answer intake refuses as
// `denied` (answer-intake.js), and a sender known only by their lid that the kept message's
// re-checks still do not match once their window ends, or that a re-check finds by a phone no
// rule allows (answer-kept.js). Never to a sender a rule of its own refuses (block or
// silent_block, on any of their ids): only the allowlist's default refusal gets it. Never on a
// check that failed, a message too old, any other gate, a group, a broadcast, history or the
// number's own side: those are never `denied`.
//
// The reply goes once a day per chat, in the chat the person wrote from, through Omni's send
// for that chat (its externalId, as needs-staff.js sends), only after their own message. The
// day's mark is in the team's saved state before the send, so a restart or a second message in
// between sends nothing more. A failed send takes the mark back, so the person's next message
// tries again; nothing tries on a timer, and the failure is warned once per chat until a send
// there works. No answer child is made or woken for them: their message stays refused.
//
// Each person who gets it is an access request: one row per chat for the bot, with the ids they
// wrote from, their first text, and when and how often they wrote. Staff read the rows in the
// answer settings, through the omni-answer-requests route; no tool reads them, so no answer
// child or other Session can.
import { z } from 'zod'
import { answerSettingsOf } from './threads.js'

const DAY_MS = 24 * 60 * 60_000
export const REPLIED_MAX = 5_000
export const REQUESTS_MAX = 500
export const REQUEST_TEXT_MAX = 500
const SENDERS_MAX = 5
const ChatRow = z.object({ data: z.object({ instanceId: z.string(), chatType: z.string(), externalId: z.string().min(1).max(500) }).passthrough() })
const RequestsBody = z.object({ botId: z.string().min(1) }).strict()
const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })

// The ids the person wrote from, as the intake checks them: their sender id, then a phone
// beside it.
function sendersOf(row) {
  const phone = value => (typeof value === 'string' && /^\d{7,15}$/.test(value) ? value : undefined)
  const raw = row.rawPayload ?? {}
  return [...new Set([row.metadata?.from, phone(raw.key?.participantAlt?.replace(/@.*$/, '')), phone(raw.resolvedSenderPhone)]
    .filter(id => typeof id === 'string' && id !== ''))]
}
const firstTextOf = row => (typeof row.textContent === 'string' && row.textContent.trim() !== ''
  ? row.textContent : `(${row.contentType ?? 'message'})`).slice(0, REQUEST_TEXT_MAX)

// Keeps the newest `max` entries of a map by `at`.
function bound(map, max, at) {
  const keys = Object.keys(map)
  if (keys.length <= max) return
  for (const key of keys.sort((a, b) => at(map[a]) - at(map[b])).slice(0, keys.length - max)) delete map[key]
}

export function install(rt) {
  const failing = new Set()
  const replied = () => (rt.state.omniStrangerReplies ??= {})
  const requestsOf = botId => ((rt.state.omniAnswerRequests ??= {})[botId] ??= {})

  function note(row, botId, now) {
    const rows = requestsOf(botId)
    const at = Math.min(Date.parse(row.receivedAt) || now, now)
    const known = rows[row.chatUuid]
    if (known) Object.assign(known, { lastAt: Math.max(known.lastAt, at), count: known.count + 1, senders: [...new Set([...known.senders, ...sendersOf(row)])].slice(0, SENDERS_MAX) })
    else rows[row.chatUuid] = { instanceId: row.instanceId, chatUuid: row.chatUuid, senders: sendersOf(row).slice(0, SENDERS_MAX), text: firstTextOf(row), firstAt: at, lastAt: at, count: 1 }
    bound(rows, REQUESTS_MAX, entry => entry.lastAt)
  }

  // True when Omni took the reply.
  async function send(row, botId, text) {
    let why
    try {
      if (rt.canChannel?.(botId, row.instanceId, 'write') === false) why = 'the channel is not this bot\'s'
      else {
        const found = await rt.omniRequest('GET', `/chats/${encodeURIComponent(row.chatUuid)}`)
        const chat = found?.ok ? ChatRow.safeParse(await found.json().catch(() => null)) : undefined
        if (!chat?.success || chat.data.data.instanceId !== row.instanceId || chat.data.data.chatType !== 'dm') why = `Omni answered ${found?.status ?? 'nothing'} for the chat`
        else {
          const sent = await rt.omniRequest('POST', '/messages/send', { body: { instanceId: row.instanceId, to: chat.data.data.externalId, text } })
          if (!sent?.ok) why = `Omni answered ${sent?.status ?? 'nothing'} for the reply`
        }
      }
    } catch (error) { why = error?.message ?? String(error) }
    const key = `${row.instanceId}:${row.chatUuid}`
    if (why === undefined) { failing.delete(key); return true }
    if (!failing.has(key)) {
      failing.add(key)
      rt.warn('omni-channels: the reply to a person no rule lets in was not sent in chat %s (tried again on their next message): %s', row.chatUuid, why)
    }
    return false
  }

  // A message of a sender no rule lets in, on a bot's answer channel; `blocked`, the intake's word
  // that a rule of its own refused one of their ids. True when the bot answers, has a reply text
  // and the sender is not blocked: the message is taken (a request noted, and the reply sent
  // unless the chat had it within a day); false otherwise, and nothing changed.
  rt.answerStranger = async (row, botId, { blocked = false } = {}) => {
    const { enabled, strangerReply: text } = answerSettingsOf(rt.botOf(botId))
    if (blocked || !enabled || text === null || !row?.instanceId || !row.chatUuid || row.rawPayload?.isFromMe === true) return false
    const now = Date.now()
    note(row, botId, now)
    // Checked and marked with no wait between: a live message and a re-check at once send once.
    const key = `${row.instanceId}:${row.chatUuid}`
    const due = !(now - (replied()[key] ?? -Infinity) < DAY_MS)
    if (due) {
      replied()[key] = now
      for (const [other, at] of Object.entries(replied())) if (now - at >= DAY_MS) delete replied()[other]
      bound(replied(), REPLIED_MAX, at => at)
    }
    // Not saved: the day's mark goes again, so the message tried again can still get the reply.
    try { await rt.save() } catch (error) {
      if (due && replied()[key] === now) delete replied()[key]
      throw error
    }
    if (due && !await send(row, botId, text) && replied()[key] === now) {
      delete replied()[key]
      await rt.save().catch(error => rt.warn('omni-channels: saving the reply marks failed: %s', error?.message ?? error))
    }
    return true
  }

  // Staff only: the bot's requests, newest first.
  rt.ctx.effect(() => rt.hooks.endpoint('omni-answer-requests', async (body) => {
    const { botId } = RequestsBody.parse(body ?? {})
    await rt.load()
    if (rt.botOf(botId)?.kind !== 'omni') throw refused('Requests belong to a channel bot.')
    const rows = Object.values(rt.state.omniAnswerRequests?.[botId] ?? {}).sort((a, b) => b.lastAt - a.lastAt)
    return { count: rows.length, requests: rows }
  }, { read: true }), 'omni-channels: omni-answer-requests')
}
