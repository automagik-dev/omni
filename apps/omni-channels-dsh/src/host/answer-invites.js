// #1716: a person whose first message carries a valid invite code is let in with no manual step.
// Who is checked: a sender on a bot's answer channel whom the answer intake refuses only by the
// allowlist's default (`denied`), or whom it knows only by their lid (`unmatched`), never one a
// rule of its own refuses (`blocked`), and never an admitted one (omni-events.js calls this only
// on such a refusal). Codes are read from the message's text (invite-codes.js codesIn); each is
// one Redeem call (invite-redeem.js), at most RATE_MAX per chat per hour.
//
// On ok: one allow rule for the sender's primary id (the id the intake checks first: their lid
// when Omni knows only that), with metadata { source: 'invite', project, inviteId, context?,
// capability? }, written unless Omni already lets that id in. The message is then admitted in
// the same pass, as if that rule had matched it, so person binding (person-binding.js) binds the
// person by it; a lid-only sender does not wait for the kept message's re-checks. With the bot's
// inviteWelcome set, the welcome is sent in the person's chat (Omni's send for that chat, as
// needs-staff.js sends) and the code message does not reach the child; with none, it reaches the
// child as any admitted message. A failed welcome is warned once; the person stays let in.
//
// Anything else, a code unknown, used or expired, a Redeem that fails or a rule Omni does not
// take, sends nothing: the message goes on as refused (the stranger reply, the kept message).
// Omni publishes no event when a rule is written (it publishes access.allowed/denied on checks),
// so the rules themselves are the record: allow rules whose metadata.source is 'invite'.
//
// Staff upload and read the code list on two routes (omni-invite-codes, omni-invite-codes-add);
// they are endpoints of the team's route, no tool reaches them, so no answer child or other
// Session can read or add a code. No code appears in a warning.
import { z } from 'zod'
import { lidAddressed } from './answer-intake.js'
import { codesIn, inviteCodes, ruleMetadataOf } from './invite-codes.js'
import { inviteRedeem } from './invite-redeem.js'
import { personOfRule } from './person-binding.js'
import { answerSettingsOf } from './threads.js'

export const RATE_MAX = 5
const RATE_WINDOW_MS = 60 * 60_000
const RATE_CHATS_MAX = 1_000
const Instance = z.object({ data: z.object({ channel: z.string().min(1) }).passthrough() })
const Checked = z.object({ data: z.object({ allowed: z.boolean(), rule: z.unknown().optional() }).passthrough() })
const Created = z.object({ data: z.unknown() })
const ChatRow = z.object({ data: z.object({ instanceId: z.string(), chatType: z.string(), externalId: z.string().min(1).max(500) }).passthrough() })
const NoBody = z.object({}).strict()
const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })
const phoneOf = value => (typeof value === 'string' && /^\d{7,15}$/.test(value.replace(/@.*$/, '')) ? value.replace(/@.*$/, '') : undefined)

// The sender as Redeem takes it: their lid when the message is lid-addressed, and a phone beside
// it; `primary`, the id the intake checks first and the allow rule names.
function senderOf(row) {
  const raw = row.rawPayload ?? {}
  const primary = row.metadata?.from
  if (typeof primary !== 'string' || primary === '') return undefined
  const lid = lidAddressed(row, raw, primary)
  const phone = [lid ? undefined : primary, raw.key?.participantAlt, raw.resolvedSenderPhone].map(phoneOf).find(Boolean)
  if (!lid && !phone) return undefined
  return { primary, ids: { ...(lid ? { lid: primary } : {}), ...(phone ? { phone } : {}) } }
}

export function install(rt) {
  const codes = inviteCodes(rt)
  const redeem = inviteRedeem(rt)
  const calls = new Map(), warned = new Set()

  // One Redeem call for the chat, unless it had RATE_MAX in the last hour.
  function take(key, now = Date.now()) {
    const recent = (calls.get(key) ?? []).filter(at => now - at < RATE_WINDOW_MS)
    calls.delete(key)
    if (recent.length >= RATE_MAX) { calls.set(key, recent); return false }
    calls.set(key, [...recent, now])
    while (calls.size > RATE_CHATS_MAX) calls.delete(calls.keys().next().value)
    return true
  }

  // Once per chat and kind until it works there again.
  function warn(kind, row, why) {
    const key = `${kind}:${row.instanceId}:${row.chatUuid}`
    if (warned.has(key)) return
    warned.add(key)
    rt.warn(`omni-channels: ${kind} in chat %s: %s`, row.chatUuid, why)
  }
  const worked = (kind, row) => warned.delete(`${kind}:${row.instanceId}:${row.chatUuid}`)

  // The allow rule that lets `platformUserId` in: the one Omni already has for it, or the one
  // written now. Throws when Omni does not answer or does not take it.
  async function allowRule(row, platformUserId, invite) {
    const instance = await rt.omniRequest('GET', `/instances/${encodeURIComponent(row.instanceId)}`)
    if (!instance?.ok) throw new Error(`Omni answered ${instance?.status ?? 'nothing'} for the channel`)
    const { channel } = Instance.parse(await instance.json()).data
    const check = await rt.omniRequest('POST', '/access/check', { body: { instanceId: row.instanceId, platformUserId, channel } })
    if (!check?.ok) throw new Error(`Omni answered ${check?.status ?? 'nothing'} for the access check`)
    const checked = Checked.parse(await check.json()).data
    if (checked.allowed) return checked.rule
    const created = await rt.omniRequest('POST', '/access/rules', { body: { instanceId: row.instanceId, ruleType: 'allow', action: 'allow', platformUserId, reason: 'invite', metadata: ruleMetadataOf(invite) } })
    if (!created?.ok) throw new Error(`Omni answered ${created?.status ?? 'nothing'} for the allow rule`)
    return Created.safeParse(await created.json().catch(() => null)).data?.data
  }

  // The welcome, in the person's chat; true when Omni took it.
  async function welcome(row, botId, text) {
    let why
    try {
      if (rt.canChannel?.(botId, row.instanceId, 'write') === false) why = 'the channel is not this bot\'s'
      else {
        const found = await rt.omniRequest('GET', `/chats/${encodeURIComponent(row.chatUuid)}`)
        const chat = found?.ok ? ChatRow.safeParse(await found.json().catch(() => null)) : undefined
        if (!chat?.success || chat.data.data.instanceId !== row.instanceId || chat.data.data.chatType !== 'dm') why = `Omni answered ${found?.status ?? 'nothing'} for the chat`
        else {
          const sent = await rt.omniRequest('POST', '/messages/send', { body: { instanceId: row.instanceId, to: chat.data.data.externalId, text } })
          if (!sent?.ok) why = `Omni answered ${sent?.status ?? 'nothing'} for the welcome`
        }
      }
    } catch (error) { why = error?.message ?? String(error) }
    if (why === undefined) { worked('the welcome after an invite code was not sent', row); return true }
    warn('the welcome after an invite code was not sent', row, `${why} (the person is let in)`)
    return false
  }

  // A message of a sender the intake refused by default or knows only by their lid, on bot
  // `botId`'s answer channel. `{ admission, welcomed }` when a code in it let them in, where
  // `admission` is the intake's answer for the rule (`{ person }`) and `welcomed` says the welcome
  // answers this message instead of the child; undefined when nothing changed.
  rt.answerInvite = async (row, botId) => {
    const found = codesIn(row?.textContent)
    if (found.length === 0 || !row.instanceId || !row.chatUuid || row.rawPayload?.isFromMe === true) return undefined
    const sender = senderOf(row)
    if (sender === undefined) return undefined
    for (const code of found) {
      if (!take(`${row.instanceId}:${row.chatUuid}`)) return undefined
      let invite
      try { invite = await redeem({ code, channel: 'whatsapp', sender: sender.ids }) } catch (error) {
        warn('an invite code could not be checked', row, error?.message ?? error)
        return undefined
      }
      if (!invite.ok) continue
      worked('an invite code could not be checked', row)
      let rule
      try { rule = await allowRule(row, sender.primary, invite) } catch (error) {
        warn('a person with a valid invite code was not let in', row, `${error?.message ?? error} (their next message with the code tries again)`)
        return undefined
      }
      worked('a person with a valid invite code was not let in', row)
      const { inviteWelcome } = answerSettingsOf(rt.botOf(botId))
      if (inviteWelcome !== null) await welcome(row, botId, inviteWelcome)
      return { admission: { person: personOfRule(rule) }, welcomed: inviteWelcome !== null }
    }
    return undefined
  }

  // Staff only: the list, newest first, and an upload.
  rt.ctx.effect(() => rt.hooks.endpoint('omni-invite-codes', async body => {
    NoBody.parse(body ?? {})
    await rt.load()
    const list = codes.view()
    return { count: list.length, codes: list }
  }, { read: true }), 'omni-channels: omni-invite-codes')
  rt.ctx.effect(() => rt.hooks.endpoint('omni-invite-codes-add', async body => {
    await rt.load()
    if (rt.readOnly?.() !== undefined) throw refused(rt.readOnly())
    return codes.add(body)
  }), 'omni-channels: omni-invite-codes-add')
}
