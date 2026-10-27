import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { StatusDot, Tile, useOmni } from './channels.js'
import { openConnectWizard } from './wizard.js'
import { isOmniBot, omniActions, startLive, typeOf, unreadOf } from './omni-store.js'
import { call, hostText, icons, t } from './core.js'
const { ChevronRightIcon, CloseIcon, PlusIcon } = icons

// Under the Omni Bot's sidebar row: one collapsible item per channel of the linked Omni, each
// with a + that adds one of its chats, and under it the chats added there, each a thread: a
// plain Session of this plugin's (src/host/threads.js), drawn with the Bot team's `bt-thread`
// look. The other chats stay on the Channels page and its chat view, a click away.
//
// The threads, whether a chat can be added and why not ride the team view (roster.omniThreads,
// omniThreadsOffered, omniThreadsReason); roster.omniRowProps names the props the team draws
// its own rows with, sent only by a team with the restart hook. A row uses only the props named
// there: without them a thread still shows and opens, with no unread dot.

const OPEN_KEY = 'omni.tree.open'
const SEARCH_DELAY_MS = 250
export const OMNI_OUTDATED = 'Adding a chat needs a newer Omni. Update it first.'

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
// hook, no linked Omni (both the host's), or a linked Omni older than this plugin's minimum.
export function plusOf(roster, state) {
  if (roster?.omniThreadsOffered !== true) return { offered: false, reason: roster?.omniThreadsReason ?? null }
  if (state?.link?.outdated === true) return { offered: false, reason: OMNI_OUTDATED }
  return { offered: true, reason: null }
}

// The row props a thread row may use: the ones the host names that the team passed.
export const rowPropsOf = (props, names) => Object.fromEntries((Array.isArray(names) ? names : []).filter(name => props?.[name] !== undefined).map(name => [name, props[name]]))
// A row's key: its thread, and which status hooks it calls, so a team that starts or stops
// passing them remounts the row instead of changing its hooks under it.
export const rowKey = (thread, rowProps) => `${thread.id}:${typeof rowProps.useSessionStatus}:${typeof rowProps.useSessionRetainInfo}`

const NO_STATUS = new Map()
const noStatus = select => select(NO_STATUS)
const noRetain = (_id, select) => select(undefined)

// Working, waiting or idle: the host's word, with DSH's own when the team passed it.
export function threadState(thread, { running = false, asking = false } = {}) {
  if (asking || thread.status === 'waiting') return 'waiting'
  if (running || thread.status === 'working') return 'working'
  return 'idle'
}

/**
 * One thread under its channel. It opens its Session through the team's row action, the way a
 * Bot's own rows do; on a team without the hook it shows the reason in place and opens nothing,
 * so no conversation view takes a turn the thread cannot act on. A thread with no live key says
 * "Not connected" with its reason, and still opens. `shown` false: its channel is folded, so
 * the row is out of the tab order.
 */
export function ThreadRow({ thread, actions, rowProps = {}, shown = true }) {
  const id = thread.sessionId
  const useStatus = rowProps.useSessionStatus ?? noStatus
  const useRetain = rowProps.useSessionRetainInfo ?? noRetain
  const unread = useStatus(map => map.get(id)?.completionUnread === true)
  const asking = useStatus(map => map.get(id)?.pendingInteraction !== undefined)
  const running = useStatus(map => map.get(id)?.running === true)
  const active = useRetain(id, info => (info?.retainedBy?.mainView ?? 0) > 0)
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState(null)
  const opens = teamReady(rowProps.roster)
  const state = threadState(thread, { running, asking })
  const reason = thread.connected === false || !opens ? hostText(thread.reason ?? t('Not connected')) : null
  const dot = typeof rowProps.useSessionStatus === 'function' && unread && !active
  const label = [thread.title, state === 'waiting' ? t('Waiting for you') : state === 'working' ? t('Working') : '', reason ?? '', dot ? t('Unread activity') : ''].filter(Boolean).join(', ')
  const remove = () => {
    if (!confirming) { setConfirming(true); return }
    setConfirming(false)
    setProblem(null)
    call('omni-thread-remove', { threadId: thread.id }).catch(error => setProblem(error?.message ?? String(error)))
  }
  return h('div', { className: 'ot-thread', 'data-idle': state === 'idle' || undefined },
    h('button', {
      type: 'button', className: 'bt-thread', 'data-state': state, 'data-thread-id': thread.id, 'aria-label': label, title: reason ?? thread.title,
      'aria-current': active ? 'page' : undefined, 'aria-disabled': opens ? undefined : true, tabIndex: shown ? undefined : -1,
      onClick: () => { if (opens) actions.openSession(id) },
    },
    h('span', { className: state === 'waiting' ? 'bt-thread-wait' : state === 'working' ? 'bt-thread-spin' : 'ot-thread-idle', 'aria-hidden': true }),
    h('span', { className: 'bt-thread-title' }, thread.title),
    reason ? h('span', { className: 'ot-thread-reason' }, reason) : null,
    dot ? h('span', { className: 'bt-unread', 'aria-hidden': true }) : null),
    h('button', {
      type: 'button', className: 'ot-thread-remove', 'data-confirm': confirming || undefined,
      'aria-label': confirming ? t('Remove {name} from the sidebar? Click again', { name: thread.title }) : t('Remove {name}', { name: thread.title }),
      title: confirming ? t('Click again to remove') : t('Remove'), tabIndex: shown ? undefined : -1, onClick: remove, onBlur: () => setConfirming(false),
    }, confirming ? t('Remove') : h(CloseIcon)),
    problem ? h('span', { className: 'ot-thread-problem', role: 'alert' }, hostText(problem)) : null)
}

/**
 * A channel's chats to add, searched on the host (omni-thread-chats). `onPick(chat)` adds one
 * and resolves with the host's answer: a refusal (a failed mint among them) shows here, and
 * nothing is added. A chat that is a thread already is marked and cannot be picked again.
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
        type: 'search', className: 'ot-picker-search', value: query, placeholder: t('Search chats'), 'aria-label': t('Search chats'),
        autoFocus: true, onChange: event => setQuery(event.target.value),
      }),
      h('button', { type: 'button', className: 'ot-picker-close', 'aria-label': t('Close'), title: t('Close'), onClick: onClose }, h(CloseIcon))),
    problem ? h('p', { className: 'ot-picker-problem', role: 'alert' }, hostText(problem)) : null,
    list.status === 'loading' ? h('p', { className: 'ot-picker-note' }, t('Loading…')) : null,
    list.status === 'failed' ? h('p', { className: 'ot-picker-problem', role: 'alert' }, hostText(list.error)) : null,
    empty ? h('p', { className: 'ot-picker-note' }, query.trim() ? t('No chats match.') : t('No chats yet')) : null,
    list.chats.length > 0 ? h('div', { className: 'ot-picker-list' },
      list.chats.map(chat => h('button', {
        key: chat.id, type: 'button', className: 'ot-picker-chat', 'data-chat-id': chat.id, disabled: chat.added === true || busy !== null,
        'aria-busy': busy === chat.id || undefined, title: chat.name, onClick: () => { void pick(chat) },
      },
      h('span', { className: 'ot-picker-name' }, chat.name),
      chat.added ? h('span', { className: 'ot-picker-tag' }, t('Added')) : busy === chat.id ? h('span', { className: 'ot-picker-tag' }, t('Adding…')) : null))) : null)
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
  const onPick = chat => addThread(channel.id, chat).then((result) => {
    if (result?.ok === true) closePicker()
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
.ot-plus{display:grid;place-items:center;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:7px;background:none;color:var(--bt-ink-3);cursor:pointer}
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
.ot-thread{position:relative;display:flex;align-items:center;flex-wrap:wrap}
.ot-thread .bt-thread{flex:1;min-width:0}
.ot-thread .bt-thread[aria-disabled=true]{cursor:default}
.ot-thread[data-idle] .bt-thread-title{color:var(--bt-ink-2)}
.ot-thread-idle{flex:none;width:8px;height:8px;margin:0 2px;box-sizing:border-box;border-radius:50%;border:1.5px solid var(--bt-ink-3);opacity:.6}
.ot-thread-reason{flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--bt-ink-3)}
.ot-thread-remove{position:absolute;right:4px;display:grid;place-items:center;min-width:20px;height:20px;padding:0 4px;border:0;border-radius:6px;background:var(--bt-hover);color:var(--bt-ink-3);font:inherit;font-size:11px;cursor:pointer;opacity:0;transition:opacity .12s ease}
.ot-thread-remove svg{width:11px;height:11px}
.ot-thread:hover .ot-thread-remove,.ot-thread-remove:focus-visible,.ot-thread-remove[data-confirm]{opacity:1}
.ot-thread-remove[data-confirm]{color:var(--bt-danger, #dc2626)}
.ot-thread-problem{flex-basis:100%;padding:0 8px 3px 28px;font-size:11px;color:var(--bt-danger, #dc2626)}
.ot-picker{display:grid;gap:4px;margin:2px 0 4px;padding:6px;border:1px solid var(--bt-line, rgba(127,127,127,.2));border-radius:10px;background:var(--bt-surface, transparent)}
.ot-picker-head{display:flex;align-items:center;gap:4px}
.ot-picker-search{flex:1;min-width:0;height:26px;padding:0 8px;border:1px solid var(--bt-line, rgba(127,127,127,.25));border-radius:7px;background:none;color:var(--bt-ink);font:inherit;font-size:12.5px}
.ot-picker-search:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-1px}
.ot-picker-close{display:grid;place-items:center;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:7px;background:none;color:var(--bt-ink-3);cursor:pointer}
.ot-picker-close svg{width:12px;height:12px}
.ot-picker-close:hover{background:var(--bt-hover);color:var(--bt-ink)}
.ot-picker-list{display:grid;gap:1px;max-height:240px;overflow-y:auto}
.ot-picker-chat{display:flex;align-items:center;gap:6px;width:100%;padding:4px 6px;border:0;border-radius:7px;background:none;color:var(--bt-ink);font:inherit;font-size:12.5px;line-height:18px;text-align:left;cursor:pointer}
.ot-picker-chat:hover:not(:disabled){background:var(--bt-hover)}
.ot-picker-chat:disabled{cursor:default;color:var(--bt-ink-3)}
.ot-picker-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ot-picker-tag{flex:none;font-size:11px;color:var(--bt-ink-3)}
.ot-picker-note,.ot-picker-problem{margin:0;padding:2px 6px;font-size:12px;color:var(--bt-ink-3)}
.ot-picker-problem{color:var(--bt-danger, #dc2626)}
.ot-chats[data-open] .ot-thread{animation:ot-in .22s ease both}
@keyframes ot-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.ot-chats{transition:none}.ot-chats .ot-thread{animation:none}.ot-chevron{transition:none}.ot-thread-remove{transition:none}}
body[data-omni-thread] .bt-voice,body[data-omni-thread] .bt-plus,body[data-omni-thread] .bt-composer-model,body[data-omni-thread] .bt-mw-dock,body[data-omni-thread] .bt-btw-dock{display:none!important}
`
