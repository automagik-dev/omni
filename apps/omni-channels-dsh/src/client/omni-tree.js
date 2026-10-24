import { createElement as h, useEffect, useMemo, useState } from 'react'
import { ChatAvatar, StatusDot, Tile, useOmni } from './channels.js'
import { openConnectWizard } from './wizard.js'
import { chatsOf, isOmniBot, omniActions, startLive, typeOf, unreadOf } from './omni-store.js'
import { BotMark, call, icons, relativeShort, t } from './core.js'
const { ChevronRightIcon } = icons

// Under the Omni Bot's sidebar row: one collapsible item per channel of the linked Omni, and
// under each its most recent chats, each with a little Omni of its own (the Omni Bot's look)
// that helps there. A chat opens in the CHAT_PANEL main panel, as from the Channels page.

const SHOWN = 8
const OPEN_KEY = 'omni.tree.open'

function readOpen() {
  try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]')) } catch { return new Set() }
}
function saveOpen(open) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])) } catch { /* storage unavailable */ }
}

function ChannelItem({ channel, state, bot, omni, open, onToggle }) {
  const { chats, more } = chatsOf(state, channel.id, SHOWN)
  const unread = unreadOf(state, channel.id)
  const type = typeOf(channel.type)
  const panelId = `omni-tree-${channel.id}`
  return h('div', { className: 'ot-channel' },
    h('button', {
      type: 'button', className: 'ot-channel-row', 'aria-expanded': open, 'aria-controls': panelId,
      title: `${type.label} · ${channel.name}`, onClick: onToggle,
    },
    h('span', { className: 'ot-chevron', 'aria-hidden': true }, h(ChevronRightIcon)),
    h(Tile, { type: channel.type, size: 18 }),
    h('span', { className: 'ot-channel-name' }, channel.name),
    unread > 0 ? h('span', { className: 'ot-count', 'aria-label': t('{n} unread', { n: unread }) }, unread) : h(StatusDot, { status: channel.status })),
    h('div', { id: panelId, className: 'ot-chats', 'data-open': open || undefined },
      h('div', { className: 'ot-chats-in' },
        chats.length === 0 ? h('span', { className: 'ot-empty' }, t('No chats yet')) : null,
        chats.map((chat, index) => h('button', {
          key: chat.id, type: 'button', className: 'ot-chat', style: { '--i': index },
          'aria-current': state.chatId === chat.id ? 'page' : undefined, title: chat.preview || chat.name,
          tabIndex: open ? undefined : -1, onClick: () => omni.openChat(chat.id),
        },
        h(ChatAvatar, { chat, size: 22 }),
        h('span', { className: 'ot-chat-name' }, chat.name),
        chat.unread > 0 ? h('span', { className: 'ot-unread', 'aria-hidden': true }) : h('span', { className: 'ot-time' }, relativeShort(chat.at)),
        h('span', { className: 'ot-helper', title: t('{name} helps in this chat', { name: bot.name }) }, h(BotMark, { bot, size: 16 })))),
        h('button', { type: 'button', className: 'ot-chat ot-all', tabIndex: open ? undefined : -1, onClick: () => omni.openChannels('channel', channel.id) },
          more > 0 ? t('All chats (+{n})', { n: more }) : t('Channel health')))))
}

export function OmniTree({ bot, actions }) {
  const state = useOmni()
  const omni = useMemo(() => omniActions(id => actions.selectPanel(id), call), [actions])
  const [open, setOpen] = useState(readOpen)
  useEffect(() => { startLive(call) }, [])
  if (!isOmniBot(bot)) return null
  // Not linked yet: one quiet way into the Connect wizard, so the screen does not say
  // "not connected" a second time here.
  if (state.preview) {
    return h('div', { className: 'ot-tree' }, h('button', { type: 'button', className: 'ot-channel-row ot-link', onClick: openConnectWizard }, t('Connect Omni'), h('span', { 'aria-hidden': true }, ' →')))
  }
  const toggle = id => setOpen((before) => {
    const next = new Set(before)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    saveOpen(next)
    return next
  })
  return h('div', { className: 'ot-tree', role: 'group', 'aria-label': t('{name}\'s channels', { name: bot.name }) },
    state.channels.map(channel => h(ChannelItem, { key: channel.id, channel, state, bot, omni, open: open.has(channel.id), onToggle: () => toggle(channel.id) })))
}

export const OMNI_TREE_CSS = `
.ot-tree{display:grid;gap:1px;margin:0 0 4px 26px;padding-left:10px;border-left:1px solid var(--bt-line, rgba(127,127,127,.2))}
.ot-channel-row{display:flex;align-items:center;gap:7px;width:100%;padding:5px 8px 5px 4px;border:0;border-radius:8px;background:none;color:var(--bt-ink);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.ot-channel-row:hover{background:var(--bt-hover)}
.ot-channel-row .oc-tile{flex:none}
.ot-link{color:var(--bt-ink-2);font-size:12.5px}
.ot-chevron{display:grid;place-items:center;width:14px;height:14px;flex:none;color:var(--bt-ink-3);transition:transform .18s ease}
.ot-chevron svg{width:12px;height:12px}
.ot-channel-row[aria-expanded=true] .ot-chevron{transform:rotate(90deg)}
.ot-channel-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ot-count{flex:none;min-width:18px;padding:0 5px;border-radius:9px;background:var(--bt-accent, #22d3ee);color:#fff;font-size:11px;line-height:18px;text-align:center;font-weight:600}
.ot-chats{display:grid;grid-template-rows:0fr;transition:grid-template-rows .26s ease}
.ot-chats[data-open]{grid-template-rows:1fr}
.ot-chats-in{overflow:hidden;min-height:0;margin-left:14px}
.ot-chat{display:flex;align-items:center;gap:7px;width:100%;padding:3px 6px 3px 4px;border:0;border-radius:8px;background:none;color:var(--bt-ink-2);font:inherit;font-size:12.5px;line-height:20px;text-align:left;cursor:pointer}
.ot-chat:hover{background:var(--bt-hover);color:var(--bt-ink)}
.ot-chat[aria-current=page]{background:var(--bt-active, var(--bt-hover));color:var(--bt-ink);font-weight:500}
.ot-chat .oc-ava{flex:none}
.ot-chat-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ot-time{flex:none;font-size:10.5px;color:var(--bt-ink-3)}
.ot-unread{flex:none;width:7px;height:7px;border-radius:50%;background:var(--bt-accent, #22d3ee)}
.ot-helper{flex:none;display:grid;place-items:center;width:18px;height:18px;opacity:.9}
.ot-all{color:var(--bt-ink-3);font-size:12px;padding-left:33px}
.ot-empty{display:block;padding:3px 6px 3px 33px;color:var(--bt-ink-3);font-size:12px}
.ot-chats[data-open] .ot-chat{animation:ot-in .22s ease both;animation-delay:calc(var(--i, 0)*25ms)}
@keyframes ot-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.ot-chats{transition:none}.ot-chats .ot-chat{animation:none}.ot-chevron{transition:none}}
`
