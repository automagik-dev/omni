// Omni events: this host listens to the omni API for the moments subscriptions watch and
// starts a run for each match (subscriptions.js). Each kind of event has a durable consumer
// on omni, named after this host; the host streams it (SSE), handles each event, then acks
// its journal position. Delivery is at least once: a restart can replay an unacked row.
// A consumer is streamed only while an active subscription needs its kind.
import { hostname } from 'node:os'
import { z } from 'zod'

const BACKOFF_MS = [2_000, 5_000, 15_000, 60_000]
const LOOKUP_TTL_MS = 10 * 60_000
const TEXT_MAX = 2_000
const optionalText = z.string().nullish()
const rowSchema = z.object({
  id: z.string(), eventType: z.string(), journalSeq: z.number().int().nonnegative().optional(),
  direction: optionalText, chatUuid: optionalText, instanceId: optionalText,
  externalId: optionalText, receivedAt: optionalText, contentType: optionalText, textContent: optionalText,
  rawPayload: z.object({ isFromMe: z.unknown().optional(), isMentioningInstance: z.unknown().optional() }).passthrough().nullish(),
  metadata: z.object({ from: optionalText, emoji: optionalText }).passthrough().nullish(),
}).passthrough()
const nameReplySchema = z.object({ data: z.object({ name: optionalText }).passthrough().nullish() })
const messageReplySchema = z.object({ data: z.object({
  textContent: optionalText, transcription: optionalText, senderDisplayName: optionalText,
}).passthrough().nullish() })
const ackErrorSchema = z.object({ error: z.object({ code: z.literal('VALIDATION_ERROR'), message: z.string() }) })

function backoff(ms, signal) {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    if (signal.aborted) done()
  })
}

// Omni filters at the source where it can: a reaction row's rawPayload is the reaction, with
// the owner flag one level down, so only the user's own reactions ever leave omni.
export const STREAMS = [
  { suffix: 'own-reactions', eventType: 'reaction.received', kinds: ['reaction'], filters: [{ field: 'rawPayload.isFromMe', operator: 'eq', value: true }] },
  { suffix: 'messages', eventType: 'message.received', kinds: ['message', 'mention', 'keyword', 'voice', 'media'] },
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
  if (trigger.kind === 'mention') return row.rawPayload?.isMentioningInstance === true
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
  let syncTail = Promise.resolve()
  let drain
  const cancelled = controller => stopped || controller.signal.aborted

  const lookups = new Map()
  async function lookup(path, schema, pick) {
    const hit = lookups.get(path)
    if (hit && Date.now() - hit.at < LOOKUP_TTL_MS) return hit.value
    let value
    try {
      const response = await rt.omniRequest('GET', path)
      const reply = response?.ok ? schema.safeParse(await response.json()) : undefined
      value = reply?.success ? pick(reply.data) : undefined
    } catch { value = undefined }
    lookups.set(path, { at: Date.now(), value })
    return value
  }

  // What the worker gets: the message (for a reaction, the one reacted to), who wrote it,
  // and where, with the ids of that chat and its channel (a chat-thread worker's thread is
  // that chat's).
  async function eventOf(row) {
    const chat = row.chatUuid ? await lookup(`/chats/${row.chatUuid}`, nameReplySchema, reply => reply.data?.name) : undefined
    const channel = row.instanceId ? await lookup(`/instances/${row.instanceId}`, nameReplySchema, reply => reply.data?.name) : undefined
    const ids = { ...(row.chatUuid ? { chatId: row.chatUuid } : {}), ...(row.instanceId ? { instanceId: row.instanceId } : {}) }
    if (row.eventType === 'reaction.received') {
      const message = row.chatUuid && row.externalId
        ? await lookup(`/messages/by-external?chatId=${encodeURIComponent(row.chatUuid)}&externalId=${encodeURIComponent(row.externalId)}`, messageReplySchema, reply => reply.data)
        : undefined
      return {
        kind: `reaction ${row.textContent ?? ''}`.trim(), who: 'the user', chat, channel, ...ids, at: Date.parse(row.receivedAt) || Date.now(),
        text: String(message?.textContent || message?.transcription || '').slice(0, TEXT_MAX),
        author: message?.senderDisplayName ?? undefined,
      }
    }
    return {
      kind: row.contentType === 'audio' ? 'voice note' : row.contentType && row.contentType !== 'text' ? row.contentType : 'message',
      who: row.metadata?.from ?? undefined, chat, channel, ...ids, at: Date.parse(row.receivedAt) || Date.now(),
      text: String(row.textContent ?? '').slice(0, TEXT_MAX),
    }
  }

  async function handle(row, controller) {
    if (cancelled(controller)) return 'cancelled'
    const due = Object.values(state.subscriptions ?? {}).filter(sub => matches(sub, row))
    if (due.length === 0) return 'unmatched'
    const event = await eventOf(row)
    if (cancelled(controller)) return 'cancelled'
    // Admission is the first dispatch, not the lookup. Once entered, finish this whole
    // captured row (even after stop), then ack it before the run can settle.
    for (const sub of due) {
      try {
        await rt.fireSubscription(sub, { ...event, ref: row.id })
      } catch (error) {
        rt.warn('ds-bot: subscription %s did not start: %s', sub.name, error?.message ?? error)
      }
    }
    return 'dispatched'
  }

  async function ensureConsumer(stream) {
    const response = await rt.omniRequest('POST', '/events/consumers', { body: { name: consumerName(stream.suffix), eventType: stream.eventType, startFrom: 'now', ...(stream.filters ? { filters: stream.filters } : {}) } })
    if (response === null) throw new Error('omni is not set up here')
    if (!response.ok && response.status !== 409) throw new Error(`omni answered ${response.status} creating the ${stream.suffix} consumer`)
  }

  async function ack(stream, cursor) {
    const response = await rt.omniRequest('POST', `/events/consumers/${encodeURIComponent(consumerName(stream.suffix))}/ack`, { body: { cursor: Number(cursor) } })
    let alreadyAdvanced = false
    if (response?.status === 400) {
      // A crash between server ack and local save leaves Last-Event-ID behind the server.
      // Only its explicit monotonic-cursor refusal proves this processed row is durable;
      // arbitrary 400s must not advance locally. Never skip to the unseen stored cursor.
      try {
        const reply = ackErrorSchema.safeParse(await response.json())
        const behind = reply.success && /^ack cursor (\d+) is behind the stored cursor (\d+) — acks are monotonic$/.exec(reply.data.error.message)
        alreadyAdvanced = !!behind && Number(behind[1]) === Number(cursor) && Number.isSafeInteger(Number(behind[2])) && Number(behind[2]) > Number(cursor)
      } catch { /* an unrecognized failure is not an acknowledgment */ }
    }
    if (!response?.ok && !alreadyAdvanced) throw new Error(`omni did not take the ${stream.suffix} ack (${response?.status ?? 'unavailable'})`)
    const previous = cursors()[stream.suffix]
    if (previous === undefined || Number(cursor) > Number(previous)) {
      cursors()[stream.suffix] = String(cursor)
      try {
        await rt.save()
      } catch (error) {
        // The server ack is durable, but do not pretend the local save succeeded.
        // A reconnect can replay this row and validate the monotonic server reply.
        if (previous === undefined) delete cursors()[stream.suffix]
        else cursors()[stream.suffix] = previous
        throw error
      }
    }
  }

  // The first consumer took every reaction; it goes once its filtered successor runs. The
  // journal position is global, so the successor resumes from the same cursor.
  async function dropRetired() {
    if (state.omniRetiredConsumers === true) return
    const response = await rt.omniRequest('DELETE', `/events/consumers/${encodeURIComponent(consumerName('reactions'))}`)
    if (response === null || (!response.ok && response.status !== 404)) return
    const cursors = state.omniEventCursors ?? {}
    if (cursors.reactions && !cursors['own-reactions']) cursors['own-reactions'] = cursors.reactions
    delete cursors.reactions
    state.omniRetiredConsumers = true
    await rt.save()
  }

  // One stream: connect from the last handled position, handle and ack each event in
  // order, reconnect when omni ends the stream, back off on failures.
  async function run(stream, controller) {
    let failures = 0
    while (!cancelled(controller)) {
      try {
        await ensureConsumer(stream)
        if (cancelled(controller)) return
        const after = cursors()[stream.suffix]
        const response = await rt.omniRequest('GET', `/events/consumers/${encodeURIComponent(consumerName(stream.suffix))}/stream`, {
          signal: controller.signal, headers: { accept: 'text/event-stream', ...(after ? { 'last-event-id': after } : {}) },
        })
        if (cancelled(controller) || response === null) return
        if (!response.ok || !response.body) throw new Error(`omni answered ${response.status} for the ${stream.suffix} stream`)
        failures = 0
        for await (const frame of frames(response.body)) {
          if (cancelled(controller)) break
          if (frame.event === 'reconnect' || frame.event === 'error') break
          if (frame.event === 'connected' || !frame.data || frame.id === undefined) continue
          let parsed
          try { parsed = rowSchema.safeParse(JSON.parse(frame.data)) } catch { continue }
          if (!parsed.success) continue
          const row = parsed.data
          const cursor = row.journalSeq ?? Number(frame.id)
          if (!Number.isSafeInteger(cursor) || cursor < 0) continue
          const handled = await handle(row, controller)
          if (handled === 'cancelled' || (handled === 'unmatched' && cancelled(controller))) break
          await ack(stream, cursor)
          if (cancelled(controller)) break
        }
      } catch (error) {
        if (cancelled(controller)) return
        const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]
        failures += 1
        rt.warn('ds-bot: omni %s events: %s; again in %d s', stream.suffix, error?.message ?? error, wait / 1000)
        await backoff(wait, controller.signal)
      }
    }
  }

  // Streams follow the subscriptions: one starts when an active subscription needs its
  // kind and stops when none does.
  async function sync() {
    if (stopped) return
    const configured = await rt.omniConfigured?.()
    if (stopped) return
    if (configured) await dropRetired().catch(error => rt.warn('ds-bot: retiring the first omni consumer failed: %s', error?.message ?? error))
    if (stopped) return
    const active = Object.values(state.subscriptions ?? {}).filter(sub => sub.on)
    for (const stream of STREAMS) {
      const wanted = configured && active.some(sub => stream.kinds.includes(sub.trigger.kind))
      let current = loops.get(stream.suffix)
      if (!wanted && current) current.controller.abort()
      if (wanted && current?.controller.signal.aborted) {
        // A stopped run still owns this consumer until enrichment/dispatch/ack settles.
        await current.task
        if (stopped) return
        current = loops.get(stream.suffix)
      }
      if (wanted && !current) {
        const entry = { controller: new AbortController(), task: undefined }
        loops.set(stream.suffix, entry)
        entry.task = run(stream, entry.controller).catch(error => rt.warn('ds-bot: omni events: %s', error)).finally(() => {
          if (loops.get(stream.suffix) === entry) loops.delete(stream.suffix)
        })
      }
    }
  }

  rt.syncOmniEvents = () => {
    if (stopped) return syncTail
    syncTail = syncTail.then(sync).catch(error => rt.warn('ds-bot: omni events: %s', error))
    return syncTail
  }
  rt.omniEventsView = () => ({ listening: [...loops].filter(([, entry]) => !cancelled(entry.controller)).map(([suffix]) => suffix) })
  ctx.effect(() => rt.hooks.live(() => ({ omniEvents: rt.omniEventsView() })), 'ds-bot: omni events view')
  ctx.effect(() => {
    const timer = setInterval(rt.syncOmniEvents, 30_000)
    const startup = Promise.resolve().then(() => rt.load()).then(rt.syncOmniEvents, () => {})
    rt.quiesceOmniEvents = () => {
      if (drain) return drain
      stopped = true
      clearInterval(timer)
      for (const entry of loops.values()) entry.controller.abort()
      // Stop synchronously, but retain stopped tasks until every ingress await settles.
      // No sync can start another run after stopped, so this final census is complete.
      drain = (async () => {
        await startup
        await syncTail
        await Promise.all([...loops.values()].map(entry => entry.task))
      })()
      return drain
    }
    return rt.quiesceOmniEvents
  }, 'ds-bot: omni events')
}
