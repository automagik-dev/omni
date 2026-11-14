import { threadReason } from './problem-words.js'
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
// Only these codes can select owner-facing guidance. Never interpolate a host diagnostic.
const ADD_REASONS = Object.freeze({
  chat_keys_unavailable: 'Omni cannot make chat keys; update it.',
  chat_key_limit: 'This app holds as many chat keys as Omni allows.',
  omni_unreachable: 'Could not reach Omni. Try again in a moment.',
  not_linked: 'Not connected: this app is not linked to an Omni.',
  other_omni: 'Not connected: this app is linked to another Omni.',
  needs_newer_team: 'Adding a chat needs a newer Bot team.',
  already_thread: 'This chat is a thread already.',
  read_only: 'This host is read-only. Add the chat from the host that owns the team.',
})
const addReason = code => typeof code === 'string' && Object.hasOwn(ADD_REASONS, code) ? t(ADD_REASONS[code]) : t('The chat was not added.')

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
  // An answer child shows its sending mode by name instead (answerModeOf).
  if (thread?.answerChild === true) return null
  const sends = thread?.permissions?.sends === 'allow'
  const any = thread?.permissions?.reactions === 'any'
  if (sends && any) return t('Sends messages and any reaction without asking you')
  if (sends) return t('Sends messages without asking you')
  if (any) return t('Reacts with any emoji without asking you')
  return null
}

/**
 * An answer child's sending mode as the sidebar names it (host threads.js sendingModeOf), with
 * its graduation progress while it trains and staff turned graduation on; null for any other
 * thread.
 */
export function answerModeOf(thread) {
  if (thread?.answerChild !== true) return null
  const mode = thread.sendingMode === 'sending' ? 'sending' : 'training'
  const after = Number.isInteger(thread.graduateAfter) && thread.graduateAfter > 0 ? thread.graduateAfter : null
  const streak = Math.max(0, Math.min(Number(thread.approvedStreak) || 0, after ?? Infinity))
  return {
    mode,
    label: mode === 'sending' ? 'Sending' : 'Training',
    title: mode === 'sending' ? 'Sends in its chat without asking you' : 'Asks you before each send',
    progress: mode === 'training' && after !== null ? `${streak} of ${after} approved drafts in a row. At ${after} it switches to sending.` : null,
  }
}

// Time left in plain words: whole minutes under an hour, then hours and minutes.
const leftOf = (ms) => {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return `${minutes} min left`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours} h left` : `${hours} h ${minutes % 60} min left`
}

/**
 * An answer child staff took over (host threads.js pausedUntilOf): it reads its chat but sends
 * nothing until staff resume it, or until `pausedUntil` passes with no newer staff message. Its
 * time left at `now`, in plain words; null for any thread that is not paused.
 */
export function pauseOf(thread, now = Date.now()) {
  if (thread?.answerChild !== true || thread.paused !== true) return null
  const until = Number.isFinite(thread.pausedUntil) ? thread.pausedUntil : null
  return {
    label: 'Paused',
    left: until === null ? 'until you resume it' : until <= now ? 'resuming…' : leftOf(until - now),
    title: until === null ? 'Staff are answering this chat. It answers again when you resume it.' : 'Staff are answering this chat. It answers again when you resume it, or by itself once staff stay quiet there long enough.',
  }
}

/**
 * An answer child that told the team its person needs someone (host needs-staff.js): the badge,
 * the child's one-line reason, and the line's tooltip; null for any other thread. It stays until
 * staff answer in that chat or dismiss it here.
 */
export function needsStaffOf(thread) {
  if (thread?.answerChild !== true || typeof thread.needsStaff?.reason !== 'string') return null
  return { label: 'Needs a person', reason: thread.needsStaff.reason, title: `Needs a person from the team: ${thread.needsStaff.reason}` }
}

// The clock a paused row counts down by: it ticks only while the row shows a countdown.
function useNow(on) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return undefined
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [on])
  return now
}

/**
 * The thread's menu: for its messages and its reactions, follow the default (null) or its own
 * choice, the one in force checked. Each item is what `omni-thread-permissions` is sent.
 */
export function permissionMenuOf(thread) {
  if (thread?.answerChild === true) {
    const mode = answerModeOf(thread).mode
    const item = (value, label) => ({ field: 'sendingMode', value, label, checked: mode === value })
    return [{ field: 'sendingMode', label: 'Sending', items: [item('training', 'Training: ask before each send'), item('sending', 'Sending: send without asking')] }]
  }
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
  const [deleting, setDeleting] = useState(null)
  const [problem, setProblem] = useState(null)
  const [menu, setMenu] = useState(false)
  const [whyOpen, setWhyOpen] = useState(false)
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
  const answer = answerModeOf(thread)
  const now = useNow(thread.answerChild === true && thread.paused === true)
  const pause = pauseOf(thread, now)
  const need = needsStaffOf(thread)
  const state = threadState(thread, { running, asking })
  const reason = thread.connected === false || !opens ? threadReason(opens ? thread : { ...thread, reasonCode: 'needs_newer_team' }) : null
  const dot = typeof rowProps.useSessionStatus === 'function' && unread && !active
  const label = [name, state === 'waiting' ? t('Waiting for you') : state === 'working' ? t('Working') : '', reason ?? '', free ?? '', answer ? `${answer.label}: ${answer.title}` : '', need ? `${need.label}: ${need.reason}` : '', pause ? `${pause.label}, ${pause.left}` : '', dot ? t('Unread activity') : ''].filter(Boolean).join(', ')
  const menuLabel = answer ? `Sending mode in ${name}` : t('Asking first in {name}', { name })
  const onClick = () => {
    if (opens) {
      openThread(thread, actions, setProblem)
      return
    }
    // Only a reason is shown: an opened pane leaves a remove error where it is.
    const why = openPhone(thread)
    if (why !== null) setProblem(why)
  }
  const remove = (automationChoice) => {
    if (!confirming && typeof automationChoice !== 'string') { setConfirming(true); return }
    setConfirming(false)
    setProblem(null)
    call('omni-thread-remove', { threadId: thread.id, ...(typeof automationChoice === 'string' ? { automations: automationChoice } : {}) }).then(result => {
      if (result?.needsChoice) setDeleting(result.automations)
      else setDeleting(null)
    }).catch(error => {
      console.warn('Could not remove the chat:', error)
      setProblem(t('Could not remove this chat. Try again.'))
    })
  }
  // The owner's choice for this thread; the row shows it on the team's next roster pull. An
  // answer child's sending mode is a staff action of its own (set_child_sending).
  const choose = (choice) => {
    setMenu(false)
    setProblem(null)
    const [endpoint, body] = choice.field === 'sendingMode'
      ? ['set_child_sending', { threadId: thread.id, mode: choice.value }]
      : ['omni-thread-permissions', { threadId: thread.id, [choice.field]: choice.value }]
    call(endpoint, body).catch(error => {
      console.warn('Could not change the chat settings:', error)
      setProblem(t('Could not change this chat\'s settings. Try again.'))
    })
  }
  // Staff's own resume (host threads.js resume_answer_child); the row follows on the next pull.
  const resume = () => {
    setProblem(null)
    call('resume_answer_child', { threadId: thread.id }).catch(error => {
      console.warn('Could not resume the chat:', error)
      setProblem('Could not resume this chat. Try again.')
    })
  }
  // Staff's own dismiss (host needs-staff.js dismiss_needs_staff); the row follows on the next pull.
  const dismiss = () => {
    setProblem(null)
    call('dismiss_needs_staff', { threadId: thread.id }).catch(error => {
      console.warn('Could not dismiss:', error)
      setProblem('Could not dismiss this. Try again.')
    })
  }
  const onMenuKey = (event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    setMenu(false)
  }
  return h('div', { ref: row, className: 'ot-thread', 'data-idle': state === 'idle' || undefined, 'data-answer': answer ? true : undefined, 'data-paused': pause ? true : undefined, 'data-needs': need ? true : undefined },
    h('button', {
      type: 'button', className: 'bt-thread', 'data-state': state, 'data-thread-id': thread.id, 'aria-label': label, title: reason ?? name,
      'aria-current': active ? 'page' : undefined, tabIndex: shown ? undefined : -1, onClick,
    },
    h('span', { className: state === 'waiting' ? 'bt-thread-wait' : state === 'working' ? 'bt-thread-spin' : 'ot-thread-idle', 'aria-hidden': true }),
    h('span', { className: 'bt-thread-title' }, name),
    answer && !pause ? h('span', { className: 'ot-mode', 'data-mode': answer.mode, title: answer.title, 'aria-hidden': true }, answer.label) : null,
    reason ? h('span', { className: 'ot-thread-reason' }, reason) : null,
    free ? h('span', { className: 'ot-thread-free', title: free, 'aria-hidden': true }, h(SparkIcon)) : null,
    dot ? h('span', { className: 'bt-unread', 'aria-hidden': true }) : null),
    h('span', { className: 'ot-thread-acts', 'data-on': confirming || menu || undefined },
      confirming ? null : h('button', {
        type: 'button', className: 'ot-thread-more', 'aria-label': menuLabel, title: answer ? 'Sending mode' : t('Asking first'),
        'aria-haspopup': 'menu', 'aria-expanded': menu, tabIndex: shown ? undefined : -1, onClick: () => setMenu(open => !open),
      }, h(DotsIcon)),
      h('button', {
        type: 'button', className: 'ot-thread-remove', 'data-confirm': confirming || undefined,
        'aria-label': confirming ? t('Remove {name} from the sidebar? Click again', { name }) : t('Remove {name}', { name }),
        title: confirming ? t('Click again to remove') : t('Remove'), tabIndex: shown ? undefined : -1, onClick: remove, onBlur: () => setConfirming(false),
      }, confirming ? t('Remove') : h(CloseIcon))),
    // Needs a person: its own line under the name, at every width: the badge and Dismiss, then
    // the child's reason, cut to one line until it is opened; the whole reason is the tooltip.
    need ? h('div', { className: 'ot-needs', title: need.title },
      h('span', { className: 'ot-mode', 'data-mode': 'needs', 'aria-hidden': true }, need.label),
      h('button', {
        type: 'button', className: 'ot-needs-why', 'aria-expanded': whyOpen, 'aria-label': `Why ${name} needs a person: ${need.reason}`,
        tabIndex: shown ? undefined : -1, onClick: () => setWhyOpen(open => !open),
      }, need.reason),
      h('button', {
        type: 'button', className: 'bt-soft bt-soft-sm ot-dismiss', 'aria-label': `Dismiss: ${name} needs a person`, title: 'Someone from the team has it',
        tabIndex: shown ? undefined : -1, onClick: dismiss,
      }, 'Dismiss')) : null,
    // Paused: its own line under the name, at every width, with the time left and Resume.
    pause ? h('div', { className: 'ot-paused', title: pause.title },
      h('span', { className: 'ot-mode', 'data-mode': 'paused', 'aria-hidden': true }, pause.label),
      h('span', { className: 'ot-paused-left', 'aria-hidden': true }, pause.left),
      h('button', {
        type: 'button', className: 'bt-soft bt-soft-sm ot-resume', 'aria-label': `Resume answering in ${name}`, title: 'Let it answer this chat again',
        tabIndex: shown ? undefined : -1, onClick: resume,
      }, 'Resume')) : null,
    menu ? h('div', { className: 'ot-thread-menu', role: 'menu', 'aria-label': menuLabel, onKeyDown: onMenuKey },
      permissionMenuOf(thread).map(group => h('div', { key: group.field, className: 'ot-thread-menu-group', role: 'group', 'aria-label': group.label },
        h('span', { className: 'ot-thread-menu-head' }, group.label),
        group.items.map(choice => h('button', {
          key: String(choice.value), type: 'button', role: 'menuitemradio', className: 'ot-thread-menu-item', 'aria-checked': choice.checked,
          'data-field': choice.field, 'data-value': choice.value ?? 'default', onClick: () => choose(choice),
        }, choice.label)))),
      answer?.progress ? h('span', { className: 'ot-thread-menu-note' }, answer.progress) : null) : null,
    (thread.automations?.length ?? 0) > 0 ? h('ul', { className: 'ot-thread-automations', 'aria-label': 'Automations' },
      thread.automations.map(automation => h('li', { key: automation.id }, automation.name))) : null,
    deleting ? h('div', { className: 'ot-thread-menu', role: 'group', 'aria-label': 'What should happen to these automations?' },
      h('p', null, `What should happen to: ${deleting.map(automation => automation.name).join(', ')}?`),
      ...[['keep', 'Keep automations'], ['pause', 'Pause automations'], ['delete', 'Delete automations']].map(([choice, label]) => h('button', {
        key: choice, type: 'button', onClick: () => { void remove(choice) },
      }, label)),
      h('button', { type: 'button', onClick: () => setDeleting(null) }, 'Cancel')) : null,
    problem ? h('span', { className: 'ot-thread-problem', role: 'alert' }, hostText(problem)) : null)
}

/**
 * One chat in the picker, drawn as the chat list draws it: its picture (or initials), name and
 * time, a direct chat's number when its name is not that number, and its last message. A
 * chat with no name is called "Group" or "Chat". Its button is named by the chat's name, number and
 * whether it is added, not by every word in the row.
 */
function PickerChat({ chat, busy, selected, onPick }) {
  const name = chat.name ?? (chat.kind === 'group' ? t('Group') : t('Chat'))
  const tag = chat.added ? t('Added') : busy === chat.id ? t('Adding…') : null
  return h('button', {
    type: 'button', className: 'ot-picker-chat', 'data-chat-id': chat.id, disabled: chat.added === true || busy !== null,
    'aria-pressed': selected, 'aria-busy': busy === chat.id || undefined, 'aria-label': [name, chat.number, tag].filter(Boolean).join(', '),
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
 * failed mint among them) shows here, and nothing is added. Chats that already have sidebar
 * threads stay out of the picker, including search results.
 */
export function ThreadPicker({ channel, channels = [channel], onPick, onClose }) {
  const [query, setQuery] = useState('')
  const [channelId, setChannelId] = useState(channel.id)
  const [selected, setSelected] = useState([])
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
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
    const load = () => call('omni-thread-chats', words ? { channelId, query: words } : { channelId }).then(
      (reply) => { if (alive.current && asked.current === ticket) setList({ status: 'ready', chats: Array.isArray(reply?.chats) ? reply.chats : [], error: null }) },
      (error) => {
        if (alive.current && asked.current === ticket) {
          console.warn('Could not load chats:', error)
          setList({ status: 'failed', chats: [], error: t('Could not load chats. Try again.') })
        }
      },
    )
    if (words === '') {
      void load()
      return undefined
    }
    const timer = setTimeout(load, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [channelId, words])
  const toggle = (chat) => {
    setSelected(before => before.some(item => item.chatId === chat.id) ? before.filter(item => item.chatId !== chat.id) : [...before, { channelId, chatId: chat.id, name: chat.name }])
  }
  const pick = async () => {
    if (selected.length === 0 || !title.trim()) return
    const chat = { id: 'saving' }
    if (busy !== null || chat.added) return
    setBusy(chat.id)
    setProblem(null)
    try {
      const result = await onPick({ chats: selected.map(({ channelId, chatId }) => ({ channelId, chatId })), title: title.trim(), notes })
      if (alive.current && result?.ok !== true) {
        console.warn('Could not add the chat:', result?.reason)
        setProblem(addReason(result?.reasonCode))
      }
    } catch (error) {
      if (alive.current) {
        console.warn('Could not add the chat:', error)
        setProblem(addReason(error?.code === 'bot/read-only' ? 'read_only' : undefined))
      }
    } finally {
      if (alive.current) setBusy(null)
    }
  }
  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onClose()
  }
  const availableChats = list.chats.filter(chat => chat.added !== true)
  const empty = list.status === 'ready' && availableChats.length === 0
  const emptyText = list.chats.length > 0 ? t('No chats to add here. Search for another chat.') : words ? t('No chats match.') : t('No chats yet')
  return h('div', { className: 'ot-picker', role: 'group', 'aria-label': t('Add a chat from {name}', { name: channel.name }), onKeyDown },
    h('select', { 'aria-label': 'Channel', value: channelId, disabled: busy !== null, onChange: event => { setChannelId(event.target.value); setQuery('') } },
      channels.map(item => h('option', { key: item.id, value: item.id }, item.name))),
    h('div', { className: 'ot-picker-head' },
      h('input', {
        type: 'search', className: 'ot-picker-search', value: query, placeholder: t('Search chats or numbers'), 'aria-label': t('Search chats or numbers'),
        autoFocus: true, onChange: event => setQuery(event.target.value),
      }),
      h('button', { type: 'button', className: 'ot-picker-close', 'aria-label': t('Close'), title: t('Close'), onClick: onClose }, h(CloseIcon))),
    problem ? h('p', { className: 'ot-picker-problem', role: 'alert' }, hostText(problem)) : null,
    list.status === 'loading' ? h('p', { className: 'ot-picker-note' }, t('Loading…')) : null,
    list.status === 'failed' ? h('p', { className: 'ot-picker-problem', role: 'alert' }, hostText(list.error)) : null,
    empty ? h('p', { className: 'ot-picker-note' }, emptyText) : null,
    availableChats.length > 0 ? h('div', { className: 'ot-picker-list' },
      availableChats.map(chat => h(PickerChat, { key: chat.id, chat, busy, selected: selected.some(item => item.chatId === chat.id), onPick: toggle }))) : null,
    h('p', { className: 'ot-picker-selected' }, selected.map(item => item.name ?? item.chatId).join(', ')),
    h('input', { 'aria-label': 'Thread title', placeholder: 'Thread title', value: title, maxLength: 80, onChange: event => setTitle(event.target.value) }),
    h('textarea', { 'aria-label': 'Thread notes', placeholder: 'Thread notes', value: notes, maxLength: 8000, onChange: event => setNotes(event.target.value) }),
    h('button', { type: 'button', disabled: busy !== null || selected.length === 0 || !title.trim(), onClick: () => { void pick() } }, 'Create thread'))
}

// The host adds the chat; the row shows on the team's next roster pull.
const addThread = payload => call('omni-thread-add', payload)

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
  const onPick = payload => addThread(payload).then((result) => {
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
        picking && plus.offered ? h(ThreadPicker, { channel, channels: state.channels, onPick, onClose: closePicker }) : null,
        !plus.offered && plus.reason ? h('span', { className: 'ot-empty' }, hostText(plus.reason)) : null,
        threads.map(thread => h(ThreadRow, { key: rowKey(thread, rowProps), thread, actions, rowProps, shown: open })),
        h('button', { type: 'button', className: 'ot-chat ot-all', tabIndex: open ? undefined : -1, onClick: () => omni.openChannels('channel', channel.id) },
          hasChats ? t('All chats') : t('Channel health')))))
}

// Sidebar clicks are owner actions. The same proposal/confirmation endpoints serve
// this form and proposals made by the default bot; confirmation is a separate click.
export function ChannelBotForm({ channels, roster, onClose }) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState([])
  const [local, setLocal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const pending = local ? [local] : roster.omniBotProposals ?? []
  const act = async (endpoint, body, after) => {
    setBusy(true); setProblem(null)
    try { const value = await call(endpoint, body); after(value) } catch (error) { setProblem(error.message) } finally { setBusy(false) }
  }
  return h('div', { className: 'ot-picker', role: 'group', 'aria-label': 'Dedicated channel bot' },
    problem ? h('p', { role: 'alert' }, hostText(problem)) : null,
    pending.map(proposal => h('div', { key: proposal.proposalId },
      h('p', null, `Create ${proposal.name} and hand over: ${proposal.channelIds.map(id => channels.find(channel => channel.id === id)?.name ?? id).join(', ')}? The default bot will only read these channels.`),
      h('button', { type: 'button', disabled: busy, onClick: () => act('confirm_answer_bot', { proposalId: proposal.proposalId }, () => { setLocal(null); onClose() }) }, 'Confirm hand-over'),
      h('button', { type: 'button', disabled: busy, onClick: () => act('cancel_answer_bot', { proposalId: proposal.proposalId }, () => { setLocal(null); onClose() }) }, 'Cancel proposal'))),
    h('input', { 'aria-label': 'Bot name', value: name, maxLength: 40, onChange: event => setName(event.target.value) }),
    channels.map(channel => h('label', { key: channel.id },
      h('input', { type: 'checkbox', checked: selected.includes(channel.id), onChange: event => setSelected(before => event.target.checked ? [...before, channel.id] : before.filter(id => id !== channel.id)) }), channel.name)),
    h('button', { type: 'button', disabled: busy || !name.trim() || !selected.length, onClick: () => act('propose_answer_bot', { name, channelIds: selected }, value => setLocal({ ...value, name, channelIds: selected })) }, 'Review hand-over'),
    h('button', { type: 'button', disabled: busy, onClick: onClose }, 'Close'))
}

// Short choice names, so a narrow sidebar never cuts a select; the note under it says what the choice does.
const VISIBILITY = {
  isolated: ['Isolated', 'Each child sees only its own chat.'],
  collective: ['Collective', 'Each child also reads this bot’s other chats and the shared notes.'],
}
const NEW_CHILD_MODES = {
  training: ['Training', 'A new child asks you before each send.'],
  sending: ['Sending', 'A new child sends without asking.'],
}
// A paused child's quiet interval in whole minutes, as the settings field shows it.
const RESUME_MINUTES_DEFAULT = 30
const RESUME_MINUTES_MAX = 24 * 60
const minutesOf = ms => String(Number.isInteger(ms) && ms >= 60_000 ? Math.round(ms / 60_000) : RESUME_MINUTES_DEFAULT)
// The read-only tools staff may add, in plain words. The tool's own name is the row's tooltip.
const ANSWER_TOOLS = [['read', 'Read files'], ['read_image', 'Read images'], ['glob', 'Find files by name'], ['grep', 'Search inside files']]
// The host's SHARED_NOTES_MAX (src/host/threads.js, which the browser cannot load); a test keeps them equal.
const SHARED_NOTES_MAX = 32000
// The host's STRANGER_REPLY_MAX (src/host/threads.js).
const STRANGER_REPLY_MAX = 1000

// The Bot team's switch (bt-switch) in a row that is not a label, as the team draws its own: a
// click on the words must not flip it twice. The switch is named by the words.
function SwitchRow({ label, title, on, onChange }) {
  return h('div', { className: 'ot-answer-switch', title },
    h('span', null, label),
    h('button', { type: 'button', role: 'switch', className: 'bt-switch', 'aria-checked': on, 'aria-label': label, onClick: () => onChange(!on) },
      h('span', { className: 'bt-switch-knob', 'aria-hidden': true })))
}

// A team field: its label holds the control; the note under it stays out of the control's name.
function Field({ label, note, children }) {
  return h('div', { className: 'bt-field ot-answer-field' },
    h('label', { className: 'ot-answer-label' }, h('span', { className: 'bt-field-label' }, label), children),
    note ? h('span', { className: 'bt-note' }, note) : null)
}

// The chats staff may name for "needs a person" (host needs-staff.js): the bot's channels' chats,
// none an answer child answers (the host refuses those too), and the one named now.
function staffChatOptions(chats, threads, chosen, several) {
  const answered = new Set(threads.filter(thread => thread.answerChild === true).flatMap(thread => thread.chatIds ?? [thread.chatId]))
  const options = chats.filter(chat => !answered.has(chat.id)).map(chat => ({ id: chat.id, label: several ? `${chat.name ?? chat.id} · ${chat.channel}` : chat.name ?? chat.id }))
  return chosen && !options.some(option => option.id === chosen) ? [{ id: chosen, label: 'The chosen chat' }, ...options] : options
}

// #1713: the people who wrote, were not let in and got the reply (host answer-strangers.js), newest
// first; read-only, read when staff open them.
function StrangerRequests({ botId }) {
  const [shown, setShown] = useState(false)
  const [requests, setRequests] = useState(null)
  const [problem, setProblem] = useState(null)
  useEffect(() => {
    if (!shown) return undefined
    let alive = true
    setProblem(null)
    call('omni-answer-requests', { botId }).then(
      reply => { if (alive) setRequests(Array.isArray(reply?.requests) ? reply.requests : []) },
      (error) => { if (alive) setProblem(error.message) },
    )
    return () => { alive = false }
  }, [shown, botId])
  const messages = count => `${count} ${count === 1 ? 'message' : 'messages'}`
  return h('div', { className: 'ot-answer-requests', role: 'group', 'aria-label': 'Requests' },
    h('div', { className: 'ot-answer-requests-head' },
      h('span', { className: 'bt-field-label' }, shown && requests !== null ? `Requests (${requests.length})` : 'Requests'),
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm', 'aria-expanded': shown, onClick: () => setShown(before => !before) }, shown ? 'Hide' : 'Show')),
    !shown ? null
      : problem ? h('p', { className: 'ot-picker-problem', role: 'alert' }, hostText(problem))
      : requests === null ? null
      : requests.length === 0 ? h('span', { className: 'bt-note' }, 'Nobody yet.')
      : h('ul', { className: 'ot-requests' }, requests.map(request => h('li', { key: request.chatUuid, className: 'ot-request' },
        h('span', { className: 'ot-request-who', title: (request.senders ?? []).join(', ') }, (request.senders ?? []).join(' · ')),
        h('span', { className: 'ot-request-text', title: request.text }, request.text),
        h('span', { className: 'ot-picker-at' }, `${relativeShort(request.lastAt)} · ${messages(request.count)}`)))))
}

// Owner-only endpoint; no model tool can enable answer mode or widen its tools.
export function AnswerSettings({ bot, value = {}, channels = [], threads = [] }) {
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(value.enabled === true)
  const [visibility, setVisibility] = useState(value.visibility ?? 'isolated')
  const [allowedTools, setAllowedTools] = useState(value.allowedTools ?? [])
  const [sharedNotes, setSharedNotes] = useState(value.sharedNotes ?? '')
  const [newChildMode, setNewChildMode] = useState(value.newChildMode ?? 'training')
  const [graduates, setGraduates] = useState(Number.isInteger(value.graduateAfter))
  const [graduateAfter, setGraduateAfter] = useState(String(value.graduateAfter ?? 5))
  const [resumeMinutes, setResumeMinutes] = useState(minutesOf(value.resumeAfterMs))
  const [knowledgeFolder, setKnowledgeFolder] = useState(value.knowledgeFolder ?? '')
  const [personBinding, setPersonBinding] = useState(value.personBinding === true)
  const [staffChat, setStaffChat] = useState(value.needsStaffChatId ?? '')
  const [staffChats, setStaffChats] = useState([])
  const [strangerReply, setStrangerReply] = useState(value.strangerReply ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  useEffect(() => {
    setEnabled(value.enabled === true); setVisibility(value.visibility ?? 'isolated')
    setAllowedTools(value.allowedTools ?? []); setSharedNotes(value.sharedNotes ?? '')
    setNewChildMode(value.newChildMode ?? 'training'); setGraduates(Number.isInteger(value.graduateAfter)); setGraduateAfter(String(value.graduateAfter ?? 5))
    setResumeMinutes(minutesOf(value.resumeAfterMs)); setKnowledgeFolder(value.knowledgeFolder ?? ''); setPersonBinding(value.personBinding === true)
    setStaffChat(value.needsStaffChatId ?? ''); setStrangerReply(value.strangerReply ?? '')
  }, [value.enabled, value.visibility, JSON.stringify(value.allowedTools), value.sharedNotes, value.newChildMode, value.graduateAfter, value.resumeAfterMs, value.knowledgeFolder, value.personBinding, value.needsStaffChatId, value.strangerReply])
  // The staff chats to pick from, read when the settings open (the picker's own read).
  const channelIds = channels.map(channel => channel.id).join(',')
  useEffect(() => {
    if (!open || channels.length === 0) return undefined
    let alive = true
    Promise.all(channels.map(channel => call('omni-thread-chats', { channelId: channel.id }).then(
      reply => (Array.isArray(reply?.chats) ? reply.chats : []).map(chat => ({ id: chat.id, name: chat.name, channel: channel.name })),
      (error) => { console.warn('Could not load chats:', error); return [] },
    ))).then(lists => { if (alive) setStaffChats(lists.flat()) })
    return () => { alive = false }
  }, [open, channelIds])
  const staffOptions = staffChatOptions(staffChats, threads, staffChat, channels.length > 1)
  // Graduation is off unless staff turn it on with a whole number of drafts (host GRADUATE_MAX).
  const count = Number(graduateAfter)
  const countOk = Number.isInteger(count) && count >= 1 && count <= 100
  // Staff take-over: whole minutes, one to a day (host RESUME_AFTER_MIN_MS..RESUME_AFTER_MAX_MS).
  const minutes = Number(resumeMinutes)
  const minutesOk = Number.isInteger(minutes) && minutes >= 1 && minutes <= RESUME_MINUTES_MAX
  const save = async () => {
    setBusy(true); setProblem(null)
    // #1704: sent while it is on or being switched off; a bot that never used it saves as before.
    const person = personBinding || value.personBinding === true ? { personBinding } : {}
    // #1707: sent while one is named or being cleared; a bot that never named one saves as before.
    const staff = staffChat || value.needsStaffChatId ? { needsStaffChatId: staffChat || null } : {}
    // #1713: the same: sent while set or being cleared.
    const stranger = strangerReply.trim() || value.strangerReply ? { strangerReply: strangerReply.trim() || null } : {}
    try { await call('omni-answer-settings', { botId: bot.id, enabled, visibility, allowedTools, sharedNotes, newChildMode, graduateAfter: graduates ? count : null, resumeAfterMs: minutes * 60_000, knowledgeFolder: knowledgeFolder.trim() || null, ...person, ...staff, ...stranger }); setOpen(false) }
    catch (error) { setProblem(error.message) } finally { setBusy(false) }
  }
  const tool = (name, on) => setAllowedTools(before => (on ? [...before.filter(item => item !== name), name] : before.filter(item => item !== name)))
  return h('div', null,
    h('button', { type: 'button', className: 'ot-channel-row', 'aria-expanded': open, onClick: () => setOpen(before => !before) }, 'Answer mode'),
    open ? h('div', { className: 'ot-picker ot-answer', role: 'group', 'aria-label': 'Answer mode settings' },
      h(SwitchRow, { label: 'Answer new messages', on: enabled, onChange: setEnabled }),
      h('p', { className: 'bt-note' }, 'Each child replies only in its own chat. Switch a child between training and sending from its menu in the list below.'),
      h(Field, { label: 'Visibility', note: VISIBILITY[visibility]?.[1] },
        h('select', { className: 'bt-select', value: visibility, onChange: event => setVisibility(event.target.value) },
          Object.entries(VISIBILITY).map(([value, [label]]) => h('option', { key: value, value }, label)))),
      h(Field, { label: 'New children start in', note: NEW_CHILD_MODES[newChildMode]?.[1] },
        h('select', { className: 'bt-select', value: newChildMode, onChange: event => setNewChildMode(event.target.value) },
          Object.entries(NEW_CHILD_MODES).map(([value, [label]]) => h('option', { key: value, value }, label)))),
      h(SwitchRow, { label: 'Switch a training child to sending by itself', on: graduates, onChange: setGraduates }),
      graduates ? h(Field, { label: 'Approved drafts in a row', note: 'Only drafts sent unchanged count. An edit or a rejection starts the count again.' },
        h('input', {
          className: 'bt-input ot-answer-count', type: 'number', min: 1, max: 100, step: 1, inputMode: 'numeric', value: graduateAfter,
          'aria-invalid': !countOk || undefined, onChange: event => setGraduateAfter(event.target.value),
        })) : null,
      h(Field, { label: 'Resume a paused child after', note: 'A child pauses when staff write in its chat from their own phone. It answers again after this many minutes with no staff message there, or when you press Resume.' },
        h('span', { className: 'ot-answer-minutes' },
          h('input', {
            className: 'bt-input ot-answer-count', type: 'number', min: 1, max: RESUME_MINUTES_MAX, step: 1, inputMode: 'numeric', value: resumeMinutes,
            'aria-invalid': !minutesOk || undefined, onChange: event => setResumeMinutes(event.target.value),
          }),
          h('span', { 'aria-hidden': true }, 'minutes'))),
      h(Field, { label: 'Staff chat when a person is needed', note: 'When a child says its person needs someone from the team, the bot\'s own chat and the child\'s row here show it. Pick a chat only staff are in to get a message there too.' },
        h('select', { className: 'bt-select ot-answer-staff', value: staffChat, onChange: event => setStaffChat(event.target.value) },
          h('option', { value: '' }, 'None'),
          staffOptions.map(option => h('option', { key: option.id, value: option.id }, option.label)))),
      h(Field, { label: 'Reply to people who are not let in', note: 'Sent once a day to each person no rule lets in. Empty: no reply.' },
        h('textarea', { className: 'bt-input bt-input-area ot-answer-stranger', maxLength: STRANGER_REPLY_MAX, value: strangerReply, onChange: event => setStrangerReply(event.target.value) })),
      h(StrangerRequests, { botId: bot.id }),
      h('div', { className: 'ot-answer-tools', role: 'group', 'aria-label': 'Children may also' },
        h('span', { className: 'bt-field-label', 'aria-hidden': true }, 'Children may also'),
        ANSWER_TOOLS.map(([name, label]) => h(SwitchRow, { key: name, label, title: name, on: allowedTools.includes(name), onChange: on => tool(name, on) }))),
      // #1689: the host checks the folder and keeps its real path; no model tool can set it.
      h(Field, { label: 'Knowledge folder', note: 'The business\'s own files, such as instructions and FAQ. While a folder is set, children read, find and search files there, and nowhere else. Full path; empty for none.' },
        h('input', { className: 'bt-input ot-answer-folder', type: 'text', value: knowledgeFolder, title: knowledgeFolder || undefined, placeholder: '/path/to/folder', spellCheck: false, autoComplete: 'off', onChange: event => setKnowledgeFolder(event.target.value) })),
      h(SwitchRow, { label: 'Bind each child to its person', on: personBinding, onChange: setPersonBinding }),
      h('p', { className: 'bt-note' }, 'A child then takes the notes and the capability in its person\'s access rule, and answers only messages that rule lets in. Needs isolated visibility, and the file tools off or limited to a knowledge folder.'),
      h(Field, { label: 'Shared notes for collective children' },
        h('textarea', { className: 'bt-input bt-input-area', maxLength: SHARED_NOTES_MAX, value: sharedNotes, onChange: event => setSharedNotes(event.target.value) })),
      problem ? h('p', { className: 'ot-picker-problem', role: 'alert' }, hostText(problem)) : null,
      h('div', { className: 'bt-actions' },
        h('button', { type: 'button', className: 'bt-soft bt-soft-sm', disabled: busy || (graduates && !countOk) || !minutesOk, onClick: save }, 'Save answer settings'))) : null)
}

// Staff only (host tool-series.js): an Omni bot whose every turn fails on its tool list takes
// its next turn with all its tools again. Its chats, automations and settings stay. Every Omni
// bot has it, the default one too: that can be a channel bot Omni made on its own Session,
// which cannot start a new conversation either.
export function RepairTools({ bot }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const repair = async () => {
    setBusy(true); setResult(null)
    try { await call('repair_tool_series', { botId: bot.id }); setResult({ ok: true, text: 'Done. Its next turn starts with all its tools: send it a message.' }) }
    catch (error) { setResult({ ok: false, text: hostText(error.message) }) } finally { setBusy(false) }
  }
  return h('div', null,
    h('button', { type: 'button', className: 'ot-channel-row', disabled: busy, title: 'For a bot whose every turn fails with a tool error', onClick: repair }, busy ? 'Repairing tools…' : 'Repair tools'),
    result ? h('p', { className: result.ok ? 'ot-picker-note' : 'ot-picker-problem', role: result.ok ? 'status' : 'alert' }, result.text) : null)
}

// #1706: messages this bot keeps because their sender is known only by a lid Omni has no phone
// for yet (host answer-kept.js). Staff see how many wait; the bot answers each once Omni knows
// the phone or the person writes again, and drops it after the channel's age limit.
function waitingOf(roster, botId) {
  const count = roster?.omniAnswerWaiting?.[botId]
  if (!Number.isInteger(count) || count < 1) return null
  return { count, label: `${count === 1 ? 'message' : 'messages'} waiting: sender not matched yet`, title: 'Omni does not know this sender\'s phone yet, so their phone access rule cannot match them. The bot answers once Omni learns the phone or the person writes again; after the channel\'s age limit the message is dropped.' }
}

export function OmniTree(props) {
  const { bot, actions, roster } = props
  const state = useOmni()
  const omni = useMemo(() => omniActions(id => actions.selectPanel(id), call), [actions])
  const [open, setOpen] = useState(readOpen)
  const [picking, setPicking] = useState(null)
  const [creatingBot, setCreatingBot] = useState(false)
  useEffect(() => { startLive(call) }, [])
  if (!isOmniBot(bot)) return null
  const rowProps = rowPropsOf(props, roster?.omniRowProps)
  // A saved default whose Bot was removed counts as none set (host subscriptions.js eventsBotId).
  const saved = roster?.omniOwnership?.defaultBotId
  const removed = saved != null && roster?.byId !== undefined && roster.byId[saved] === undefined
  const defaultBotId = (removed ? undefined : saved) ?? roster?.eventsBotId ?? bot.id
  const ownerOf = id => roster?.omniOwnership?.channels?.[id] ?? defaultBotId
  const threads = (Array.isArray(roster?.omniThreads) ? roster.omniThreads : []).filter(thread => (thread.ownerBotId ?? ownerOf(thread.channelId)) === bot.id)
  const ownedChannels = state.channels.filter(channel => ownerOf(channel.id) === bot.id)
  const ownedState = { ...state, channels: ownedChannels }
  const ownedView = { ...roster, omniThreads: threads }
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
  const listed = new Set(ownedChannels.map(channel => channel.id))
  const waiting = waitingOf(roster, bot.id)
  return h('div', { className: 'ot-tree', role: 'group', 'aria-label': t('{name}\'s channels', { name: bot.name }) },
    waiting ? h('div', { className: 'ot-channel-row ot-waiting', role: 'status', title: waiting.title, 'aria-label': `${waiting.count} ${waiting.label}` },
      h('span', { className: 'ot-count', 'aria-hidden': true }, String(waiting.count)), h('span', { className: 'ot-waiting-text', 'aria-hidden': true }, waiting.label)) : null,
    h(AnswerSettings, { bot, value: roster?.omniAnswers?.[bot.id], channels: ownedChannels, threads }),
    h(RepairTools, { bot }),
    bot.id === defaultBotId ? h('button', { type: 'button', className: 'ot-channel-row', onClick: () => setCreatingBot(value => !value) }, 'Add channel bot') : null,
    bot.id === defaultBotId && (creatingBot || roster?.omniBotProposals?.length > 0) ? h(ChannelBotForm, { channels: state.channels, roster, onClose: () => setCreatingBot(false) }) : null,
    ownedChannels.map(channel => h(ChannelItem, {
      key: channel.id, channel, state: ownedState, roster: ownedView, rowProps, actions, omni, plus, open: open.has(channel.id), picking: picking === channel.id,
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

// An answer child's row stacked: its name keeps the whole first line, its mode the second, and any
// reason a line of its own under the mode, aligned with it, so the row's buttons never squeeze it
// to a stub: while they show, the reason ends before them. A spacer keeps the mode clear of them.
// Used in a narrow tree, and at any width while a reason shows. Only the mode inside the row's
// button takes the indent; a paused row's own line keeps its own.
const stackedRow = row => `
${row}{display:grid;grid-template-columns:minmax(0,1fr) auto}
${row}>*{grid-column:1/-1}
${row} .bt-thread{grid-row:1;flex-wrap:wrap;row-gap:1px}
${row} .ot-thread-acts{grid-column:2;grid-row:1;align-self:end;z-index:1;margin-bottom:4px}
${row} .bt-thread-title{flex-basis:calc(100% - 20px)}
${row} .bt-thread .ot-mode{margin:2px 0 2px 20px}
${row} .ot-thread-reason{flex:1 1 100%;max-width:none;box-sizing:border-box;padding-left:20px}
${row}:is(:hover,:focus-within) .ot-thread-reason,${row}:has(.ot-thread-acts[data-on]) .ot-thread-reason{padding-right:48px}
${row} .bt-thread::after{content:'';flex:none;width:0}
${row}:is(:hover,:focus-within) .bt-thread::after,${row}:has(.ot-thread-acts[data-on]) .bt-thread::after{width:48px}`

export const OMNI_TREE_CSS = `
.ot-tree{container:ot-tree/inline-size;display:grid;grid-template-columns:minmax(0,1fr);gap:1px;margin:0 0 4px 26px;padding-left:10px;border-left:1px solid var(--bt-line, rgba(127,127,127,.2))}
.ot-channel-head{display:flex;align-items:center;gap:2px}
.ot-channel-row{display:flex;align-items:center;gap:7px;width:100%;min-width:0;padding:5px 8px 5px 4px;border:0;border-radius:8px;background:none;color:var(--bt-ink);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.ot-channel-row:hover{background:var(--bt-hover)}
.ot-channel-row .oc-tile{flex:none}
.ot-link{color:var(--bt-ink-2);font-size:12.5px}
.ot-chevron{display:grid;place-items:center;width:14px;height:14px;flex:none;color:var(--bt-ink-3);transition:transform .18s ease}
.ot-chevron svg{width:12px;height:12px}
.ot-channel-row[aria-expanded=true] .ot-chevron{transform:rotate(90deg)}
.ot-channel-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ot-waiting{box-sizing:border-box;align-items:flex-start;cursor:default;color:var(--bt-ink-2);font-size:12.5px;line-height:18px}
.ot-waiting:hover{background:none}
.ot-waiting .ot-count{background:color-mix(in srgb,var(--bt-star, #ff9800) 15%,transparent);color:color-mix(in srgb,var(--bt-star, #ff9800) 72%,var(--bt-ink))}
.ot-waiting-text{flex:1;min-width:0;overflow-wrap:anywhere}
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
/* An answer child's sending mode, always shown by name: amber while it trains, green once it sends. The title gives way first. */
.ot-mode{flex:none;padding:0 6px;border-radius:999px;font-size:10.5px;line-height:16px;font-weight:600;white-space:nowrap}
.ot-mode[data-mode=training]{color:color-mix(in srgb,var(--bt-star, #ff9800) 72%,var(--bt-ink));background:color-mix(in srgb,var(--bt-star, #ff9800) 15%,transparent)}
.ot-mode[data-mode=sending]{color:color-mix(in srgb,var(--bt-green, #00c972) 72%,var(--bt-ink));background:color-mix(in srgb,var(--bt-green, #00c972) 15%,transparent)}
.ot-thread-menu-note{padding:2px 6px 0;font-size:11px;line-height:15px;color:var(--bt-ink-3)}
/* A paused answer child: under its name and aligned with it, at every width, the pause, its time left and the team's Resume button. The time left is never cut: where the line is too short, it wraps to the pill's left edge, and Resume drops under it. */
.ot-mode[data-mode=paused]{color:color-mix(in srgb,var(--bt-accent, #22d3ee) 72%,var(--bt-ink));background:color-mix(in srgb,var(--bt-accent, #22d3ee) 15%,transparent)}
.ot-paused{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;flex-basis:100%;grid-column:1/-1;min-width:0;padding:0 4px 4px 28px}
.ot-paused-left{flex:1 0 auto;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums}
.ot-paused .ot-resume{height:24px;padding:0 10px}
/* An answer child whose person needs someone from the team: under its name and aligned with it, at every width, the badge and staff's Dismiss on one line, the child's reason on the next, cut to one line until it is opened. */
.ot-mode[data-mode=needs]{color:color-mix(in srgb,var(--bt-danger, #dc2626) 72%,var(--bt-ink));background:color-mix(in srgb,var(--bt-danger, #dc2626) 14%,transparent)}
.ot-needs{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;flex-basis:100%;grid-column:1/-1;min-width:0;padding:0 4px 4px 28px}
.ot-needs .ot-dismiss{order:1;margin-left:auto;height:24px;padding:0 10px}
.ot-needs-why{order:2;flex:1 1 100%;min-width:0;padding:0;border:0;background:none;color:var(--bt-ink-2);font:inherit;font-size:11px;line-height:16px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.ot-needs-why[aria-expanded=true]{white-space:normal;overflow-wrap:anywhere}
.ot-needs-why:focus-visible{outline:2px solid var(--bt-accent, #22d3ee);outline-offset:1px;border-radius:4px}
.ot-answer-minutes{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--bt-ink-2)}
${stackedRow('.ot-thread[data-answer]:has(.ot-thread-reason)')}
@container ot-tree (max-width:259px){${stackedRow('.ot-thread[data-answer]')}}
/* Answer settings: the Bot team's own switches, fields, selects, inputs and button (bt-*). */
.ot-answer{gap:12px;padding:10px}
.ot-answer-switch{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;min-width:0;font-size:13px;line-height:18px;color:var(--bt-ink)}
.ot-answer-switch>span{min-width:0;overflow-wrap:anywhere}
.ot-answer-label{display:grid;gap:6px;min-width:0}
.ot-answer .bt-field{gap:6px;min-width:0}
.ot-answer .bt-note{margin:0}
.ot-answer-tools{display:grid;gap:8px}
.ot-answer .ot-answer-count{width:88px}
.ot-answer .ot-answer-folder{box-sizing:border-box;width:100%;min-width:0}
.ot-answer .ot-answer-staff{box-sizing:border-box;width:100%;min-width:0}
.ot-answer .bt-input[aria-invalid=true]{border-color:var(--bt-danger, #dc2626)}
.ot-answer .bt-actions{justify-content:flex-end}
.ot-answer-requests{display:grid;gap:6px;min-width:0}
.ot-answer-requests-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.ot-requests{display:grid;gap:6px;max-height:220px;margin:0;padding:0;overflow-y:auto;list-style:none}
.ot-request{display:grid;gap:1px;min-width:0;padding:6px 8px;border:1px solid var(--bt-line, rgba(127,127,127,.2));border-radius:8px}
.ot-request-who,.ot-request-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:17px}
.ot-request-who{color:var(--bt-ink);font-variant-numeric:tabular-nums}
.ot-request-text{color:var(--bt-ink-2)}
.ot-thread-remove[data-confirm]{color:var(--bt-danger, #dc2626)}
.ot-thread-problem{flex-basis:100%;padding:0 8px 3px 28px;font-size:11px;color:var(--bt-danger, #dc2626)}
.ot-picker{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;margin:2px 0 4px;padding:6px;border:1px solid var(--bt-line, rgba(127,127,127,.2));border-radius:10px;background:var(--bt-surface, transparent)}
/* A narrow sidebar: the settings' controls and words wrap inside the panel, never widen the tree. */
.ot-picker label,.ot-picker p{min-width:0;overflow-wrap:anywhere}
.ot-picker select,.ot-picker textarea{box-sizing:border-box;max-width:100%;min-width:0}
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
