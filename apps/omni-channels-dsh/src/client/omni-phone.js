import { createElement as h, useEffect, useMemo, useState } from 'react'
import { ChatMessages, useStayAtEnd } from './channels.js'
import { POLL_MS } from './omni-store.js'
import { PHONE_FRAME_CSS, PhoneFrame } from './phone-frame.js'
import { call, hostText, t } from './core.js'

// The phone pane: a tab of DSH's right column that shows one thread's chat in a drawn iPhone
// (phone-frame.js), files and Omni's text for them included. It is the owner's own view: it
// reads on the host's link key, polling as the chat view does, and has no composer.
//
// It opens only from the thread, never by itself: a click on the thread's row or a pick in
// the picker, which opens it beside the thread's own Session. On a Bot team without the
// restart hook, where the row opens no Session, the row's click opens it beside the Session
// on screen. The tab carries the thread and its chat
// in its params. DSH keeps a column's tabs over a reload but not their params (it saves the
// layout alone, dsh.sidebar-right.v1), so this page keeps each tab's last params itself, and
// a tab with neither shows the thread whose Session it is in.

export const PHONE_KIND = 'omni-phone'
// The tab type's id, which its body registers under; one pane per thread is that plus the
// thread's id.
export const PHONE_TAB_ID = 'ds-bot/omni-phone'
export const phoneTabId = threadId => `${PHONE_TAB_ID}:${threadId}`
export const phoneTabDefinition = () => ({ id: PHONE_TAB_ID, kind: PHONE_KIND, title: () => t('Phone pane') })
export const phoneParams = thread => ({ threadId: thread.id, chatId: thread.chatId })

const threadsIn = roster => (Array.isArray(roster?.omniThreads) ? roster.omniThreads : [])

/** A thread's name: its chat's (host threads.js chatNameOf), else "Group" or "Chat". */
export const threadName = thread => thread.title || (thread.kind === 'group' ? t('Group') : t('Chat'))

/**
 * The thread a pane shows, from the threads listed now: the one its params name, else the
 * thread of the chat they name (the chat added again since); params that name nothing: the
 * thread whose Session the tab is in. null when none is listed, so a removed thread's chat is
 * not read on, and params naming a removed thread never fall back to another thread.
 */
export function phoneThreadOf(roster, params, sessionId) {
  const threads = threadsIn(roster)
  const pick = (field, value) => (typeof value === 'string' ? threads.find(thread => thread[field] === value) : undefined)
  const named = typeof params?.threadId === 'string' || typeof params?.chatId === 'string'
  return (named ? pick('id', params.threadId) ?? pick('chatId', params.chatId) : pick('sessionId', sessionId)) ?? null
}

// DSH's right column, once its plugin is there: the row, the picker and the thread's own
// dock open the pane in it.
let phoneRight = null
// A thread whose pane is to open once its Session is on screen with its surface there (the
// row's click, the picker's pick). The Session's own dock takes it and opens the pane from
// that render's effects: sidebarRight opens a tab on the Session the seat has adopted, and
// adoption is minted with the render that brings the Session, not when the click asks. A
// click while another Session is on screen therefore leaves the intent, never a timer; the
// oldest goes when it grows past INTENTS_MAX, so clicking rows over and over cannot grow it.
const INTENTS_MAX = 8
const intents = new Map()
const noteIntent = (threadId) => {
  intents.delete(threadId)
  intents.set(threadId, true)
  while (intents.size > INTENTS_MAX) intents.delete(intents.keys().next().value)
}
/** Whether a thread's open is still owed. */
export function hasPhoneIntent(threadId) {
  return intents.has(threadId)
}
/** Takes a thread's pending open, if it has one: true once, false after. */
export function takePhoneIntent(threadId) {
  return intents.delete(threadId)
}

/**
 * Whether `thread`'s Session is on screen with its surface already committed: sidebarRight's
 * `screen()`, whose `bySession` the seat materializes in its own effect — which may run after
 * the thread's dock does. It answers the row's fast path only; the dock opens on `mounted`
 * alone, because `openTab` lands in a Session whose store is adopted even when its surface is
 * not there yet (place() takes `surface === undefined`). A DSH with no `screen()` answers
 * false, so the open is left to the dock and never thrown at click time.
 */
export function phoneSurfaceIs(right, thread) {
  if (typeof right?.screen !== 'function') return false
  const screen = right.screen()
  return screen !== undefined && screen.sessionId === thread.sessionId
}

export function installPhone(ctx, face) {
  const fiber = ctx.inject(['sidebarRight', 'sidebarRightTabs'], (scope) => {
    scope.effect(() => scope.sidebarRightTabs.register(phoneTabDefinition()), 'ds-bot: phone tab type')
    scope.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: PHONE_TAB_ID, inject: face }, PhoneTab)), 'ds-bot: phone tab')
    scope.effect(() => {
      phoneRight = scope.sidebarRight
      return () => {
        phoneRight = null
        intents.clear()
      }
    }, 'ds-bot: the phone pane for the thread rows')
  })
  return () => fiber.dispose()
}

/**
 * Opens the pane on `thread` in the right column, whose Session must be the one on screen
 * with its surface there. Returns null when it opened, else why not. It opens no Session.
 * Called when that surface is not there it changes nothing: requestPhone waits instead.
 */
export function openPhone(thread) {
  const right = phoneRight
  if (!right) return t('The phone pane needs DSH\'s right column.')
  if (typeof right.mounted?.getSnapshot === 'function' && right.mounted.getSnapshot() === undefined) return t('Open a conversation first; the phone pane opens beside it.')
  try {
    right.openTab(PHONE_KIND, { params: phoneParams(thread) })
    return null
  } catch (error) {
    return error?.message ?? String(error)
  }
}

/**
 * Asks for the pane on `thread`: opens it now when its Session is the one on screen with its
 * surface there, else leaves the intent its own Session's dock opens (takePhoneIntent), and
 * returns null. Returns why not when there is no right column or no Session on screen at all.
 */
export function requestPhone(thread) {
  const right = phoneRight
  if (!right) return t('The phone pane needs DSH\'s right column.')
  if (phoneSurfaceIs(right, thread)) return openPhone(thread)
  noteIntent(thread.id)
  return null
}

// The chat's messages from the host, now and every POLL_MS while `on`; a hidden page skips
// its turn. Each poll replaces the list: a message's row, and the file it fetched, stay.
function useChatPoll(chatId, on) {
  const [read, setRead] = useState({ chatId: null, messages: null, error: null })
  useEffect(() => {
    if (!chatId || !on) return undefined
    let stopped = false
    let timer = 0
    const tick = async () => {
      if (typeof document === 'undefined' || !document.hidden) {
        try {
          const reply = await call('omni-messages', { chatId })
          if (!stopped) setRead({ chatId, messages: Array.isArray(reply?.messages) ? reply.messages : [], error: null })
        } catch (error) {
          if (!stopped) setRead(before => ({ chatId, messages: before.chatId === chatId ? before.messages : null, error: error?.message ?? String(error) }))
        }
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [chatId, on])
  return read.chatId === chatId ? read : { chatId, messages: null, error: null }
}

/** One thread's chat in the drawn frame. `visible` false (the tab hidden): it does not poll. */
export function PhonePane({ params, sessionId, useRoster, visible = true }) {
  const thread = useRoster(roster => phoneThreadOf(roster, params, sessionId))
  const read = useChatPoll(thread?.chatId ?? null, visible)
  const messages = read.messages ?? []
  const { scroller, onScroll, onSized } = useStayAtEnd(thread?.chatId, messages.length)
  if (!thread) {
    const named = typeof params?.threadId === 'string' || typeof params?.chatId === 'string'
    return h('div', { className: 'op-pane' }, h('p', { className: 'op-note' }, named ? t('This chat is no longer in the sidebar.') : t('Open the phone pane from a chat in the sidebar.')))
  }
  const loading = read.messages === null && read.error === null
  const name = threadName(thread)
  return h('div', { className: 'op-pane', 'data-thread-id': thread.id },
    h(PhoneFrame, { label: t('{name} on the phone', { name }) },
      h('header', { className: 'op-head' },
        h('strong', null, name),
        thread.connected === false && thread.reason ? h('span', null, hostText(thread.reason)) : null),
      h('div', { ref: scroller, className: 'oc-thread op-log', onScroll, role: 'log', 'aria-label': t('Conversation with {name}', { name }) },
        h('div', { className: 'oc-thread-in' },
          loading ? h('div', { className: 'oc-day' }, h('span', { className: 'oc-spinner', 'aria-hidden': true }), t('Loading messages…')) : null,
          read.error ? h('p', { className: 'op-note', role: 'alert' }, hostText(read.error)) : null,
          read.messages?.length === 0 ? h('p', { className: 'op-note' }, t('No messages yet')) : null,
          h(ChatMessages, { messages, onSized })))))
}

// Each tab's last params on this page, by Session and tab, the newest KEPT_TABS of them.
const KEPT_KEY = 'omni.phone.tabs'
const KEPT_TABS = 50
const readKept = () => {
  try {
    const kept = JSON.parse(localStorage.getItem(KEPT_KEY) ?? '{}')
    return kept !== null && typeof kept === 'object' && !Array.isArray(kept) ? kept : {}
  } catch {
    return {}
  }
}
export const keptParams = where => readKept()[where]
export function keepParams(where, params) {
  const kept = { ...readKept() }
  delete kept[where]
  kept[where] = { threadId: params.threadId, chatId: params.chatId }
  const all = Object.keys(kept)
  for (const old of all.slice(0, Math.max(0, all.length - KEPT_TABS))) delete kept[old]
  try { localStorage.setItem(KEPT_KEY, JSON.stringify(kept)) } catch { /* storage unavailable */ }
}

// The tab's body: the params of its last open (kept here over a reload), and the Session
// whose column it is in.
export function PhoneTab({ useTabInfo, sessionId, useRoster }) {
  const tab = typeof useTabInfo === 'function' ? useTabInfo()?.tab : undefined
  const opened = tab?.navigation?.params
  const where = `${sessionId ?? ''}/${tab?.id ?? ''}`
  const params = useMemo(() => opened ?? keptParams(where), [where, opened])
  useEffect(() => {
    if (opened && typeof opened.threadId === 'string') keepParams(where, opened)
  }, [where, opened])
  return h(PhonePane, { key: phoneTabId(params?.threadId ?? ''), params, sessionId, useRoster, visible: tab?.visible !== false })
}

/**
 * In a thread's own Session: opens the pane its row asked for, from this render's effects.
 * That is where DSH has minted the Session's surface (sidebarRight's own rule: a command acts
 * on the arriving Session from that commit's effects), so no wait and no timer is needed. It
 * draws no control of its own; a pane that could not open says why, in place.
 */
export function PhoneDock({ sessionId, useRoster }) {
  const thread = useRoster(roster => threadsIn(roster).find(item => item.sessionId === sessionId) ?? null)
  const [problem, setProblem] = useState(null)
  const id = thread?.id ?? null
  useEffect(() => {
    if (id === null || !hasPhoneIntent(id)) return
    // This dock renders inside the thread's Session, so DSH has minted and adopted that
    // Session's store in the render that brought it: openTab lands here. Its committed surface
    // may arrive one effect later (the seat's own), which openTab takes as it is.
    const mounted = phoneRight?.mounted
    if (typeof mounted?.getSnapshot === 'function' && mounted.getSnapshot() !== thread.sessionId) return
    takePhoneIntent(id)
    setProblem(openPhone(thread))
  }, [id])
  if (problem === null) return null
  return h('div', { className: 'op-dock' }, h('span', { className: 'op-dock-problem', role: 'alert' }, hostText(problem)))
}

export const OMNI_PHONE_CSS = `${PHONE_FRAME_CSS}
.op-pane{box-sizing:border-box;height:100%;overflow-y:auto;padding:20px 16px}
.op-head{display:flex;flex-direction:column;align-items:center;gap:1px;padding:28px 12px 8px;border-bottom:1px solid var(--bt-line, rgba(127,127,127,.2));text-align:center}
.op-head strong{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}
.op-head span{font-size:11px;color:var(--bt-ink-3)}
.op-screen .oc-thread-in{max-width:none;padding:8px 8px 14px}
.op-screen .oc-msg{max-width:86%}
.op-screen .oc-bubble{padding:6px 10px 5px;border-radius:16px;font-size:13px;line-height:18px}
.op-screen .oc-bubble[data-media]{padding:3px 3px 6px}
.op-screen .oc-bubble[data-media=sticker]{padding:0}
.op-screen .oc-media-img{max-height:220px;border-radius:12px}
.op-screen .oc-media-still,.op-screen .oc-media-wait{width:180px}
.op-screen .oc-media-audio,.op-screen .oc-media-wait-audio{width:190px}
.op-screen .oc-media-sticker,.op-screen .oc-media-wait-sticker{width:110px;height:110px}
.op-screen .oc-media-doc{min-width:0;font-size:12.5px}
.op-note{margin:12px 8px;font-size:12.5px;color:var(--bt-ink-3);text-align:center}
.op-dock{display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:0 4px 4px}
.op-dock-problem{margin:0 8px 4px;font-size:11.5px;color:var(--bt-danger, #dc2626)}
`
