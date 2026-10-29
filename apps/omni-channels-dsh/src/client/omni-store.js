import { createSource, t } from './core.js'

// The Omni channels state the sidebar's Chats section and the two main panels share:
// connected channels with their health, their chats, and each chat's messages. This is
// sample data for the preview; the omni API replaces SAMPLE without changing the shape.

export const CHANNELS_PANEL = 'omni-channels'
export const CHAT_PANEL = 'omni-chat'

// A channel omni has that this view has no tile for still shows, with a plain chat mark.
export const typeOf = type => CHANNEL_TYPES[type] ?? { label: type, tile: '#64748B', glyph: 'chat', pairing: 'token', blurb: '' }

// Keyed by omni's channel ids (core/src/types/channel.ts), with how each one pairs. On a linked
// Omni the page adds every one itself (src/host/omni-channel-actions.js); channel-add.js has
// their guided steps.
export const CHANNEL_TYPES = {
  'whatsapp-baileys': { label: 'WhatsApp', tile: '#25D366', glyph: 'whatsapp', pairing: 'qr', blurb: 'Your own number, linked like WhatsApp Web.' },
  'whatsapp-business': { label: 'WhatsApp Business', tile: '#128C7E', glyph: 'whatsapp', pairing: 'meta', signIn: 'Meta', blurb: 'The official Business API, through your Meta account.' },
  slack: { label: 'Slack', tile: '#4A154B', glyph: 'slack', pairing: 'oauth', signIn: 'Slack', blurb: 'Channels and DMs, as a bot or as yourself.' },
  telegram: { label: 'Telegram', tile: '#229ED9', glyph: 'telegram', pairing: 'token', blurb: 'A bot of yours, in chats and groups.' },
  discord: { label: 'Discord', tile: '#5865F2', glyph: 'discord', pairing: 'token', blurb: 'Servers, threads and DMs, through your bot.' },
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
    { id: 'c-ci', channelId: 'slack-namastex', name: '#ci-alerts', initials: '#', kind: 'group', preview: 'build #1932 failed on dev', at: ago(12 * MIN), unread: 0 },
    { id: 'c-self', channelId: 'wa-personal', name: 'Me (notes)', initials: 'ME', kind: 'self', preview: 'Voice note (0:14)', at: ago(52 * MIN), unread: 0 },
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
  // preview: sample data, every action works locally. live: the host's omni endpoints,
  // read-only. `source` says which, and why the preview stays when omni is not set up.
  preview: true,
  source: { kind: 'preview' },
  // Chats opened here, with the newest message seen, so a poll does not bring the
  // unread count back for messages already read.
  seen: {},
  // What the linked Omni runs, read once per link (omni-link-info): `outdated` when it is
  // older than this plugin's minimum, so the sidebar offers no + on it.
  link: null,
})

export const channelOf = (state, id) => state.channels.find(channel => channel.id === id)
export const chatOf = (state, id) => state.chats.find(chat => chat.id === id)

export function visibleChats(state) {
  const chats = state.filter === null ? state.chats : state.chats.filter(chat => chat.channelId === state.filter)
  return [...chats].sort((a, b) => b.at - a.at)
}

// The Omni Bot (kind omni, added by onboarding's team step) carries the channels in the sidebar.
export const isOmniBot = bot => bot?.kind === 'omni'

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

// The preview changes its sample freely. A linked Omni is changed through the host, as far as
// its key allows (`abilities`, from omni-channel-abilities): channels, and replies apart.
export const canWrite = state => state.preview || (state.source.kind === 'live' && state.abilities?.changeChannels === true)
export const canSend = state => state.preview || (state.source.kind === 'live' && state.abilities?.send === true)

const set = patch => omniStore.set(state => ({ ...state, ...(typeof patch === 'function' ? patch(state) : patch) }))
const patchChannel = (id, patch) => set(state => ({ channels: state.channels.map(channel => (channel.id === id ? { ...channel, ...patch } : channel)) }))

// Shared across action objects and redraws. A deletion freezes overview updates until the
// result, and invalidates older overview/message reads so they cannot restore deleted data.
const deleting = new Set()
let dataGeneration = 0

const withoutChats = (values, ids) => Object.fromEntries(Object.entries(values).filter(([id]) => !ids.has(id)))
const forgetChannel = channelId => set(state => {
  const ids = new Set(state.chats.filter(chat => chat.channelId === channelId).map(chat => chat.id))
  return {
    channels: state.channels.filter(channel => channel.id !== channelId),
    chats: state.chats.filter(chat => chat.channelId !== channelId),
    messages: withoutChats(state.messages, ids),
    seen: withoutChats(state.seen, ids),
    chatId: ids.has(state.chatId) ? null : state.chatId,
    filter: state.filter === channelId ? null : state.filter,
    sendError: ids.has(state.sendError?.chatId) ? null : state.sendError,
    page: state.page.view === 'channel' && state.page.channelId === channelId
      ? { view: 'overview', channelId: null, type: null, step: 0 } : state.page,
  }
})

// `select` is ctx.layout.selectPanel: chats and the Channels page are DSH main panels.
export function omniActions(select, call) {
  // On a linked Omni, a channel change goes through the host and the overview is read again;
  // the preview changes its sample (`local`). A refusal shows on the channel.
  const liveAct = (channelId, action, local, token) => {
    if (deleting.has(channelId)) return
    if (omniStore.getSnapshot().preview || !call) return local()
    patchChannel(channelId, { busy: action, actionError: undefined })
    call('omni-channel-act', { id: channelId, action, ...(token ? { token } : {}) })
      .then(() => refreshLive(call))
      .then(() => patchChannel(channelId, { busy: undefined }), error => patchChannel(channelId, { busy: undefined, actionError: error.message }))
  }
  return {
    setFilter: filter => set({ filter }),
    openChat(chatId) {
      set(state => ({
        chatId,
        chats: state.chats.map(chat => (chat.id === chatId ? { ...chat, unread: 0 } : chat)),
        seen: { ...state.seen, [chatId]: chatOf(state, chatId)?.at ?? Date.now() },
      }))
      select(CHAT_PANEL)
      if (!omniStore.getSnapshot().preview && call) void loadMessages(call, chatId)
    },
    openChannels(view = 'overview', channelId = null) {
      set({ page: { view, channelId, type: null, step: 0 } })
      select(CHANNELS_PANEL)
    },
    showPage: page => set(state => ({ page: { ...state.page, ...page } })),
    sendText(chatId, text) {
      const body = text.trim()
      const before = omniStore.getSnapshot()
      if (body === '' || !canSend(before)) return
      const at = Date.now()
      const localId = `local-${at}`
      set(state => ({
        messages: { ...state.messages, [chatId]: [...(state.messages[chatId] ?? []), { id: localId, from: 'you', text: body, at, ...(state.preview ? {} : { sending: true }) }] },
        chats: state.chats.map(chat => (chat.id === chatId ? { ...chat, preview: `You: ${body}`, at } : chat)),
        sendError: null,
      }))
      if (before.preview || !call) return
      // Shown at once; a refusal takes it back and says why. A sent one stays until the
      // chat's messages come back from omni with it.
      call('omni-send', { chatId, text: body }).then(
        () => { set(state => ({ messages: { ...state.messages, [chatId]: (state.messages[chatId] ?? []).map(message => (message.id === localId ? { ...message, sending: false } : message)) } })); void loadMessages(call, chatId) },
        error => set(state => ({
          messages: { ...state.messages, [chatId]: (state.messages[chatId] ?? []).filter(message => message.id !== localId) },
          chats: state.chats.map(chat => (chat.id === chatId ? chatOf(before, chatId) ?? chat : chat)),
          sendError: { chatId, text: body, message: error.message },
        })),
      )
    },
    setAnsweredBy: (channelId, answeredBy) => patchChannel(channelId, { answeredBy }),
    pause: channelId => liveAct(channelId, 'pause', () => patchChannel(channelId, { status: 'paused' })),
    resume: channelId => liveAct(channelId, 'resume', () => patchChannel(channelId, { status: 'connected', problem: undefined })),
    reconnect(channelId, token) {
      liveAct(channelId, token ? 'token' : 'reconnect', () => {
        patchChannel(channelId, { status: 'connecting', problem: undefined })
        setTimeout(() => patchChannel(channelId, { status: 'connected', health: { ...channelOf(omniStore.getSnapshot(), channelId)?.health, lastEventAt: Date.now() } }), 1600)
      }, token)
    },
    // The preview's connect flow ends with a new sample channel; a live one with the channel
    // omni just connected (`id`), shown once the overview has it.
    finishConnect(type, name, liveId) {
      if (liveId) {
        set({ page: { view: 'channel', channelId: liveId, type: null, step: 0 } })
        if (call) void refreshLive(call).catch(() => {})
        return
      }
      const id = `${type}-${Date.now()}`
      set(state => ({
        channels: [...state.channels, { id, type, name: name || CHANNEL_TYPES[type].label, detail: 'Just connected', status: 'connected', answeredBy: 'Omni',
          health: { lastEventAt: Date.now(), messagesToday: 0, replyMedianSec: null, uptime: 1, week: [0, 0, 0, 0, 0, 0, 0] } }],
        page: { view: 'channel', channelId: id, type: null, step: 0 },
      }))
    },
    // Disconnect remains a local-only sample action.
    remove(channelId) {
      if (omniStore.getSnapshot().preview) forgetChannel(channelId)
    },
    async deleteInstance(channelId) {
      const before = omniStore.getSnapshot()
      const channel = channelOf(before, channelId)
      if (before.preview || !canWrite(before) || !call || !channel || channel.busy || deleting.has(channelId)) return
      deleting.add(channelId)
      dataGeneration += 1
      patchChannel(channelId, { busy: 'delete', deleteError: undefined, actionError: undefined })
      try {
        await call('omni-channel-act', { id: channelId, action: 'delete' })
      } catch (error) {
        patchChannel(channelId, { busy: undefined, deleteError: error.message })
        return
      } finally {
        deleting.delete(channelId)
        dataGeneration += 1
      }
      forgetChannel(channelId)
      try {
        await refreshLive(call)
      } catch (error) {
        set(state => ({ source: { ...state.source, error: t('Instance deleted, but refresh failed: {reason}. Refresh or wait for the next update.', { reason: error.message }) } }))
      }
    },
  }
}

// -------------------------------------------------------------------------
// Live data: the host's omni endpoints (src/host/omni.js), polled while the page is shown.

export const POLL_MS = 15_000
let polling = null

const markSeen = (seen, chats) => chats.map(chat => ((seen[chat.id] ?? -1) >= chat.at ? { ...chat, unread: 0 } : chat))

export async function loadMessages(call, chatId) {
  const generation = dataGeneration
  try {
    const { messages } = await call('omni-messages', { chatId })
    if (generation !== dataGeneration || deleting.size || !chatOf(omniStore.getSnapshot(), chatId)) return
    set(state => ({ messages: { ...state.messages, [chatId]: messages } }))
  } catch (error) {
    if (generation !== dataGeneration || deleting.size || !chatOf(omniStore.getSnapshot(), chatId)) return
    set(state => ({ messages: { ...state.messages, [chatId]: state.messages[chatId] ?? [] }, source: { ...state.source, error: error.message } }))
  }
}

export async function refreshLive(call) {
  const generation = dataGeneration
  const reply = await call('omni-overview')
  if (generation !== dataGeneration || deleting.size) return
  if (!reply.configured) {
    set(state => (state.preview ? { source: { kind: 'preview', missing: reply.missing } } : {}))
    return
  }
  // What this device's key may change, read once per page (the host keeps it a minute).
  const abilities = omniStore.getSnapshot().abilities ?? await call('omni-channel-abilities').catch(() => ({ changeChannels: false, send: false }))
  if (generation !== dataGeneration || deleting.size) return
  set(state => ({
    // The first live answer drops every sample: their chats and messages are not omni's.
    ...(state.preview ? { messages: {}, chatId: null, page: { view: 'overview', channelId: null, type: null, step: 0 } } : {}),
    abilities,
    preview: false,
    source: { kind: 'live', origin: reply.origin, at: Date.now() },
    channels: reply.channels.map(channel => { const kept = channelOf(state, channel.id); return kept?.busy || kept?.actionError || kept?.deleteError ? { ...channel, busy: kept.busy, actionError: kept.actionError, deleteError: kept.deleteError } : channel }),
    chats: markSeen(state.seen, reply.chats),
    filter: reply.channels.some(channel => channel.id === state.filter) ? state.filter : null,
  }))
  // An outdated one, or one whose version is not known yet, is asked again each poll, so an
  // update shows without a reload. The chat's messages do not wait for it.
  const link = omniStore.getSnapshot().link
  if (link?.origin !== reply.origin || link.outdated || link.version === null) void loadLink(call, reply.origin)
  const open = omniStore.getSnapshot().chatId
  if (open) await loadMessages(call, open)
}

// The linked Omni's version against this plugin's minimum. A failed read is asked again on
// the next poll; an Omni whose version is not known is not called outdated.
export async function loadLink(call, origin) {
  const info = await call('omni-link-info').catch(() => null)
  if (info === null || typeof info !== 'object') return
  set({ link: { origin, version: typeof info.version === 'string' ? info.version : null, outdated: info.outdated === true } })
}

// Starts once per page; the returned function stops it.
export function startLive(call, every = POLL_MS) {
  if (polling) return polling
  let timer = 0
  let stopped = false
  const tick = async () => {
    if (typeof document === 'undefined' || !document.hidden) {
      try {
        await refreshLive(call)
      } catch (error) {
        set(state => ({ source: { ...state.source, error: error.message } }))
      }
    }
    if (!stopped) timer = setTimeout(tick, every)
  }
  void tick()
  polling = () => { stopped = true; clearTimeout(timer); polling = null }
  return polling
}

// -------------------------------------------------------------------------
// Subscriptions live on the host (src/host/subscriptions.js) and ride the team view as
// roster.subscriptions and roster.subscriptionRuns; Omni changes them by talking.

// `icon` names a line icon (subscriptions.js); only a reaction shows an emoji, the one you react with.
export const TRIGGERS = {
  reaction: { label: 'You react with', short: 'reaction', icon: 'reaction' },
  message: { label: 'Any new message', short: 'new message', icon: 'message' },
  mention: { label: 'Someone mentions you', short: 'mention', icon: 'mention' },
  keyword: { label: 'A message contains', short: 'keyword', icon: 'keyword' },
  voice: { label: 'A voice note arrives', short: 'voice note', icon: 'voice' },
  media: { label: 'A photo or file arrives', short: 'file', icon: 'media' },
  down: { label: 'The channel disconnects', short: 'disconnect', icon: 'down' },
}

export const runsOf = (roster, subId) => (roster?.subscriptionRuns ?? []).filter(run => subId === undefined || run.subId === subId).toSorted((a, b) => b.at - a.at)
// A run waits for the user while its task Session has an approval open (the read-only
// preset asks before every escalation); `waiting` is those Sessions' ids.
export const waitingRuns = (roster, waiting = new Set()) => (roster?.subscriptionRuns ?? []).filter(run => run.status === 'working' && waiting.has(run.sessionId)).length

