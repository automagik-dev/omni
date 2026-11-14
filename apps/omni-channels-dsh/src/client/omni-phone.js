import { threadReason } from './problem-words.js'
import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { ChatHead, ChatMessages, MessageBar, useOmni, useStayAtEnd } from './channels.js'
import { POLL_MS, channelOf, chatOf } from './omni-store.js'
import { call, hostText, icons, t } from './core.js'

// The chat pane (its ids still say phone): a tab of DSH's right column that shows one thread's
// chat as a chat app's web client does, across the whole pane: the chat's header, its log, and
// the message bar at its foot, drawn by the chat view the chat page draws too (channels.js),
// files and Omni's text for them included. It is the owner's own view: it reads on the host's
// link key, polling as the chat page does. Its header holds the thread's "Always allow send"
// switch (SendSwitch); its foot, staff's own message bar (PhoneComposer, #1715).
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
export const phoneTabDefinition = () => ({ id: PHONE_TAB_ID, kind: PHONE_KIND, title: () => t('Chat') })
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
// click while another Session is on screen therefore leaves the intent; only its dock may
// briefly retry while that Session's store is being adopted. The oldest intent goes when
// it grows past INTENTS_MAX, so clicking rows over and over cannot grow it.
const INTENTS_MAX = 8
const PHONE_WAIT_MS = 500
const PHONE_RETRY_MS = 50
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
const phoneUnavailable = () => t('Open a conversation first; the chat opens beside it.')
const phoneFailure = error => {
  console.warn('Could not open the phone pane:', error)
  return phoneUnavailable()
}

export function openPhone(thread) {
  const right = phoneRight
  if (!right) return t('The chat needs DSH\'s right column.')
  try {
    const snapshot = right.mounted?.getSnapshot?.()
    if (snapshot === undefined || (typeof right.actionsFor === 'function' && right.actionsFor(snapshot) === undefined)) return phoneUnavailable()
    right.openTab(PHONE_KIND, { params: phoneParams(thread) })
    return null
  } catch (error) {
    return phoneFailure(error)
  }
}

/**
 * Asks for the pane on `thread`: opens it now when its Session is the one on screen with its
 * surface there, else leaves the intent its own Session's dock opens (takePhoneIntent), and
 * returns null. Returns why not when there is no right column or no Session on screen at all.
 */
export function requestPhone(thread) {
  const right = phoneRight
  if (!right) return t('The chat needs DSH\'s right column.')
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
          if (!stopped) {
            console.warn('Could not load chat messages:', error)
            setRead(before => ({ chatId, messages: before.chatId === chatId ? before.messages : null, error: t('Could not load messages. Retrying soon.') }))
          }
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

/**
 * Whether a thread's sends go without a card now, as its view says (host threads.js
 * permissionsOf); an answer child's, whether it is in sending mode (RFC-0001).
 */
export const sendsAllowed = thread => (thread?.answerChild === true ? thread.sendingMode === 'sending' : thread?.permissions?.sends === 'allow')

/**
 * The thread's "Always allow send" switch, an icon action in the chat's header: on (tinted),
 * its sends into this chat go without a card; off, each asks on DSH's card. It sets only this
 * thread's own choice (omni-thread-permissions; an answer child's sending mode,
 * set_child_sending), and shows the new state on the team's next roster pull; until then it
 * shows the one asked for. A failed change says so under the header.
 */
export function SendSwitch({ thread }) {
  const on = sendsAllowed(thread)
  const [wanted, setWanted] = useState(null)
  const [problem, setProblem] = useState(null)
  useEffect(() => { setWanted(null) }, [on])
  const shown = wanted ?? on
  const flip = () => {
    const next = !shown
    setWanted(next)
    setProblem(null)
    // An answer child's switch is its sending mode, the same staff action as its sidebar menu.
    const [endpoint, body] = thread.answerChild === true
      ? ['set_child_sending', { threadId: thread.id, mode: next ? 'sending' : 'training' }]
      : ['omni-thread-permissions', { threadId: thread.id, sends: next ? 'allow' : 'ask' }]
    call(endpoint, body).catch((error) => {
      console.warn('Could not change the chat settings:', error)
      setWanted(null)
      setProblem(t('Could not change this chat\'s settings. Try again.'))
    })
  }
  return h('div', { className: 'op-send' },
    h('button', {
      type: 'button', role: 'switch', 'aria-checked': shown, 'aria-label': t('Always allow send'), className: 'oc-icon-act op-switch', 'data-thread-id': thread.id,
      title: shown ? t('Sends into this chat go without asking you') : t('Each send into this chat asks you first'), onClick: flip,
    }, h(icons.ArrowUpIcon)),
    problem ? h('span', { className: 'op-send-problem', role: 'alert' }, hostText(problem)) : null)
}

/**
 * #1715: the pane's composer, on the chat view's message bar (channels.js MessageBar). Staff's
 * own text goes from the thread's channel straight to its chat (host omni-phone-send): never
 * through the thread's model, a tool or a card, and it shows above on the next poll. Enter
 * sends, Shift+Enter adds a line, and the bar waits while one is being sent; a failed one says
 * why and keeps the text, and nothing is sent again until staff send it. An answer child's
 * draft waiting on its card shows over the bar with Edit, which puts its text in the field:
 * sent from here it goes out as typed and counts as edited. DSH lets no plugin answer that
 * card, so the pane then asks staff to reject it there.
 */
// The longest message the host sends (omni-phone-send).
export const PHONE_TEXT_MAX = 4096
export function PhoneComposer({ thread }) {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(null)
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState(null)
  // Two Enters before the box re-renders as waiting still send once.
  const busy = useRef(false)
  const box = useRef(null)
  const draft = thread.waitingDraft ?? null
  const send = async () => {
    const message = text.trim()
    if (busy.current || message === '') return
    busy.current = true
    setSending(true)
    setProblem(null)
    try {
      await call('omni-phone-send', { threadId: thread.id, text: message, ...(editing === null ? {} : { draftId: editing }) })
      setText('')
      setEditing(null)
    } catch (error) {
      console.warn('Could not send the message:', error)
      setProblem(typeof error?.message === 'string' && error.message !== '' ? error.message : 'Could not send this message. Check your connection and access, then try again.')
    } finally {
      busy.current = false
      setSending(false)
    }
  }
  const edit = () => {
    setText(draft.text)
    setEditing(draft.id)
    setProblem(null)
    box.current?.focus?.()
  }
  const editingDraft = draft !== null && editing === draft.id
  return h(MessageBar, {
    className: 'op-compose', value: text, sending, maxLength: PHONE_TEXT_MAX, placeholder: t('Write your own message'), label: t('Your message'), boxRef: box,
    // An emptied field lets the draft go back to waiting on its card.
    onChange: (next) => {
      setText(next)
      if (next === '') setEditing(null)
    },
    onSend: () => { void send() },
  },
  draft && draft.replaced !== true && !editingDraft ? h('div', { className: 'op-draft', 'data-draft-id': draft.id },
    h('div', { className: 'op-draft-head' },
      h('span', null, t('The bot\'s draft, waiting on its card')),
      h('button', { type: 'button', className: 'op-draft-edit', disabled: sending, onClick: edit }, h(icons.PencilIcon), t('Edit'))),
    h('p', { className: 'op-draft-text' }, draft.text)) : null,
  editingDraft && draft.replaced !== true ? h('p', { className: 'op-edit-note', role: 'status' }, h(icons.PencilIcon), t('Editing the bot\'s draft')) : null,
  draft?.replaced === true ? h('p', { className: 'op-compose-note', role: 'status' }, t('Reject the bot\'s draft on its card')) : null,
  problem ? h('p', { className: 'op-compose-note op-compose-fail', role: 'alert' }, t('Not sent: {reason}', { reason: hostText(problem) })) : null)
}

/**
 * One thread's chat across the whole pane: its header (the chat's photo or initials, its name,
 * the channel's name, or why the thread cannot reach it, and the thread's send switch), its log
 * and the message bar. `visible` false (the tab hidden): it does not poll. The chat's photo and
 * its channel's name come from the overview the sidebar already reads; nothing more is asked.
 */
export function PhonePane({ params, sessionId, useRoster, visible = true }) {
  const thread = useRoster(roster => phoneThreadOf(roster, params, sessionId))
  const read = useChatPoll(thread?.chatId ?? null, visible)
  const overview = useOmni()
  const messages = read.messages ?? []
  const { scroller, onScroll, onSized } = useStayAtEnd(thread?.chatId, messages.length)
  if (!thread) {
    const named = typeof params?.threadId === 'string' || typeof params?.chatId === 'string'
    return h('div', { className: 'op-pane' }, h('p', { className: 'op-note' }, named ? t('This chat is no longer in the sidebar.') : t('Open a chat from the sidebar to see it here.')))
  }
  const loading = read.messages === null && read.error === null
  const name = threadName(thread)
  const cut = thread.connected === false && Boolean(thread.reason)
  return h('div', { className: 'op-pane', 'data-thread-id': thread.id, role: 'region', 'aria-label': t('Chat with {name}', { name }) },
    h(ChatHead, { className: 'op-head', chat: chatOf(overview, thread.chatId), name, status: cut ? threadReason(thread) : channelOf(overview, thread.channelId)?.name ?? null, off: cut },
      h(SendSwitch, { thread })),
    h('div', { ref: scroller, className: 'oc-thread op-log', onScroll, role: 'log', 'aria-label': t('Conversation with {name}', { name }) },
      h('div', { className: 'oc-thread-in' },
        loading ? h('div', { className: 'oc-day' }, h('span', { className: 'oc-spinner', 'aria-hidden': true }), t('Loading messages…')) : null,
        read.error ? h('p', { className: 'op-note', role: 'alert' }, hostText(read.error)) : null,
        read.messages?.length === 0 ? h('p', { className: 'op-note' }, t('No messages yet')) : null,
        h(ChatMessages, { messages, onSized }))),
    h(PhoneComposer, { thread }))
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
 * A mounted Session can briefly have no adopted store, including just after adoption was
 * released. When DSH exposes actionsFor, retry that gap here for at most PHONE_WAIT_MS;
 * otherwise let openTab try and map its failure. It draws no control; a failed pane says why.
 */
export function PhoneDock({ sessionId, useRoster }) {
  const thread = useRoster(roster => threadsIn(roster).find(item => item.sessionId === sessionId) ?? null)
  const [problem, setProblem] = useState(null)
  const id = thread?.id ?? null
  useEffect(() => {
    if (id === null || !hasPhoneIntent(id)) return
    const right = phoneRight
    let timer
    let stopped = false
    let waited = 0
    const attempt = () => {
      if (stopped || phoneRight !== right || !hasPhoneIntent(id)) return
      try {
        const snapshot = right?.mounted?.getSnapshot?.()
        // Never open this thread's pane in a Session the owner navigated to during the wait.
        if (snapshot !== thread.sessionId) return
        if (typeof right.actionsFor === 'function' && right.actionsFor(snapshot) === undefined && waited < PHONE_WAIT_MS) {
          waited += PHONE_RETRY_MS
          timer = setTimeout(attempt, PHONE_RETRY_MS)
          return
        }
        takePhoneIntent(id)
        setProblem(openPhone(thread))
      } catch (error) {
        takePhoneIntent(id)
        setProblem(phoneFailure(error))
      }
    }
    attempt()
    return () => { stopped = true; clearTimeout(timer) }
  }, [id])
  if (problem === null) return null
  return h('div', { className: 'op-dock' }, h('span', { className: 'op-dock-problem', role: 'alert' }, hostText(problem)))
}

// The pane's own rules; the header, log, bubbles and bar are the chat view's (CHANNELS_CSS).
export const OMNI_PHONE_CSS = `
.op-pane{box-sizing:border-box;flex:1 1 auto;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--bt-main);color:var(--bt-ink);font-family:var(--bt-font)}
.op-pane .oc-chat-head{padding:8px 8px 8px 12px;min-height:58px}
.op-pane .oc-thread-in{max-width:none;padding:8px 14px 14px}
.op-pane .oc-bar-wrap{padding:8px 10px 10px}
.op-send{display:contents}
.op-send-problem{position:absolute;top:calc(100% + 6px);left:12px;right:12px;z-index:2;padding:6px 10px;border-radius:10px;background:var(--bt-card);box-shadow:0 6px 18px -8px var(--oc-shade);font-size:12px;line-height:16px;color:var(--bt-danger)}
.op-note{margin:12px 8px;font-size:12.5px;color:var(--bt-ink-3);text-align:center}
.op-pane>.op-note{margin:auto 16px}
.op-dock{display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:0 4px 4px}
.op-dock-problem{margin:0 8px 4px;font-size:11.5px;color:var(--bt-danger)}
.op-draft{display:flex;flex-direction:column;gap:4px;padding:8px 10px 9px 12px;border-left:3px solid var(--bt-accent);border-radius:10px;background:color-mix(in srgb,var(--bt-accent) 7%,var(--bt-card))}
.op-draft-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;line-height:16px;font-weight:600;color:var(--bt-accent)}
.op-draft-head span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.op-draft-edit{flex:none;display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px 0 8px;border:1px solid var(--bt-line-2);border-radius:999px;background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:12px;font-weight:500;cursor:pointer}
.op-draft-edit svg{width:13px;height:13px}
.op-draft-edit:hover:not(:disabled){background:var(--bt-hover)}
.op-draft-edit:disabled{opacity:.5;cursor:default}
.op-draft-text{margin:0;max-height:76px;overflow-y:auto;font-size:13px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--bt-ink-2)}
.op-edit-note{display:flex;align-items:center;gap:6px;margin:0;padding:0 4px;font-size:12px;line-height:16px;font-weight:600;color:var(--bt-accent)}
.op-edit-note svg{width:13px;height:13px}
.op-compose-note{margin:0;padding:7px 10px;border-radius:10px;background:var(--bt-hover);font-size:12.5px;line-height:17px;color:var(--bt-ink-2);overflow-wrap:anywhere}
.op-compose-fail{color:color-mix(in srgb,var(--bt-danger) 80%,var(--bt-ink));background:color-mix(in srgb,var(--bt-danger) 10%,transparent)}
`
