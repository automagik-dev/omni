import { createSource } from './sources.js'

// The Omni channels state the sidebar's Chats section and the two main panels share:
// connected channels with their health, their chats, and each chat's messages. This is
// sample data for the preview; the omni API replaces SAMPLE without changing the shape.

export const CHANNELS_PANEL = 'omni-channels'
export const CHAT_PANEL = 'omni-chat'

// Keyed by omni's channel ids (core/src/types/channel.ts), with how each one pairs.
export const CHANNEL_TYPES = {
  'whatsapp-baileys': { label: 'WhatsApp', tile: '#25D366', glyph: 'whatsapp', pairing: 'qr', blurb: 'Link a phone number by scanning a code, like WhatsApp Web.' },
  'whatsapp-business': { label: 'WhatsApp Business', tile: '#128C7E', glyph: 'whatsapp', pairing: 'oauth', signIn: 'Meta', blurb: 'The official Business API, through your Meta account.' },
  telegram: { label: 'Telegram', tile: '#229ED9', glyph: 'telegram', pairing: 'token', blurb: 'A bot of yours, in direct chats and groups.' },
  slack: { label: 'Slack', tile: '#4A154B', glyph: 'slack', pairing: 'oauth', signIn: 'Slack', blurb: 'Workspace channels and direct messages.' },
  discord: { label: 'Discord', tile: '#5865F2', glyph: 'discord', pairing: 'token', blurb: 'Servers, threads and direct messages.' },
}

// connected: working. connecting: pairing or reconnecting by itself. attention: needs the
// user (expired session, revoked token). paused: the user stopped it.
export const STATUS = {
  connected: { label: 'Connected', tone: 'ok' },
  connecting: { label: 'Reconnecting', tone: 'busy' },
  attention: { label: 'Needs attention', tone: 'warn' },
  paused: { label: 'Paused', tone: 'off' },
}

const MIN = 60_000
const HOUR = 60 * MIN

function sample(now) {
  const ago = ms => now - ms
  const channels = [
    { id: 'wa-sales', type: 'whatsapp-baileys', name: 'Sales', detail: '+55 11 9xxxx-2291', status: 'connected', answeredBy: 'Omni',
      health: { lastEventAt: ago(2 * MIN), messagesToday: 128, replyMedianSec: 41, uptime: 0.998, week: [42, 58, 61, 49, 77, 90, 128] } },
    { id: 'wa-personal', type: 'whatsapp-baileys', name: 'Personal', detail: '+55 21 9xxxx-7810', status: 'connected', answeredBy: 'You',
      health: { lastEventAt: ago(26 * MIN), messagesToday: 14, replyMedianSec: null, uptime: 0.991, week: [9, 12, 6, 15, 11, 8, 14] } },
    { id: 'slack-namastex', type: 'slack', name: 'Namastex', detail: '#support · #sales', status: 'connected', answeredBy: 'Omni',
      health: { lastEventAt: ago(6 * MIN), messagesToday: 57, replyMedianSec: 95, uptime: 1, week: [33, 40, 51, 38, 44, 21, 57] } },
    { id: 'tg-helper', type: 'telegram', name: 'Omni helper', detail: '@omni_helper_bot', status: 'attention', answeredBy: 'Omni',
      problem: 'The bot token was revoked in BotFather. Paste a new token to reconnect.',
      health: { lastEventAt: ago(19 * HOUR), messagesToday: 0, replyMedianSec: null, uptime: 0.62, week: [18, 22, 25, 19, 7, 0, 0] } },
  ]
  const chats = [
    { id: 'c-marina', channelId: 'wa-sales', name: 'Marina Lopes', initials: 'ML', preview: 'Pode me mandar o orçamento de novo?', at: ago(3 * MIN), unread: 2 },
    { id: 'c-support', channelId: 'slack-namastex', name: '#support', initials: '#', kind: 'group', preview: 'Omni: Ticket 482 answered, link resent', at: ago(7 * MIN), unread: 5 },
    { id: 'c-rafael', channelId: 'slack-namastex', name: 'Rafael Costa', initials: 'RC', preview: 'Deploy after lunch', at: ago(41 * MIN), unread: 0 },
    { id: 'c-alpha', channelId: 'wa-sales', name: 'Alpha Construções', initials: 'AC', preview: 'Recebido, obrigado!', at: ago(2 * HOUR), unread: 0 },
    { id: 'c-familia', channelId: 'wa-personal', name: 'Família', initials: 'FA', kind: 'group', preview: 'Almoço domingo?', at: ago(3 * HOUR), unread: 1 },
    { id: 'c-obras', channelId: 'wa-sales', name: 'Grupo Obras', initials: 'GO', kind: 'group', preview: 'Rafael: fotos no drive', at: ago(26 * HOUR), unread: 0 },
    { id: 'c-beta', channelId: 'tg-helper', name: 'Beta testers', initials: 'BT', kind: 'group', preview: 'Is the bot down?', at: ago(19 * HOUR), unread: 0 },
  ]
  const messages = {
    'c-marina': [
      { id: 'm1', from: 'them', text: 'Oi! Vi o anúncio. Quanto fica o plano anual?', at: ago(15 * MIN) },
      { id: 'm2', from: 'omni', text: 'Oi Marina! O plano anual sai por R$ 1.190, com a instalação inclusa.', at: ago(14 * MIN) },
      { id: 'm3', from: 'them', text: 'Perdi o arquivo do orçamento 😅', at: ago(4 * MIN) },
      { id: 'm4', from: 'them', text: 'Pode me mandar o orçamento de novo?', at: ago(3 * MIN) },
    ],
    'c-support': [
      { id: 'm1', from: 'them', author: 'Ana', text: 'Ticket 482: the payment link does not open on mobile.', at: ago(12 * MIN) },
      { id: 'm2', from: 'omni', text: 'I resent the link with the fixed version. Ana, can you confirm it opens now?', at: ago(7 * MIN) },
    ],
    'c-beta': [
      { id: 'm1', from: 'them', author: 'Leo', text: 'Is the bot down?', at: ago(19 * HOUR) },
    ],
  }
  return { channels, chats, messages }
}

export const omniStore = createSource({
  ...sample(Date.now()),
  // Which channel the sidebar's Chats section shows (null: all), and the open chat.
  filter: null,
  chatId: null,
  // The Channels page: the overview, one channel, or the connect flow.
  page: { view: 'overview', channelId: null, type: null, step: 0 },
  preview: true,
})

export const channelOf = (state, id) => state.channels.find(channel => channel.id === id)
export const chatOf = (state, id) => state.chats.find(chat => chat.id === id)

export function visibleChats(state) {
  const chats = state.filter === null ? state.chats : state.chats.filter(chat => chat.channelId === state.filter)
  return [...chats].sort((a, b) => b.at - a.at)
}

export const unreadOf = (state, channelId) => state.chats
  .filter(chat => channelId === undefined || chat.channelId === channelId)
  .reduce((sum, chat) => sum + chat.unread, 0)

export function healthSummary(state) {
  const count = status => state.channels.filter(channel => channel.status === status).length
  return {
    total: state.channels.length,
    connected: count('connected'),
    attention: count('attention') + count('connecting'),
    messagesToday: state.channels.reduce((sum, channel) => sum + (channel.health?.messagesToday ?? 0), 0),
  }
}

const set = patch => omniStore.set(state => ({ ...state, ...(typeof patch === 'function' ? patch(state) : patch) }))
const patchChannel = (id, patch) => set(state => ({ channels: state.channels.map(channel => (channel.id === id ? { ...channel, ...patch } : channel)) }))

// `select` is ctx.layout.selectPanel: chats and the Channels page are DSH main panels.
export function omniActions(select) {
  return {
    setFilter: filter => set({ filter }),
    openChat(chatId) {
      set(state => ({ chatId, chats: state.chats.map(chat => (chat.id === chatId ? { ...chat, unread: 0 } : chat)) }))
      select(CHAT_PANEL)
    },
    openChannels(view = 'overview', channelId = null) {
      set({ page: { view, channelId, type: null, step: 0 } })
      select(CHANNELS_PANEL)
    },
    showPage: page => set(state => ({ page: { ...state.page, ...page } })),
    sendText(chatId, text) {
      const body = text.trim()
      if (body === '') return
      const at = Date.now()
      set(state => ({
        messages: { ...state.messages, [chatId]: [...(state.messages[chatId] ?? []), { id: `local-${at}`, from: 'you', text: body, at }] },
        chats: state.chats.map(chat => (chat.id === chatId ? { ...chat, preview: `You: ${body}`, at } : chat)),
      }))
    },
    setAnsweredBy: (channelId, answeredBy) => patchChannel(channelId, { answeredBy }),
    pause: channelId => patchChannel(channelId, { status: 'paused' }),
    resume: channelId => patchChannel(channelId, { status: 'connected', problem: undefined }),
    reconnect(channelId) {
      patchChannel(channelId, { status: 'connecting', problem: undefined })
      setTimeout(() => patchChannel(channelId, { status: 'connected', health: { ...channelOf(omniStore.getSnapshot(), channelId)?.health, lastEventAt: Date.now() } }), 1600)
    },
    // The preview's connect flow ends with a new sample channel.
    finishConnect(type, name) {
      const id = `${type}-${Date.now()}`
      set(state => ({
        channels: [...state.channels, { id, type, name: name || CHANNEL_TYPES[type].label, detail: 'Just connected', status: 'connected', answeredBy: 'Omni',
          health: { lastEventAt: Date.now(), messagesToday: 0, replyMedianSec: null, uptime: 1, week: [0, 0, 0, 0, 0, 0, 0] } }],
        page: { view: 'channel', channelId: id, type: null, step: 0 },
      }))
    },
    remove: channelId => set(state => ({
      channels: state.channels.filter(channel => channel.id !== channelId),
      chats: state.chats.filter(chat => chat.channelId !== channelId),
      filter: state.filter === channelId ? null : state.filter,
      page: { view: 'overview', channelId: null, type: null, step: 0 },
    })),
  }
}
