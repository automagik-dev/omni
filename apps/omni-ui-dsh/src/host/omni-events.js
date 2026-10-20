// Omni events: this host listens to the omni API for the moments subscriptions watch and
// starts a run for each match (subscriptions.js). Each kind of event has a durable consumer
// on omni, named after this host; the host streams it (SSE), handles each event, then acks
// its journal position, so a restart resumes where it stopped and nothing runs twice. A
// consumer is streamed only while an active subscription needs its kind.
import { hostname } from 'node:os'

const BACKOFF_MS = [2_000, 5_000, 15_000, 60_000]
const LOOKUP_TTL_MS = 10 * 60_000
const TEXT_MAX = 2_000

export const STREAMS = [
  { suffix: 'reactions', eventType: 'reaction.received', kinds: ['reaction'] },
  { suffix: 'messages', eventType: 'message.received', kinds: ['message', 'keyword', 'voice', 'media'] },
]

// Emoji arrive with or without the variation selector (❤ vs ❤️); compare without it.
const bare = emoji => String(emoji ?? '').replace(/️/g, '')

const watches = (sub, row) => sub.sources.some(source => (source.kind === 'channel' ? source.id === row.instanceId : source.id === row.chatUuid))

// Whether one journal row is the moment a subscription waits for.
export function matches(sub, row) {
  if (!sub.on || !watches(sub, row)) return false
  const { trigger } = sub
  if (row.eventType === 'reaction.received') {
    // "You react": only the account owner's own reactions, from any device.
    const own = row.rawPayload?.isFromMe === true || row.direction === 'outbound'
    return trigger.kind === 'reaction' && own && bare(row.textContent ?? row.metadata?.emoji) === bare(trigger.emoji)
  }
  if (row.eventType !== 'message.received' || row.direction !== 'inbound') return false
  const type = row.contentType ?? 'text'
  if (trigger.kind === 'message') return true
  if (trigger.kind === 'voice') return type === 'audio'
  if (trigger.kind === 'media') return ['image', 'video', 'document', 'sticker'].includes(type)
  if (trigger.kind === 'keyword') {
    const text = String(row.textContent ?? '').toLowerCase()
    return trigger.words.some(word => text.includes(word.toLowerCase()))
  }
  return false
}

// One `event:`/`id:`/`data:` frame at a time from an SSE body.
export async function* frames(body) {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    let end
    while ((end = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '')
      const frame = { event: 'message', id: undefined, data: '' }
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') frame.event = value
        else if (field === 'id') frame.id = value
        else if (field === 'data') frame.data += (frame.data ? '\n' : '') + value
      }
      if (frame.data || frame.event !== 'message') yield frame
    }
  }
}

export function install(rt) {
  const { ctx, state } = rt
  const consumerName = suffix => `omni-ui-dsh.${hostname().toLowerCase().replace(/[^a-z0-9.-]/g, '-')}.${suffix}`
  const cursors = () => (state.omniEventCursors ??= {})
  const loops = new Map()
  let stopped = false

  const lookups = new Map()
  async function lookup(path, pick) {
    const hit = lookups.get(path)
    if (hit && Date.now() - hit.at < LOOKUP_TTL_MS) return hit.value
    let value
    try {
      const response = await rt.omniRequest('GET', path)
      value = response?.ok ? pick(await response.json()) : undefined
    } catch { value = undefined }
    lookups.set(path, { at: Date.now(), value })
    return value
  }

  // What the worker gets: the message (for a reaction, the one reacted to), who wrote it,
  // and where.
  async function eventOf(row) {
    const chat = row.chatUuid ? await lookup(`/chats/${row.chatUuid}`, reply => reply.data?.name) : undefined
    const channel = row.instanceId ? await lookup(`/instances/${row.instanceId}`, reply => reply.data?.name) : undefined
    if (row.eventType === 'reaction.received') {
      const message = row.chatUuid && row.externalId
        ? await lookup(`/messages/by-external?chatId=${encodeURIComponent(row.chatUuid)}&externalId=${encodeURIComponent(row.externalId)}`, reply => reply.data)
        : undefined
      return {
        kind: `reaction ${row.textContent ?? ''}`.trim(), who: 'the user', chat, channel, at: Date.parse(row.receivedAt) || Date.now(),
        text: String(message?.textContent || message?.transcription || '').slice(0, TEXT_MAX),
        author: message?.senderDisplayName ?? undefined,
      }
    }
    return {
      kind: row.contentType === 'audio' ? 'voice note' : row.contentType && row.contentType !== 'text' ? row.contentType : 'message',
      who: row.metadata?.from ?? undefined, chat, channel, at: Date.parse(row.receivedAt) || Date.now(),
      text: String(row.textContent ?? '').slice(0, TEXT_MAX),
    }
  }

  async function handle(row) {
    const due = Object.values(state.subscriptions ?? {}).filter(sub => matches(sub, row))
    if (due.length === 0) return
    const event = await eventOf(row)
    for (const sub of due) {
      try {
        await rt.fireSubscription(sub, { ...event, ref: row.id })
      } catch (error) {
        rt.warn('ds-bot: subscription %s did not start: %s', sub.name, error?.message ?? error)
      }
    }
  }

  async function ensureConsumer(stream) {
    const response = await rt.omniRequest('POST', '/events/consumers', { body: { name: consumerName(stream.suffix), eventType: stream.eventType, startFrom: 'now' } })
    if (response === null) throw new Error('omni is not set up here')
    if (!response.ok && response.status !== 409) throw new Error(`omni answered ${response.status} creating the ${stream.suffix} consumer`)
  }

  async function ack(stream, cursor) {
    const response = await rt.omniRequest('POST', `/events/consumers/${encodeURIComponent(consumerName(stream.suffix))}/ack`, { body: { cursor: Number(cursor) } })
    if (response && !response.ok && response.status !== 400) rt.warn('ds-bot: omni did not take the %s ack (%s)', stream.suffix, response.status)
    cursors()[stream.suffix] = String(cursor)
    await rt.save()
  }

  // One stream: connect from the last handled position, handle and ack each event in
  // order, reconnect when omni ends the stream, back off on failures.
  async function run(stream, controller) {
    let failures = 0
    while (!controller.signal.aborted) {
      try {
        await ensureConsumer(stream)
        const after = cursors()[stream.suffix]
        const response = await rt.omniRequest('GET', `/events/consumers/${encodeURIComponent(consumerName(stream.suffix))}/stream`, {
          signal: controller.signal, headers: { accept: 'text/event-stream', ...(after ? { 'last-event-id': after } : {}) },
        })
        if (response === null) return
        if (!response.ok || !response.body) throw new Error(`omni answered ${response.status} for the ${stream.suffix} stream`)
        failures = 0
        for await (const frame of frames(response.body)) {
          if (frame.event === 'reconnect' || frame.event === 'error') break
          if (frame.event === 'connected' || !frame.data || frame.id === undefined) continue
          let row
          try { row = JSON.parse(frame.data) } catch { continue }
          await handle(row)
          await ack(stream, row.journalSeq ?? frame.id)
        }
      } catch (error) {
        if (controller.signal.aborted) return
        const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]
        failures += 1
        rt.warn('ds-bot: omni %s events: %s; again in %d s', stream.suffix, error?.message ?? error, wait / 1000)
        await new Promise(resolve => setTimeout(resolve, wait))
      }
    }
  }

  // Streams follow the subscriptions: one starts when an active subscription needs its
  // kind and stops when none does.
  async function sync() {
    if (stopped) return
    const configured = await rt.omniConfigured?.()
    const active = Object.values(state.subscriptions ?? {}).filter(sub => sub.on)
    for (const stream of STREAMS) {
      const wanted = configured && active.some(sub => stream.kinds.includes(sub.trigger.kind))
      const current = loops.get(stream.suffix)
      if (wanted && !current) {
        const controller = new AbortController()
        loops.set(stream.suffix, controller)
        void run(stream, controller).finally(() => { if (loops.get(stream.suffix) === controller) loops.delete(stream.suffix) })
      } else if (!wanted && current) {
        current.abort()
        loops.delete(stream.suffix)
      }
    }
  }

  rt.syncOmniEvents = () => { void sync().catch(error => rt.warn('ds-bot: omni events: %s', error)) }
  rt.omniEventsView = () => ({ listening: [...loops.keys()] })
  ctx.effect(() => {
    const timer = setInterval(rt.syncOmniEvents, 30_000)
    void rt.load().then(rt.syncOmniEvents, () => {})
    return () => {
      stopped = true
      clearInterval(timer)
      for (const controller of loops.values()) controller.abort()
      loops.clear()
    }
  }, 'ds-bot: omni events')
}
