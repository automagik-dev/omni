// Changing Omni's channels from the Channels page, on the linked Omni: add one (WhatsApp by
// its QR code or a phone-number code, Telegram and Discord by a bot token), reconnect, pause
// and resume it, and reply in a chat. Every call goes through this host with the linked key
// (rt.omniRequest, omni.js), so the key never reaches the page: the page gets the channel,
// the code to scan, the connection state and Omni's own words when it refuses.
//
// What the key may do is read from POST /auth/validate: without instances:write the page
// stays read-only for channels, without messages:send for replies. An Omni from before that
// route is tried, and a 403 says the key cannot.
import { z } from 'zod'

// The channel types the page adds here, with how each pairs. The others are set up from the
// CLI (omni-store.js names the command), never faked.
export const LIVE_TYPES = { 'whatsapp-baileys': 'qr', telegram: 'token', discord: 'token' }
export const FORBIDDEN_CHANGE = 'This device\'s key can\'t change channels; ask your Omni\'s owner.'
export const FORBIDDEN_SEND = 'This device\'s key can\'t send messages; ask your Omni\'s owner.'

const ABILITIES_TTL_MS = 60_000
// A channel this page created and that has not connected yet; cancelling deletes it, and
// only such a channel can be deleted from here.
const PENDING_TTL_MS = 30 * 60_000

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })
const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const token = z.string().trim().min(8).max(4096).regex(/^\S+$/)
const CreatePayload = z.object({
  type: z.enum(Object.keys(LIVE_TYPES)),
  name: z.string().trim().min(1).max(80),
  token: token.optional(),
})
const ChannelPayload = z.object({ id })
const PhonePayload = z.object({ id, phone: z.string().trim().regex(/^\+?[\d\s().-]{8,24}$/) })
const ActPayload = z.object({ id, action: z.enum(['reconnect', 'pause', 'resume', 'token']), token: token.optional() })
const SendPayload = z.object({ chatId: id, text: z.string().min(1).max(4000).refine(text => text.trim() !== '') })

const Instance = z.object({ data: z.object({ id, name: z.string(), channel: z.string() }).passthrough() })
const Status = z.object({ data: z.object({ state: z.string().max(40), isConnected: z.boolean().optional(), message: z.string().max(500).nullish(), profileName: z.string().max(200).nullish(), ownerIdentifier: z.string().max(200).nullish() }).passthrough() })
const Qr = z.object({ data: z.object({ qr: z.string().max(2048).nullable(), expiresAt: z.string().max(64).nullable() }).passthrough() })
const PhoneCode = z.object({ data: z.object({ code: z.string().min(4).max(16), expiresIn: z.number().optional() }).passthrough() })
const Chat = z.object({ data: z.object({ id, instanceId: id, externalId: z.string().min(1) }).passthrough() })
const Validate = z.object({ data: z.object({ scopes: z.array(z.string()) }).passthrough() })

const parse = (schema, value, what) => {
  const parsed = schema.safeParse(value ?? {})
  if (!parsed.success) throw invalid(what)
  return parsed.data
}

// The API's own rule (services/api-keys.ts scopeAllows): "*", the scope itself, or its namespace.
export function scopeAllows(scopes, required) {
  const [namespace] = required.split(':')
  return scopes.includes('*') || scopes.includes(required) || scopes.includes(`${namespace}:*`)
}

// A WhatsApp owner is a JID; the page shows the number.
const phoneOf = owner => (typeof owner === 'string' ? owner.replace(/[:@].*$/, '').replace(/^(\d{6,})$/, '+$1') : '')

export function install(rt) {
  const pending = new Map()
  let abilities = null

  async function request(method, path, body) {
    let response
    try {
      response = await rt.omniRequest(method, path, body === undefined ? {} : { body })
    } catch {
      throw refused('Could not reach your Omni. Try again in a moment.')
    }
    if (response === null) throw refused('No Omni is linked here.')
    const json = await response.json().catch(() => null)
    return { status: response.status, ok: response.ok, json, message: typeof json?.error?.message === 'string' ? json.error.message : null }
  }
  // Omni's answer, or its own words for why not.
  async function must(method, path, body, forbidden = FORBIDDEN_CHANGE) {
    const reply = await request(method, path, body)
    if (reply.status === 401 || reply.status === 403) throw refused(forbidden)
    if (!reply.ok) throw refused(reply.message ?? `Omni answered ${reply.status}`)
    return reply.json
  }

  async function readAbilities() {
    if (abilities && Date.now() - abilities.at < ABILITIES_TTL_MS) return abilities.value
    const reply = await request('POST', '/auth/validate')
    const parsed = Validate.safeParse(reply.json)
    // An Omni that cannot say is tried; a refusal then says the key cannot.
    const value = reply.ok && parsed.success
      ? { changeChannels: scopeAllows(parsed.data.data.scopes, 'instances:write'), send: scopeAllows(parsed.data.data.scopes, 'messages:send') }
      : { changeChannels: true, send: true }
    abilities = { at: Date.now(), value }
    return value
  }

  const sweep = () => {
    for (const [channelId, at] of pending) if (Date.now() - at > PENDING_TTL_MS) pending.delete(channelId)
  }

  async function create(body) {
    const payload = parse(CreatePayload, body, 'Name the channel, and paste its token when it takes one')
    const kind = LIVE_TYPES[payload.type]
    if (kind === 'token' && !payload.token) throw invalid('Paste the bot token')
    const reply = await must('POST', '/instances', { name: payload.name, channel: payload.type, ...(kind === 'token' ? { token: payload.token } : {}) })
    const created = parse(Instance, reply, 'Omni did not return the new channel')
    sweep()
    pending.set(created.data.id, Date.now())
    return { id: created.data.id, type: created.data.channel, name: created.data.name }
  }

  // Where pairing stands: the connection state and, while WhatsApp waits for a scan, the code.
  async function pairing(body) {
    const { id: channelId } = parse(ChannelPayload, body, 'Unknown channel')
    const status = parse(Status, await must('GET', `/instances/${channelId}/status`), 'Omni did not say how the channel is')
    const { state, isConnected, message, profileName, ownerIdentifier } = status.data
    const connected = isConnected === true || state === 'connected'
    if (connected) pending.delete(channelId)
    let qr = null
    let expiresAt = null
    if (!connected) {
      const code = await request('GET', `/instances/${channelId}/qr`)
      const parsed = Qr.safeParse(code.json)
      if (code.ok && parsed.success) ({ qr, expiresAt } = parsed.data.data)
    }
    return { state, connected, qr, expiresAt, ...(message ? { message } : {}), detail: profileName || phoneOf(ownerIdentifier) || null }
  }

  async function phoneCode(body) {
    const payload = parse(PhonePayload, body, 'Type the phone number with its country code')
    const reply = parse(PhoneCode, await must('POST', `/instances/${payload.id}/pair`, { phoneNumber: `+${payload.phone.replace(/\D/g, '')}` }), 'Omni did not return a code')
    return { code: reply.data.code, expiresIn: reply.data.expiresIn ?? 60 }
  }

  async function cancel(body) {
    const { id: channelId } = parse(ChannelPayload, body, 'Unknown channel')
    sweep()
    if (!pending.has(channelId)) return { removed: false }
    pending.delete(channelId)
    await must('DELETE', `/instances/${channelId}`)
    return { removed: true }
  }

  async function act(body) {
    const payload = parse(ActPayload, body, 'Pick what to do with the channel')
    const path = `/instances/${payload.id}`
    if (payload.action === 'pause') await must('POST', `${path}/disconnect`)
    else if (payload.action === 'token') {
      if (!payload.token) throw invalid('Paste the new token')
      await must('POST', `${path}/connect`, { token: payload.token })
    } else await must('POST', `${path}/connect`, {})
    return { ok: true }
  }

  async function send(body) {
    const payload = parse(SendPayload, body, 'Type a message')
    const chat = parse(Chat, await must('GET', `/chats/${payload.chatId}`, undefined, FORBIDDEN_SEND), 'Omni does not know that chat')
    await must('POST', '/messages/send', { instanceId: chat.data.instanceId, to: chat.data.externalId, text: payload.text }, FORBIDDEN_SEND)
    return { sent: true }
  }

  const ENDPOINTS = {
    'omni-channel-create': create, 'omni-channel-phone-code': phoneCode, 'omni-channel-cancel': cancel, 'omni-channel-act': act, 'omni-send': send,
  }
  rt.omniChannelEndpoint = (endpoint, body) => {
    if (endpoint === 'omni-channel-abilities') return readAbilities()
    if (endpoint === 'omni-channel-pairing') return pairing(body)
    const run = ENDPOINTS[endpoint]
    if (!run) throw invalid(`Unknown endpoint ${endpoint}`)
    return run(body)
  }
  // Reads answer any host that shows the page; the changes only a host that may change things.
  for (const name of ['omni-channel-abilities', 'omni-channel-pairing']) {
    rt.ctx.effect(() => rt.hooks.endpoint(name, body => rt.omniChannelEndpoint(name, body), { read: true }), `omni-channels: ${name}`)
  }
  for (const name of Object.keys(ENDPOINTS)) {
    rt.ctx.effect(() => rt.hooks.endpoint(name, body => rt.omniChannelEndpoint(name, body)), `omni-channels: ${name}`)
  }
}
