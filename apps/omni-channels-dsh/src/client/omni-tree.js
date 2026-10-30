import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { ChatAvatar, StatusDot, Tile, useOmni } from './channels.js'
import { openConnectWizard } from './wizard.js'
import { isOmniBot, omniActions, startLive, typeOf, unreadOf } from './omni-store.js'
import { openPhone, requestPhone, threadName } from './omni-phone.js'
import { call, hostText, icons, relativeShort, t } from './core.js'
const { ChevronRightIcon, CloseIcon, DotsIcon, PlusIcon, SparkIcon } = icons

// Under the Omni Bot's sidebar row: one collapsible item per channel of the linked Omni, each
// with a + that adds one of its chats, and under it the chats added there, each a thread: a
// plain Session of this plugin's (src/host/threads.js), drawn with the Bot team's `bt-thread`
// look. The other chats stay on the Channels page and its chat view, a click away.
//
// The threads, whether a chat can be added and why not ride the team view (roster.omniThreads,
// omniThreadsOffered, omniThreadsReason); roster.omniRowProps names the props the team draws
// its own rows with, sent only by a team with the restart hook. A row uses only the props named
// there: without them a thread still shows and opens, with no unread dot.
//
// Nothing else is drawn under the Omni Bot: its channels with their threads, and the threads
// of no channel listed here under "Other chats".

const OPEN_KEY = 'omni.tree.open'
const SEARCH_DELAY_MS = 250
export const OMNI_OUTDATED = 'Adding a chat needs a newer Omni. Update it first.'
// The host has not said yet whether a chat can be added: the + stays off, and says so.
export const OFFER_UNKNOWN = 'Adding a chat is not ready yet. Reload the window if this stays.'

function readOpen() {
  try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]')) } catch { return new Set() }
}
function saveOpen(open) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])) } catch { /* storage unavailable */ }
}

// The team runs the restart hook, which every thread needs (design row 20): the host names the
// row props only then (threads.js threadsView).
export const teamReady = roster => Array.isArray(roster?.omniRowProps) && roster.omniRowProps.length > 0
export const threadsOf = (roster, channelId) => (Array.isArray(roster?.omniThreads) ? roster.omniThreads : []).filter(thread => thread.channelId === channelId)
export const isThreadSession = (roster, sessionId) => typeof sessionId === 'string' && (Array.isArray(roster?.omniThreads) ? roster.omniThreads : []).some(thread => thread.sessionId === sessionId)

// Whether the channel rows offer the +, and the reason when they do not: a team without the
// hook, no linked Omni (both the host's), a linked Omni older than this plugin's minimum, or
// no answer from the host yet. A row is never left with neither a + nor a reason.
export function plusOf(roster, state) {
  if (roster?.omniThreadsOffered !== true) return { offered: false, reason: roster?.omniThreadsReason ?? OFFER_UNKNOWN }
  if (state?.link?.outdated === true) return { offered: false, reason: OMNI_OUTDATED }
  return { offered: true, reason: null }
}

// The row props a thread row may use: the ones the host names that the team passed. The
// Bot team's BotChildren hands every entry the props of the Bot's own rows and `wide`
// (bots-dsh 3.32.1 and 3.47 sidebar.js), so on a team with the hook all the named ones are
// there.
export const rowPropsOf = (props, names) => Object.fromEntries((Array.isArray(names) ? names : []).filter(name => props?.[name] !== undefined).map(name => [name, props[name]]))
// A row's key: its thread, and which status hooks it calls, so a team that starts or stops
// passing them remounts the row instead of changing its hooks under it.
export const rowKey = (thread, rowProps) => `${thread.id}:${typeof rowProps.useSessionStatus}:${typeof rowProps.useSessionRetainInfo}`

const NO_STATUS = new Map()
const noStatus = select => select(NO_STATUS)
const noRetain = (_id, select) => select(undefined)
// Threads just added from the picker, by id: each opens once its row is drawn (the team's next
// roster pull), as a click on that row would open it. A row drawn before the add answered is
// opened through `rowOpeners`, which every row that can open lists itself in.
const openOnArrival = new Set()
const rowOpeners = new Map()

// Working, waiting or idle: the host's word, with DSH's own when the team passed it.
export function threadState(thread, { running = false, asking = false } = {}) {
  if (asking || thread.status === 'waiting') return 'waiting'
  if (running || thread.status === 'working') return 'working'
  return 'idle'
}

/**
 * What a thread does without asking you, as its view says (host threads.js permissionsOf):
 * the mark's title, or null while it asks for both as it does by default.
 */
export function freeMarkOf(thread) {
  const sends = thread?.permissions?.sends === 'allow'
  const any = thread?.permissions?.reactions === 'any'
  if (sends && any) return t('Sends messages and any reaction without asking you')
  if (sends) return t('Sends messages without asking you')
  if (any) return t('Reacts with any emoji without asking you')
  return null
}

/**
 * The thread's menu: for its messages and its reactions, follow the default (null) or its own
 * choice, the one in force checked. Each item is what `omni-thread-permissions` is sent.
 */
export function permissionMenuOf(thread) {
  const own = thread?.ownPermissions ?? {}
  const item = (field, value, label) => ({ field, value, label, checked: (own[field] ?? null) === value })
  const sends = { ask: t('Ask me each time'), allow: t('Send without asking') }
  const reactions = { list: t('Only the free reactions go without asking'), any: t('Any reaction goes without asking') }
  // "Follow the default" names the default it follows now, as the view gives it.
  const byDefault = (field, labels, fallback) => t('Follow the default: {choice}', { choice: labels[thread?.defaultPermissions?.[field]] ?? labels[fallback] })
  return [
    { field: 'sends', label: t('Messages'), items: [item('sends', null, byDefault('sends', sends, 'ask')), item('sends', 'ask', sends.ask), item('sends', 'allow', sends.allow)] },
    { field: 'reactions', label: t('Reactions'), items: [item('reactions', null, byDefault('reactions', reactions, 'list')), item('reactions', 'list', reactions.list), item('reactions', 'any', reactions.any)] },
  ]
}

/**
 * Opens a thread the owner clicked: its Session, through the team's row action as a Bot's own
 * rows open theirs, then its phone pane beside it (omni-phone.js requestPhone).
 *
 * The Bot team leaves a main view that holds no Bot, group or DSH bot for the Main Bot while
 * DSH lists its Session as blank, one with no turn yet (bots-dsh sidebar.js useLandOnMainBot),
 * so a thread that never ran stays open only on a team that counts the threads' Sessions
 * (roster.omniThreads) as its own destinations. That exemption is the team's to make.
 */
function openThread(thread, actions, onProblem) {
  onProblem(null)
  actions.openSession(thread.sessionId)
  const reason = requestPhone(thread)
  if (reason !== null) onProblem(reason)
}

/**
 * One thread under its channel, named by its chat (threadName). A click opens the thread (its
 * Session and its phone pane, openThread); on a team without the hook it opens only the
 * phone pane, beside the conversation on screen, and shows the reason in place, so no
 * conversation view takes a turn the thread cannot act on. A thread with no live key says "Not
 * connected" with its reason, and still opens. Its menu and its remove button show on hover
 * and focus, after the title, which ends in an ellipsis before them. `shown` false: its
 * channel is folded, so the row is out of the tab order.
 */
export function ThreadRow({ thread, actions, rowProps = {}, shown = true }) {
  const id = thread.sessionId
  const name = threadName(thread)
  const useStatus = rowProps.useSessionStatus ?? noStatus
  const useRetain = rowProps.useSessionRetainInfo ?? noRetain
  const unread = useStatus(map => map.get(id)?.completionUnread === true)
  const asking = useStatus(map => map.get(id)?.pendingInteraction !== undefined)
  const running = useStatus(map => map.get(id)?.running === true)
  const active = useRetain(id, info => (info?.retainedBy?.mainView ?? 0) > 0)
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState(null)
  const [menu, setMenu] = useState(false)
  const row = useRef(null)
  const opens = teamReady(rowProps.roster)
  // An open menu closes on a click anywhere outside its row.
  useEffect(() => {
    if (!menu || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
    const away = (event) => { if (!row.current?.contains?.(event.target)) setMenu(false) }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [menu])
  // A thread just added from the picker opens as soon as its row is drawn.
  useEffect(() => {
    if (opens && openOnArrival.delete(thread.id)) openThread(thread, actions, setProblem)
  }, [opens, thread.id])
  useEffect(() => {
    if (!opens) return undefined
    const opener = () => openThread(thread, actions, setProblem)
    rowOpeners.set(thread.id, opener)
    return () => { if (rowOpeners.get(thread.id) === opener) rowOpeners.delete(thread.id) }
  })
  const free = freeMarkOf(thread)
  const state = threadState(thread, { running, asking })
  const reason = thread.connected === false || !opens ? hostText(thread.reason ?? t('Not connected')) : null
  const dot = typeof rowProps.useSessionStatus === 'function' && unread && !active
  const label = [name, state === 'waiting' ? t('Waiting for you') : state === 'working' ? t('Working') : '', reason ?? '', free ?? '', dot ? t('Unread activity') : ''].filter(Boolean).join(', ')
  const onClick = () => {
    if (opens) {
      openThread(thread, actions, setProblem)
      return
    }
    // Only a reason is shown: an opened pane leaves a remove error where it is.
    const why = openPhone(thread)
    if (why !== null) setProblem(why)
  }
  const remove = () => {
    if (!confirming) { setConfirming(true); return }
    setConfirming(false)
    setProblem(null)
    call('omni-thread-remove', { threadId: thread.id }).catch(error => setProblem(error?.message ?? String(error)))
  }
  // The owner's choice for this thread; the row shows it on the team's next roster pull.
  const choose = (choice) => {
    setMenu(false)
    setProblem(null)
    call('omni-thread-permissions', { threadId: thread.id, [choice.field]: choice.value }).catch(error => setProblem(error?.message ?? String(error)))
  }
  const onMenuKey = (event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    setMenu(false)
  }
  return h('div', { ref: row, className: 'ot-thread', 'data-idle': state === 'idle' || undefined },
    h('button', {
      type: 'button', className: 'bt-thread', 'data-state': state, 'data-thread-id': thread.id, 'aria-label': label, title: reason ?? name,
      'aria-current': active ? 'page' : undefined, tabIndex: shown ? undefined : -1, onClick,
    },
    h('span', { className: state === 'waiting' ? 'bt-thread-wait' : state === 'working' ? 'bt-thread-spin' : 'ot-thread-idle', 'aria-hidden': true }),
    h('span', { className: 'bt-thread-title' }, name),
    reason ? h('span', { className: 'ot-thread-reason' }, reason) : null,
    free ? h('span', { className: 'ot-thread-free', title: free, 'aria-hidden': true }, h(SparkIcon)) : null,
    dot ? h('span', { className: 'bt-unread', 'aria-hidden': true }) : null),
    h('span', { className: 'ot-thread-acts', 'data-on': confirming || menu || undefined },
      confirming ? null : h('button', {
        type: 'button', className: 'ot-thread-more', 'aria-label': t('Asking first in {name}', { name }), title: t('Asking first'),
        'aria-haspopup': 'menu', 'aria-expanded': menu, tabIndex: shown ? undefined : -1, onClick: () => setMenu(open => !open),
      }, h(DotsIcon)),
      h('button', {
        type: 'button', className: 'ot-thread-remove', 'data-confirm': confirming || undefined,
        'aria-label': confirming ? t('Remove {name} from the sidebar? Click again', { name }) : t('Remove {name}', { name }),
        title: confirming ? t('Click again to remove') : t('Remove'), tabIndex: shown ? undefined : -1, onClick: remove, onBlur: () => setConfirming(false),
      }, confirming ? t('Remove') : h(CloseIcon))),
    menu ? h('div', { className: 'ot-thread-menu', role: 'menu', 'aria-label': t('Asking first in {name}', { name }), onKeyDown: onMenuKey },
      permissionMenuOf(thread).map(group => h('div', { key: group.field, className: 'ot-thread-menu-group', role: 'group', 'aria-label': group.label },
        h('span', { className: 'ot-thread-menu-head' }, group.label),
        group.items.map(choice => h('button', {
          key: String(choice.value), type: 'button', role: 'menuitemradio', className: 'ot-thread-menu-item', 'aria-checked': choice.checked,
          'data-field': choice.field, 'data-value': choice.value ?? 'default', onClick: () => choose(choice),
        }, choice.label))))) : null,
    problem ? h('span', { className: 'ot-thread-problem', role: 'alert' }, hostText(problem)) : null)
}

/**
 * One chat in the picker, drawn as the chat list draws it: its picture (or initials), name and
 * time, a direct chat's number when its name is not that number, and its last message. A
 * chat with no name is called "Group" or "Chat". Its button is named by the chat's name, number and
 * whether it is added, not by every word in the row.
 */
function PickerChat({ chat, busy, onPick }) {
  const name = chat.name ?? (chat.kind === 'group' ? t('Group') : t('Chat'))
  const tag = chat.added ? t('Added') : busy === chat.id ? t('Adding…') : null
  return h('button', {
    type: 'button', className: 'ot-picker-chat', 'data-chat-id': chat.id, disabled: chat.added === true || busy !== null,
    'aria-busy': busy === chat.id || undefined, 'aria-label': [name, chat.number, tag].filter(Boolean).join(', '),
    title: chat.number ? `${name} · ${chat.number}` : name, onClick: () => { void onPick(chat) },
  },
  h(ChatAvatar, { chat: { ...chat, name }, size: 30 }),
  h('span', { className: 'ot-picker-body' },
    h('span', { className: 'ot-picker-top' },
      h('span', { className: 'ot-picker-name' }, name),
      tag ? h('span', { className: 'ot-picker-tag' }, tag) : chat.at > 0 ? h('span', { className: 'ot-picker-at' }, relativeShort(chat.at)) : null),
    chat.number ? h('span', { className: 'ot-picker-number' }, chat.number) : null,
    chat.preview ? h('span', { className: 'ot-picker-preview' }, chat.preview) : null))
}

/**
 * A channel's chats to add, searched on the host (omni-thread-chats; a number is searched by
 * its digits there). `onPick(chat)` adds one and resolves with the host's answer: a refusal (a
 * failed mint among them) shows here, and nothing is added. A chat that is a thread already is
 * marked and cannot be picked again.
 */
export function ThreadPicker({ channel, onPick, onClose }) {
  const [query, setQuery] = useState('')
  const [list, setList] = useState({ status: 'loading', chats: [], error: null })
  const [busy, setBusy] = useState(null)
  const [problem, setProblem] = useState(null)
  const asked = useRef(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  // Asked again only when the words change: a trailing space is no new search.
  const words = query.trim()
  useEffect(() => {
    const ticket = ++asked.current
    const load = () => call('omni-thread-chats', words ? { channelId: channel.id, query: words } : { channelId: channel.id }).then(
      (reply) => { if (alive.current && asked.current === ticket) setList({ status: 'ready', chats: Array.isArray(reply?.chats) ? reply.chats : [], error: null }) },
      (error) => { if (alive.current && asked.current === ticket) setList({ status: 'failed', chats: [], error: error?.message ?? String(error) }) },
    )
    if (words === '') {
      void load()
      return undefined
    }
    const timer = setTimeout(load, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [channel.id, words])
  const pick = async (chat) => {
    if (busy !== null || chat.added) return
    setBusy(chat.id)
    setProblem(null)
    try {
      const result = await onPick(chat)
      if (alive.current && result?.ok !== true) setProblem(result?.reason ?? t('The chat was not added.'))
    } catch (error) {
      if (alive.current) setProblem(error?.message ?? String(error))
    } finally {
      if (alive.current) setBusy(null)
    }
  }
  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onClose()
  }
  const empty = list.status === 'ready' && list.chats.length === 0
  return h('div', { className: 'ot-picker', role: 'group', 'aria-label': t('Add a chat from {name}', { name: channel.name }), onKeyDown },
    h('div', { className: 'ot-picker-head' },
      h('input', {
        type: 'search', className: 'ot-picker-search', value: query, placeholder: t('Search chats or numbers'), 'aria-label': t('Search chats or numbers'),
        autoFocus: true, onChange: event => setQuery(event.target.value),
      }),
      h('button', { type: 'button', className: 'ot-picker-close', 'aria-label': t('Close'), title: t('Close'), onClick: onClose }, h(CloseIcon))),
    problem ? h('p', { className: 'ot-picker-problem', role: 'alert' }, hostText(problem)) : null,
    list.status === 'loading' ? h('p', { className: 'ot-picker-note' }, t('Loading…')) : null,
    list.status === 'failed' ? h('p', { className: 'ot-picker-problem', role: 'alert' }, hostText(list.error)) : null,
    empty ? h('p', { className: 'ot-picker-note' }, query.trim() ? t('No chats match.') : t('No chats yet')) : null,
    list.chats.length > 0 ? h('div', { className: 'ot-picker-list' },
      list.chats.map(chat => h(PickerChat, { key: chat.id, chat, busy, onPick: pick }))) : null)
}

// The host adds the chat; the row shows on the team's next roster pull.
const addThread = (channelId, chat) => call('omni-thread-add', { channelId, chatId: chat.id })

function ChannelItem({ channel, state, roster, rowProps, actions, omni, plus, open, picking, onToggle, onPlus, onClosePicker }) {
  const plusButton = useRef(null)
  const threads = threadsOf(roster, channel.id)
  const hasChats = state.chats.some(chat => chat.channelId === channel.id)
  const unread = unreadOf(state, channel.id)
  const type = typeOf(channel.type)
  const panelId = `omni-tree-${channel.id}`
  // Closing the picker (a pick, Escape, its close button) hands focus back to the +.
  const closePicker = () => {
    onClosePicker()
    plusButton.current?.focus?.()
  }
  // A pick is the owner's own click, so it opens the new thread, Session and phone pane, once
  // its row is drawn (no panel opens by itself).
  const onPick = chat => addThread(channel.id, chat).then((result) => {
    if (result?.ok !== true) return result
    closePicker()
    if (typeof result.threadId !== 'string' || !teamReady(roster)) return result
    const opener = rowOpeners.get(result.threadId)
    if (opener) opener()
    else openOnArrival.add(result.threadId)
    return result
  })
  return h('div', { className: 'ot-channel' },
    h('div', { className: 'ot-channel-head' },
      h('button', {
        type: 'button', className: 'ot-channel-row', 'aria-expanded': open, 'aria-controls': panelId,
        title: `${type.label} · ${channel.name}`, onClick: onToggle,
      },
      h('span', { className: 'ot-chevron', 'aria-hidden': true }, h(ChevronRightIcon)),
      h(Tile, { type: channel.type, size: 18 }),
      h('span', { className: 'ot-channel-name' }, channel.name),
      unread > 0 ? h('span', { className: 'ot-count', 'aria-label': t('{n} unread', { n: unread }) }, unread) : h(StatusDot, { status: channel.status })),
      plus.offered ? h('button', {
        ref: plusButton, type: 'button', className: 'ot-plus', 'aria-label': t('Add a chat'), title: t('Add a chat'), 'aria-expanded': picking, onClick: onPlus,
      }, h(PlusIcon)) : null),
    h('div', { id: panelId, className: 'ot-chats', 'data-open': open || undefined },
      h('div', { className: 'ot-chats-in' },
        picking && plus.offered ? h(ThreadPicker, { channel, onPick, onClose: closePicker }) : null,
        !plus.offered && plus.reason ? h('span', { className: 'ot-empty' }, hostText(plus.reason)) : null,
        threads.map(thread => h(ThreadRow, { key: rowKey(thread, rowProps), thread, actions, rowProps, shown: open })),
        h('button', { type: 'button', className: 'ot-chat ot-all', tabIndex: open ? undefined : -1, onClick: () => omni.openChannels('channel', channel.id) },
          hasChats ? t('All chats') : t('Channel health')))))
}

export function OmniTree(props) {
  const { bot, actions, roster } = props
  const state = useOmni()
  const omni = useMemo(() => omniActions(id => actions.selectPanel(id), call), [actions])
  const [open, setOpen] = useState(readOpen)
  const [picking, setPicking] = useState(null)
  useEffect(() => { startLive(call) }, [])
  if (!isOmniBot(bot)) return null
  const rowProps = rowPropsOf(props, roster?.omniRowProps)
  const threads = Array.isArray(roster?.omniThreads) ? roster.omniThreads : []
  // Threads of no channel shown here (none linked now, a channel removed, another Omni linked
  // since) still show, so they can be opened or removed: removing needs no link.
  const others = list => (list.length === 0 ? null : h('div', { className: 'ot-others', role: 'group', 'aria-label': t('Other chats') },
    h('span', { className: 'ot-empty' }, t('Other chats')),
    list.map(thread => h(ThreadRow, { key: rowKey(thread, rowProps), thread, actions, rowProps }))))
  // Not linked yet: one quiet way into the Connect wizard, so the screen does not say
  // "not connected" a second time here.
  if (state.preview) {
    return h('div', { className: 'ot-tree' }, h('button', { type: 'button', className: 'ot-channel-row ot-link', onClick: openConnectWizard }, t('Connect Omni'), h('span', { 'aria-hidden': true }, ' →')), others(threads))
  }
  const change = (id, show) => setOpen((before) => {
    const next = new Set(before)
    if (show ?? !next.has(id)) next.add(id)
    else next.delete(id)
    saveOpen(next)
    return next
  })
  const plus = plusOf(roster, state)
  const listed = new Set(state.channels.map(channel => channel.id))
  return h('div', { className: 'ot-tree', role: 'group', 'aria-label': t('{name}\'s channels', { name: bot.name }) },
    state.channels.map(channel => h(ChannelItem, {
      key: channel.id, channel, state, roster, rowProps, actions, omni, plus, open: open.has(channel.id), picking: picking === channel.id,
      // Folding a channel closes its picker.
      onToggle: () => {
        if (picking === channel.id && open.has(channel.id)) setPicking(null)
        change(channel.id)
      },
      onPlus: () => {
        const next = picking === channel.id ? null : channel.id
        setPicking(next)
        if (next !== null) change(channel.id, true)
      },
      onClosePicker: () => setPicking(null),
    })),
    others(threads.filter(thread => !listed.has(thread.channelId))))
}

/**
 * Above a thread's composer, drawing nothing: while a thread's Session is shown it marks the
 * page (`body[data-omni-thread]`), from the thread's own record in the roster, so the Bot
 * controls the team draws for any Session (voice chat, and any Bot dock that would show) stay
 * hidden there. A thread is not a Bot.
 */
// Thread docks mounted now: the page mark goes only when the last one does.
let threadDocks = 0
export function ThreadDock({ sessionId, useRoster }) {
  const thread = useRoster(roster => isThreadSession(roster, sessionId))
  useEffect(() => {
    if (!thread || typeof document === 'undefined') return undefined
    threadDocks += 1
    document.body.dataset.omniThread = ''
    return () => {
      threadDocks -= 1
      if (threadDocks === 0) delete document.body.dataset.omniThread
    }
  }, [thread])
  return null
}

export const OMNI_TREE_CSS = `
.ot-tree{display:grid;gap:1px;margin:0 0 4px 26px;padding-left:10px;border-left:1px solid var(--bt-line, rgba(127,127,127,.2))}
.ot-channel-head{display:flex;align-items:center;gap:2px}
.ot-channel-row{display:flex;align-items:center;gap:7px;width:100%;min-width:0;padding:5px 8px 5px 4px;border:0;border-radius:8px;background:none;color:var(--bt-ink);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.ot-channel-row:hover{background:var(--bt-hover)}
.ot-channel-row .oc-tile{flex:none}
.ot-link{color:var(--bt-ink-2);font-size:12.5px}
.ot-chevron{display:grid;place-items:center;width:14px;height:14px;flex:none;color:var(--bt-ink-3);transition:transform .18s ease}
.ot-chevron svg{width:12px;height:12px}
.ot-channel-row[aria-expanded=true] .ot-chevron{transform:rotate(90deg)}
.ot-channel-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ot-count{flex:none;min-width:18px;padding:0 5px;border-radius:9px;background:var(--bt-accent, #22d3ee);color:#fff;font-size:11px;line-height:18px;text-align:center;font-weight:600}
.ot-plus{display:grid;place-items:center;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:7px;background:none;color:var(--bt-ink-2);cursor:pointer;opacity:.55;transition:opacity .12s}
/* The + is always there, faint, so it can be found; it is full on a channel's hover or focus and while its picker is open. */
.ot-channel-head:hover .ot-plus,.ot-channel-head:focus-within .ot-plus,.ot-plus[aria-expanded=true]{opacity:1}
.ot-plus svg{width:14px;height:14px}
.ot-plus:hover,.ot-plus[aria-expanded=true]{background:var(--bt-hover);color:var(--bt-ink)}
.ot-plus:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.ot-chats{display:grid;grid-template-rows:0fr;transition:grid-template-rows .26s ease}
.ot-chats[data-open]{grid-template-rows:1fr}
.ot-chats-in{overflow:hidden;min-height:0;margin-left:14px}
.ot-chat{display:flex;align-items:center;gap:7px;width:100%;padding:3px 6px 3px 4px;border:0;border-radius:8px;background:none;color:var(--bt-ink-2);font:inherit;font-size:12.5px;line-height:20px;text-align:left;cursor:pointer}
.ot-chat:hover{background:var(--bt-hover);color:var(--bt-ink)}
.ot-all{color:var(--bt-ink-3);font-size:12px;padding-left:12px}
.ot-empty{display:block;padding:3px 6px 3px 12px;color:var(--bt-ink-3);font-size:12px}
.ot-others{display:grid;gap:1px;margin-top:4px}
.ot-thread{display:flex;align-items:center;flex-wrap:wrap}
.ot-thread .bt-thread{flex:1;min-width:0}
.ot-thread .bt-thread-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ot-thread[data-idle] .bt-thread-title{color:var(--bt-ink-2)}
.ot-thread-idle{flex:none;width:8px;height:8px;margin:0 2px;box-sizing:border-box;border-radius:50%;border:1.5px solid var(--bt-ink-3);opacity:.6}
.ot-thread-reason{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--bt-ink-3)}
/* The menu and remove buttons sit after the row, never over it: they take no room until the row is hovered or holds focus, and the title then ends in an ellipsis before them. They are never display:none, so they stay in the tab order. */
.ot-thread-acts{display:flex;align-items:center;gap:4px;flex:none;max-width:0;overflow:hidden;opacity:0;transition:max-width .12s ease,opacity .12s ease}
.ot-thread:hover .ot-thread-acts,.ot-thread:focus-within .ot-thread-acts,.ot-thread-acts[data-on]{max-width:120px;padding-right:4px;opacity:1}
.ot-thread-remove,.ot-thread-more{display:grid;place-items:center;flex:none;min-width:20px;height:20px;padding:0;border:0;border-radius:6px;background:var(--bt-hover);color:var(--bt-ink-3);font:inherit;font-size:11px;cursor:pointer}
.ot-thread-remove{padding:0 4px}
.ot-thread-remove svg{width:11px;height:11px}
.ot-thread-more svg{width:12px;height:12px}
.ot-thread-more:hover,.ot-thread-more[aria-expanded=true],.ot-thread-remove:hover{color:var(--bt-ink)}
.ot-thread-free{display:grid;place-items:center;flex:none;width:14px;height:14px;color:var(--bt-accent, #22d3ee)}
.ot-thread-free svg{width:11px;height:11px}
.ot-thread-menu{flex-basis:100%;display:grid;gap:6px;margin:2px 4px 4px 22px;padding:6px;border:1px solid var(--bt-line, rgba(127,127,127,.2));border-radius:10px;background:var(--bt-surface, transparent)}
.ot-thread-menu-group{display:grid;gap:1px}
.ot-thread-menu-head{padding:0 6px;font-size:11px;color:var(--bt-ink-3)}
.ot-thread-menu-item{display:block;width:100%;padding:3px 6px 3px 20px;border:0;border-radius:7px;background:none;color:var(--bt-ink-2);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;position:relative}
.ot-thread-menu-item:hover{background:var(--bt-hover);color:var(--bt-ink)}
.ot-thread-menu-item[aria-checked=true]{color:var(--bt-ink)}
.ot-thread-menu-item[aria-checked=true]::before{content:'';position:absolute;left:8px;top:50%;width:6px;height:6px;margin-top:-3px;border-radius:50%;background:var(--bt-accent, #22d3ee)}
.ot-thread-remove[data-confirm]{color:var(--bt-danger, #dc2626)}
.ot-thread-problem{flex-basis:100%;padding:0 8px 3px 28px;font-size:11px;color:var(--bt-danger, #dc2626)}
.ot-picker{display:grid;gap:4px;margin:2px 0 4px;padding:6px;border:1px solid var(--bt-line, rgba(127,127,127,.2));border-radius:10px;background:var(--bt-surface, transparent)}
.ot-picker-head{display:flex;align-items:center;gap:4px}
.ot-picker-search{flex:1;min-width:0;height:26px;padding:0 8px;border:1px solid var(--bt-line, rgba(127,127,127,.25));border-radius:7px;background:none;color:var(--bt-ink);font:inherit;font-size:12.5px}
.ot-picker-search:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-1px}
.ot-picker-close{display:grid;place-items:center;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:7px;background:none;color:var(--bt-ink-3);cursor:pointer}
.ot-picker-close svg{width:12px;height:12px}
.ot-picker-close:hover{background:var(--bt-hover);color:var(--bt-ink)}
.ot-picker-list{display:grid;gap:1px;max-height:320px;overflow-y:auto}
.ot-picker-chat{display:flex;align-items:center;gap:8px;width:100%;padding:5px 6px;border:0;border-radius:8px;background:none;color:var(--bt-ink);font:inherit;font-size:12.5px;line-height:17px;text-align:left;cursor:pointer}
.ot-picker-chat:hover:not(:disabled){background:var(--bt-hover)}
.ot-picker-chat:disabled{cursor:default}
.ot-picker-chat:disabled .ot-picker-body{opacity:.6}
.ot-picker-body{display:flex;flex-direction:column;flex:1;min-width:0}
.ot-picker-top{display:flex;align-items:baseline;gap:6px;min-width:0}
.ot-picker-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.ot-picker-at,.ot-picker-tag{flex:none;font-size:11px;color:var(--bt-ink-3)}
.ot-picker-number,.ot-picker-preview{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--bt-ink-3)}
.ot-picker-number{font-variant-numeric:tabular-nums}
.ot-picker-note,.ot-picker-problem{margin:0;padding:2px 6px;font-size:12px;color:var(--bt-ink-3)}
.ot-picker-problem{color:var(--bt-danger, #dc2626)}
.ot-chats[data-open] .ot-thread{animation:ot-in .22s ease both}
@keyframes ot-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.ot-chats{transition:none}.ot-chats .ot-thread{animation:none}.ot-chevron{transition:none}.ot-thread-acts{transition:none}}
body[data-omni-thread] .bt-voice,body[data-omni-thread] .bt-plus,body[data-omni-thread] .bt-composer-model,body[data-omni-thread] .bt-mw-dock,body[data-omni-thread] .bt-btw-dock{display:none!important}
`
