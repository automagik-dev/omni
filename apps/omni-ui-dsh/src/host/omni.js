// Omni channels: the instances, chats and messages of an omni API, read on this host so its
// key never reaches the browser. The key is the OMNI_API_KEY credential in DSH's credential
// store; `config.omni.url` names the API (https://omni.example.com, without /api/v2). Without
// both, the Channels view keeps its sample data. This file only reads; the Main Bot changes
// omni through omni-api.js, with the same key.

export const KEY = 'OMNI_API_KEY'
const TIMEOUT_MS = 10_000
const CHATS_LIMIT = 100
const MESSAGES_LIMIT = 80
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })
const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })
const time = value => (value ? Date.parse(value) || null : null)

// omni's connection states (channel-sdk InstanceState), folded into the four the view shows.
export function statusOf(instance, live) {
  if (instance.isActive === false) return 'paused'
  const state = live?.state
  if (state === 'connected') return 'connected'
  if (state === 'connecting' || state === 'qr' || state === 'reconnecting') return 'connecting'
  return 'attention'
}

// A WhatsApp owner is a JID; the view shows the number.
const ownerText = owner => (typeof owner === 'string' ? owner.replace(/[:@].*$/, '').replace(/^(\d{6,})$/, '+$1') : '')

export function channelOf(instance, live) {
  const status = statusOf(instance, live)
  return {
    id: instance.id,
    type: instance.channel,
    name: instance.name,
    detail: instance.profileName || ownerText(instance.ownerIdentifier) || instance.channel,
    status,
    ...(status === 'attention' ? { problem: live?.message || 'omni does not report this channel as connected.' } : {}),
    answeredBy: instance.agentId ? 'Omni' : 'You',
    avatarUrl: instance.profilePicUrl ?? null,
    health: { lastEventAt: time(instance.lastMessageAt), lastSeenAt: time(instance.lastSeenAt), messagesToday: null, replyMedianSec: null, uptime: null, week: null },
  }
}

export function initialsOf(name) {
  const text = String(name ?? '').trim()
  if (text.startsWith('#')) return '#'
  const words = text.split(/\s+/).filter(word => /\p{L}|\p{N}/u.test(word))
  return (words.length > 1 ? words[0][0] + words.at(-1)[0] : (words[0] ?? '?').slice(0, 2)).toUpperCase()
}

export function chatOf(chat) {
  const name = chat.name || ownerText(chat.externalId) || 'Chat'
  return {
    id: chat.id,
    channelId: chat.instanceId,
    name,
    initials: initialsOf(name),
    kind: chat.chatType === 'dm' ? 'direct' : 'group',
    preview: `${chat.lastMessageFromMe ? 'You: ' : ''}${chat.lastMessagePreview ?? ''}`.replace(/\s+/g, ' ').trim(),
    at: time(chat.lastMessageAt) ?? time(chat.updatedAt) ?? 0,
    unread: chat.unreadCount ?? 0,
    avatarUrl: chat.avatarUrl ?? null,
  }
}

// From-me messages sent through the API are Omni's (an agent or an integration); the rest
// of the from-me ones were typed on the phone.
export function messageOf(message) {
  const mine = message.isFromMe === true
  return {
    id: message.id,
    from: mine ? (message.source === 'api' ? 'omni' : 'you') : 'them',
    ...(mine || !message.senderDisplayName ? {} : { author: message.senderDisplayName }),
    text: message.textContent || message.transcription || (message.hasMedia ? `[${message.messageType ?? 'media'}]` : ''),
    at: time(message.platformTimestamp) ?? time(message.createdAt) ?? 0,
  }
}

export function install(rt) {
  const base = () => {
    const url = rt.config.omni?.url
    return typeof url === 'string' && /^https?:\/\//i.test(url) ? url.replace(/\/+$/, '') : null
  }
  const key = async () => (await rt.ctx.get?.('credentials')?.resolve?.(KEY))?.value

  async function get(url, apiKey, path) {
    let response
    try {
      response = await fetch(`${url}/api/v2${path}`, { headers: { 'x-api-key': apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      throw refused(`Could not reach omni at ${url}`)
    }
    if (response.status === 401) throw refused(`omni did not accept the key in ${KEY}`)
    if (response.status === 403) throw refused(`The key in ${KEY} may not read ${path.split('?')[0]}`)
    if (!response.ok) throw refused(`omni answered ${response.status} for ${path.split('?')[0]}`)
    return response.json()
  }

  // One omni API request for other host modules (omni-events.js), with this host's URL and
  // key; `null` when omni is not set up here. The caller reads the response.
  rt.omniRequest = async (method, path, { body, signal, headers = {} } = {}) => {
    const url = base()
    const apiKey = await key()
    if (url === null || !apiKey) return null
    return fetch(`${url}/api/v2${path}`, {
      method,
      headers: { 'x-api-key': apiKey, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
    })
  }
  rt.omniConfigured = async () => base() !== null && Boolean(await key())

  rt.omniEndpoint = async (endpoint, body) => {
    const url = base()
    const apiKey = await key()
    if (url === null || !apiKey) return { configured: false, missing: [url === null ? 'omni.url' : null, apiKey ? null : KEY].filter(Boolean) }
    if (endpoint === 'omni-overview') {
      const [instances, chats] = await Promise.all([
        get(url, apiKey, '/instances?limit=100'),
        get(url, apiKey, `/chats?limit=${CHATS_LIMIT}&sort=activity`),
      ])
      // A failed status read leaves that one channel in "needs attention", not the page empty.
      const statuses = await Promise.all(instances.items.map(instance => get(url, apiKey, `/instances/${instance.id}/status`).then(reply => reply.data, () => null)))
      return {
        configured: true,
        origin: new URL(url).host,
        channels: instances.items.map((instance, index) => channelOf(instance, statuses[index])),
        chats: chats.items.map(chatOf),
      }
    }
    if (endpoint === 'omni-messages') {
      if (typeof body?.chatId !== 'string' || !ID.test(body.chatId)) throw invalid('Unknown chat')
      const reply = await get(url, apiKey, `/chats/${body.chatId}/messages?limit=${MESSAGES_LIMIT}`)
      return { messages: reply.items.map(messageOf).sort((a, b) => a.at - b.at) }
    }
    throw invalid(`Unknown omni endpoint ${endpoint}`)
  }
}
