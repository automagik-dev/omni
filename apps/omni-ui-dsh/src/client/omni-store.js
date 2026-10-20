import { createSource } from './sources.js'

// The Omni channels state the sidebar's Chats section and the two main panels share:
// connected channels with their health, their chats, and each chat's messages. This is
// sample data for the preview; the omni API replaces SAMPLE without changing the shape.

export const CHANNELS_PANEL = 'omni-channels'
export const CHAT_PANEL = 'omni-chat'
export const SUBS_PANEL = 'omni-subscriptions'

// A channel omni has that this view has no tile for still shows, with a plain chat mark.
export const typeOf = type => CHANNEL_TYPES[type] ?? { label: type, tile: '#64748B', glyph: 'chat', pairing: 'token', blurb: '' }

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
    { id: 'c-ci', channelId: 'slack-namastex', name: '#ci-alerts', initials: '#', kind: 'group', preview: 'build #1932 failed on dev', at: ago(12 * MIN), unread: 0 },
    { id: 'c-self', channelId: 'wa-personal', name: 'Me (notes)', initials: 'ME', kind: 'self', preview: '🎤 Voice note (0:14)', at: ago(52 * MIN), unread: 0 },
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
  const src = (chat, channel) => ({ kind: 'chat', id: chat, ...pick(chats.find(item => item.id === chat), channels.find(item => item.id === channel)) })
  const subscriptions = [
    { id: 's-react', name: 'Hand a message to Omni', on: true,
      sources: [{ kind: 'channel', id: 'wa-sales', name: 'Sales', type: 'whatsapp-baileys' }, { kind: 'channel', id: 'wa-personal', name: 'Personal', type: 'whatsapp-baileys' }, { kind: 'channel', id: 'slack-namastex', name: 'Namastex', type: 'slack' }],
      trigger: { kind: 'reaction', emoji: '🤖' }, worker: { kind: 'main' }, outputs: { react: true, replyToMe: false }, safety: { askFirst: true } },
    { id: 's-ci', name: 'Build failures', on: true,
      sources: [src('c-ci', 'slack-namastex'), src('c-support', 'slack-namastex'), src('c-beta', 'tg-helper')],
      trigger: { kind: 'keyword', words: ['failed', 'error', 'down'] }, worker: { kind: 'bot', name: 'Ops', look: { shape: 'octopus', color: 'orange' } }, outputs: { react: true, replyToMe: false }, safety: { askFirst: true } },
    { id: 's-voice', name: 'Voice notes to my inbox', on: true,
      sources: [src('c-self', 'wa-personal')],
      trigger: { kind: 'voice' }, worker: { kind: 'session', mode: 'ongoing', title: 'Inbox' }, outputs: { react: true, replyToMe: true }, safety: { askFirst: true } },
    { id: 's-invoices', name: 'Invoices from clients', on: false,
      sources: [src('c-marina', 'wa-sales'), src('c-alpha', 'wa-sales')],
      trigger: { kind: 'media' }, worker: { kind: 'bot', name: 'Finance', look: { shape: 'octopus', color: 'green' } }, outputs: { react: false, replyToMe: false }, safety: { askFirst: true } },
  ]
  const runs = [
    { id: 'r1', subId: 's-ci', at: ago(11 * MIN), status: 'waiting', from: '#ci-alerts', excerpt: 'build #1932 failed on dev', summary: 'Wants to run `gh run view 1932 --log-failed`' },
    { id: 'r2', subId: 's-react', at: ago(26 * MIN), status: 'working', from: 'Marina Lopes', excerpt: 'Pode me mandar o orçamento de novo?', summary: 'Finding the latest quote in Drive' },
    { id: 'r3', subId: 's-voice', at: ago(52 * MIN), status: 'done', from: 'Me (notes)', excerpt: '🎤 "lembrar de renovar o domínio lembr.ai"', summary: 'Added a task for Friday and replied to you' },
    { id: 'r4', subId: 's-ci', at: ago(3 * HOUR), status: 'done', from: '#support', excerpt: 'checkout is down for some users', summary: 'Found a 502 spike; posted a summary in Ops' },
    { id: 'r5', subId: 's-react', at: ago(5 * HOUR), status: 'failed', from: 'Grupo Obras', excerpt: 'Rafael: fotos no drive', summary: 'No access to that Drive folder' },
  ]
  return { channels, chats, messages, subscriptions, runs }
}

const pick = (chat, channel) => ({ name: chat?.name ?? '', type: channel?.type ?? 'whatsapp-baileys', chatKind: chat?.kind ?? 'direct' })


export const omniStore = createSource({
  ...sample(Date.now()),
  // Which channel the sidebar's Chats section shows (null: all), and the open chat.
  filter: null,
  chatId: null,
  // The Channels page: the overview, one channel, or the connect flow.
  page: { view: 'overview', channelId: null, type: null, step: 0 },
  // The Subscriptions page: the list, one subscription, or the editor (`draft`).
  subs: { view: 'list', id: null, runId: null, draft: null },
  // preview: sample data, every action works locally. live: the host's omni endpoints,
  // read-only. `source` says which, and why the preview stays when omni is not set up.
  preview: true,
  source: { kind: 'preview' },
  // Chats opened here, with the newest message seen, so a poll does not bring the
  // unread count back for messages already read.
  seen: {},
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

// Only the preview changes channels and sends; the live view reads.
export const canWrite = state => state.preview

const set = patch => omniStore.set(state => ({ ...state, ...(typeof patch === 'function' ? patch(state) : patch) }))
const patchChannel = (id, patch) => set(state => ({ channels: state.channels.map(channel => (channel.id === id ? { ...channel, ...patch } : channel)) }))

// `select` is ctx.layout.selectPanel: chats and the Channels page are DSH main panels.
export function omniActions(select, call) {
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
      if (body === '' || !canWrite(omniStore.getSnapshot())) return
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

// -------------------------------------------------------------------------
// Live data: the host's omni endpoints (src/host/omni.js), polled while the page is shown.

const POLL_MS = 15_000
let polling = null

const markSeen = (seen, chats) => chats.map(chat => ((seen[chat.id] ?? -1) >= chat.at ? { ...chat, unread: 0 } : chat))

export async function loadMessages(call, chatId) {
  try {
    const { messages } = await call('omni-messages', { chatId })
    set(state => ({ messages: { ...state.messages, [chatId]: messages } }))
  } catch (error) {
    set(state => ({ messages: { ...state.messages, [chatId]: state.messages[chatId] ?? [] }, source: { ...state.source, error: error.message } }))
  }
}

export async function refreshLive(call) {
  const reply = await call('omni-overview')
  if (!reply.configured) {
    set(state => (state.preview ? { source: { kind: 'preview', missing: reply.missing } } : {}))
    return
  }
  set(state => ({
    // The first live answer drops every sample: their chats and messages are not omni's.
    ...(state.preview ? { messages: {}, chatId: null, page: { view: 'overview', channelId: null, type: null, step: 0 } } : {}),
    preview: false,
    source: { kind: 'live', origin: reply.origin, at: Date.now() },
    channels: reply.channels,
    chats: markSeen(state.seen, reply.chats),
    filter: reply.channels.some(channel => channel.id === state.filter) ? state.filter : null,
  }))
  const open = omniStore.getSnapshot().chatId
  if (open) await loadMessages(call, open)
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
// Subscriptions: chats, groups or whole channels, watched for one kind of event and handed to
// a Bot or a DSH session. Sample only: nothing here talks to omni yet.

export const TRIGGERS = {
  reaction: { label: 'You react with', icon: '🤖' },
  message: { label: 'Any new message', icon: '💬' },
  mention: { label: 'Someone mentions you', icon: '@' },
  keyword: { label: 'A message contains', icon: '🔎' },
  voice: { label: 'A voice note arrives', icon: '🎤' },
  media: { label: 'A photo or file arrives', icon: '📎' },
  down: { label: 'The channel disconnects', icon: '⚡' },
}
export const REACTIONS = ['🤖', '👀', '📌', '✅', '🧾', '🔥', '❓', '⭐']

export const subOf = (state, id) => state.subscriptions.find(sub => sub.id === id)
export const runsOf = (state, subId) => state.runs.filter(run => subId === undefined || run.subId === subId).toSorted((a, b) => b.at - a.at)
export const waitingRuns = state => state.runs.filter(run => run.status === 'waiting').length
export function firedToday(state, subId) {
  const midnight = new Date().setHours(0, 0, 0, 0)
  return state.runs.filter(run => run.subId === subId && run.at >= midnight).length
}

export const emptyDraft = () => ({ id: null, name: '', on: true, sources: [], trigger: { kind: 'reaction', emoji: '🤖' }, worker: { kind: 'main' }, outputs: { react: true, replyToMe: false }, safety: { askFirst: true } })

const sourceOfChat = (state, chat) => ({ kind: 'chat', id: chat.id, name: chat.name, type: channelOf(state, chat.channelId)?.type ?? 'whatsapp-baileys', chatKind: chat.kind ?? 'direct' })
export const sourceOfChannel = channel => ({ kind: 'channel', id: channel.id, name: channel.name, type: channel.type })
export const chatSource = sourceOfChat

// "Describe it to Omni": the preview guesses a draft from the words; the real one is the Main
// Bot proposing a subscription for you to approve.
export function guessDraft(text, state) {
  const words = text.toLowerCase()
  const draft = { ...emptyDraft(), name: text.trim().slice(0, 48) }
  const emoji = REACTIONS.find(item => text.includes(item))
  if (emoji || /\breact/.test(words)) draft.trigger = { kind: 'reaction', emoji: emoji ?? '🤖' }
  else if (/voice|audio|áudio/.test(words)) draft.trigger = { kind: 'voice' }
  else if (/photo|file|invoice|pdf|foto|nota/.test(words)) draft.trigger = { kind: 'media' }
  else if (/mention|@me/.test(words)) draft.trigger = { kind: 'mention' }
  else {
    const quoted = [...text.matchAll(/["“']([^"”']+)["”']/g)].map(match => match[1])
    draft.trigger = { kind: 'keyword', words: quoted.length > 0 ? quoted : ['failed'] }
  }
  draft.sources = state.chats.filter(chat => words.includes(chat.name.toLowerCase().replace(/^#/, ''))).map(chat => sourceOfChat(state, chat))
  if (/\b(me|myself|mim)\b/.test(words)) draft.outputs = { ...draft.outputs, replyToMe: true }
  return draft
}

export function subsActions(select) {
  const show = subs => set(state => ({ subs: { ...state.subs, ...subs } }))
  return {
    openSubs(view = 'list', id = null, runId = null) {
      const sub = id ? subOf(omniStore.getSnapshot(), id) : undefined
      show({ view, id, runId, draft: view === 'edit' ? (sub ? structuredClone(sub) : emptyDraft()) : null })
      select(SUBS_PANEL)
    },
    show,
    startDraft: (draft) => { show({ view: 'edit', id: draft.id, runId: null, draft }); select(SUBS_PANEL) },
    editDraft: patch => set(state => ({ subs: { ...state.subs, draft: { ...state.subs.draft, ...patch } } })),
    save() {
      const { draft } = omniStore.getSnapshot().subs
      if (!draft || draft.sources.length === 0) return
      const id = draft.id ?? `s-${Date.now()}`
      const saved = { ...draft, id, name: draft.name.trim() || 'Untitled subscription' }
      set(state => ({
        subscriptions: state.subscriptions.some(sub => sub.id === id) ? state.subscriptions.map(sub => (sub.id === id ? saved : sub)) : [...state.subscriptions, saved],
        subs: { view: 'detail', id, runId: null, draft: null },
      }))
    },
    toggle: id => set(state => ({ subscriptions: state.subscriptions.map(sub => (sub.id === id ? { ...sub, on: !sub.on } : sub)) })),
    remove: id => set(state => ({ subscriptions: state.subscriptions.filter(sub => sub.id !== id), runs: state.runs.filter(run => run.subId !== id), subs: { view: 'list', id: null, runId: null, draft: null } })),
    // A test fires the subscription on its newest matching message, as a run that finishes.
    test(id) {
      const sub = subOf(omniStore.getSnapshot(), id)
      if (!sub) return
      const runId = `r-${Date.now()}`
      set(state => ({ runs: [{ id: runId, subId: id, at: Date.now(), status: 'working', from: sub.sources[0]?.name ?? 'a chat', excerpt: 'Test: the newest matching message', summary: 'Reading the message' }, ...state.runs], subs: { ...state.subs, runId } }))
      setTimeout(() => set(state => ({ runs: state.runs.map(run => (run.id === runId ? { ...run, status: 'done', summary: 'Test finished: the worker got the message and where it came from' } : run)) })), 2200)
    },
    approve: runId => set(state => ({ runs: state.runs.map(run => (run.id === runId ? { ...run, status: 'working', summary: 'Approved: running it now' } : run)) })),
    deny: runId => set(state => ({ runs: state.runs.map(run => (run.id === runId ? { ...run, status: 'failed', summary: 'You declined' } : run)) })),
  }
}
