import { createElement as h, Fragment, useEffect, useState, useSyncExternalStore } from 'react'

// Omni channels: one icon per connected channel down the left rail, that channel's chats in the
// middle, and the conversation on the right. A Connect flow lists every channel an install can
// add. This is a preview with sample data only; the omni API is not called yet.

const CHANNELS = {
  whatsapp: { label: 'WhatsApp', tile: '#25D366', glyph: 'M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z', blurb: 'Personal and business numbers, with media and voice notes.' },
  slack: { label: 'Slack', tile: '#4A154B', glyph: 'M9 3 7 21M17 3l-2 18M4 9h16M3 15h16', blurb: 'Workspace channels and direct messages for your team.', stroke: true },
  telegram: { label: 'Telegram', tile: '#229ED9', glyph: 'M21 4 3 11l6 2 2 7 3-4 5 4z', blurb: 'Bots and groups, with inline buttons and files.' },
  discord: { label: 'Discord', tile: '#5865F2', glyph: 'M7 7c3-1.5 7-1.5 10 0l1.5 9c-2.5 2-5 2.5-6.5 2.5L11 17c-1.5 0-4-.5-6.5-2.5z', blurb: 'Servers and threads for communities.' },
  email: { label: 'Email', tile: '#64748B', glyph: 'M3 6h18v12H3zM3 7l9 6 9-6', blurb: 'Inbox threads, replies and attachments.', stroke: true },
  web: { label: 'Web chat', tile: '#0F9D8F', glyph: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', blurb: 'A chat widget for your site, answered by Omni.', stroke: true },
}

const SAMPLE_CHANNELS = [
  { id: 'wa-sofia', type: 'whatsapp', name: 'Sofia', detail: '+55 11 9 xxxx-2291', status: 'connected', unread: 2 },
  { id: 'wa-personal', type: 'whatsapp', name: 'Personal', detail: '+55 21 9 xxxx-7810', status: 'connected', unread: 0 },
  { id: 'slack-ns', type: 'slack', name: 'Namastex', detail: '#support, #sales', status: 'connected', unread: 5 },
  { id: 'tg-bot', type: 'telegram', name: 'Omni bot', detail: '@omni_helper_bot', status: 'attention', unread: 0 },
]

const SAMPLE_CHATS = {
  'wa-sofia': [
    { id: 'c1', name: 'Marina Lopes', preview: 'Pode me mandar o orçamento de novo?', time: '09:42', unread: 2, initials: 'ML' },
    { id: 'c2', name: 'Cliente Alpha', preview: 'Recebido, obrigado!', time: 'Ontem', unread: 0, initials: 'CA' },
    { id: 'c3', name: 'Grupo Obras', preview: 'Rafael: fotos no drive', time: 'Seg', unread: 0, initials: 'GO' },
  ],
  'wa-personal': [{ id: 'c4', name: 'Família', preview: 'Almoço domingo?', time: '08:10', unread: 0, initials: 'FA' }],
  'slack-ns': [
    { id: 'c5', name: '#support', preview: 'Ticket 482 respondido pelo Omni', time: '10:05', unread: 5, initials: '#S' },
    { id: 'c6', name: 'Rafael Costa', preview: 'Subo o deploy depois do almoço', time: '09:20', unread: 0, initials: 'RC' },
  ],
  'tg-bot': [{ id: 'c7', name: '@grupo_beta', preview: 'Bot aguardando reconexão', time: 'Ter', unread: 0, initials: 'GB' }],
}

const SAMPLE_MESSAGES = {
  c1: [
    { from: 'them', text: 'Oi! Vi o anúncio. Quanto fica o plano anual?', time: '09:30' },
    { from: 'me', text: 'Oi Marina! O plano anual sai por R$ 1.190 com a instalação inclusa.', time: '09:31', by: 'Omni' },
    { from: 'them', text: 'Pode me mandar o orçamento de novo? Perdi o arquivo.', time: '09:42' },
  ],
  c5: [
    { from: 'them', text: 'Ticket 482: o link de pagamento não abre no celular', time: '09:58' },
    { from: 'me', text: 'Já reenviei o link com a versão atualizada. Confirme se abriu.', time: '10:04', by: 'Omni' },
  ],
}

// A tiny store shared by the footer button and the overlay, which mount in different slots.
// Each change makes a new state object: useSyncExternalStore re-renders only when the snapshot's identity changes.
let state = { open: false, view: 'chats', channel: 'wa-sofia', chat: 'c1' }
const listeners = new Set()
const setStore = patch => { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
const snapshot = () => state
const useOmni = () => useSyncExternalStore(subscribe, snapshot, snapshot)

function ChannelGlyph({ type, size = 22 }) {
  const channel = CHANNELS[type]
  const stroke = channel.stroke
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: 'false', className: 'oc-glyph' },
    h('path', stroke
      ? { d: channel.glyph, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
      : { d: channel.glyph, fill: 'currentColor' }))
}

function OctopusMark({ size = 22 }) {
  return h('svg', { width: size, height: size, viewBox: '0 0 100 100', 'aria-hidden': true, focusable: 'false' },
    h('path', { d: 'M50 6C75 6 87 24 87 46C87 60 82 68 80 72C84 82 84 92 80 96C76 98 72 92 70 84C68 92 66 98 61 96C57 94 56 84 54 78C52 80 48 80 46 78C44 84 43 94 39 96C34 98 32 92 30 84C28 92 24 98 20 96C16 92 16 82 20 72C18 68 13 60 13 46C13 24 25 6 50 6Z', fill: 'currentColor' }))
}

function Tile({ type, size = 40 }) {
  return h('span', { className: 'oc-tile', style: { width: size, height: size, background: CHANNELS[type].tile } }, h(ChannelGlyph, { type, size: Math.round(size * 0.55) }))
}

export function ChannelsButton() {
  const omni = useOmni()
  const unread = SAMPLE_CHANNELS.reduce((sum, channel) => sum + channel.unread, 0)
  return h('button', {
    type: 'button',
    className: 'oc-open',
    onClick: () => setStore({ open: !omni.open }),
    'aria-label': 'Channels',
    title: 'Channels',
  }, h('span', { className: 'oc-open-glyph' }, h(OctopusMark, { size: 16 })), h('span', null, 'Channels'),
    unread > 0 ? h('span', { className: 'oc-badge' }, String(unread)) : null)
}

function Rail({ omni }) {
  return h('nav', { className: 'oc-rail', 'aria-label': 'Channels' },
    h('button', {
      type: 'button',
      className: `oc-rail-home${omni.view === 'chats' && omni.channel === null ? ' oc-on' : ''}`,
      onClick: () => setStore({ view: 'chats', channel: null }),
      'aria-label': 'All chats',
      title: 'All chats',
    }, h(OctopusMark, { size: 26 })),
    h('span', { className: 'oc-rail-divider' }),
    ...SAMPLE_CHANNELS.map(channel => h('button', {
      key: channel.id,
      type: 'button',
      className: `oc-rail-item${omni.channel === channel.id && omni.view === 'chats' ? ' oc-on' : ''}`,
      onClick: () => setStore({ view: 'chats', channel: channel.id, chat: SAMPLE_CHATS[channel.id]?.[0]?.id ?? null }),
      'aria-label': `${CHANNELS[channel.type].label} ${channel.name}${channel.unread ? `, ${channel.unread} unread` : ''}`,
      title: `${CHANNELS[channel.type].label} · ${channel.name}`,
    }, h(Tile, { type: channel.type, size: 44 }),
      channel.unread > 0 ? h('span', { className: 'oc-rail-badge' }, String(channel.unread)) : null,
      h('span', { className: `oc-status oc-status-${channel.status}`, 'aria-hidden': true }))),
    h('button', {
      type: 'button',
      className: `oc-rail-add${omni.view === 'connect' ? ' oc-on' : ''}`,
      onClick: () => setStore({ view: 'connect' }),
      'aria-label': 'Connect a channel',
      title: 'Connect a channel',
    }, '+'),
  )
}

function ChatList({ omni }) {
  const channel = SAMPLE_CHANNELS.find(item => item.id === omni.channel)
  const chats = channel ? SAMPLE_CHATS[channel.id] ?? [] : Object.values(SAMPLE_CHATS).flat()
  const title = channel ? channel.name : 'All chats'
  const subtitle = channel ? `${CHANNELS[channel.type].label} · ${channel.detail}` : `${SAMPLE_CHANNELS.length} channels`
  return h('section', { className: 'oc-list', 'aria-label': 'Conversations' },
    h('header', { className: 'oc-list-head' },
      h('div', null, h('h2', null, title), h('p', null, subtitle)),
      channel ? h('span', { className: `oc-pill oc-pill-${channel.status}` }, channel.status === 'connected' ? 'Connected' : 'Needs attention') : null),
    h('label', { className: 'oc-search' }, h('span', { 'aria-hidden': true }, '⌕'), h('input', { placeholder: 'Search chats', 'aria-label': 'Search chats' })),
    h('ul', { className: 'oc-chats' },
      ...chats.map(chat => h('li', { key: chat.id },
        h('button', {
          type: 'button',
          className: `oc-chat${omni.chat === chat.id ? ' oc-on' : ''}`,
          onClick: () => setStore({ chat: chat.id, view: 'chats' }),
        },
          h('span', { className: 'oc-avatar' }, chat.initials),
          h('span', { className: 'oc-chat-body' },
            h('span', { className: 'oc-chat-top' }, h('strong', null, chat.name), h('time', null, chat.time)),
            h('span', { className: 'oc-chat-bottom' }, h('span', { className: 'oc-preview' }, chat.preview),
              chat.unread > 0 ? h('span', { className: 'oc-count' }, String(chat.unread)) : null))))),
      chats.length === 0 ? h('li', { className: 'oc-empty' }, 'No chats yet on this channel.') : null))
}

function Conversation({ omni }) {
  const channel = SAMPLE_CHANNELS.find(item => item.id === omni.channel) ?? SAMPLE_CHANNELS[0]
  const chat = (SAMPLE_CHATS[channel.id] ?? []).find(item => item.id === omni.chat) ?? SAMPLE_CHATS[channel.id]?.[0]
  if (!chat) return h('section', { className: 'oc-thread oc-thread-empty' }, h('p', null, 'Pick a chat to see the conversation.'))
  const messages = SAMPLE_MESSAGES[chat.id] ?? [{ from: 'them', text: chat.preview, time: chat.time }]
  return h('section', { className: 'oc-thread', 'aria-label': `Conversation with ${chat.name}` },
    h('header', { className: 'oc-thread-head' },
      h('span', { className: 'oc-avatar oc-avatar-lg' }, chat.initials),
      h('div', null, h('strong', null, chat.name), h('p', null, h('span', { className: 'oc-via' }, h(Tile, { type: channel.type, size: 16 })), ` ${CHANNELS[channel.type].label} · ${channel.name}`))),
    h('div', { className: 'oc-messages' },
      h('div', { className: 'oc-day' }, 'Today'),
      ...messages.map((message, index) => h('div', { key: index, className: `oc-msg oc-msg-${message.from}` },
        h('p', null, message.text),
        h('span', { className: 'oc-msg-meta' }, message.by ? `${message.by} · ${message.time}` : message.time)))),
    h('footer', { className: 'oc-composer' },
      h('input', { placeholder: `Reply on ${CHANNELS[channel.type].label}`, 'aria-label': 'Reply' }),
      h('button', { type: 'button', className: 'oc-send', 'aria-label': 'Send' }, '↑')))
}

const STEPS = ['Choose', 'Connect', 'Done']

function ConnectFlow({ omni }) {
  const [picked, setPicked] = useState(null)
  const [step, setStep] = useState(0)
  useEffect(() => { if (omni.view !== 'connect') { setPicked(null); setStep(0) } }, [omni.view])
  if (picked === null) {
    return h('section', { className: 'oc-connect', 'aria-label': 'Connect a channel' },
      h('header', { className: 'oc-connect-head' }, h('h2', null, 'Connect a channel'), h('p', null, 'Pick where people already talk to you. Omni answers in the same place, and you see every chat in one list.')),
      h('div', { className: 'oc-grid' }, ...Object.keys(CHANNELS).map(type => h('button', {
        key: type,
        type: 'button',
        className: 'oc-card',
        onClick: () => { setPicked(type); setStep(0) },
      }, h(Tile, { type, size: 48 }), h('strong', null, CHANNELS[type].label), h('span', null, CHANNELS[type].blurb), h('em', null, 'Connect →')))))
  }
  const channel = CHANNELS[picked]
  return h('section', { className: 'oc-connect oc-connect-flow', 'aria-label': `Connect ${channel.label}` },
    h('button', { type: 'button', className: 'oc-back', onClick: () => setPicked(null) }, '← All channels'),
    h('ol', { className: 'oc-steps', 'aria-label': 'Progress' }, ...STEPS.map((label, index) => h('li', { key: label, className: index <= step ? 'oc-step-on' : '' }, h('span', null, String(index + 1)), label))),
    h('div', { className: 'oc-flow' },
      h(Tile, { type: picked, size: 64 }),
      step === 0 ? h(Fragment, null,
        h('h2', null, `Connect ${channel.label}`),
        h('p', null, channel.blurb),
        h('ul', { className: 'oc-checks' }, h('li', null, 'Takes about a minute'), h('li', null, 'You can disconnect at any time'), h('li', null, 'Omni only reads chats you allow')),
        h('button', { type: 'button', className: 'oc-primary', onClick: () => setStep(1) }, `Start with ${channel.label}`))
        : step === 1 ? h(Fragment, null,
          h('h2', null, 'Scan this code'),
          h('p', null, 'Open the app on your phone, go to Linked devices, and scan the code. This is a sample code for the preview.'),
          h('div', { className: 'oc-qr', 'aria-label': 'Sample QR code' }, h(SampleQr, null)),
          h('button', { type: 'button', className: 'oc-primary', onClick: () => setStep(2) }, 'I scanned it'))
          : h(Fragment, null,
            h('h2', null, `${channel.label} is connected`),
            h('p', null, 'New chats on this channel now appear in Omni. Nothing is sent to your contacts until you reply.'),
            h('button', { type: 'button', className: 'oc-primary', onClick: () => setStore({ view: 'chats', channel: null }) }, 'Open my chats'))))
}

// Decorative placeholder pattern, not a real pairing code.
function SampleQr() {
  const cells = []
  for (let y = 0; y < 13; y += 1) for (let x = 0; x < 13; x += 1) {
    if (((x * 7 + y * 13) % 5 === 0) || (x < 3 && y < 3) || (x > 9 && y < 3) || (x < 3 && y > 9)) cells.push(h('rect', { key: `${x}-${y}`, x: x + 1, y: y + 1, width: 1, height: 1, rx: 0.2 }))
  }
  return h('svg', { viewBox: '0 0 15 15', width: 184, height: 184, 'aria-hidden': true }, h('g', { fill: 'currentColor' }, ...cells))
}

export function ChannelsOverlay() {
  const omni = useOmni()
  useEffect(() => {
    if (!omni.open) return undefined
    const onKey = event => { if (event.key === 'Escape') setStore({ open: false }) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [omni.open])
  if (!omni.open) return null
  return h('div', { className: 'oc-scrim', onClick: event => { if (event.target === event.currentTarget) setStore({ open: false }) } },
    h('div', { className: 'oc-window', role: 'dialog', 'aria-modal': true, 'aria-label': 'Omni channels' },
      h('header', { className: 'oc-topbar' },
        h('span', { className: 'oc-title' }, h(OctopusMark, { size: 20 }), 'Omni channels'),
        h('span', { className: 'oc-preview-chip' }, 'Preview · sample data'),
        h('button', { type: 'button', className: 'oc-close', onClick: () => setStore({ open: false }), 'aria-label': 'Close' }, '×')),
      h('div', { className: 'oc-body' },
        h(Rail, { omni }),
        omni.view === 'connect' ? h(ConnectFlow, { omni }) : h(ChatList, { omni }),
        omni.view === 'connect' ? null : h(Conversation, { omni }))))
}

export const CHANNELS_CSS = `
.oc-open{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:1px solid var(--bt-line,#d9e3e1);border-radius:12px;background:var(--bt-card,#fff);color:var(--bt-ink,#0c2630);font:inherit;font-size:13px;cursor:pointer}
.oc-open:hover{background:var(--bt-hover,#eef6f4)}
.oc-open-glyph{display:grid;place-items:center;width:24px;height:24px;border-radius:8px;background:var(--bt-accent,#0f9d8f);color:var(--bt-accent-ink,#fff)}
.oc-badge,.oc-rail-badge,.oc-count{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#ef4444;color:#fff;font-size:11px;font-weight:600;display:inline-grid;place-items:center;margin-left:auto}
.oc-scrim{position:fixed;inset:0;z-index:2000;background:rgba(6,20,26,.45);backdrop-filter:blur(3px);display:grid;place-items:center;padding:24px;animation:oc-in .18s ease-out}
@keyframes oc-in{from{opacity:0}to{opacity:1}}
.oc-window{width:min(1180px,100%);height:min(780px,100%);background:var(--bt-main,#f3fbfa);color:var(--bt-ink,#0c2630);border-radius:22px;box-shadow:0 30px 80px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--bt-line,#d9e3e1)}
.oc-topbar{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--bt-line,#d9e3e1);background:var(--bt-sidebar,#e8f6f3)}
.oc-title{display:flex;align-items:center;gap:8px;font-weight:650;font-size:15px;color:var(--bt-accent,#0f9d8f)}
.oc-preview-chip{font-size:12px;padding:3px 10px;border-radius:999px;background:var(--bt-bubble,#dcefea);color:var(--bt-ink,#0c2630);opacity:.8}
.oc-close{margin-left:auto;width:32px;height:32px;border:0;border-radius:10px;background:transparent;color:inherit;font-size:22px;cursor:pointer}
.oc-close:hover{background:var(--bt-hover,#eef6f4)}
.oc-body{flex:1;display:grid;grid-template-columns:76px 300px 1fr;min-height:0}
.oc-rail{display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px 0;background:var(--bt-sidebar,#e8f6f3);border-right:1px solid var(--bt-line,#d9e3e1);overflow:auto}
.oc-rail-home,.oc-rail-item,.oc-rail-add{position:relative;width:48px;height:48px;border:0;border-radius:16px;display:grid;place-items:center;background:var(--bt-card,#fff);color:var(--bt-accent,#0f9d8f);cursor:pointer;transition:border-radius .18s,transform .12s}
.oc-rail-home:hover,.oc-rail-item:hover,.oc-rail-add:hover{border-radius:12px;transform:translateY(-1px)}
.oc-rail-add{font-size:24px;color:var(--bt-ink,#0c2630);opacity:.7;border:1px dashed var(--bt-line,#d9e3e1);background:transparent}
.oc-rail .oc-on{box-shadow:0 0 0 2px var(--bt-accent,#0f9d8f);border-radius:14px}
.oc-rail-divider{width:28px;height:1px;background:var(--bt-line,#d9e3e1);margin:4px 0}
.oc-rail-item .oc-tile{border-radius:inherit}
.oc-rail-badge{position:absolute;top:-4px;right:-6px;height:18px;min-width:18px;font-size:10px}
.oc-status{position:absolute;bottom:-2px;right:-2px;width:11px;height:11px;border-radius:50%;border:2px solid var(--bt-sidebar,#e8f6f3)}
.oc-status-connected{background:#22c55e}.oc-status-attention{background:#f59e0b}
.oc-tile{display:grid;place-items:center;border-radius:14px;color:#fff;flex:none}
.oc-glyph{display:block}
.oc-list{display:flex;flex-direction:column;border-right:1px solid var(--bt-line,#d9e3e1);min-height:0;background:var(--bt-card,#fff)}
.oc-list-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:16px 16px 8px}
.oc-list-head h2{margin:0;font-size:17px}
.oc-list-head p{margin:2px 0 0;font-size:12px;opacity:.65}
.oc-pill{font-size:11px;padding:3px 8px;border-radius:999px;white-space:nowrap}
.oc-pill-connected{background:#dcfce7;color:#166534}.oc-pill-attention{background:#fef3c7;color:#92400e}
.oc-search{display:flex;align-items:center;gap:8px;margin:6px 12px 10px;padding:8px 10px;border-radius:12px;background:var(--bt-main,#f3fbfa);border:1px solid var(--bt-line,#d9e3e1);font-size:13px}
.oc-search input{flex:1;border:0;background:transparent;font:inherit;color:inherit;outline:none}
.oc-chats{list-style:none;margin:0;padding:0 8px 12px;overflow:auto;flex:1}
.oc-chat{display:flex;gap:10px;align-items:center;width:100%;padding:10px;border:0;border-radius:14px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.oc-chat:hover{background:var(--bt-hover,#eef6f4)}
.oc-chat.oc-on{background:var(--bt-active,#d5efea)}
.oc-avatar{width:40px;height:40px;border-radius:50%;flex:none;display:grid;place-items:center;background:var(--bt-bubble,#dcefea);color:var(--bt-accent,#0f9d8f);font-weight:650;font-size:13px}
.oc-avatar-lg{width:44px;height:44px}
.oc-chat-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.oc-chat-top,.oc-chat-bottom{display:flex;align-items:center;gap:8px;min-width:0}
.oc-chat-top strong{flex:1;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oc-chat-top time{font-size:11px;opacity:.6}
.oc-preview{flex:1;min-width:0;font-size:12.5px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oc-empty{padding:16px;font-size:13px;opacity:.6}
.oc-thread{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bt-main,#f3fbfa)}
.oc-thread-empty{align-items:center;justify-content:center;opacity:.6}
.oc-thread-head{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--bt-line,#d9e3e1);background:var(--bt-card,#fff)}
.oc-thread-head strong{font-size:15px}
.oc-thread-head p{margin:2px 0 0;font-size:12px;opacity:.65;display:flex;align-items:center;gap:6px}
.oc-via .oc-tile{width:16px;height:16px;border-radius:5px}
.oc-messages{flex:1;overflow:auto;padding:18px 24px;display:flex;flex-direction:column;gap:10px}
.oc-day{align-self:center;font-size:11px;padding:3px 10px;border-radius:999px;background:var(--bt-bubble,#dcefea);opacity:.8;margin:4px 0}
.oc-msg{max-width:62%;padding:9px 12px;border-radius:16px;background:var(--bt-bubble,#dcefea)}
.oc-msg p{margin:0;font-size:14px;line-height:1.45}
.oc-msg-meta{display:block;margin-top:4px;font-size:11px;opacity:.6}
.oc-msg-me{align-self:flex-end;background:var(--bt-accent,#0f9d8f);color:var(--bt-accent-ink,#fff);border-bottom-right-radius:6px}
.oc-msg-me .oc-msg-meta{color:inherit}
.oc-msg-them{align-self:flex-start;border-bottom-left-radius:6px;background:var(--bt-card,#fff);border:1px solid var(--bt-line,#d9e3e1)}
.oc-composer{display:flex;gap:10px;padding:12px 16px;border-top:1px solid var(--bt-line,#d9e3e1);background:var(--bt-card,#fff)}
.oc-composer input{flex:1;padding:10px 14px;border-radius:999px;border:1px solid var(--bt-line,#d9e3e1);background:var(--bt-main,#f3fbfa);font:inherit;color:inherit;outline:none}
.oc-send{width:40px;height:40px;border-radius:50%;border:0;background:var(--bt-accent,#0f9d8f);color:var(--bt-accent-ink,#fff);font-size:18px;cursor:pointer}
.oc-connect{grid-column:2 / span 2;overflow:auto;padding:28px 32px;display:flex;flex-direction:column;gap:18px}
.oc-connect-head h2{margin:0 0 6px;font-size:22px}
.oc-connect-head p{margin:0;opacity:.7;max-width:620px;line-height:1.5}
.oc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.oc-card{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:18px;border-radius:18px;border:1px solid var(--bt-line,#d9e3e1);background:var(--bt-card,#fff);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:transform .12s,box-shadow .12s}
.oc-card:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(0,0,0,.10)}
.oc-card strong{font-size:16px}
.oc-card > span:not(.oc-tile){font-size:13px;opacity:.7;line-height:1.4}
.oc-card em{font-style:normal;color:var(--bt-accent,#0f9d8f);font-size:13px;margin-top:auto}
.oc-connect-flow{align-items:stretch}
.oc-back{align-self:flex-start;border:0;background:transparent;color:var(--bt-accent,#0f9d8f);font:inherit;cursor:pointer;padding:4px 0}
.oc-steps{display:flex;gap:18px;list-style:none;margin:0;padding:0;font-size:13px;opacity:.6}
.oc-steps li{display:flex;align-items:center;gap:6px}
.oc-steps span{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;border:1px solid currentColor;font-size:11px}
.oc-steps .oc-step-on{opacity:1;color:var(--bt-accent,#0f9d8f);font-weight:600}
.oc-steps .oc-step-on span{background:var(--bt-accent,#0f9d8f);color:var(--bt-accent-ink,#fff);border-color:transparent}
.oc-flow{display:flex;flex-direction:column;align-items:flex-start;gap:12px;max-width:520px;margin-top:8px}
.oc-flow h2{margin:4px 0 0;font-size:22px}
.oc-flow p{margin:0;line-height:1.55;opacity:.8}
.oc-checks{margin:4px 0;padding-left:18px;line-height:1.8;opacity:.8}
.oc-primary{margin-top:8px;padding:11px 20px;border-radius:14px;border:0;background:var(--bt-accent,#0f9d8f);color:var(--bt-accent-ink,#fff);font:inherit;font-weight:600;cursor:pointer}
.oc-qr{padding:14px;border-radius:18px;background:#fff;color:#0c2630;border:1px solid var(--bt-line,#d9e3e1)}
@media (max-width:820px){.oc-body{grid-template-columns:64px 1fr}.oc-thread{display:none}.oc-connect{grid-column:2}}
`
