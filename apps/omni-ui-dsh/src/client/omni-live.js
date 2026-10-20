import { createElement as h, Fragment, useEffect, useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { call } from './api.js'
import { t } from './i18n.js'
import { relativeShort } from './text.js'
import { Tile } from './channels.js'
import { typeOf } from './omni-store.js'

// What Omni does on the platform, drawn live: the cards for its omni_call tool calls, and the
// Channel, QrCode and Chat components its canvases use. Everything here reads through the
// host's `omni-get` (documented GET operations, with the host's key); nothing here writes.

// One GET, again every `every` ms while mounted (slower while the tab is hidden).
export function useOmniGet(path, every = 0) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  useEffect(() => {
    if (!path) return undefined
    let live = true
    let timer
    const load = async () => {
      try {
        const reply = await call('omni-get', { path })
        if (live) setState({ loading: false, data: reply.data, error: reply.ok ? null : errorText(reply.data, reply.status) })
      } catch (error) {
        if (live) setState(previous => ({ ...previous, loading: false, error: error.message }))
      }
      if (live && every > 0) timer = setTimeout(load, document.hidden ? every * 4 : every)
    }
    void load()
    return () => { live = false; clearTimeout(timer) }
  }, [path, every])
  return state
}

export const errorText = (data, status) => data?.error?.message ?? (typeof data === 'string' && data ? data.slice(0, 200) : `omni answered ${status}`)

// omni's connection states, folded into the ones the cards show.
export function stateOf(instance, status) {
  if (instance?.isActive === false) return 'paused'
  const state = status?.state
  if (status?.isConnected || state === 'connected') return 'connected'
  if (state === 'connecting' || state === 'qr' || state === 'reconnecting') return 'connecting'
  return 'attention'
}
const STATE = {
  connected: { tone: 'ok', label: 'Connected' },
  connecting: { tone: 'warn', label: 'Connecting' },
  paused: { tone: 'muted', label: 'Paused' },
  attention: { tone: 'bad', label: 'Not connected' },
}
const phoneOf = owner => (typeof owner === 'string' ? owner.replace(/[:@].*$/, '').replace(/^(\d{6,})$/, '+$1') : '')

export const Badge = ({ text, tone = 'muted' }) => h('span', { className: 'ou-badge', 'data-tone': tone }, text)
const Problem = ({ text }) => h('p', { className: 'ou-problem', role: 'alert' }, text)

export function LiveChannel({ id }) {
  const instance = useOmniGet(id ? `/instances/${encodeURIComponent(id)}` : null, 30_000)
  const status = useOmniGet(id ? `/instances/${encodeURIComponent(id)}/status` : null, 8_000)
  const record = instance.data?.data
  const live = status.data?.data
  if (instance.error) return h(Problem, { text: instance.error })
  if (!record) return h('div', { className: 'ou-card ou-loading' }, t('Loading channel…'))
  const state = stateOf(record, live)
  return h('div', { className: 'ou-card ou-channel' },
    h(Tile, { type: record.channel, size: 38 }),
    h('div', { className: 'ou-channel-body' },
      h('strong', null, record.name),
      h('span', { className: 'ou-muted' }, [typeOf(record.channel).label ?? record.channel, live?.profileName ?? record.profileName, phoneOf(live?.ownerIdentifier ?? record.ownerIdentifier)].filter(Boolean).join(' · '))),
    h(Badge, { text: t(STATE[state].label), tone: STATE[state].tone }))
}

// A QR code as SVG, one path of dark modules: crisp at any size, no image to load.
export function QrSvg({ text, size = 208 }) {
  const path = useMemo(() => {
    const code = qrcode(0, 'L')
    code.addData(text)
    code.make()
    const count = code.getModuleCount()
    let d = ''
    for (let row = 0; row < count; row += 1) for (let col = 0; col < count; col += 1) if (code.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`
    return { d, count }
  }, [text])
  return h('svg', { className: 'ou-qr-svg', width: size, height: size, viewBox: `-2 -2 ${path.count + 4} ${path.count + 4}`, role: 'img', 'aria-label': t('QR code'), shapeRendering: 'crispEdges' },
    h('rect', { x: -2, y: -2, width: path.count + 4, height: path.count + 4, fill: '#fff' }),
    h('path', { d: path.d, fill: '#000' }))
}

// WhatsApp rotates the code every ~20 seconds; the card follows it, then says Connected.
export function LiveQr({ channelId }) {
  const base = channelId ? `/instances/${encodeURIComponent(channelId)}` : null
  const status = useOmniGet(base && `${base}/status`, 2_500)
  const connected = status.data?.data?.isConnected === true || status.data?.data?.state === 'connected'
  const qr = useOmniGet(base && !connected ? `${base}/qr` : null, 2_500)
  const code = qr.data?.data?.qr
  if (connected) {
    const live = status.data.data
    return h('div', { className: 'ou-card ou-qr ou-qr-done' },
      h('span', { className: 'ou-qr-check', 'aria-hidden': true }, '✓'),
      h('strong', null, t('Connected')),
      h('span', { className: 'ou-muted' }, [live.profileName, phoneOf(live.ownerIdentifier)].filter(Boolean).join(' · ')))
  }
  return h('div', { className: 'ou-card ou-qr' },
    code ? h(QrSvg, { text: code }) : h('div', { className: 'ou-qr-wait' }, qr.error ? h(Problem, { text: qr.error }) : t('Waiting for a code…')),
    h('div', { className: 'ou-qr-help' },
      h('strong', null, t('Scan with WhatsApp')),
      h('span', { className: 'ou-muted' }, t('On the phone: Settings → Linked devices → Link a device.')),
      h('span', { className: 'ou-live' }, h('span', { className: 'ou-live-dot', 'aria-hidden': true }), qr.data?.data?.message || t('Live · refreshes by itself'))))
}

export function LiveChat({ id, limit = 8 }) {
  const chat = useOmniGet(id ? `/chats/${encodeURIComponent(id)}` : null, 60_000)
  const messages = useOmniGet(id ? `/chats/${encodeURIComponent(id)}/messages?limit=${Math.min(30, Math.max(1, limit))}` : null, 10_000)
  const record = chat.data?.data
  if (chat.error) return h(Problem, { text: chat.error })
  const items = [...(messages.data?.items ?? [])].sort((a, b) => (Date.parse(a.platformTimestamp ?? a.createdAt) || 0) - (Date.parse(b.platformTimestamp ?? b.createdAt) || 0))
  return h('div', { className: 'ou-card ou-chat' },
    h('div', { className: 'ou-chat-head' },
      h(Tile, { type: record?.channel, size: 26 }),
      h('strong', null, record?.name ?? t('Chat')),
      record?.isGroup ? h(Badge, { text: t('Group') }) : null),
    items.length === 0
      ? h('span', { className: 'ou-muted' }, messages.loading ? t('Loading messages…') : t('no messages yet'))
      : h('div', { className: 'ou-chat-lines' }, items.map(message => h('div', { key: message.id, className: 'ou-chat-line', 'data-me': message.isFromMe ? '' : undefined },
        message.isFromMe ? null : h('span', { className: 'ou-chat-who' }, message.senderDisplayName ?? ''),
        h('span', { className: 'ou-chat-text' }, message.textContent || message.transcription || (message.hasMedia ? `[${message.messageType ?? 'media'}]` : '')),
        h('span', { className: 'ou-chat-at' }, relativeShort(Date.parse(message.platformTimestamp ?? message.createdAt) || Date.now()))))))
}

// Any JSON answer as something to read: a list as a table of its plain fields, a record as
// label/value pairs. Nested values stay one short line each.
const PLAIN = value => value === null || ['string', 'number', 'boolean'].includes(typeof value)
const cell = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? t('yes') : t('no')
  if (PLAIN(value)) return String(value).slice(0, 160)
  return Array.isArray(value) ? t('{count} items', { count: value.length }) : '{…}'
}
const COLUMNS_MAX = 6
const ROWS_MAX = 50
// Columns people read first, when a record has them.
const FIRST = ['name', 'title', 'displayName', 'channel', 'status', 'state', 'type', 'eventType', 'textContent', 'isActive', 'createdAt', 'id']

export function DataView({ value }) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : null
  if (list) {
    if (list.length === 0) return h('span', { className: 'ou-muted' }, t('Nothing here.'))
    if (!list.every(item => item && typeof item === 'object' && !Array.isArray(item))) return h('span', null, list.slice(0, ROWS_MAX).map(cell).join(', '))
    const keys = new Set(list.slice(0, 20).flatMap(item => Object.keys(item).filter(key => PLAIN(item[key]))))
    const columns = [...FIRST.filter(key => keys.has(key)), ...[...keys].filter(key => !FIRST.includes(key))].slice(0, COLUMNS_MAX)
    return h(Fragment, null,
      h(Table, { columns, rows: list.slice(0, ROWS_MAX).map(item => columns.map(key => item[key])) }),
      list.length > ROWS_MAX || value?.meta?.hasMore ? h('span', { className: 'ou-muted' }, t('First {count} shown.', { count: Math.min(list.length, ROWS_MAX) })) : null)
  }
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value.data ?? value : null
  if (record && typeof record === 'object') {
    const pairs = Object.entries(record).filter(([, item]) => item !== null && item !== undefined && item !== '').slice(0, 24)
    return h(KeyValue, { pairs: pairs.map(([label, item]) => ({ label, value: item })) })
  }
  return h('span', null, cell(value))
}

export function Table({ columns, rows }) {
  return h('div', { className: 'ou-table-wrap' },
    h('table', { className: 'ou-table' },
      h('thead', null, h('tr', null, columns.map((column, index) => h('th', { key: index }, column)))),
      h('tbody', null, rows.map((row, index) => h('tr', { key: index }, columns.map((_, col) => h('td', { key: col }, cell(row[col]))))))))
}

export function KeyValue({ pairs }) {
  return h('dl', { className: 'ou-kv' }, pairs.map(({ label, value }, index) => h(Fragment, { key: index }, h('dt', null, label), h('dd', null, cell(value)))))
}

// --- omni_call cards ---------------------------------------------------------------------

const VERB = { GET: 'Read', POST: 'Ran', PUT: 'Set', PATCH: 'Changed', DELETE: 'Deleted' }
const INSTANCE = /^\/instances\/([0-9a-f-]{36})(?:\/(connect|pair|qr|restart|status|disconnect|logout))?$/i

export function parseCall(argText, content) {
  let result = null
  try { result = JSON.parse(content) } catch { result = content ? { status: 0, error: String(content).slice(0, 300) } : null }
  return { method: String(argText('method') ?? 'GET').toUpperCase(), path: String(argText('path') ?? ''), result }
}

// One omni_call as the user sees it. Reads are a line that opens to the data; changes are a
// card with what changed, and a channel being connected shows its live QR code.
export function OmniCallCard({ method, path, result, done }) {
  const [open, setOpen] = useState(false)
  const failed = done && (!result || result.error || !(result.status >= 200 && result.status < 300))
  const title = result?.operation || `${method} ${path}`
  const instance = INSTANCE.exec(path)?.[1]
  const action = INSTANCE.exec(path)?.[2]
  const head = h('button', { type: 'button', className: 'ou-call-head', 'aria-expanded': open, onClick: () => setOpen(value => !value) },
    h('span', { className: 'ou-call-verb', 'data-method': method }, t(VERB[method] ?? method)),
    h('span', { className: 'ou-call-title' }, title),
    !done ? h('span', { className: 'ou-muted' }, t('working…')) : failed ? h(Badge, { text: result?.status ? String(result.status) : t('failed'), tone: 'bad' }) : null,
    h('span', { className: 'ou-call-path' }, `${method} ${path}`))
  if (failed) return h('div', { className: 'ou-call', 'data-failed': '' }, head, h(Problem, { text: result?.error ?? errorText(result?.data, result?.status) }))
  if (method === 'GET' && action !== 'qr') {
    return h('div', { className: 'ou-call ou-call-read' }, head, open && done ? h('div', { className: 'ou-call-body' }, h(DataView, { value: result?.data })) : null)
  }
  const body = !done ? null
    : instance && (action === 'connect' || action === 'pair' || action === 'qr' || action === 'restart') ? h(LiveQr, { channelId: instance })
      : instance && (action === undefined || action === 'disconnect' || action === 'logout' || action === 'status') ? h(LiveChannel, { id: instance })
        : method === 'POST' && path === '/instances' && result?.data?.data?.id ? h(LiveChannel, { id: result.data.data.id })
          : h(DataView, { value: result?.data })
  return h('div', { className: 'ou-call ou-call-write', 'data-method': method }, head, body ? h('div', { className: 'ou-call-body' }, body) : null)
}

export const OMNI_LIVE_CSS = `
.ou-card{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--bt-line);border-radius:14px;background:var(--bt-card);color:var(--bt-ink);min-width:0}
.ou-loading{color:var(--bt-ink-3);font-size:13px}
.ou-muted{color:var(--bt-ink-3);font-size:12.5px}
.ou-problem{margin:0;padding:8px 12px;border-radius:10px;background:color-mix(in srgb,#e5484d 10%,transparent);color:#e5484d;font-size:13px}
.ou-badge{flex:none;display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:12px;font-weight:500;background:var(--bt-tag-bg);color:var(--bt-tag-ink)}
.ou-badge[data-tone=ok]{background:color-mix(in srgb,#00c972 16%,transparent);color:#00a35c}
.ou-badge[data-tone=warn]{background:color-mix(in srgb,#ff9800 18%,transparent);color:#c76f00}
.ou-badge[data-tone=bad]{background:color-mix(in srgb,#e5484d 14%,transparent);color:#d13438}
.ou-badge[data-tone=info]{background:color-mix(in srgb,var(--bt-accent) 15%,transparent);color:var(--bt-accent)}
.ou-channel-body{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.ou-channel-body strong{font-size:14px;font-weight:600}
.ou-channel-body .ou-muted{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-qr{align-items:center;gap:18px;flex-wrap:wrap}
.ou-qr-svg{flex:none;border-radius:10px;box-shadow:0 0 0 1px var(--bt-line)}
.ou-qr-wait{display:grid;place-items:center;width:208px;height:208px;border-radius:10px;background:var(--bt-hover);color:var(--bt-ink-3);font-size:13px;text-align:center;padding:12px}
.ou-qr-help{display:flex;flex-direction:column;gap:6px;max-width:260px}
.ou-qr-done{gap:10px}
.ou-qr-check{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#00c972;color:#fff;font-weight:700}
.ou-live{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--bt-ink-3)}
.ou-live-dot{width:7px;height:7px;border-radius:50%;background:#00c972;animation:ou-pulse 1.6s ease-in-out infinite}
@keyframes ou-pulse{50%{opacity:.35}}
.ou-chat{flex-direction:column;align-items:stretch;gap:8px}
.ou-chat-head{display:flex;align-items:center;gap:8px}
.ou-chat-head strong{font-size:14px}
.ou-chat-lines{display:flex;flex-direction:column;gap:4px}
.ou-chat-line{display:flex;gap:8px;align-items:baseline;font-size:13px;line-height:18px}
.ou-chat-line[data-me]{color:var(--bt-ink-2)}
.ou-chat-who{flex:none;font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-chat-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-chat-at{flex:none;font-size:11px;color:var(--bt-ink-3)}
.ou-table-wrap{overflow-x:auto;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-card)}
.ou-table{width:100%;border-collapse:collapse;font-size:13px}
.ou-table th{text-align:left;font-weight:500;color:var(--bt-ink-3);padding:8px 12px;border-bottom:1px solid var(--bt-line);white-space:nowrap}
.ou-table td{padding:7px 12px;border-bottom:1px solid var(--bt-line);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-table tr:last-child td{border-bottom:0}
.ou-kv{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 16px;margin:0;font-size:13px}
.ou-kv dt{color:var(--bt-ink-3)}
.ou-kv dd{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-call{display:flex;flex-direction:column;gap:8px;margin:4px 0;max-width:640px}
.ou-call-head{display:flex;align-items:center;gap:8px;min-width:0;padding:0;border:0;background:none;color:var(--bt-ink-2);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.ou-call-verb{flex:none;font-weight:600;color:var(--bt-ink)}
.ou-call-verb[data-method=DELETE]{color:#d13438}
.ou-call-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-call-path{display:none;margin-left:auto;flex:none;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--bt-ink-3)}
.ou-call-head:hover .ou-call-path,.ou-call-head:focus-visible .ou-call-path{display:inline}
.ou-call-write{padding:12px;border:1px solid var(--bt-line);border-radius:16px;background:color-mix(in srgb,var(--bt-card) 70%,transparent)}
.ou-call-write .ou-call-head{font-size:13.5px}
`
