import { createElement as h, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ConnectPrompt, openConnectWizard } from './wizard.js'
import { UpdateBar } from './omni-update.js'
import { AddGrid, LiveConnectFlow } from './channel-connect-live.js'
import { ORDER } from './channel-add.js'
import {
  CHANNEL_TYPES, CHANNELS_PANEL, STATUS, canSend, canWrite, channelOf, chatOf, healthSummary, omniActions, omniStore, startLive, typeOf, unreadOf, visibleChats,
} from './omni-store.js'
import { call, OmniMark, relativeShort, t, icons } from './core.js'
const { ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } = icons

// Omni channels inside the Bot surface. The Channels page (CHANNELS_PANEL) connects new
// channels and shows the health of the connected ones; a chat opens in the CHAT_PANEL main
// panel. Subscriptions on these channels live in subscriptions.js, run by Omni.
// Live when the host has an omni URL and key (src/host/omni.js); sample data otherwise. On a
// live Omni, adding, reconnecting, pausing and replying go through the host as far as the
// key allows (src/host/omni-channel-actions.js).

export const useOmni = () => useSyncExternalStore(omniStore.subscribe, omniStore.getSnapshot, omniStore.getSnapshot)
const useActions = actions => useMemo(() => omniActions(id => actions.selectPanel(id), call), [actions])

// -------------------------------------------------------------------------
// Marks

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }
const GLYPHS = {
  whatsapp: () => [
    h('path', { key: 'b', d: 'M12 3.6a8.4 8.4 0 0 0-7.2 12.8L3.7 20.3l4-1.1A8.4 8.4 0 1 0 12 3.6z', ...stroke }),
    h('path', { key: 'p', d: 'M9.2 8.3c-.3 0-.7.1-.9.5-.3.5-.5 1.2-.2 2.1.6 1.8 2.3 3.5 4.1 4.1.9.3 1.6.1 2.1-.2.4-.2.5-.6.5-.9l-.1-.4-1.6-.8-.9 1c-1-.4-1.9-1.3-2.3-2.3l1-.9-.8-1.6z', fill: 'currentColor' }),
  ],
  telegram: () => [
    h('path', { key: 'a', d: 'M20.5 4.5 3.5 11.2l5.3 1.9 2 6.1 3-3.3 4.4 3.3z', ...stroke }),
    h('path', { key: 'b', d: 'M8.8 13.1 16.8 8', ...stroke }),
  ],
  slack: () => [h('path', { key: 'a', d: 'M9.5 4.5v6M14.5 13.5v6M4.5 14.5h6M13.5 9.5h6', ...stroke, strokeWidth: 2.8 })],
  chat: () => [h('path', { key: 'a', d: 'M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z', ...stroke })],
  discord: () => [
    h('path', { key: 'a', d: 'M7.6 7.2c2.9-1.2 5.9-1.2 8.8 0 1.5 2.4 2.1 5 1.9 8-1.6 1.2-3.1 1.8-4.2 2l-.8-1.5m-2.6 0-.8 1.5c-1.1-.2-2.6-.8-4.2-2-.2-3 .4-5.6 1.9-8z', ...stroke }),
    h('circle', { key: 'l', cx: 9.6, cy: 12.4, r: 1.3, fill: 'currentColor' }),
    h('circle', { key: 'r', cx: 14.4, cy: 12.4, r: 1.3, fill: 'currentColor' }),
  ],
}

export function Tile({ type, size = 40, ring = false }) {
  return h('span', {
    className: `oc-tile${ring ? ' oc-tile-ring' : ''}`,
    style: { width: size, height: size, borderRadius: Math.round(size * 0.32), background: typeOf(type).tile },
  }, h('svg', { width: Math.round(size * 0.62), height: Math.round(size * 0.62), viewBox: '0 0 24 24', 'aria-hidden': true, focusable: 'false' }, (GLYPHS[typeOf(type).glyph] ?? GLYPHS.chat)()))
}

export const StatusDot = ({ status }) => h('span', { className: 'oc-dot', 'data-tone': STATUS[status].tone, 'aria-hidden': true })

const StatusPill = ({ status }) => h('span', { className: 'oc-pill', 'data-tone': STATUS[status].tone },
  h('span', { className: 'oc-pill-dot', 'aria-hidden': true }), t(STATUS[status].label))

// A stable soft color per name, so a chat keeps its avatar color across renders.
const HUES = [168, 200, 222, 262, 290, 330, 18, 38, 140]
function hueOf(name) {
  let sum = 0
  for (const char of name) sum = (sum * 31 + char.charCodeAt(0)) >>> 0
  return HUES[sum % HUES.length]
}

export function ChatAvatar({ chat, channel, size = 36 }) {
  const hue = hueOf(chat.name)
  return h('span', { className: 'oc-ava', style: { width: size, height: size, '--oc-hue': hue } },
    h('span', { className: 'oc-ava-face', style: { fontSize: Math.round(size * 0.34) } }, chat.initials),
    chat.avatarUrl ? h('img', { className: 'oc-ava-img', src: chat.avatarUrl, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onError: event => { event.currentTarget.remove() } }) : null,
    channel ? h('span', { className: 'oc-ava-badge' }, h(Tile, { type: channel.type, size: Math.round(size * 0.4) })) : null)
}

export function PreviewChip() {
  const source = useOmni().source
  if (source.kind === 'live') {
    return h('span', { className: 'oc-preview-chip oc-live-chip', 'data-error': source.error ? true : undefined, title: source.error ?? t('Read from omni every 15 seconds.') },
      h('span', { className: 'oc-live-dot', 'aria-hidden': true }), source.error ? t('Live · last refresh failed') : t('Live · {origin}', { origin: source.origin }))
  }
  const missing = source.missing?.join(', ')
  // Sample data until an Omni is linked: the chip opens the Connect wizard.
  return h('button', { type: 'button', className: 'oc-preview-chip oc-chip-action', onClick: openConnectWizard, title: missing ? t('Sample data until DSH has {missing}.', { missing }) : t('Nothing here reaches a real channel yet.') },
    t('Preview · sample data'), h('span', { className: 'oc-chip-go' }, t('Connect your Omni')))
}

// -------------------------------------------------------------------------
// Main panel: one chat

const dayKey = at => new Date(at).toDateString()
function dayLabel(at) {
  const today = new Date()
  if (dayKey(at) === today.toDateString()) return t('Today')
  if (dayKey(at) === new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toDateString()) return t('Yesterday')
  return new Date(at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

// A message's file, drawn in its bubble with Omni's text for it under it. The host fetches
// the file on its own key and keeps it (the omni-media endpoint, src/host/omni.js). A file is
// fetched once its row comes near the screen, and a video only once it is played.
const DRAWN = { image: 'Picture', audio: 'Voice note', video: 'Video', document: 'Document', sticker: 'Sticker' }
const drawnMedia = message => message.hasMedia === true && Object.hasOwn(DRAWN, message.type)
// How far beyond the thread's edges a row counts as near.
const NEAR = '600px 0px'

// Whether the node has come within NEAR of the thread's view; once near, it stays near.
// Without IntersectionObserver every row is near.
function useNear(ref, watching) {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!watching || near || !node) return undefined
    if (typeof IntersectionObserver !== 'function') {
      setNear(true)
      return undefined
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) setNear(true)
    }, { root: node.closest('.oc-thread'), rootMargin: NEAR })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref, watching, near])
  return near
}

// The host's base64, decoded once into a Blob the page points at; the URL is let go with
// the row.
const blobOf = (data, mime) => {
  const text = atob(data)
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

function useMediaFile(id, wanted) {
  const [file, setFile] = useState(null)
  useEffect(() => {
    if (!wanted) return undefined
    let on = true
    let url = null
    call('omni-media', { messageId: id }).then(
      (reply) => {
        if (!on) return
        if (!reply.ok) return setFile({ failed: reply.reason })
        url = URL.createObjectURL(blobOf(reply.data, reply.mime))
        setFile({ url })
      },
      (error) => { if (on) setFile({ failed: error.message }) })
    return () => {
      on = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [id, wanted])
  return file
}

const PlayMark = () => h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: 'false' }, h('path', { d: 'M8 5.5v13l10.5-6.5z', fill: 'currentColor' }))
const DocMark = () => h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: 'false' },
  h('path', { d: 'M7 3.5h6.5L18 8v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5zM13.5 3.5V8H18', ...stroke }))

function MediaPart({ message, onSized }) {
  const kind = message.type
  const [played, setPlayed] = useState(false)
  const spot = useRef(null)
  const near = useNear(spot, kind !== 'video' && kind !== 'document')
  const file = useMediaFile(message.id, kind === 'video' ? played : kind !== 'document' && near)
  const label = t(DRAWN[kind])
  if (kind === 'document') {
    return h('div', { className: 'oc-media-doc' }, h(DocMark), h('span', null, message.fileName ?? label))
  }
  if (file?.failed) return h('div', { className: 'oc-media-miss', title: file.failed }, label, ' · ', t('not available'))
  if (kind === 'video' && !played) {
    return h('button', { type: 'button', className: 'oc-media-still', 'aria-label': t('Play video'), onClick: () => setPlayed(true) }, h('span', { className: 'oc-media-play' }, h(PlayMark)))
  }
  if (!file) return h('div', { ref: spot, className: `oc-media-wait oc-media-wait-${kind}`, role: 'status', 'aria-label': t('Loading…') }, h('span', { className: 'oc-spinner', 'aria-hidden': true }))
  if (kind === 'audio') return h('audio', { className: 'oc-media-audio', controls: true, preload: 'metadata', src: file.url, onLoadedMetadata: onSized })
  if (kind === 'video') return h('video', { className: 'oc-media-img', controls: true, autoPlay: true, playsInline: true, src: file.url, onLoadedMetadata: onSized })
  return h('img', { className: kind === 'sticker' ? 'oc-media-sticker' : 'oc-media-img', src: file.url, alt: message.mediaText ?? label, onLoad: onSized })
}

// A chat's scroller, at its end when the chat or its number of messages changes. Whether
// the reader is at the end: a file that loads and grows its row keeps them there, and leaves
// a reader who scrolled up where they are.
export function useStayAtEnd(chatId, count) {
  const scroller = useRef(null)
  const atEnd = useRef(true)
  useLayoutEffect(() => {
    const node = scroller.current
    if (node) node.scrollTop = node.scrollHeight
    atEnd.current = true
  }, [chatId, count])
  const onScroll = () => {
    const node = scroller.current
    if (node) atEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32
  }
  const onSized = () => {
    const node = scroller.current
    if (node && atEnd.current) node.scrollTop = node.scrollHeight
  }
  return { scroller, onScroll, onSized }
}

// A chat's messages, as the chat view and the phone pane (omni-phone.js) draw them: the day
// over its first message, the sender over the first of a run, each file in its bubble with
// Omni's text for it under it. Names and text from the chat are text only.
export function ChatMessages({ messages, onSized }) {
  return messages.map((message, index) => {
    const mine = message.from !== 'them'
    const newDay = index === 0 || dayKey(messages[index - 1].at) !== dayKey(message.at)
    const first = newDay || messages[index - 1].from !== message.from || messages[index - 1].author !== message.author
    return h(Fragment, { key: message.id }, newDay ? h('div', { className: 'oc-day' }, dayLabel(message.at)) : null, h('div', { className: `oc-msg oc-msg-${message.from}${first ? ' oc-msg-first' : ''}` },
      first && !mine && message.author ? h('span', { className: 'oc-msg-author' }, message.author) : null,
      first && message.from === 'omni' ? h('span', { className: 'oc-msg-author oc-msg-omni' }, h(OmniMark, { size: 12 }), 'Omni') : null,
      h('div', { className: 'oc-bubble', 'data-sending': message.sending || undefined, 'data-media': drawnMedia(message) ? message.type : undefined },
        drawnMedia(message) ? h(MediaPart, { message, onSized }) : null,
        drawnMedia(message) ? (message.text ? h('span', { className: 'oc-media-caption' }, message.text) : null) : message.text,
        drawnMedia(message) && message.mediaText ? h('span', { className: 'oc-media-text' }, message.mediaText) : null,
        h('time', null, message.sending ? t('Sending…') : new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })))))
  })
}

export function ChatPage({ actions }) {
  const state = useOmni()
  const omni = useActions(actions)
  const chat = chatOf(state, state.chatId)
  const channel = chat ? channelOf(state, chat.channelId) : undefined
  const loaded = chat ? state.messages[chat.id] : undefined
  const loading = chat !== undefined && loaded === undefined && !state.preview
  const messages = chat ? loaded ?? (state.preview ? [{ id: 'preview', from: 'them', text: chat.preview, at: chat.at }] : []) : []
  const { scroller, onScroll, onSized } = useStayAtEnd(chat?.id, messages.length)
  const [draft, setDraft] = useState('')
  useEffect(() => { setDraft('') }, [chat?.id])
  if (!chat || !channel) {
    return h('div', { className: 'oc-page oc-chat-empty' }, h(OmniMark, { size: 40 }), h('p', null, t('Pick a chat under your Bots.')))
  }
  const type = typeOf(channel.type)
  const writable = canSend(state)
  const live = channel.status === 'connected' && writable
  const send = () => { omni.sendText(chat.id, draft); setDraft('') }
  const failed = state.sendError?.chatId === chat.id ? state.sendError : null
  return h('div', { className: 'oc-page oc-chat' },
    h('header', { className: 'oc-chat-head' },
      h(ChatAvatar, { chat, channel, size: 40 }),
      h('div', { className: 'oc-chat-who' },
        h('strong', null, chat.name),
        h('span', null, `${type.label} · ${channel.name}`)),
      h('span', { className: 'oc-answer', 'data-by': channel.answeredBy === 'Omni' ? 'omni' : 'you' },
        channel.answeredBy === 'Omni' ? h(Fragment, null, h(OmniMark, { size: 14 }), t('Omni answers here')) : t('You answer here')),
      h('button', { type: 'button', className: 'oc-ghost', onClick: () => omni.openChannels('channel', channel.id) }, h(StatusDot, { status: channel.status }), t('Channel health')),
      h(PreviewChip)),
    h('div', { ref: scroller, className: 'oc-thread', onScroll, role: 'log', 'aria-label': t('Conversation with {name}', { name: chat.name }) },
      h('div', { className: 'oc-thread-in' },
        loading ? h('div', { className: 'oc-day' }, h('span', { className: 'oc-spinner', 'aria-hidden': true }), t('Loading messages…')) : null,
        h(ChatMessages, { messages, onSized }))),
    h('footer', { className: 'oc-compose-wrap' },
      failed ? h('button', { type: 'button', className: 'oc-compose-note oc-compose-fail', role: 'alert', onClick: () => setDraft(failed.text) }, t('Not sent: {reason}', { reason: failed.message }), ' ', h('u', null, t('Put it back'))) : null,
      !writable ? h('div', { className: 'oc-compose-note oc-compose-info' }, t('This device\'s key can\'t send messages; ask your Omni\'s owner.'))
        : live ? null : h('button', { type: 'button', className: 'oc-compose-note', onClick: () => omni.openChannels('channel', channel.id) },
          h(StatusDot, { status: channel.status }), t('{name} is not connected. Fix it to reply.', { name: channel.name })),
      h('div', { className: 'oc-compose', 'data-off': live ? undefined : true },
        h('textarea', {
          rows: 1, value: draft, disabled: !live, placeholder: t('Reply on {channel}', { channel: type.label }), 'aria-label': t('Reply'),
          onChange: event => setDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() }
          },
        }),
        h('button', { type: 'button', className: 'oc-send', disabled: !live || draft.trim() === '', 'aria-label': t('Send'), onClick: send }, h(ArrowUpIcon)))))
}

// -------------------------------------------------------------------------
// Main panel: Channels

export function ChannelsPage({ actions }) {
  const state = useOmni()
  const omni = useActions(actions)
  const { page } = state
  const channel = page.view === 'channel' ? channelOf(state, page.channelId) : undefined
  return h('div', { className: 'oc-page oc-channels' },
    h('div', { className: 'oc-channels-in' },
      page.view === 'connect' ? h(ConnectFlow, { state, omni })
        : channel ? h(ChannelDetail, { key: channel.id, channel, state, omni })
          : h(Overview, { state, omni })))
}

function Overview({ state, omni }) {
  const summary = healthSummary(state)
  const troubled = state.channels.filter(channel => channel.status === 'attention' || channel.status === 'connecting')
  const replies = state.channels.map(channel => channel.health?.replyMedianSec).filter(value => typeof value === 'number')
  const median = replies.length === 0 ? null : Math.round(replies.reduce((a, b) => a + b, 0) / replies.length)
  return h(Fragment, null,
    h('header', { className: 'oc-head' },
      h('div', null,
        h('h1', null, t('Channels'), h(PreviewChip)),
        h('p', null, t('Connect the apps people already use to reach you. Omni answers there, and every chat shows up under your Bots.'))),
      h('button', { type: 'button', className: 'oc-primary', disabled: !canWrite(state), title: canWrite(state) ? undefined : t('This device\'s key can\'t change channels; ask your Omni\'s owner.'), onClick: () => omni.showPage({ view: 'connect', type: null, step: 0 }) }, h(PlusIcon), t('Add channel'))),
    // Sample data means no Omni is linked yet: connecting one comes first, in the Connect
    // wizard (wizard.js). A linked one says when an update is out.
    state.preview ? h(ConnectPrompt) : h(UpdateBar, { origin: state.source.origin }),
    troubled.map(channel => h('button', { key: channel.id, type: 'button', className: 'oc-callout', 'data-tone': STATUS[channel.status].tone, onClick: () => omni.showPage({ view: 'channel', channelId: channel.id }) },
      h(Tile, { type: channel.type, size: 36 }),
      h('span', { className: 'oc-callout-text' },
        h('strong', null, t('{name} needs attention', { name: `${typeOf(channel.type).label} · ${channel.name}` })),
        h('span', null, channel.problem ?? t(STATUS[channel.status].label))),
      h('span', { className: 'oc-callout-go' }, t('Fix now'), h(ChevronRightIcon)))),
    h('div', { className: 'oc-stats' },
      h(Stat, { value: `${summary.connected}/${summary.total}`, label: t('connected') }),
      h(Stat, { value: String(summary.attention), label: t('need attention'), tone: summary.attention > 0 ? 'warn' : undefined }),
      state.preview ? h(Stat, { value: String(summary.messagesToday), label: t('messages today') }) : h(Stat, { value: String(state.chats.length), label: t('recent chats') }),
      state.preview ? h(Stat, { value: median === null ? '–' : median < 60 ? t('{n} s', { n: median }) : t('{n} min', { n: Math.round(median / 60) }), label: t('typical reply') })
        : h(Stat, { value: String(unreadOf(state)), label: t('unread') })),
    h('h2', { className: 'oc-section' }, t('Your channels')),
    state.channels.length === 0
      ? h('div', { className: 'oc-empty' }, t('No channels yet. Add one to start.'))
      : h('div', { className: 'oc-cards' }, state.channels.map(channel => h(ChannelCard, { key: channel.id, channel, state, omni }))))
}

const Stat = ({ value, label, tone }) => h('div', { className: 'oc-stat', 'data-tone': tone }, h('strong', null, value), h('span', null, label))

function Spark({ week }) {
  const top = Math.max(1, ...week)
  return h('span', { className: 'oc-spark', 'aria-hidden': true }, week.map((value, index) => h('span', { key: index, style: { height: `${Math.max(8, (value / top) * 100)}%` }, 'data-zero': value === 0 || undefined })))
}

function ChannelCard({ channel, state, omni }) {
  const unread = unreadOf(state, channel.id)
  return h('button', { type: 'button', className: 'oc-card', onClick: () => omni.showPage({ view: 'channel', channelId: channel.id }) },
    h('span', { className: 'oc-card-top' },
      h(Tile, { type: channel.type, size: 42 }),
      h('span', { className: 'oc-card-who' }, h('strong', null, channel.name), h('span', null, `${typeOf(channel.type).label} · ${channel.detail}`)),
      h(StatusPill, { status: channel.status })),
    h('span', { className: 'oc-card-bottom' },
      channel.health.week ? h(Spark, { week: channel.health.week }) : null,
      h('span', { className: 'oc-card-facts' },
        channel.health.messagesToday === null ? null : h('span', null, t('{n} today', { n: channel.health.messagesToday })),
        h('span', null, channel.health.lastEventAt ? t('last message {time}', { time: relativeShort(channel.health.lastEventAt) }) : t('no messages yet')),
        unread > 0 ? h('span', { className: 'oc-card-unread' }, t('{n} unread', { n: unread })) : null)))
}

const replyText = seconds => (seconds === null ? '–' : seconds < 60 ? t('{n} s', { n: seconds }) : t('{n} min', { n: Math.round(seconds / 60) }))

function ChannelDetail({ channel, state, omni }) {
  const [confirming, setConfirming] = useState(false)
  useEffect(() => { setConfirming(false) }, [channel.id])
  const type = typeOf(channel.type)
  const writable = canWrite(state)
  const { health } = channel
  const firstChat = visibleChats({ ...state, filter: channel.id })[0]
  const chats = state.chats.filter(chat => chat.channelId === channel.id)
  const troubled = channel.status === 'attention' || channel.status === 'connecting'
  return h(Fragment, null,
    h('button', { type: 'button', className: 'oc-back', onClick: () => omni.showPage({ view: 'overview', channelId: null }) }, h(ChevronLeftIcon), t('Channels')),
    h('header', { className: 'oc-detail-head' },
      h(Tile, { type: channel.type, size: 56 }),
      h('div', { className: 'oc-detail-who' },
        h('h1', null, channel.name),
        h('p', null, `${type.label} · ${channel.detail}`)),
      h(StatusPill, { status: channel.status })),
    troubled
      ? h('div', { className: 'oc-callout oc-callout-static', 'data-tone': STATUS[channel.status].tone },
        h('span', { className: 'oc-callout-text' },
          h('strong', null, channel.status === 'connecting' ? t('Reconnecting…') : t('This channel stopped working')),
          h('span', null, channel.status === 'connecting' ? t('Omni is bringing {name} back. Messages sent meanwhile are delivered after.', { name: channel.name }) : channel.problem)),
        writable && channel.status === 'attention' && type.pairing !== 'token' ? h('button', { type: 'button', className: 'oc-primary', disabled: Boolean(channel.busy), onClick: () => omni.reconnect(channel.id) }, channel.busy === 'reconnect' ? t('Reconnecting…') : t('Reconnect')) : null,
        channel.status === 'connecting' || channel.busy ? h('span', { className: 'oc-spinner', 'aria-hidden': true }) : null)
      : null,
    channel.actionError ? h('p', { className: 'oc-problem', role: 'alert' }, channel.actionError) : null,
    writable && channel.status === 'attention' && type.pairing === 'token' ? h(TokenFix, { channel, type, omni }) : null,
    h('div', { className: 'oc-actions' },
      firstChat ? h('button', { type: 'button', className: 'oc-secondary', onClick: () => { omni.setFilter(channel.id); omni.openChat(firstChat.id) } }, t('Open chats')) : null,
      !writable ? null : channel.status === 'paused'
        ? h('button', { type: 'button', className: 'oc-secondary', disabled: Boolean(channel.busy), onClick: () => omni.resume(channel.id) }, channel.busy === 'resume' ? t('Resuming…') : t('Resume'))
        : channel.status === 'connected' ? h('button', { type: 'button', className: 'oc-secondary', disabled: Boolean(channel.busy), onClick: () => omni.pause(channel.id) }, channel.busy === 'pause' ? t('Pausing…') : t('Pause')) : null),
    h('h2', { className: 'oc-section' }, t('Health')),
    h('div', { className: 'oc-stats' },
      health.uptime === null
        ? h(Stat, { value: t(STATUS[channel.status].label), label: t('right now'), tone: channel.status === 'connected' ? undefined : 'warn' })
        : h(Stat, { value: `${(health.uptime * 100).toFixed(health.uptime === 1 ? 0 : 1)}%`, label: t('online, last 7 days'), tone: health.uptime < 0.95 ? 'warn' : undefined }),
      health.messagesToday === null
        ? h(Stat, { value: String(chats.reduce((sum, chat) => sum + chat.unread, 0)), label: t('unread') })
        : h(Stat, { value: String(health.messagesToday), label: t('messages today') }),
      health.replyMedianSec === null && health.lastSeenAt
        ? h(Stat, { value: relativeShort(health.lastSeenAt), label: t('last seen online') })
        : h(Stat, { value: replyText(health.replyMedianSec), label: t('typical reply') }),
      h(Stat, { value: health.lastEventAt ? relativeShort(health.lastEventAt) : '–', label: t('last message') })),
    health.week ? h(WeekChart, { week: health.week }) : null,
    h('h2', { className: 'oc-section' }, t('Who answers')),
    // Who answers is the agent omni routes a channel to; on a live Omni, Omni changes that by talking.
    state.preview
      ? h('div', { className: 'oc-seg', role: 'radiogroup', 'aria-label': t('Who answers') },
        [['Omni', t('Omni answers'), t('Omni replies on its own and hands over when it should.')], ['You', t('You answer'), t('Chats wait for you. Omni only drafts.')]].map(([value, title, text]) => h('button', {
          key: value, type: 'button', role: 'radio', 'aria-checked': channel.answeredBy === value, className: 'oc-seg-opt',
          onClick: () => omni.setAnsweredBy(channel.id, value),
        }, h('strong', null, value === 'Omni' ? h(OmniMark, { size: 16 }) : null, title), h('span', null, text))))
      : h('div', { className: 'oc-seg-opt oc-seg-static' }, channel.answeredBy === 'Omni'
        ? h(Fragment, null, h('strong', null, h(OmniMark, { size: 16 }), t('Omni answers')), h('span', null, t('An agent is assigned to this channel in omni.')))
        : h(Fragment, null, h('strong', null, t('You answer')), h('span', null, t('No agent is assigned to this channel in omni.')))),
    state.preview
      ? h('div', { className: 'oc-danger' },
        h('div', null, h('strong', null, t('Disconnect {name}', { name: channel.name })), h('span', null, t('Omni stops reading and answering here. Its chats leave the sidebar.'))),
        h('button', {
          type: 'button', className: confirming ? 'oc-danger-go oc-danger-armed' : 'oc-danger-go',
          onClick: () => (confirming ? omni.remove(channel.id) : setConfirming(true)),
          onBlur: () => setConfirming(false),
        }, confirming ? t('Click again to disconnect') : t('Disconnect')))
      : h('section', { className: 'oc-danger', 'aria-label': t('Delete instance') },
        h('div', null,
          h('strong', null, confirming ? t('Delete instance {name} ({id})?', { name: channel.name, id: channel.id }) : t('Delete instance')),
          h('span', null, t('Permanently deletes this instance configuration and its local chats and messages.')),
          h('span', null, t('Disconnect, logout and session cleanup are best effort. External token revocation or account unlinking is not guaranteed. Events are not all erased.')),
          channel.deleteError ? h('p', { className: 'oc-problem', role: 'alert' }, t('Could not delete instance: {reason}. Check your access or connection, then try again.', { reason: channel.deleteError })) : null),
        confirming ? h(Fragment, null,
          h('button', { type: 'button', className: 'oc-secondary', disabled: channel.busy === 'delete', onClick: () => setConfirming(false) }, t('Cancel')),
          h('button', { type: 'button', className: 'oc-danger-go oc-danger-armed', disabled: !writable || Boolean(channel.busy), onClick: () => { if (writable && !channel.busy) void omni.deleteInstance(channel.id) } }, channel.busy === 'delete' ? t('Deleting instance…') : t('Permanently delete instance')))
          : h('button', { type: 'button', className: 'oc-danger-go', disabled: !writable || Boolean(channel.busy), title: writable ? undefined : t('This device\'s key can\'t change channels; ask your Omni\'s owner.'), onClick: () => { if (writable && !channel.busy) setConfirming(true) } }, t('Delete instance'))))
}

function WeekChart({ week }) {
  const days = [6, 5, 4, 3, 2, 1, 0].map(back => new Date(Date.now() - back * 86_400_000).toLocaleDateString([], { weekday: 'short' }))
  const top = Math.max(1, ...week)
  return h('div', { className: 'oc-chart', role: 'img', 'aria-label': t('Messages per day, last 7 days: {list}', { list: week.join(', ') }) },
    week.map((value, index) => h('span', { key: index, className: 'oc-chart-col' },
      h('span', { className: 'oc-chart-n' }, value > 0 ? String(value) : ''),
      h('span', { className: 'oc-chart-bar', style: { height: `${Math.max(3, (value / top) * 100)}%` }, 'data-zero': value === 0 || undefined }),
      h('span', { className: 'oc-chart-day' }, days[index]))))
}

// Choose a channel type, then pair it the way that channel pairs: a QR code, a token,
// or the app's own sign-in.
function ConnectFlow({ state, omni }) {
  return state.preview ? h(PreviewConnectFlow, { state, omni }) : h(LiveConnectFlow, { state, omni, Tile, PreviewChip })
}

function PreviewConnectFlow({ state, omni }) {
  const { type, step } = state.page
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  useEffect(() => { setName(''); setToken('') }, [type])
  if (type === null) {
    return h(AddGrid, { types: ORDER, onPick: id => omni.showPage({ type: id, step: 0 }), onBack: () => omni.showPage({ view: 'overview' }), Tile, PreviewChip })
  }
  const info = CHANNEL_TYPES[type]
  const steps = [t('Name it'), info.pairing === 'qr' ? t('Scan') : info.pairing === 'token' ? t('Paste token') : t('Sign in'), t('Done')]
  return h(Fragment, null,
    h('button', { type: 'button', className: 'oc-back', onClick: () => omni.showPage({ type: null, step: 0 }) }, h(ChevronLeftIcon), t('All channels')),
    h('ol', { className: 'oc-steps' }, steps.map((label, index) => h('li', { key: label, 'data-state': index < step ? 'done' : index === step ? 'now' : undefined }, h('span', null, index < step ? '✓' : String(index + 1)), label))),
    h('div', { className: 'oc-flow' },
      h(Tile, { type, size: 64, ring: true }),
      step === 0 ? h(Fragment, null,
        h('h1', null, t('Connect {app}', { app: info.label })),
        h('p', null, info.blurb),
        h('label', { className: 'oc-field' }, h('span', null, t('Name')), h('input', {
          value: name, placeholder: t('For example: Sales, Support, Personal'), onChange: event => setName(event.target.value), autoFocus: true,
          onKeyDown: (event) => { if (event.key === 'Enter') omni.showPage({ step: 1 }) },
        })),
        h('button', { type: 'button', className: 'oc-primary', onClick: () => omni.showPage({ step: 1 }) }, t('Continue')))
        : step === 1 ? h(Pairing, { info, token, setToken, onDone: () => omni.showPage({ step: 2 }) })
          : h(Fragment, null,
            h('h1', null, state.preview ? t('{app} is connected', { app: info.label }) : t('That is the whole flow')),
            h('p', null, state.preview ? t('New chats appear under your Bots. Nothing is sent to your contacts until Omni or you reply.') : t('Connecting from here is switched on after you approve it; this run changed nothing in omni.')),
            state.preview
              ? h('button', { type: 'button', className: 'oc-primary', onClick: () => omni.finishConnect(type, name.trim()) }, t('See its health'))
              : h('button', { type: 'button', className: 'oc-primary', onClick: () => omni.showPage({ view: 'overview', type: null, step: 0 }) }, t('Back to channels')))))
}

function Pairing({ info, token, setToken, onDone }) {
  if (info.pairing === 'qr') return h(QrPairing, { info, onDone })
  if (info.pairing === 'token') {
    return h(Fragment, null,
      h('h1', null, t('Paste the {app} token', { app: info.label })),
      h('p', null, info.label === 'Telegram' ? t('Message @BotFather, send /newbot, and copy the token it gives you.') : t('Create the token in {app}\'s settings and paste it here.', { app: info.label })),
      h('label', { className: 'oc-field' }, h('span', null, t('Token')), h('input', { type: 'password', value: token, onChange: event => setToken(event.target.value), placeholder: '123456:ABC-…', autoComplete: 'off' })),
      h('button', { type: 'button', className: 'oc-primary', disabled: token.trim() === '', onClick: onDone }, t('Connect')))
  }
  return h(Fragment, null,
    h('h1', null, t('Sign in with {app}', { app: info.signIn })),
    h('p', null, t('A {app} window opens. Approve Omni there and come back.', { app: info.signIn })),
    h('button', { type: 'button', className: 'oc-primary', onClick: onDone }, t('Continue to {app}', { app: info.signIn })))
}

// A revoked token is fixed where it is reported: paste the new one and reconnect.
function TokenFix({ channel, type, omni }) {
  const [token, setToken] = useState('')
  return h('div', { className: 'oc-fix' },
    h('label', { className: 'oc-field' }, h('span', null, t('New {app} token', { app: type.label })),
      h('input', { type: 'password', value: token, autoComplete: 'off', placeholder: '123456:ABC-…', onChange: event => setToken(event.target.value),
        onKeyDown: (event) => { if (event.key === 'Enter' && token.trim() !== '') omni.reconnect(channel.id, token.trim()) } })),
    h('button', { type: 'button', className: 'oc-primary', disabled: token.trim() === '' || Boolean(channel.busy), onClick: () => omni.reconnect(channel.id, token.trim()) }, t('Reconnect')))
}

// WhatsApp codes live for 60 seconds; the countdown shows when the next one appears.
function useCountdown(seconds) {
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    const timer = setInterval(() => setLeft(value => (value <= 1 ? seconds : value - 1)), 1000)
    return () => clearInterval(timer)
  }, [seconds])
  return left
}

function QrPairing({ info, onDone }) {
  const [byPhone, setByPhone] = useState(false)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState(null)
  const left = useCountdown(60)
  if (byPhone) {
    return h(Fragment, null,
      h('h1', null, t('Link with a phone number')),
      code === null ? h(Fragment, null,
        h('p', null, t('Omni shows an 8-character code. Type it on your phone instead of scanning.')),
        h('label', { className: 'oc-field' }, h('span', null, t('Phone number with country code')), h('input', { value: phone, inputMode: 'tel', placeholder: '+55 11 91234-5678', onChange: event => setPhone(event.target.value), autoFocus: true })),
        h('button', { type: 'button', className: 'oc-primary', disabled: phone.replace(/\D/g, '').length < 8, onClick: () => setCode('K7QX-4M2P') }, t('Get code')))
        : h(Fragment, null,
          h('ol', { className: 'oc-howto' },
            h('li', null, t('On your phone, open {app} → Linked devices → Link a device', { app: info.label })),
            h('li', null, t('Tap “Link with phone number instead”')),
            h('li', null, t('Type this code'))),
          h('div', { className: 'oc-code', 'aria-label': t('Pairing code') }, code.split('').map((char, index) => h('span', { key: index, 'data-dash': char === '-' || undefined }, char))),
          h('span', { className: 'oc-qr-wait' }, h('span', { className: 'oc-spinner', 'aria-hidden': true }), t('Waiting for your phone… the code works for {n} s', { n: left })),
          h('button', { type: 'button', className: 'oc-link', onClick: onDone }, t('Preview: pretend I typed it'))),
      h('button', { type: 'button', className: 'oc-link', onClick: () => { setByPhone(false); setCode(null) } }, t('Scan a QR code instead')))
  }
  return h(Fragment, null,
    h('h1', null, t('Scan with your phone')),
    h('ol', { className: 'oc-howto' },
      h('li', null, t('Open {app} on your phone', { app: info.label })),
      h('li', null, t('Tap Settings, then Linked devices')),
      h('li', null, t('Tap Link a device and point the camera here'))),
    h('div', { className: 'oc-qr' },
      h('span', { className: 'oc-qr-code' }, h(SampleQr, { seed: Math.floor(Date.now() / 60_000) }), h('span', { className: 'oc-qr-logo' }, h(Tile, { type: 'whatsapp-baileys', size: 34 }))),
      h('span', { className: 'oc-qr-wait' }, h('span', { className: 'oc-spinner', 'aria-hidden': true }), t('Waiting for your phone · new code in {n} s', { n: left }))),
    h('span', { className: 'oc-alt' },
      h('button', { type: 'button', className: 'oc-link', onClick: () => setByPhone(true) }, t('Use a phone number instead')),
      h('button', { type: 'button', className: 'oc-link', onClick: onDone }, t('Preview: pretend I scanned it'))))
}

// A placeholder pattern for the preview, not a pairing code.
function SampleQr({ seed = 1 }) {
  const N = 25
  const finder = (x, y) => [[0, 0], [N - 7, 0], [0, N - 7]].find(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7)
  const logo = (x, y) => Math.abs(x - 12) <= 3 && Math.abs(y - 12) <= 3
  const cells = []
  let state = seed * 2654435761 >>> 0
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
    state = (state * 1103515245 + 12345) >>> 0
    if (finder(x, y) || logo(x, y) || (x === 7 || y === 7) && (x < 8 && y < 8 || x > N - 9 && y < 8 || x < 8 && y > N - 9)) continue
    if ((state >>> 16) % 100 < 48) cells.push(h('rect', { key: `${x}-${y}`, x, y, width: 1, height: 1, rx: 0.3 }))
  }
  const eyes = [[0, 0], [N - 7, 0], [0, N - 7]].map(([x, y]) => h('g', { key: `${x}-${y}` },
    h('rect', { x: x + 0.5, y: y + 0.5, width: 6, height: 6, rx: 1.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1 }),
    h('rect', { x: x + 2, y: y + 2, width: 3, height: 3, rx: 0.9 })))
  return h('svg', { viewBox: `-1 -1 ${N + 2} ${N + 2}`, width: 196, height: 196, 'aria-hidden': true }, h('g', { fill: 'currentColor' }, cells, eyes))
}

// -------------------------------------------------------------------------

const TONES = '[data-tone=ok]{--oc-tone:#16a34a}[data-tone=busy]{--oc-tone:#0ea5e9}[data-tone=warn]{--oc-tone:#f59e0b}[data-tone=off]{--oc-tone:#94a3b8}'

// The footer's way into channel management: the connected channels as small tiles, a dot
// when one needs attention, and the Channels page (connect, health) on click.
export function ChannelsFooter({ wide, actions }) {
  const state = useOmni()
  useEffect(() => { startLive(call) }, [])
  if (!wide) return null
  const summary = healthSummary(state)
  const label = summary.attention > 0 ? t('{n} channel needs attention', { n: summary.attention }) : t('Channels and their health')
  return h('span', { className: 'bt-connect-wrap' }, h('button', { type: 'button', className: 'bt-connect bt-connect-foot bt-channels-foot', title: label, 'aria-label': `${t('Channels')}, ${label}`, onClick: () => actions.selectPanel(CHANNELS_PANEL) },
    h('span', { className: 'bt-channels-tiles', 'aria-hidden': true }, state.channels.slice(0, 4).map(channel => h(Tile, { key: channel.id, type: channel.type, size: 18 }))),
    t('Channels'),
    summary.attention > 0 ? h('span', { className: 'oc-warn-dot', 'aria-hidden': true }) : h('span', { className: 'bt-channels-count' }, `${summary.connected}/${summary.total}`)))
}

export const CHANNELS_CSS = `
.bt-channels-foot{gap:8px;justify-content:flex-start;padding:0 12px 0 8px}
.bt-channels-tiles{display:inline-flex}
.bt-channels-tiles .oc-tile{margin-left:-5px;box-shadow:0 0 0 1.5px var(--bt-main)}
.bt-channels-tiles .oc-tile:first-child{margin-left:0}
.bt-channels-count{margin-left:auto;font-size:12px;color:var(--bt-ink-3)}
.bt-channels-foot .oc-warn-dot{margin-left:auto}
${TONES}
.oc-tile{display:inline-grid;place-items:center;flex:none;color:#fff;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.08)}
.oc-tile svg{display:block}
.oc-tile-ring{box-shadow:0 0 0 6px color-mix(in srgb,var(--bt-accent) 14%,transparent)}
.oc-dot{width:9px;height:9px;border-radius:50%;background:var(--oc-tone);flex:none}
.oc-pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap;color:color-mix(in srgb,var(--oc-tone) 70%,var(--bt-ink));background:color-mix(in srgb,var(--oc-tone) 13%,transparent)}
.oc-pill-dot{width:6px;height:6px;border-radius:50%;background:var(--oc-tone)}
.oc-pill[data-tone=busy] .oc-pill-dot,.oc-filter .oc-dot[data-tone=busy]{animation:oc-pulse 1.2s ease-in-out infinite}
@keyframes oc-pulse{50%{opacity:.35}}
.oc-preview-chip{display:inline-flex;align-items:center;height:22px;padding:0 9px;margin-left:10px;border-radius:999px;border:1px dashed var(--bt-line-2);color:var(--bt-ink-2);font-size:11.5px;font-weight:500;vertical-align:middle;white-space:nowrap}
.oc-chip-action{cursor:pointer;font:inherit;font-size:11.5px;background:none;gap:6px}
.oc-chip-action:hover{border-color:var(--bt-accent);color:var(--bt-ink)}
.oc-chip-go{color:var(--bt-accent);font-weight:600}
.oc-connect-prompt{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:4px 0 22px;padding:18px 20px;border:1px solid var(--bt-line);border-radius:16px;background:color-mix(in srgb,var(--bt-accent) 6%,var(--bt-surface,transparent))}
.oc-connect-prompt strong{font-size:15px;font-weight:600}
.oc-connect-prompt p{margin:4px 0 0;color:var(--bt-ink-2);font-size:13px}

/* Chat avatars carry a small channel tile in the corner. */
.oc-ava{position:relative;flex:none;display:inline-grid;place-items:center;border-radius:50%;background:hsl(var(--oc-hue) 55% 88%);color:hsl(var(--oc-hue) 45% 30%)}
body[data-ds-dark-theme] .oc-ava{background:hsl(var(--oc-hue) 30% 26%);color:hsl(var(--oc-hue) 60% 82%)}
.oc-ava-face{font-weight:600;letter-spacing:.01em}
.oc-ava-img{position:absolute;inset:0;width:100%;height:100%;border-radius:50%;object-fit:cover}
.oc-ava-badge{position:absolute;right:-4px;bottom:-4px;display:inline-flex;border-radius:32%;box-shadow:0 0 0 2px var(--bt-sidebar)}
.oc-chat .oc-ava-badge{box-shadow:0 0 0 2px var(--bt-main)}

/* Main panels */
.oc-page{position:relative;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--bt-main);color:var(--bt-ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;animation:oc-page-in .22s cubic-bezier(.2,0,0,1)}
@keyframes oc-page-in{from{opacity:0;transform:translateY(6px)}}
.oc-primary,.oc-secondary,.oc-ghost{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 16px;border-radius:999px;font:inherit;font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap;transition:transform .12s ease,opacity .12s ease,background-color .12s ease}
.oc-primary{border:0;background:var(--bt-accent);color:var(--bt-accent-ink,#fff)}
.oc-primary svg{width:16px;height:16px}
.oc-primary:hover:not(:disabled){opacity:.92}
.oc-primary:active:not(:disabled),.oc-secondary:active{transform:scale(.97)}
.oc-primary:disabled{opacity:.45;cursor:default}
.oc-secondary{border:1px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink)}
.oc-secondary:hover{background:var(--bt-hover)}
.oc-ghost{height:32px;padding:0 12px;border:0;background:none;color:var(--bt-ink-2);font-size:13px}
.oc-ghost:hover{background:var(--bt-hover);color:var(--bt-ink)}
.oc-link{border:0;background:none;padding:0;color:var(--bt-ink-2);font:inherit;font-size:13px;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.oc-spinner{width:14px;height:14px;border-radius:50%;border:2px solid color-mix(in srgb,var(--bt-accent) 25%,transparent);border-top-color:var(--bt-accent);animation:oc-spin .8s linear infinite;flex:none}
@keyframes oc-spin{to{transform:rotate(360deg)}}

/* Chat */
.oc-chat-empty{align-items:center;justify-content:center;gap:12px;color:var(--bt-ink-3)}
.oc-chat-head{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:.5px solid var(--bt-line-2);flex-wrap:wrap}
.oc-chat-who{display:flex;flex-direction:column;min-width:0;margin-right:auto}
.oc-chat-who strong{font-size:15px;line-height:20px;font-weight:600}
.oc-chat-who span{font-size:12.5px;color:var(--bt-ink-2)}
.oc-answer{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:999px;font-size:12.5px;color:var(--bt-accent);background:color-mix(in srgb,var(--bt-accent) 10%,transparent)}
.oc-answer[data-by=you]{color:var(--bt-ink-2);background:var(--bt-hover)}
.oc-thread{flex:1;min-height:0;overflow-y:auto}
.oc-thread-in{display:flex;flex-direction:column;gap:2px;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:20px 24px 12px}
.oc-day{align-self:center;margin:4px 0 12px;font-size:11.5px;color:var(--bt-ink-3)}
.oc-msg{display:flex;flex-direction:column;max-width:72%;animation:oc-msg-in .2s cubic-bezier(.2,0,0,1)}
@keyframes oc-msg-in{from{opacity:0;transform:translateY(4px)}}
.oc-msg-first{margin-top:10px}
.oc-msg-them{align-self:flex-start;align-items:flex-start}
.oc-msg-omni,.oc-msg-you{align-self:flex-end;align-items:flex-end}
.oc-msg-author{display:inline-flex;align-items:center;gap:4px;margin:0 12px 3px;font-size:12px;font-weight:500;color:var(--bt-ink-2)}
.oc-msg-omni .oc-msg-author{color:var(--bt-accent)}
.oc-bubble{position:relative;padding:8px 12px 7px;border-radius:18px;font-size:14.5px;line-height:21px;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:2px}
.oc-bubble time{float:right;margin:5px 0 -3px 10px;font-size:10.5px;line-height:14px;opacity:.55}
.oc-msg-them .oc-bubble{background:var(--bt-bubble);color:var(--bt-ink)}
.oc-msg-omni .oc-bubble{background:color-mix(in srgb,var(--bt-accent) 14%,var(--bt-main));color:var(--bt-ink)}
.oc-msg-you .oc-bubble{background:var(--bt-user);color:var(--bt-user-ink)}
.oc-bubble[data-media]{padding:4px 4px 7px}
.oc-media-caption,.oc-media-text{display:block;margin:2px 8px 0}
.oc-bubble[data-media]>time{margin-right:8px}
.oc-bubble[data-media=sticker]{background:none;padding:0}
.oc-media-img{display:block;max-width:100%;max-height:340px;border-radius:14px;margin-bottom:4px}
.oc-media-sticker{display:block;width:140px;height:140px;object-fit:contain}
.oc-media-audio{display:block;width:260px;max-width:100%;height:40px;margin-top:4px;margin-bottom:4px}
.oc-media-still{display:grid;place-items:center;width:240px;max-width:100%;aspect-ratio:16/10;margin-bottom:4px;border:0;border-radius:14px;background:linear-gradient(160deg,#2b2f36,#14161a);color:#fff;cursor:pointer}
.oc-media-play{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:rgba(0,0,0,.45);padding-left:3px;box-sizing:border-box}
.oc-media-wait{display:grid;place-items:center;width:240px;max-width:100%;aspect-ratio:4/3;margin-bottom:4px;border-radius:14px;background:var(--bt-hover)}
.oc-media-wait-audio{aspect-ratio:auto;height:40px;width:260px}
.oc-media-wait-sticker{width:140px;aspect-ratio:1}
.oc-media-doc{display:flex;align-items:center;gap:8px;min-width:180px;padding:8px 10px;border-radius:12px;background:var(--bt-hover);font-size:13.5px}
.oc-media-doc span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oc-media-miss{margin:6px 8px 2px;font-size:12.5px;color:var(--bt-ink-3)}
.oc-media-text{font-size:13px;line-height:19px;opacity:.75}
.oc-compose-wrap{padding:8px 24px 20px}
.oc-compose-note{display:flex;align-items:center;gap:8px;max-width:var(--dsh-chat-content-width,748px);margin:0 auto 8px;width:100%;padding:8px 12px;border:0;border-radius:12px;background:color-mix(in srgb,#f59e0b 12%,transparent);color:var(--bt-ink);font:inherit;font-size:13px;text-align:left;cursor:pointer;box-sizing:border-box}
.oc-compose{display:flex;align-items:flex-end;gap:8px;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:6px 6px 6px 16px;border-radius:24px;border:1px solid var(--bt-line-2);background:var(--bt-card);box-shadow:0 2px 8px -2px rgba(0,0,0,.06);box-sizing:border-box}
.oc-compose[data-off]{opacity:.6}
.oc-compose textarea{flex:1;height:36px;min-height:36px;max-height:160px;padding:8px 0;box-sizing:border-box;border:0;background:none;color:var(--bt-ink);font:inherit;font-size:14.5px;line-height:20px;resize:none;outline:none;field-sizing:content}
.oc-send{width:36px;height:36px;border-radius:50%;border:0;background:var(--bt-accent);color:var(--bt-accent-ink,#fff);display:inline-grid;place-items:center;cursor:pointer;flex:none;transition:opacity .12s ease,transform .12s ease}
.oc-send:disabled{opacity:.3;cursor:default}
.oc-send:active:not(:disabled){transform:scale(.94)}

/* Channels */
.oc-channels{overflow-y:auto}
.oc-channels-in{width:100%;max-width:880px;margin:0 auto;padding:28px 32px 48px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px}
.oc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
.oc-head h1,.oc-detail-who h1,.oc-flow h1{margin:0;font-size:24px;line-height:32px;font-weight:650;letter-spacing:-.01em}
.oc-head p{margin:6px 0 0;max-width:560px;font-size:14px;line-height:21px;color:var(--bt-ink-2)}
.oc-callout{display:flex;align-items:center;gap:14px;width:100%;padding:14px 16px;border:1px solid color-mix(in srgb,var(--oc-tone) 35%,transparent);border-radius:16px;background:color-mix(in srgb,var(--oc-tone) 9%,var(--bt-main));color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;box-sizing:border-box;transition:transform .12s ease}
.oc-callout:hover:not(.oc-callout-static){transform:translateY(-1px)}
.oc-callout-static{cursor:default}
.oc-callout-text{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;font-size:13.5px;line-height:19px;color:var(--bt-ink-2)}
.oc-callout-text strong{font-size:14px;color:var(--bt-ink);font-weight:600}
.oc-callout-go{display:inline-flex;align-items:center;gap:2px;font-size:13.5px;font-weight:600;color:color-mix(in srgb,var(--oc-tone) 70%,var(--bt-ink));white-space:nowrap}
.oc-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.oc-stat{display:flex;flex-direction:column;gap:2px;padding:14px 16px;border-radius:14px;background:var(--bt-card);border:.5px solid var(--bt-line-2)}
.oc-stat strong{font-size:22px;line-height:28px;font-weight:650;font-variant-numeric:tabular-nums}
.oc-stat span{font-size:12.5px;color:var(--bt-ink-2)}
.oc-stat[data-tone=warn] strong{color:#d97706}
.oc-section{margin:10px 0 0;font-size:13px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--bt-ink-3)}
.oc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}
.oc-card{display:flex;flex-direction:column;gap:16px;padding:16px;border-radius:18px;border:.5px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;transition:transform .14s ease,box-shadow .14s ease}
.oc-card:hover{transform:translateY(-2px);box-shadow:0 12px 28px -12px rgba(0,0,0,.18)}
.oc-card-top{display:flex;align-items:center;gap:12px}
.oc-card-who{display:flex;flex-direction:column;flex:1;min-width:0}
.oc-card-who strong{font-size:15px;line-height:20px;font-weight:600}
.oc-card-who span{font-size:12.5px;color:var(--bt-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oc-card-bottom{display:flex;align-items:flex-end;gap:14px}
.oc-card-facts{display:flex;flex-direction:column;gap:2px;font-size:12.5px;color:var(--bt-ink-2);margin-left:auto;text-align:right}
.oc-card-unread{color:var(--bt-accent);font-weight:600}
.oc-spark{display:flex;align-items:flex-end;gap:3px;height:34px;width:96px}
.oc-spark span{flex:1;border-radius:3px;background:color-mix(in srgb,var(--bt-accent) 55%,transparent)}
.oc-spark span:last-child:not([data-zero]){background:var(--bt-accent)}
.oc-spark span[data-zero]{background:var(--bt-line-2)}
.oc-back{align-self:flex-start;display:inline-flex;align-items:center;gap:2px;height:30px;padding:0 10px 0 4px;margin-left:-4px;border:0;border-radius:999px;background:none;color:var(--bt-ink-2);font:inherit;font-size:13.5px;cursor:pointer}
.oc-back:hover{background:var(--bt-hover);color:var(--bt-ink)}
.oc-detail-head{display:flex;align-items:center;gap:16px}
.oc-detail-who{flex:1;min-width:0}
.oc-detail-who p{margin:2px 0 0;font-size:13.5px;color:var(--bt-ink-2)}
.oc-actions{display:flex;gap:8px;flex-wrap:wrap}
.oc-chart{display:flex;align-items:stretch;gap:10px;height:150px;padding:16px 16px 10px;border-radius:16px;background:var(--bt-card);border:.5px solid var(--bt-line-2)}
.oc-chart-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;min-width:0}
.oc-chart-n{font-size:11px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums;min-height:14px}
.oc-chart-bar{width:100%;max-width:38px;border-radius:8px 8px 4px 4px;background:color-mix(in srgb,var(--bt-accent) 50%,transparent);transform-origin:bottom;animation:oc-grow .5s cubic-bezier(.2,0,0,1) both}
.oc-chart-col:last-child .oc-chart-bar:not([data-zero]){background:var(--bt-accent)}
.oc-chart-bar[data-zero]{background:var(--bt-line-2)}
@keyframes oc-grow{from{transform:scaleY(0)}}
.oc-chart-day{font-size:11.5px;color:var(--bt-ink-2)}
.oc-seg{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.oc-seg-opt{display:flex;flex-direction:column;gap:4px;padding:14px 16px;border-radius:14px;border:1px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;transition:border-color .12s ease,background-color .12s ease}
.oc-seg-opt strong{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:600}
.oc-seg-opt span{font-size:12.5px;line-height:18px;color:var(--bt-ink-2)}
.oc-seg-opt[aria-checked=true]{border-color:var(--bt-accent);background:color-mix(in srgb,var(--bt-accent) 8%,var(--bt-card));box-shadow:0 0 0 3px color-mix(in srgb,var(--bt-accent) 14%,transparent)}
.oc-danger{display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin-top:14px;padding:16px;border-radius:14px;border:1px solid color-mix(in srgb,var(--bt-danger) 25%,transparent)}
.oc-danger div{display:flex;flex-direction:column;gap:2px;flex:1;font-size:12.5px;color:var(--bt-ink-2)}
.oc-danger strong{font-size:14px;color:var(--bt-ink)}
.oc-danger-go{height:34px;padding:0 14px;border-radius:999px;border:1px solid color-mix(in srgb,var(--bt-danger) 40%,transparent);background:none;color:var(--bt-danger);font:inherit;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap}
.oc-danger-armed{background:var(--bt-danger);color:#fff;border-color:transparent}
.oc-danger button:disabled{opacity:.45;cursor:default}
.oc-types{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;align-items:stretch}
.oc-type{display:flex;flex-direction:column;align-items:stretch;gap:10px;min-height:184px;padding:18px;border-radius:18px;border:.5px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;transition:transform .14s ease,box-shadow .14s ease,border-color .14s ease}
.oc-type:hover:not(:disabled){transform:translateY(-2px);border-color:var(--bt-line);box-shadow:0 12px 28px -12px rgba(0,0,0,.18)}
.oc-type-top{display:flex;align-items:center;gap:12px}
.oc-type-top strong{flex:1;min-width:0;font-size:16px;font-weight:600}
.oc-type-time{flex:none;padding:2px 8px;border-radius:999px;border:1px solid var(--bt-line-2);color:var(--bt-ink-3);font-size:11.5px;white-space:nowrap}
.oc-type-blurb{flex:1;font-size:13.5px;line-height:20px;color:var(--bt-ink-2)}
.oc-type-how{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:12px;border-top:.5px solid var(--bt-line-2);font-size:12.5px;color:var(--bt-ink-3)}
.oc-type-how b{color:var(--bt-accent);font-weight:600}
.oc-head h1 .oc-tile{margin-right:10px;vertical-align:-6px}
.oc-guide{display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;margin-top:6px;align-items:start}
.oc-guide-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:13.5px;color:var(--bt-ink-3)}
.oc-guide-steps li{display:flex;align-items:center;gap:10px;padding:6px 0}
.oc-guide-steps span{width:24px;height:24px;border-radius:50%;display:inline-grid;place-items:center;flex:none;border:1px solid var(--bt-line-2);font-size:11.5px;font-weight:600}
.oc-guide-steps li[data-state=now]{color:var(--bt-ink);font-weight:500}
.oc-guide-steps li[data-state=now] span{border-color:var(--bt-accent);color:var(--bt-accent)}
.oc-guide-steps li[data-state=done] span{background:color-mix(in srgb,#16a34a 14%,transparent);border-color:transparent;color:#16a34a}
.oc-guide-pane{display:flex;flex-direction:column;align-items:flex-start;gap:14px;padding:22px;border-radius:18px;border:.5px solid var(--bt-line-2);background:var(--bt-card);animation:oc-page-in .22s cubic-bezier(.2,0,0,1)}
.oc-guide-pane h2{margin:0;font-size:19px;line-height:26px;font-weight:650}
.oc-guide-pane>p{margin:-6px 0 0;font-size:14px;line-height:21px;color:var(--bt-ink-2)}
.oc-guide-pane a:not(.oc-primary):not(.oc-secondary){color:var(--bt-accent)}
.oc-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.oc-fine{margin:0;font-size:12.5px;color:var(--bt-ink-3)}
.oc-numbered{list-style:none;counter-reset:oc-n;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;font-size:14px;color:var(--bt-ink-2)}
.oc-numbered li{counter-increment:oc-n;display:flex;align-items:baseline;gap:10px}
.oc-numbered li::before{content:counter(oc-n);flex:none;width:22px;height:22px;border-radius:7px;display:inline-grid;place-items:center;background:color-mix(in srgb,var(--bt-accent) 12%,transparent);color:var(--bt-accent);font-size:12px;font-weight:600}
.oc-numbered code{padding:1px 6px;border-radius:6px;background:var(--bt-hover);font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
.oc-suggest{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--bt-accent) 9%,transparent);font-size:13.5px;box-sizing:border-box}
.oc-suggest span{flex:1}
.oc-brand{display:inline-flex;align-items:center;justify-content:center;height:40px;padding:0 18px;border:0;border-radius:12px;color:#fff;font:inherit;font-size:14px;font-weight:600;cursor:pointer}
.oc-brand:disabled{opacity:.5;cursor:default}
.oc-qr-row{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
.oc-qr-side{display:flex;flex-direction:column;align-items:flex-start;gap:12px;flex:1;min-width:220px}
.oc-qr-side h2{margin:0}
.oc-guide-pane .oc-seg{width:100%}
.oc-steps{display:flex;gap:6px;list-style:none;margin:0;padding:0;font-size:13px;color:var(--bt-ink-3)}
.oc-steps li{display:flex;align-items:center;gap:8px}
.oc-steps li+li::before{content:"";width:28px;height:1px;background:var(--bt-line-2);margin-right:2px}
.oc-steps span{width:22px;height:22px;border-radius:50%;display:inline-grid;place-items:center;border:1px solid var(--bt-line-2);font-size:11px;font-weight:600}
.oc-steps li[data-state=now]{color:var(--bt-ink);font-weight:500}
.oc-steps li[data-state=now] span{background:var(--bt-accent);border-color:transparent;color:var(--bt-accent-ink,#fff)}
.oc-steps li[data-state=done] span{background:color-mix(in srgb,var(--bt-accent) 15%,transparent);border-color:transparent;color:var(--bt-accent)}
.oc-flow{display:flex;flex-direction:column;align-items:flex-start;gap:14px;max-width:520px;margin-top:10px;animation:oc-page-in .22s cubic-bezier(.2,0,0,1)}
.oc-flow p{margin:0;font-size:14px;line-height:21px;color:var(--bt-ink-2)}
.oc-field{display:flex;flex-direction:column;gap:6px;width:100%}
.oc-field span{font-size:12.5px;font-weight:500;color:var(--bt-ink-2)}
.oc-field input{height:42px;padding:0 14px;border-radius:12px;border:1px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:14px;outline:none;transition:border-color .12s ease,box-shadow .12s ease}
.oc-field input:focus{border-color:var(--bt-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--bt-accent) 16%,transparent)}
.oc-howto{margin:0;padding-left:20px;font-size:14px;line-height:24px;color:var(--bt-ink-2)}
.oc-qr{display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 20px 14px;border-radius:20px;background:#fff;color:#0c2630;border:.5px solid var(--bt-line-2);box-shadow:0 10px 30px -14px rgba(0,0,0,.25)}
.oc-live-chip{gap:6px;border-style:solid;border-color:color-mix(in srgb,#16a34a 35%,transparent);color:color-mix(in srgb,#16a34a 70%,var(--bt-ink))}
.oc-live-chip[data-error]{border-color:color-mix(in srgb,#f59e0b 45%,transparent);color:color-mix(in srgb,#d97706 80%,var(--bt-ink))}
.oc-live-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:oc-pulse 2s ease-in-out infinite}
.oc-compose-info{cursor:default;background:var(--bt-hover);color:var(--bt-ink-2)}
.oc-seg-static{cursor:default}
.oc-day{display:inline-flex;align-items:center;gap:8px}
.oc-qr-wait{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--bt-ink-2)}
.oc-qr .oc-qr-wait{color:#475569}
.oc-qr-code{position:relative;display:inline-flex}
.oc-qr-logo{position:absolute;inset:0;display:grid;place-items:center}
.oc-qr-logo .oc-tile{box-shadow:0 0 0 5px #fff}
.oc-alt{display:flex;gap:18px;flex-wrap:wrap}
.oc-code{display:flex;gap:6px}
.oc-code span{display:inline-grid;place-items:center;width:40px;height:52px;border-radius:12px;background:var(--bt-card);border:1px solid var(--bt-line-2);font-size:24px;font-weight:650;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.oc-code span[data-dash]{width:14px;border:0;background:none;color:var(--bt-ink-3)}
.oc-fix{display:flex;align-items:flex-end;gap:10px}
.oc-fix .oc-field{flex:1}
.oc-problem{margin:4px 0 0;padding:10px 12px;border-radius:12px;font-size:13px;color:color-mix(in srgb,#d97706 85%,var(--bt-ink));background:color-mix(in srgb,#f59e0b 12%,transparent)}
.oc-compose-fail{color:color-mix(in srgb,#d97706 85%,var(--bt-ink));background:color-mix(in srgb,#f59e0b 12%,transparent)}
.oc-bubble[data-sending]{opacity:.6}
.oc-type:disabled{opacity:.5;cursor:not-allowed}
.oc-qr-empty{display:grid;place-items:center;width:196px;height:196px}
@media (max-width:720px){.oc-guide{grid-template-columns:1fr;gap:12px}.oc-guide-steps{flex-direction:row;flex-wrap:wrap;gap:4px 14px}.oc-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.oc-seg{grid-template-columns:1fr}.oc-channels-in{padding:20px 16px 40px}.oc-head{flex-direction:column}}
@media (prefers-reduced-motion:reduce){.oc-page,.oc-msg,.oc-flow,.oc-guide-pane,.oc-chart-bar{animation:none}.oc-card,.oc-type,.oc-filter{transition:none}}
`
