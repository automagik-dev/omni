// Omni channels: the instances, chats and messages of an omni API, read on this host so its
// key never reaches the browser. The URL and key come from the link a pairing saved
// (omni-link.js); without one, from the older profile settings: `config.omni.url` (the API,
// https://omni.example.com, without /api/v2) and the OMNI_API_KEY credential in DSH's store,
// both only read. Without either, the Channels view keeps its sample data. This file only
// reads; the Omni Bot or a Main Bot changes omni through omni-api.js, with the same key.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { OPERATOR_RULES } from './omni-rules.js'

export const KEY = 'OMNI_API_KEY'
const TIMEOUT_MS = 10_000
const CHATS_LIMIT = 100
const MESSAGES_LIMIT = 80
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The media endpoint's cache: the files the chat view showed last, so its 15 s poll asks
// Omni nothing for a file it has.
const MEDIA_ENTRIES = 200
const MEDIA_BYTES = 50 * 1024 * 1024
// The cache counts the base64 it hands out; the largest file whose base64 fits it.
const MEDIA_FILE_BYTES = MEDIA_BYTES / 4 * 3
const MEDIA_TIMEOUT_MS = 60_000
// The kinds the chat view draws as media; any other media message keeps its "[type]" line.
const DRAWN = new Set(['image', 'audio', 'video', 'document', 'sticker'])
// Omni's own text for a file: the transcription of a voice note, the description of a
// picture or video. A document's extracted text stays out: the whole file's text would ride
// every poll.
const OMNI_TEXT = ['transcription', 'imageDescription', 'videoDescription']
const MediaPayload = z.object({ messageId: z.string().min(1) })
const MediaMessage = z.object({ data: z.object({
  hasMedia: z.boolean(),
  mediaMimeType: z.string().max(200).nullish(),
  mediaMetadata: z.object({ fileName: z.string().max(500).nullish() }).passthrough().nullish(),
}).passthrough() })
const MediaReady = z.object({ data: z.object({ mediaLocalPath: z.string().min(1).max(1000), mediaMimeType: z.string().max(200).nullish() }).passthrough() })
// Each part of the stored path names a file or folder under /media, never one above it.
const PATH_PART = /^(?!\.{1,2}$)[\w.-]+$/

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

// Omni writes "[error: …]" where processing failed: that is no text of the file's.
const omniTextOf = (message) => {
  for (const field of OMNI_TEXT) {
    const value = message[field]
    if (typeof value === 'string' && value.trim() !== '' && !value.startsWith('[error')) return value
  }
  return null
}

// From-me messages sent through the API are Omni's (an agent or an integration); the rest
// of the from-me ones were typed on the phone. A drawn media message's text is its caption
// alone: the view draws the file, and Omni's text for it apart.
export function messageOf(message) {
  const mine = message.isFromMe === true
  const hasMedia = message.hasMedia === true
  const type = typeof message.messageType === 'string' && message.messageType !== '' ? message.messageType : 'text'
  const drawn = hasMedia && DRAWN.has(type)
  const fileName = message.mediaMetadata?.fileName
  return {
    id: message.id,
    from: mine ? (message.source === 'api' ? 'omni' : 'you') : 'them',
    fromMe: mine,
    ...(mine || !message.senderDisplayName ? {} : { author: message.senderDisplayName }),
    text: drawn ? message.textContent || '' : message.textContent || message.transcription || (hasMedia ? `[${message.messageType || 'media'}]` : ''),
    caption: hasMedia && message.textContent ? message.textContent : null,
    type,
    hasMedia,
    mime: hasMedia && typeof message.mediaMimeType === 'string' && message.mediaMimeType !== '' ? message.mediaMimeType : null,
    mediaText: hasMedia ? omniTextOf(message) : null,
    fileName: hasMedia && typeof fileName === 'string' && fileName !== '' ? fileName : null,
    at: time(message.platformTimestamp) ?? time(message.createdAt) ?? 0,
  }
}

export function install(rt) {
  const { ctx } = rt
  const profileUrl = () => {
    const url = rt.config.omni?.url
    return typeof url === 'string' && /^https?:\/\//i.test(url) ? url.replace(/\/+$/, '') : null
  }
  // A saved link wins whole: its URL never pairs with the profile's key, or the reverse.
  const base = () => rt.omniLink?.()?.url ?? profileUrl()
  const key = async () => {
    const link = rt.omniLink?.()
    if (link) return link.key
    return (await rt.ctx.get?.('credentials')?.resolve?.(KEY))?.value
  }
  // Whether an Omni is named here at all, read without a credential lookup.
  rt.omniNamed = () => base() !== null

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
    if (url === null || !apiKey) return { configured: false, missing: [url === null ? 'omni.url' : null, apiKey ? null : KEY].filter(Boolean), ...(rt.omniLinkEndpoint ? { link: await rt.omniLinkEndpoint('omni-link') } : {}) }
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

  // One message's file for the chat view, as base64, through the routes `omni media
  // download` uses: Omni stores it, then serves it under /media. Kept here, most recently
  // shown last, within MEDIA_ENTRIES files and MEDIA_BYTES; one download per file at a time.
  const media = new Map()
  const loading = new Map()
  let mediaBytes = 0
  // Which Omni and key filled the cache, as a digest: a new link, a disconnect or a new key
  // empties it.
  let mediaOwner = null
  const keep = (id, file) => {
    media.set(id, file)
    mediaBytes += file.data.length
    for (const [oldest, kept] of media) {
      if (media.size <= MEDIA_ENTRIES && mediaBytes <= MEDIA_BYTES) break
      media.delete(oldest)
      mediaBytes -= kept.data.length
    }
  }
  const shown = ({ mime, data, name }) => ({ ok: true, mime, data, name })
  const no = reason => ({ ok: false, reason })
  // The body, read until it passes MEDIA_FILE_BYTES (then null, the rest unread): a file
  // without a Content-Length is refused as early as one with it.
  async function bounded(response) {
    if (!response.body) return Buffer.alloc(0)
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > MEDIA_FILE_BYTES) {
        await response.body.cancel().catch(() => {})
        return null
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }
  async function download(id, owner) {
    const ask = (method, path, body) => rt.omniRequest(method, path, { body, signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) })
    const read = response => response.json().catch(() => null)
    const found = await ask('GET', `/messages/${id}`)
    if (found === null) return no('omni is not set up here')
    if (!found.ok) return no(found.status === 404 ? 'omni has no such message' : `omni answered ${found.status} for that message`)
    const message = MediaMessage.safeParse(await read(found))
    if (!message.success) return no('omni answered something else for that message')
    if (!message.data.data.hasMedia) return no('That message has no media')
    const stored = await ask('POST', '/messages/media/download', { messageId: id })
    const ready = MediaReady.safeParse(stored.ok ? await read(stored) : null)
    if (!ready.success) return no(`omni answered ${stored.status} for that media`)
    const parts = ready.data.data.mediaLocalPath.split('/')
    if (!parts.every(part => PATH_PART.test(part))) return no('omni named a file outside its media')
    const file = await ask('GET', `/media/${parts.join('/')}`)
    if (!file.ok) return no(`omni answered ${file.status} for the file`)
    if (Number(file.headers.get('content-length')) > MEDIA_FILE_BYTES) return no('The file is too large to show here')
    const bytes = await bounded(file)
    if (bytes === null) return no('The file is too large to show here')
    const mime = message.data.data.mediaMimeType || ready.data.data.mediaMimeType || file.headers.get('content-type')?.split(';')[0] || 'application/octet-stream'
    const kept = { mime, data: bytes.toString('base64'), name: message.data.data.mediaMetadata?.fileName || null }
    // A download that began under another link stays out of this one's cache.
    if (owner === mediaOwner) keep(id, kept)
    return shown(kept)
  }
  rt.omniMedia = async (body) => {
    const parsed = MediaPayload.safeParse(body)
    if (!parsed.success) throw invalid('Unknown message')
    const id = parsed.data.messageId
    if (!ID.test(id)) return no('Unknown message')
    const url = base()
    const apiKey = await key()
    if (url === null || !apiKey) return no('omni is not set up here')
    const owner = createHash('sha256').update(`${url}\n${apiKey}`).digest('hex')
    if (owner !== mediaOwner) {
      media.clear()
      loading.clear()
      mediaBytes = 0
      mediaOwner = owner
    }
    const hit = media.get(id)
    if (hit) {
      media.delete(id)
      media.set(id, hit)
      return shown(hit)
    }
    if (!loading.has(id)) loading.set(id, download(id, owner).catch(() => no('Could not reach omni')).finally(() => loading.delete(id)))
    return loading.get(id)
  }

  // Reads, so a host that only reads the team still shows the channels.
  for (const name of ['omni-overview', 'omni-messages']) ctx.effect(() => rt.hooks.endpoint(name, body => rt.omniEndpoint(name, body), { read: true }), `ds-bot: ${name}`)
  ctx.effect(() => rt.hooks.endpoint('omni-media', body => rt.omniMedia(body), { read: true }), 'ds-bot: omni-media')
  // With an Omni named here, a Main Bot operates it. A non-Main Omni Bot gets these rules once the
  // Bot team gives plugin rules to kind 'omni' Bots too (bots-dsh prompt.js).
  ctx.effect(() => rt.hooks.mainRules(() => (rt.omniNamed() ? OPERATOR_RULES : null), { order: 100 }), 'ds-bot: operator rules')
}
