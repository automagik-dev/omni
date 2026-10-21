import { createElement as h, Fragment, useEffect, useState } from 'react'
import { t } from './i18n.js'
import { relativeShort } from './text.js'
import { Tile } from './channels.js'
import { DataView } from './omni-live.js'

// What Omni saw, drawn as what it is: a read shows its messages as bubbles, its chats with
// their unread counts, its channels as tiles, its events on a line, anything else as a
// small table. Rows come in one after another and counts tick up; with reduced motion they
// simply appear. (A task Omni handed on has its own card, task-card.js.)

const PREVIEW = 4

// --- shared bits -------------------------------------------------------------------------

const HUES = [168, 200, 222, 262, 290, 330, 18, 38, 140]
const hueOf = (name) => {
  let sum = 0
  for (const char of String(name ?? '')) sum = (sum * 31 + char.charCodeAt(0)) >>> 0
  return HUES[sum % HUES.length]
}
const initialsOf = name => String(name ?? '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map(word => word[0] ?? '').join('').toUpperCase() || '?'

// Initials on a color of their own, under the real picture when there is one.
function Avatar({ name, url, size = 28 }) {
  return h('span', { className: 'op-ava', style: { width: size, height: size, '--op-hue': hueOf(name), fontSize: Math.round(size * 0.38) } },
    initialsOf(name),
    url ? h('img', { src: url, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onError: (event) => { event.currentTarget.remove() } }) : null)
}

const still = () => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.body?.dataset.btMotion === 'quiet')

// A number that counts up to `to` when it first shows.
function useCountUp(to) {
  const [shown, setShown] = useState(still() ? to : 0)
  useEffect(() => {
    if (still() || !Number.isFinite(to)) { setShown(to); return undefined }
    const start = performance.now()
    let frame
    const step = (now) => {
      const progress = Math.min(1, (now - start) / 600)
      setShown(Math.round(to * (1 - (1 - progress) ** 3)))
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [to])
  return shown
}

const when = at => (Date.parse(at) || Number(at) ? relativeShort(Date.parse(at) || Number(at)) : '')
// An argument as a person reads it: dates as dates.
const chipText = (value) => {
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(text) && Number.isFinite(Date.parse(text))) {
    return new Date(text).toLocaleDateString([], { month: 'short', day: 'numeric', ...(/T\d{2}:\d{2}/.test(text) && !/T00:00(:00)?/.test(text) ? { hour: 'numeric', minute: '2-digit' } : {}) })
  }
  return text.slice(0, 40)
}

const ICONS = {
  messages: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v5A2.5 2.5 0 0 1 13.5 13H9l-3.5 3v-3A2.5 2.5 0 0 1 3 10.5',
  chats: 'M3 5.5A2.5 2.5 0 0 1 5.5 3h6A2.5 2.5 0 0 1 14 5.5v3A2.5 2.5 0 0 1 11.5 11H8l-3 2.5V11A2.5 2.5 0 0 1 3 8.5zM14 7h.5A2.5 2.5 0 0 1 17 9.5v3a2.5 2.5 0 0 1-2 2.45V17l-2.5-2H10',
  channels: 'M10 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM6.5 13.5a5 5 0 0 1 0-7M13.5 6.5a5 5 0 0 1 0 7M4 16a8.5 8.5 0 0 1 0-12M16 4a8.5 8.5 0 0 1 0 12',
  events: 'M2.5 10h3l2-5 3 10 2-5h5',
  automations: 'M11 2.5 4.5 11H10l-1 6.5L15.5 9H10z',
  people: 'M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 17c.6-3 3-4.5 6-4.5s5.4 1.5 6 4.5',
  records: 'M4 5c0-1.1 2.7-2 6-2s6 .9 6 2-2.7 2-6 2-6-.9-6-2zM4 5v10c0 1.1 2.7 2 6 2s6-.9 6-2V5M4 10c0 1.1 2.7 2 6 2s6-.9 6-2',
  write: 'M13.5 3.5l3 3L7 16H4v-3z',
  remove: 'M5 6h10M8 6V4h4v2M6.5 6l.7 10h5.6l.7-10',
}
const Icon = ({ kind }) => h('svg', { width: 16, height: 16, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: ICONS[kind] ?? ICONS.records }))

// --- what a read returned ----------------------------------------------------------------

export const listOf = data => (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null)

// Which kind of things a list holds, from the fields its first items carry.
export function kindOf(items) {
  const item = items.find(entry => entry && typeof entry === 'object') ?? {}
  if ('textContent' in item || 'messageType' in item || ('text' in item && ('from' in item || 'at' in item))) return 'messages'
  if ('chatType' in item || 'lastMessagePreview' in item || ('unread' in item && 'name' in item)) return 'chats'
  if ('eventType' in item) return 'events'
  if ('channel' in item && ('isActive' in item || 'state' in item || 'profileName' in item)) return 'channels'
  if ('trigger' in item || 'triggerType' in item || ('actions' in item && 'name' in item)) return 'automations'
  if ('displayName' in item || 'primaryPhone' in item) return 'people'
  return 'records'
}

const Row = ({ index, children, className = '' }) => h('div', { className: `op-row ${className}`, style: { '--i': index } }, children)

function MessageRows({ items }) {
  return items.map((item, index) => {
    const mine = item.isFromMe === true || item.from === 'you'
    const name = mine ? t('You') : item.senderDisplayName ?? item.from ?? item.senderName ?? t('Someone')
    const text = item.textContent ?? item.text ?? item.transcription ?? (item.hasMedia ? `[${item.messageType ?? 'media'}]` : '')
    return h(Row, { key: item.id ?? index, index, className: mine ? 'op-msg op-msg-mine' : 'op-msg' },
      mine ? null : h(Avatar, { name, size: 26 }),
      h('div', { className: 'op-bubble' },
        mine ? null : h('span', { className: 'op-bubble-who' }, name),
        h('span', { className: 'op-bubble-text' }, String(text || '…').slice(0, 220)),
        h('span', { className: 'op-bubble-at' }, when(item.platformTimestamp ?? item.at ?? item.createdAt))))
  })
}

// A chat's kind, when it is not a plain one-to-one chat.
const kindTag = (item) => {
  const type = item.isGroup ? 'group' : item.type ?? item.chatType
  if (String(item.externalId ?? item.name ?? '').startsWith('status@')) return 'status'
  return type && type !== 'dm' ? type : null
}

function ChatRows({ items }) {
  return items.map((item, index) => {
    const unread = item.unread ?? item.unreadCount ?? 0
    return h(Row, { key: item.id ?? index, index, className: 'op-chat' },
      h(Avatar, { name: item.name, url: item.avatarUrl, size: 30 }),
      h('div', { className: 'op-chat-body' },
        h('span', { className: 'op-chat-name' }, h('span', { className: 'op-chat-name-text' }, item.name ?? t('Chat')), kindTag(item) ? h('span', { className: 'op-tag' }, t(kindTag(item))) : null),
        h('span', { className: 'op-chat-preview' }, String(item.preview ?? item.lastMessagePreview ?? '').slice(0, 120))),
      h('div', { className: 'op-chat-side' },
        h('span', { className: 'op-chat-at' }, when(item.lastMessageAt)),
        unread > 0 ? h('span', { className: 'op-unread' }, unread > 99 ? '99+' : unread) : null))
  })
}

function ChannelTiles({ items }) {
  return h('div', { className: 'op-tiles' }, items.map((item, index) => {
    const state = item.state ?? (item.isActive === false ? 'paused' : 'unknown')
    return h('div', { key: item.id ?? index, className: 'op-tile', style: { '--i': index }, 'data-state': state },
      h(Tile, { type: item.channel, size: 30 }),
      h('span', { className: 'op-tile-name' }, item.name),
      h('span', { className: 'op-tile-state' }, h('i', { 'aria-hidden': true }), item.profile ?? item.profileName ?? state))
  }))
}

function EventLine({ items }) {
  return h('div', { className: 'op-events' }, items.map((item, index) => h(Row, { key: item.id ?? index, index, className: 'op-event' },
    h('span', { className: 'op-event-dot', 'aria-hidden': true }),
    h('span', { className: 'op-event-type' }, item.eventType),
    h('span', { className: 'op-event-text' }, String(item.textContent ?? item.chatName ?? item.source ?? '').slice(0, 100)),
    h('span', { className: 'op-event-at' }, when(item.receivedAt ?? item.createdAt ?? item.timestamp)))))
}

function NamedRows({ items, kind }) {
  return items.map((item, index) => h(Row, { key: item.id ?? index, index, className: 'op-named' },
    kind === 'people' ? h(Avatar, { name: item.displayName ?? item.name, size: 26 }) : h('span', { className: 'op-named-icon' }, h(Icon, { kind })),
    h('span', { className: 'op-named-name' }, String(item.displayName ?? item.name ?? item.title ?? item.id ?? '—').slice(0, 80)),
    h('span', { className: 'op-named-meta' }, String(item.status ?? item.state ?? item.type ?? item.triggerType ?? item.channel ?? '').slice(0, 40))))
}

function RecordFields({ record }) {
  const pairs = Object.entries(record).filter(([, value]) => value !== null && value !== undefined && value !== '' && typeof value !== 'object').slice(0, 8)
  return h('dl', { className: 'op-fields' }, pairs.map(([key, value], index) => h(Fragment, { key },
    h('dt', { style: { '--i': index } }, key), h('dd', { style: { '--i': index } }, String(value).slice(0, 120)))))
}

// The preview of what came back; "Show all" opens every row as a table.
export function Seen({ data, kind: forced }) {
  const [all, setAll] = useState(false)
  const list = listOf(data)
  if (list === null) {
    const record = data?.data ?? data
    return record && typeof record === 'object' ? h(RecordFields, { record }) : null
  }
  if (list.length === 0) return h('p', { className: 'op-empty' }, t('Nothing came back.'))
  const kind = forced ?? kindOf(list)
  const shown = list.slice(0, PREVIEW)
  const rest = list.length - shown.length
  const view = kind === 'messages' ? h(MessageRows, { items: shown })
    : kind === 'chats' ? h(ChatRows, { items: shown })
      : kind === 'channels' ? h(ChannelTiles, { items: shown })
        : kind === 'events' ? h(EventLine, { items: shown })
          : h(NamedRows, { items: shown, kind })
  return h(Fragment, null,
    h('div', { className: 'op-seen', 'data-kind': kind }, view),
    rest > 0 || kind === 'records' ? h('div', { className: 'op-more' },
      h('button', { type: 'button', className: 'op-more-btn', onClick: () => setAll(value => !value) }, all ? t('Hide') : t('Show all {count}', { count: list.length }))) : null,
    all ? h('div', { className: 'op-all' }, h(DataView, { value: data })) : null)
}

// --- the card around a call --------------------------------------------------------------

// One call: an icon that pulses while it works, what it does, how many things came back,
// the arguments it was given, and what it saw.
export function PeekCard({ kind = 'records', verb, title, count, unit, chips = [], state, failure, children, accent = false }) {
  const shownCount = useCountUp(Number.isFinite(count) ? count : 0)
  return h('section', { className: 'op-card', 'data-state': state, 'data-accent': accent || undefined },
    h('header', { className: 'op-head' },
      h('span', { className: 'op-icon', 'data-kind': kind }, h(Icon, { kind })),
      h('span', { className: 'op-verb' }, verb),
      h('span', { className: 'op-title' }, title),
      state === 'working' ? h('span', { className: 'op-working' }, t('looking…'))
        : state === 'failed' ? h('span', { className: 'op-failed' }, t('failed'))
          : Number.isFinite(count) ? h('span', { className: 'op-count' }, h('b', null, shownCount), ' ', unit ?? (count === 1 ? t('item') : t('items'))) : null),
    chips.length > 0 ? h('div', { className: 'op-chips' }, chips.map(([key, value]) => h('span', { key, className: 'op-chip' }, h('span', null, key), chipText(value)))) : null,
    state === 'working' ? h('div', { className: 'op-skeleton', 'aria-hidden': true }, [0, 1, 2].map(index => h('span', { key: index, style: { '--i': index } })))
      : state === 'failed' ? h('p', { className: 'op-problem', role: 'alert' }, failure)
        : children ? h('div', { className: 'op-body' }, children) : null)
}

export const OMNI_PEEK_CSS = `
@property --op-angle{syntax:'<angle>';inherits:false;initial-value:0deg}
.op-card{position:relative;display:flex;flex-direction:column;gap:10px;max-width:640px;padding:12px 14px 14px;border-radius:18px;background:linear-gradient(180deg,color-mix(in srgb,var(--bt-card) 92%,var(--bt-accent) 8%),var(--bt-card));border:1px solid color-mix(in srgb,var(--bt-line) 70%,var(--bt-accent) 30%);box-shadow:0 1px 0 rgba(255,255,255,.4) inset,0 8px 24px -16px color-mix(in srgb,var(--bt-accent) 60%,transparent);animation:op-card-in .42s cubic-bezier(.2,.8,.2,1)}
.op-card[data-state=working]{border-color:transparent;background:linear-gradient(var(--bt-card),var(--bt-card)) padding-box,conic-gradient(from var(--op-angle),transparent 0 60%,var(--bt-accent) 75%,#a78bfa 85%,transparent 95%) border-box;animation:op-card-in .42s cubic-bezier(.2,.8,.2,1),op-spin 1.6s linear infinite}
.op-card[data-state=failed]{border-color:color-mix(in srgb,#e5484d 40%,var(--bt-line))}
@keyframes op-spin{to{--op-angle:360deg}}
@keyframes op-card-in{from{opacity:0;transform:translateY(8px) scale(.985);filter:blur(3px)}}
.op-head{display:flex;align-items:center;gap:8px;min-width:0;font-size:13.5px}
.op-icon{position:relative;flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:9px;color:var(--bt-accent);background:color-mix(in srgb,var(--bt-accent) 13%,transparent)}
.op-card[data-state=working] .op-icon::after{content:"";position:absolute;inset:-3px;border-radius:12px;border:1.5px solid var(--bt-accent);opacity:0;animation:op-ping 1.4s cubic-bezier(0,0,.2,1) infinite}
@keyframes op-ping{0%{opacity:.7;transform:scale(.85)}100%{opacity:0;transform:scale(1.35)}}
.op-verb{flex:none;font-weight:600;color:var(--bt-ink)}
.op-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bt-ink-2)}
.op-count{flex:none;margin-left:auto;font-size:12px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums}
.op-count b{font-size:14px;font-weight:650;color:var(--bt-ink)}
.op-working{flex:none;margin-left:auto;font-size:12px;color:var(--bt-accent);animation:op-breathe 1.2s ease-in-out infinite}
.op-failed{flex:none;margin-left:auto;font-size:12px;color:#d13438;font-weight:600}
@keyframes op-breathe{50%{opacity:.45}}
.op-chips{display:flex;flex-wrap:wrap;gap:6px}
.op-chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;background:var(--bt-hover);font-size:11.5px;color:var(--bt-ink-2)}
.op-chip>span{color:var(--bt-ink-3)}
.op-skeleton{display:flex;flex-direction:column;gap:8px}
.op-skeleton span{height:30px;border-radius:10px;background:linear-gradient(90deg,var(--bt-hover) 0%,color-mix(in srgb,var(--bt-accent) 14%,var(--bt-hover)) 45%,var(--bt-hover) 90%);background-size:220% 100%;animation:op-shimmer 1.3s ease-in-out infinite;animation-delay:calc(var(--i) * 120ms);opacity:calc(1 - var(--i) * .25)}
@keyframes op-shimmer{from{background-position:120% 0}to{background-position:-120% 0}}
.op-problem{margin:0;padding:8px 10px;border-radius:10px;background:color-mix(in srgb,#e5484d 10%,transparent);color:#d13438;font-size:13px}
.op-body{display:flex;flex-direction:column;gap:8px;min-width:0}
.op-row,.op-tile,.op-fields dt,.op-fields dd{animation:op-row-in .45s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i, 0) * 70ms + 80ms)}
@keyframes op-row-in{from{opacity:0;transform:translateY(6px);filter:blur(2px)}}
.op-seen{display:flex;flex-direction:column;gap:6px;min-width:0}
.op-ava{position:relative;overflow:hidden;flex:none;display:grid;place-items:center;border-radius:50%;font-weight:600;color:hsl(var(--op-hue) 55% 32%);background:hsl(var(--op-hue) 70% 88%)}
.op-ava img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
body[data-ds-dark-theme] .op-ava{color:hsl(var(--op-hue) 70% 82%);background:hsl(var(--op-hue) 35% 28%)}
.op-msg{display:flex;align-items:flex-end;gap:8px;min-width:0}
.op-msg-mine{justify-content:flex-end}
.op-bubble{display:flex;flex-direction:column;gap:1px;max-width:78%;padding:6px 10px 5px;border-radius:14px 14px 14px 4px;background:var(--bt-hover);font-size:13px;line-height:18px}
.op-msg-mine .op-bubble{border-radius:14px 14px 4px 14px;background:color-mix(in srgb,var(--bt-accent) 16%,var(--bt-card))}
.op-bubble-who{font-size:11.5px;font-weight:600;color:var(--bt-ink-2)}
.op-bubble-text{overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.op-bubble-at{align-self:flex-end;font-size:10.5px;color:var(--bt-ink-3)}
.op-chat{display:flex;align-items:center;gap:10px;min-width:0;padding:6px 8px;border-radius:12px;transition:background-color .12s}
.op-chat:hover{background:var(--bt-hover)}
.op-chat-body{display:flex;flex-direction:column;flex:1;min-width:0}
.op-chat-name{display:flex;align-items:center;gap:6px;min-width:0;font-size:13.5px;font-weight:600;white-space:nowrap}
.op-chat-name-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
.op-chat-name .op-tag{flex:none}
.op-chat-preview{font-size:12.5px;color:var(--bt-ink-3);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.op-chat-side{display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex:none}
.op-chat-at{font-size:11px;color:var(--bt-ink-3)}
.op-unread{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--bt-accent);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center;animation:op-pop .5s cubic-bezier(.3,1.6,.5,1) both;animation-delay:calc(var(--i,0) * 70ms + 300ms)}
@keyframes op-pop{from{transform:scale(0)}}
.op-tag{font-size:10.5px;font-weight:500;padding:1px 6px;border-radius:6px;background:var(--bt-tag-bg);color:var(--bt-tag-ink)}
.op-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.op-tile{display:flex;flex-direction:column;gap:6px;padding:10px;border-radius:14px;background:var(--bt-hover)}
.op-tile-name{font-size:13px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.op-tile-state{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--bt-ink-3);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.op-tile-state i{flex:none;width:7px;height:7px;border-radius:50%;background:var(--bt-ink-3)}
.op-tile[data-state=connected] .op-tile-state i{background:#00c972;box-shadow:0 0 0 0 rgba(0,201,114,.5);animation:op-live 2s infinite}
@keyframes op-live{70%{box-shadow:0 0 0 6px rgba(0,201,114,0)}100%{box-shadow:0 0 0 0 rgba(0,201,114,0)}}
.op-events{position:relative;display:flex;flex-direction:column;gap:6px;padding-left:14px}
.op-events::before{content:"";position:absolute;left:4px;top:6px;bottom:6px;width:2px;border-radius:1px;background:linear-gradient(var(--bt-accent),transparent)}
.op-event{position:relative;display:flex;align-items:baseline;gap:8px;font-size:12.5px;min-width:0}
.op-event-dot{position:absolute;left:-14px;top:5px;width:10px;height:10px;border-radius:50%;background:var(--bt-card);border:2px solid var(--bt-accent)}
.op-event-type{flex:none;font-weight:600}
.op-event-text{flex:1;min-width:0;color:var(--bt-ink-2);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.op-event-at{flex:none;font-size:11px;color:var(--bt-ink-3)}
.op-named{display:flex;align-items:center;gap:10px;font-size:13px;min-width:0}
.op-named-icon{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:var(--bt-hover);color:var(--bt-ink-2)}
.op-named-name{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:500}
.op-named-meta{flex:none;font-size:11.5px;color:var(--bt-ink-3)}
.op-fields{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 14px;margin:0;font-size:12.5px}
.op-fields dt{color:var(--bt-ink-3)}
.op-fields dd{margin:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.op-empty{margin:0;font-size:12.5px;color:var(--bt-ink-3)}
.op-more{display:flex}
.op-more-btn{padding:0;border:0;background:none;color:var(--bt-accent);font:inherit;font-size:12.5px;font-weight:500;cursor:pointer}
.op-all{animation:op-row-in .3s ease both}
@media (prefers-reduced-motion:reduce){.op-card,.op-row,.op-tile,.op-fields dt,.op-fields dd,.op-unread,.op-skeleton span,.op-icon::after{animation:none!important}}
body[data-bt-motion=quiet] :is(.op-card,.op-row,.op-tile,.op-fields dt,.op-fields dd,.op-unread,.op-skeleton span,.op-icon::after){animation:none!important}
`
