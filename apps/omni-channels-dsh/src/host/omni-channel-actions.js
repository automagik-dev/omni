// Changing Omni's channels from the Channels page, on the linked Omni: add one (WhatsApp by
// its QR code or a phone-number code, Telegram and Discord by a bot token, Slack through
// Slack's own sign-in as a bot or as the person, WhatsApp Business with its Meta details),
// reconnect, pause and resume it, and reply in a chat. Every call goes through this host with
// the linked key (rt.omniRequest, omni.js), so the key never reaches the page: the page gets
// the channel, the code to scan, the connection state and Omni's own words when it refuses.
// A token or access token the person types goes from the page to here once and is not
// returned.
//
// What the key may do is read from POST /auth/validate: without instances:write the page
// stays read-only for channels, without messages:send for replies. An Omni from before that
// route is tried, and a 403 says the key cannot.
import { z } from 'zod'
import { settingsSchemas } from './channel-settings.js'
const Settings = settingsSchemas(z)

// The channel types the page adds here, with how each pairs. Slack's sign-in creates its
// channel on Omni's side (omni-slack-start), and WhatsApp Business is created and connected
// in one call (omni-wab-connect), so neither goes through omni-channel-create.
export const LIVE_TYPES = { 'whatsapp-baileys': 'qr', telegram: 'token', discord: 'token' }
export const ALL_TYPES = ['whatsapp-baileys', 'whatsapp-business', 'slack', 'telegram', 'discord']

// What Discord's invite gives the bot: view channels, send messages (also in threads), read
// history, embed links, attach files and add reactions. The scopes add slash commands.
export const DISCORD_PERMISSIONS = [1n << 10n, 1n << 11n, 1n << 38n, 1n << 16n, 1n << 14n, 1n << 15n, 1n << 6n].reduce((sum, bit) => sum | bit, 0n)

// A Discord bot token starts with its application id in base64; the invite needs that id.
export function discordInviteUrl(botToken) {
  const [head] = String(botToken ?? '').split('.')
  let id = ''
  try {
    id = Buffer.from(head.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  } catch {
    return null
  }
  if (!/^\d{15,22}$/.test(id)) return null
  const query = new URLSearchParams({ client_id: id, scope: 'bot applications.commands', permissions: String(DISCORD_PERMISSIONS) })
  return `https://discord.com/oauth2/authorize?${query}`
}
export const FORBIDDEN_CHANGE = 'This device\'s key can\'t change channels; ask your Omni\'s owner.'
export const FORBIDDEN_SEND = 'This device\'s key can\'t send messages; ask your Omni\'s owner.'

const ABILITIES_TTL_MS = 60_000
// Cancelling pairing deletes only a channel this page created that has not connected yet.
// Explicit instance deletion is a separate action, available for existing channels too.
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
const ActPayload = z.object({ id, action: z.enum(['reconnect', 'pause', 'resume', 'token', 'delete']), token: token.optional() })
const SendPayload = z.object({ chatId: id, text: z.string().min(1).max(4000).refine(text => text.trim() !== '') })
const SlackStartPayload = z.object({ mode: z.enum(['bot', 'user']) })
const SlackResultPayload = z.object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/) })
const metaId = z.string().trim().regex(/^\d{5,25}$/)
const WabPayload = z.object({
  name: z.string().trim().min(1).max(80),
  accessToken: token,
  phoneNumberId: metaId,
  wabaId: metaId,
})

const Deleted = z.object({ success: z.literal(true) })
const Instance = z.object({ data: z.object({ id, name: z.string(), channel: z.string() }).passthrough() })
const Status = z.object({ data: z.object({ state: z.string().max(40), isConnected: z.boolean().optional(), message: z.string().max(500).nullish(), profileName: z.string().max(200).nullish(), ownerIdentifier: z.string().max(200).nullish() }).passthrough() })
const Qr = z.object({ data: z.object({ qr: z.string().max(2048).nullable(), expiresAt: z.string().max(64).nullable() }).passthrough() })
const PhoneCode = z.object({ data: z.object({ code: z.string().min(4).max(16), expiresIn: z.number().optional() }).passthrough() })
const Chat = z.object({ data: z.object({ id, instanceId: id, externalId: z.string().min(1) }).passthrough() })
const Validate = z.object({ data: z.object({ scopes: z.array(z.string()) }).passthrough() })
const Supported = z.object({ items: z.array(z.object({ id: z.string(), loaded: z.boolean().optional() }).passthrough()) }).passthrough()
const SlackApp = z.object({ configured: z.boolean() }).passthrough()
const SlackStart = z.object({ authorizeUrl: z.string().url().max(4096), nonce: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/) }).passthrough()
const SlackResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('done'), instanceId: id }),
  z.object({ status: z.literal('error'), code: z.string().max(80).optional(), message: z.string().max(500).optional() }),
])

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
    const invite = payload.type === 'discord' ? discordInviteUrl(payload.token) : null
    return { id: created.data.id, type: created.data.channel, name: created.data.name, ...(invite ? { inviteUrl: invite } : {}) }
  }

  // The channel types this Omni has loaded, of the ones the page can add; null when the Omni
  // cannot say, and the page then offers them all.
  async function types() {
    const reply = await request('GET', '/instances/supported-channels').catch(() => null)
    const parsed = Supported.safeParse(reply?.json)
    if (!reply?.ok || !parsed.success) return { types: null }
    const loaded = new Set(parsed.data.items.filter(item => item.loaded === true).map(item => item.id))
    return { types: ALL_TYPES.filter(type => loaded.has(type)) }
  }

  // Slack: Omni signs in to Slack itself and creates the channel when Slack sends the person
  // back; this host only starts the sign-in and asks how it ended. The page opens the
  // returned address in the browser.
  const slackFlows = new Map()
  async function slackApp() {
    const reply = await request('GET', '/slack/app')
    const parsed = SlackApp.safeParse(reply.json)
    return { configured: reply.ok && parsed.success && parsed.data.configured }
  }
  async function slackStart(body) {
    const { mode } = parse(SlackStartPayload, body, 'Pick how Omni joins Slack')
    const reply = await request('POST', '/slack/oauth/start', { mode, entry: 'ui' })
    if (reply.status === 401 || reply.status === 403) throw refused(FORBIDDEN_CHANGE)
    if (reply.json?.error?.code === 'SLACK_APP_NOT_CONFIGURED') return { configured: false }
    if (!reply.ok) throw refused(reply.message ?? `Omni answered ${reply.status}`)
    const started = parse(SlackStart, reply.json, 'Omni did not start the Slack sign-in')
    // Only Slack's own sign-in page is opened from here.
    if (new URL(started.authorizeUrl).hostname !== 'slack.com') throw refused('Omni sent a sign-in address that is not Slack\'s')
    for (const [nonce, at] of slackFlows) if (Date.now() - at > PENDING_TTL_MS) slackFlows.delete(nonce)
    slackFlows.set(started.nonce, Date.now())
    return { configured: true, authorizeUrl: started.authorizeUrl, nonce: started.nonce }
  }
  async function slackResult(body) {
    const { nonce } = parse(SlackResultPayload, body, 'Unknown Slack sign-in')
    if (!slackFlows.has(nonce)) throw invalid('Unknown Slack sign-in')
    const result = parse(SlackResult, await must('GET', `/slack/oauth/result/${nonce}`), 'Omni did not say how the Slack sign-in went')
    if (result.status !== 'pending') slackFlows.delete(nonce)
    if (result.status === 'done') return { status: 'done', id: result.instanceId }
    if (result.status === 'error') return { status: 'error', message: result.message ?? 'Slack did not finish the sign-in.' }
    return { status: 'pending' }
  }

  // WhatsApp Business with the details from Meta's WhatsApp Manager: the channel is created
  // and connected here in one go, and removed again when Meta refuses the details.
  async function wabConnect(body) {
    const payload = parse(WabPayload, body, 'Fill in the access token, the phone number ID and the WhatsApp Business Account ID')
    const created = parse(Instance, await must('POST', '/instances', { name: payload.name, channel: 'whatsapp-business' }), 'Omni did not return the new channel')
    const channelId = created.data.id
    try {
      await must('POST', `/instances/${channelId}/whatsapp-business/connect`, { accessToken: payload.accessToken, phoneNumberId: payload.phoneNumberId, wabaId: payload.wabaId })
    } catch (error) {
      await request('DELETE', `/instances/${channelId}`).catch(() => {})
      throw error
    }
    return { id: channelId, type: 'whatsapp-business', name: created.data.name }
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
    if (payload.action === 'delete') {
      parse(Deleted, await must('DELETE', path), 'Omni did not confirm instance deletion')
      pending.delete(payload.id)
    } else if (payload.action === 'pause') await must('POST', `${path}/disconnect`)
    else if (payload.action === 'token') {
      if (!payload.token) throw invalid('Paste the new token')
      await must('POST', `${path}/connect`, { token: payload.token })
    } else await must('POST', `${path}/connect`, {})
    return { ok: true }
  }

  async function settings(body) {
    const { id: channelId } = parse(ChannelPayload.strict(), body, 'Unknown channel')
    const instance = parse(Instance, await must('GET', `/instances/${channelId}`), 'Omni did not return the channel')
    return { settings: parse(Settings.read, instance.data, 'Omni returned invalid settings') }
  }
  async function saveSettings(body) {
    const payload = parse(z.object({ id, patch: Settings.patch }).strict(), body, 'Check the channel settings')
    const reply = await request('PATCH', `/instances/${payload.id}`, payload.patch)
    if (reply.status === 401 || reply.status === 403) throw refused(FORBIDDEN_CHANGE)
    if (!reply.ok) throw refused(reply.status === 400
      ? `Settings rejected (${Object.keys(payload.patch).join(', ')}). Check types, limits and JSON shapes; update Omni if fields are unsupported.`
      : reply.message ?? `Omni answered ${reply.status}`)
    return { ok: true }
  }
  async function agents() {
    return parse(z.object({ items: z.array(z.object({ id, name: z.string().max(255) })) }),
      await must('GET', '/agents?limit=200'), 'Omni did not return the agents')
  }
  async function wabRepair(body) {
    const payload = parse(z.object({ id, accessToken: token, phoneNumberId: metaId, wabaId: metaId,
      appId: metaId.optional(), businessId: metaId.optional() }).strict(), body, 'Re-enter the token and Meta identifiers')
    const { id: channelId, ...credentials } = payload
    // Never reuse wabConnect: its create/cleanup lifecycle must not own an existing channel.
    try {
      await must('POST', `/instances/${channelId}/whatsapp-business/connect`, credentials)
    } catch (error) {
      // A provider error can quote credentials. The server persists them before connecting.
      throw refused(error.message === FORBIDDEN_CHANGE ? FORBIDDEN_CHANGE : 'Could not reconnect. Credentials may have been saved; check the token and identifiers and retry.')
    }
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
    'omni-slack-start': slackStart, 'omni-slack-result': slackResult, 'omni-wab-connect': wabConnect,
    'omni-channel-settings-save': saveSettings, 'omni-wab-repair': wabRepair,
  }
  const READS = { 'omni-channel-abilities': readAbilities, 'omni-channel-pairing': pairing, 'omni-channel-types': types, 'omni-slack-app': slackApp,
    'omni-channel-settings': settings, 'omni-channel-agents': agents }
  rt.omniChannelEndpoint = (endpoint, body) => {
    const run = READS[endpoint] ?? ENDPOINTS[endpoint]
    if (!run) throw invalid(`Unknown endpoint ${endpoint}`)
    return run(body)
  }
  // Reads answer any host that shows the page; the changes only a host that may change things.
  for (const name of Object.keys(READS)) {
    rt.ctx.effect(() => rt.hooks.endpoint(name, body => rt.omniChannelEndpoint(name, body), { read: true }), `omni-channels: ${name}`)
  }
  for (const name of Object.keys(ENDPOINTS)) {
    rt.ctx.effect(() => rt.hooks.endpoint(name, body => rt.omniChannelEndpoint(name, body)), `omni-channels: ${name}`)
  }
}
