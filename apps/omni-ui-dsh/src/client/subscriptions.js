import { createElement as h, Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SearchIcon } from './icons.js'
import { OctopusLogo } from './logo.js'
import { BotMark } from './mark.js'
import { MAIN_LOOK } from './characters.js'
import { t } from './i18n.js'
import { relativeShort } from './text.js'
import { call } from './api.js'
import { ChatAvatar, PreviewChip, Tile, useOmni } from './channels.js'
import {
  REACTIONS, SUBS_PANEL, TRIGGERS, chatSource, firedToday, guessDraft, omniActions, runsOf, sourceOfChannel, startLive, subOf, subsActions, typeOf, waitingRuns,
} from './omni-store.js'

// Subscriptions: the agent-native side of Omni. You do not read your chats here; you pick
// chats, groups or whole channels, the event you care about in them (an emoji you react with,
// a keyword, a voice note…), and the Bot or DSH session that acts on it. Activity lists what
// fired and what the workers did, with approvals waiting for you first.

const useSubs = actions => useMemo(() => ({ ...omniActions(id => actions.selectPanel(id), call), ...subsActions(id => actions.selectPanel(id)) }), [actions])
const activePanel = usePanel => (usePanel ? usePanel(info => info?.activePanelId ?? null) : null)

// -------------------------------------------------------------------------
// Pieces of a subscription, shared by the sidebar, the list and the editor

export function workerOf(worker, roster) {
  if (worker.kind === 'main') {
    const main = roster?.byId?.[roster.mainBotId]
    return { name: main?.name ?? 'Omni', bot: main, look: MAIN_LOOK, role: t('Main Bot') }
  }
  if (worker.kind === 'session') return { name: worker.title || t('DSH session'), session: true, role: worker.mode === 'new' ? t('a new session each time') : t('one ongoing session') }
  const bot = worker.botId ? roster?.byId?.[worker.botId] : undefined
  return { name: bot?.name ?? worker.name, bot, look: worker.look, role: t('Bot') }
}

export function WorkerMark({ worker, roster, size = 24 }) {
  const info = workerOf(worker, roster)
  if (info.session) return h('span', { className: 'os-session', style: { width: size, height: size } }, h(OctopusLogo, { size: Math.round(size * 0.62) }))
  return h(BotMark, info.bot ? { bot: info.bot, size } : { look: info.look ?? MAIN_LOOK, size })
}

const TriggerBadge = ({ trigger, size = 36 }) => h('span', { className: 'os-trigger', 'data-kind': trigger.kind, style: { width: size, height: size, fontSize: Math.round(size * 0.5) } },
  trigger.kind === 'reaction' ? trigger.emoji : TRIGGERS[trigger.kind].icon)

function triggerText(trigger) {
  if (trigger.kind === 'reaction') return t('you react')
  if (trigger.kind === 'keyword') return t('a message says {words}', { words: trigger.words.map(word => `“${word}”`).join(t(' or ')) })
  return t(TRIGGERS[trigger.kind].label).toLowerCase()
}

function sourcesText(sources) {
  if (sources.length === 0) return t('no chats yet')
  if (sources.length === 1) return sources[0].kind === 'channel' ? t('anywhere on {name}', { name: sources[0].name }) : sources[0].name
  const channels = sources.filter(source => source.kind === 'channel').length
  const groups = sources.filter(source => source.kind === 'chat' && source.chatKind === 'group').length
  const chats = sources.length - channels - groups
  const count = (n, one, many) => (n === 0 ? '' : n === 1 ? t(one) : t(many, { n }))
  return [count(channels, '1 channel', '{n} channels'), count(groups, '1 group', '{n} groups'), count(chats, '1 chat', '{n} chats')].filter(Boolean).join(' + ')
}

function SourceStack({ sources, size = 18 }) {
  return h('span', { className: 'os-stack' }, sources.slice(0, 3).map(source => h('span', { key: `${source.kind}-${source.id}`, className: 'os-stack-item' },
    source.kind === 'channel' ? h(Tile, { type: source.type, size }) : h(ChatAvatar, { chat: { name: source.name, initials: initials(source.name) }, size }))),
  sources.length > 3 ? h('span', { className: 'os-stack-more' }, `+${sources.length - 3}`) : null)
}
const initials = name => (name.startsWith('#') ? '#' : name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || '?')

// The whole subscription as one sentence.
function Sentence({ sub, roster }) {
  const worker = workerOf(sub.worker, roster)
  return h('p', { className: 'os-sentence' },
    h('span', { className: 'os-w' }, t('When')), ' ',
    h('span', { className: 'os-chip os-chip-trigger' }, sub.trigger.kind === 'reaction' ? h('b', { className: 'os-emoji' }, sub.trigger.emoji) : null, triggerText(sub.trigger)), ' ',
    h('span', { className: 'os-w' }, t('in')), ' ',
    h('span', { className: 'os-chip' }, h(SourceStack, { sources: sub.sources, size: 16 }), sourcesText(sub.sources)), ' ',
    h('span', { className: 'os-w' }, '→'), ' ',
    h('span', { className: 'os-chip os-chip-worker' }, h(WorkerMark, { worker: sub.worker, roster, size: 18 }), worker.name),
    sub.outputs.react ? h(Fragment, null, ' ', h('span', { className: 'os-chip os-chip-soft' }, t('reacts 👀 then ✅'))) : null,
    sub.outputs.replyToMe ? h(Fragment, null, ' ', h('span', { className: 'os-chip os-chip-soft' }, t('replies to you'))) : null)
}

const RUN_STATUS = {
  waiting: { label: 'Needs you', tone: 'warn' },
  working: { label: 'Working', tone: 'busy' },
  done: { label: 'Done', tone: 'ok' },
  failed: { label: 'Did not finish', tone: 'bad' },
}

// -------------------------------------------------------------------------
// Sidebar: Subscriptions and Activity, under the Bots

export function SubscriptionsSection({ wide, actions, usePanel, roster }) {
  const state = useOmni()
  const omni = useSubs(actions)
  const panel = activePanel(usePanel)
  useEffect(() => { startLive(call) }, [])
  const waiting = waitingRuns(state)
  const runs = runsOf(state).slice(0, 4)
  const current = panel === SUBS_PANEL ? state.subs : null
  if (!wide) {
    return h('div', { className: 'oc-side oc-side-rail', role: 'group', 'aria-label': t('Subscriptions') },
      h('span', { className: 'oc-side-rule', 'aria-hidden': true }),
      state.subscriptions.filter(sub => sub.on).slice(0, 5).map(sub => h('button', {
        key: sub.id, type: 'button', className: 'bt-row os-row', title: sub.name, 'aria-label': sub.name,
        'aria-current': current?.id === sub.id ? 'page' : undefined, onClick: () => omni.openSubs('detail', sub.id),
      }, h(TriggerBadge, { trigger: sub.trigger, size: 34 }))),
      h('button', { type: 'button', className: 'bt-row os-row', title: t('Activity'), 'aria-label': t('Activity'), onClick: () => omni.openSubs('list') },
        h('span', { className: 'oc-rail-octo' }, h(OctopusLogo, { size: 20 }), waiting > 0 ? h('span', { className: 'oc-warn-dot', 'aria-hidden': true }) : null)))
  }
  return h('div', { className: 'oc-side os-side', role: 'group', 'aria-label': t('Subscriptions') },
    h('div', { className: 'oc-side-head' },
      h('button', { type: 'button', className: 'os-side-title', 'aria-current': current?.view === 'list' ? 'page' : undefined, onClick: () => omni.openSubs('list') }, t('Subscriptions')),
      h('span', { className: 'os-side-tools' },
        h('button', { type: 'button', className: 'oc-side-manage', title: t('Channels and their health'), onClick: () => omni.openChannels() }, t('Channels'), h(ChevronRightIcon)),
        h('button', { type: 'button', className: 'os-add', title: t('New subscription'), 'aria-label': t('New subscription'), onClick: () => omni.openSubs('edit') }, h(PlusIcon)))),
    state.subscriptions.length === 0
      ? h('button', { type: 'button', className: 'os-empty', onClick: () => omni.openSubs('edit') }, t('Pick chats and what to watch for. A Bot acts when it happens.'))
      : state.subscriptions.map((sub) => {
        const pending = state.runs.filter(run => run.subId === sub.id && run.status === 'waiting').length
        const worker = workerOf(sub.worker, roster)
        return h('button', {
          key: sub.id, type: 'button', className: 'bt-row os-row', 'data-off': sub.on ? undefined : true,
          'aria-current': current?.id === sub.id && current.view !== 'list' ? 'page' : undefined,
          'aria-label': [sub.name, sub.on ? '' : t('Paused'), pending ? t('{n} waiting for you', { n: pending }) : ''].filter(Boolean).join(', '),
          onClick: () => omni.openSubs('detail', sub.id),
        },
        h(TriggerBadge, { trigger: sub.trigger }),
        h('span', { className: 'bt-row-body' },
          h('span', { className: 'bt-row-name' }, h('span', { className: 'bt-row-title' }, sub.name)),
          h('span', { className: 'os-row-line' }, h(SourceStack, { sources: sub.sources, size: 14 }), h('span', { className: 'os-arrow' }, '→'), h(WorkerMark, { worker: sub.worker, roster, size: 14 }), h('span', { className: 'bt-row-preview' }, worker.name))),
        pending ? h('span', { className: 'os-pending' }, String(pending)) : sub.on ? null : h('span', { className: 'os-paused' }, t('Paused')))
      }),
    runs.length > 0 ? h(Fragment, null,
      h('div', { className: 'oc-side-head os-activity-head' }, h('span', { className: 'oc-side-title' }, t('Activity')),
        waiting > 0 ? h('span', { className: 'os-needs' }, t('{n} need you', { n: waiting })) : null),
      runs.map(run => h(RunRow, { key: run.id, run, sub: subOf(state, run.subId), roster, onOpen: () => omni.openSubs('detail', run.subId, run.id) }))) : null)
}

function RunRow({ run, sub, roster, onOpen }) {
  if (!sub) return null
  const status = RUN_STATUS[run.status]
  return h('button', { type: 'button', className: 'os-run', 'data-tone': status.tone, onClick: onOpen },
    h(WorkerMark, { worker: sub.worker, roster, size: 22 }),
    h('span', { className: 'os-run-body' },
      h('span', { className: 'os-run-top' }, h('strong', null, workerOf(sub.worker, roster).name), h('span', { className: 'os-run-status' }, t(status.label)), h('time', null, relativeShort(run.at))),
      h('span', { className: 'os-run-text' }, run.summary)))
}

// -------------------------------------------------------------------------
// Main panel: list, one subscription, editor

export function SubscriptionsPage({ actions, useRoster }) {
  const state = useOmni()
  const roster = useRoster ? useRoster(value => value) : null
  const omni = useSubs(actions)
  const { subs } = state
  const sub = subs.id ? subOf(state, subs.id) : undefined
  return h('div', { className: 'oc-page oc-channels' },
    h('div', { className: 'oc-channels-in' },
      subs.view === 'edit' && subs.draft ? h(Editor, { draft: subs.draft, state, roster, omni })
        : subs.view === 'detail' && sub ? h(Detail, { sub, state, roster, omni, focus: subs.runId })
          : h(List, { state, roster, omni })))
}

function Describe({ state, omni }) {
  const [text, setText] = useState('')
  const go = () => { if (text.trim()) omni.startDraft(guessDraft(text, state)) }
  return h('div', { className: 'os-describe' },
    h('span', { className: 'os-describe-mark' }, h(OctopusLogo, { size: 18 })),
    h('input', {
      value: text, onChange: event => setText(event.target.value), 'aria-label': t('Describe a subscription'),
      placeholder: t('Tell Omni what to watch: “when I react 📌 in Grupo Obras, have Ops file it”'),
      onKeyDown: (event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) go() },
    }),
    h('button', { type: 'button', className: 'oc-primary', disabled: text.trim() === '', onClick: go }, t('Draft it')))
}

function List({ state, roster, omni }) {
  const runs = runsOf(state)
  const waiting = runs.filter(run => run.status === 'waiting')
  return h(Fragment, null,
    h('header', { className: 'oc-head' },
      h('div', null,
        h('h1', null, t('Subscriptions'), h(PreviewChip)),
        h('p', null, t('Pick chats, groups or whole channels and the moment you care about. A Bot or a DSH session acts on it, and you see what it did here.'))),
      h('button', { type: 'button', className: 'oc-primary', onClick: () => omni.openSubs('edit') }, h(PlusIcon), t('New subscription'))),
    h(Describe, { state, omni }),
    waiting.length > 0 ? h(Fragment, null,
      h('h2', { className: 'oc-section' }, t('Waiting for you')),
      waiting.map(run => h(RunCard, { key: run.id, run, sub: subOf(state, run.subId), roster, omni }))) : null,
    h('h2', { className: 'oc-section' }, t('Your subscriptions')),
    h('div', { className: 'os-cards' }, state.subscriptions.map(sub => h('button', {
      key: sub.id, type: 'button', className: 'os-card', 'data-off': sub.on ? undefined : true, onClick: () => omni.openSubs('detail', sub.id),
    },
    h('span', { className: 'os-card-top' }, h(TriggerBadge, { trigger: sub.trigger, size: 40 }), h('strong', null, sub.name),
      h('span', { className: 'os-card-meta' }, sub.on ? t('{n} today', { n: firedToday(state, sub.id) }) : t('Paused'))),
    h(Sentence, { sub, roster })))),
    h('h2', { className: 'oc-section' }, t('Activity')),
    h('div', { className: 'os-timeline' }, runs.filter(run => run.status !== 'waiting').map(run => h(RunCard, { key: run.id, run, sub: subOf(state, run.subId), roster, omni, compact: true }))))
}

function RunCard({ run, sub, roster, omni, compact = false, focused = false }) {
  if (!sub) return null
  const status = RUN_STATUS[run.status]
  return h('div', { className: `os-runcard${compact ? ' os-runcard-compact' : ''}`, 'data-tone': status.tone, 'data-focus': focused || undefined },
    h(WorkerMark, { worker: sub.worker, roster, size: compact ? 28 : 34 }),
    h('div', { className: 'os-runcard-body' },
      h('div', { className: 'os-runcard-top' },
        h('strong', null, workerOf(sub.worker, roster).name),
        h('span', { className: 'oc-pill', 'data-tone': status.tone === 'bad' ? 'warn' : status.tone }, h('span', { className: 'oc-pill-dot', 'aria-hidden': true }), t(status.label)),
        h('button', { type: 'button', className: 'os-link', onClick: () => omni.openSubs('detail', sub.id, run.id) }, sub.name),
        h('time', null, relativeShort(run.at))),
      h('div', { className: 'os-quote' }, h('span', null, run.from), ' ', run.excerpt),
      h('div', { className: 'os-summary' }, run.summary),
      run.status === 'waiting' ? h('div', { className: 'os-approve' },
        h('button', { type: 'button', className: 'oc-primary', onClick: () => omni.approve(run.id) }, t('Allow once')),
        h('button', { type: 'button', className: 'oc-secondary', onClick: () => omni.deny(run.id) }, t('Decline')),
        h('span', { className: 'os-approve-why' }, t('This came from a chat message, so the Bot asks before running commands.'))) : null))
}

function Detail({ sub, state, roster, omni, focus }) {
  const [confirming, setConfirming] = useState(false)
  const runs = runsOf(state, sub.id)
  const worker = workerOf(sub.worker, roster)
  return h(Fragment, null,
    h('button', { type: 'button', className: 'oc-back', onClick: () => omni.show({ view: 'list', id: null, runId: null }) }, h(ChevronLeftIcon), t('Subscriptions')),
    h('header', { className: 'oc-detail-head' },
      h(TriggerBadge, { trigger: sub.trigger, size: 56 }),
      h('div', { className: 'oc-detail-who' }, h('h1', null, sub.name), h('p', null, sub.on ? t('On · fired {n} times today', { n: firedToday(state, sub.id) }) : t('Paused'))),
      h('button', { type: 'button', role: 'switch', 'aria-checked': sub.on, className: 'os-switch', 'aria-label': t('On'), onClick: () => omni.toggle(sub.id) }, h('span'))),
    h('div', { className: 'os-sentence-card' }, h(Sentence, { sub, roster })),
    h('div', { className: 'oc-actions' },
      h('button', { type: 'button', className: 'oc-secondary', onClick: () => omni.openSubs('edit', sub.id) }, t('Edit')),
      h('button', { type: 'button', className: 'oc-secondary', onClick: () => omni.test(sub.id) }, t('Test with the latest match'))),
    h('h2', { className: 'oc-section' }, t('Watching')),
    h('div', { className: 'os-sources' }, sub.sources.map(source => h('span', { key: `${source.kind}-${source.id}`, className: 'os-source' },
      source.kind === 'channel' ? h(Tile, { type: source.type, size: 28 }) : h(ChatAvatar, { chat: { name: source.name, initials: initials(source.name) }, size: 28 }),
      h('span', null, h('strong', null, source.kind === 'channel' ? t('Everything on {name}', { name: source.name }) : source.name),
        h('small', null, `${typeOf(source.type).label} · ${source.kind === 'channel' ? t('whole channel') : source.chatKind === 'group' ? t('group') : source.chatKind === 'self' ? t('your own chat') : t('direct chat')}`))))),
    h('h2', { className: 'oc-section' }, t('Runs')),
    runs.length === 0 ? h('div', { className: 'oc-empty' }, t('Nothing fired yet. Test it to see what {name} gets.', { name: worker.name }))
      : runs.map(run => h(RunCard, { key: run.id, run, sub, roster, omni, focused: run.id === focus })),
    h('div', { className: 'oc-danger' },
      h('div', null, h('strong', null, t('Delete {name}', { name: sub.name })), h('span', null, t('Its runs stay in the Bot’s chat; nothing new fires.'))),
      h('button', { type: 'button', className: confirming ? 'oc-danger-go oc-danger-armed' : 'oc-danger-go', onBlur: () => setConfirming(false), onClick: () => (confirming ? omni.remove(sub.id) : setConfirming(true)) },
        confirming ? t('Click again to delete') : t('Delete'))))
}

// An unnamed subscription is named after what it does: "📌 Grupo Obras → Ops".
function autoName(draft, roster) {
  const lead = draft.trigger.kind === 'reaction' ? draft.trigger.emoji : TRIGGERS[draft.trigger.kind].icon
  return `${lead} ${sourcesText(draft.sources)} → ${workerOf(draft.worker, roster).name}`
}

// -------------------------------------------------------------------------
// Editor: where, what, who, then. The sentence on top reads back what it will do.

function Editor({ draft, state, roster, omni }) {
  const edit = omni.editDraft
  const ready = draft.sources.length > 0 && (draft.trigger.kind !== 'keyword' || draft.trigger.words.length > 0)
  return h(Fragment, null,
    h('button', { type: 'button', className: 'oc-back', onClick: () => omni.show(draft.id ? { view: 'detail', id: draft.id } : { view: 'list', id: null }) }, h(ChevronLeftIcon), draft.id ? draft.name : t('Subscriptions')),
    h('header', { className: 'oc-head' }, h('div', null, h('h1', null, draft.id ? t('Edit subscription') : t('New subscription'), h(PreviewChip)))),
    h('div', { className: 'os-sentence-card os-sticky' }, h(Sentence, { sub: draft, roster }),
      h('input', { className: 'os-name', value: draft.name, placeholder: t('Name it (optional)'), 'aria-label': t('Name'), onChange: event => edit({ name: event.target.value }) })),
    h(Step, { n: 1, title: t('Where'), hint: t('Chats, groups, whole channels, or a mix.') }, h(SourcePicker, { draft, state, edit })),
    h(Step, { n: 2, title: t('When'), hint: t('The moment that wakes the worker.') }, h(TriggerPicker, { draft, edit })),
    h(Step, { n: 3, title: t('Who acts'), hint: t('It gets the message, who sent it, and the chat around it.') }, h(WorkerPicker, { draft, roster, edit })),
    h(Step, { n: 4, title: t('Then'), hint: t('Results always land in the worker’s chat here.') },
      h(Toggle, { on: draft.outputs.react, onChange: react => edit({ outputs: { ...draft.outputs, react } }), title: t('React on the message: 👀 when it starts, ✅ when done'), text: t('You see progress in the chat you are already in.') }),
      h(Toggle, { on: draft.outputs.replyToMe, onChange: replyToMe => edit({ outputs: { ...draft.outputs, replyToMe } }), title: t('Reply to me in my own chat'), text: t('Only to your own number: the key Omni uses cannot message anyone else.') })),
    h('div', { className: 'os-safety' },
      h('span', { className: 'os-safety-icon', 'aria-hidden': true }, '🛡'),
      h('div', null, h('strong', null, t('Messages come from other people')), h('span', null, t('Anyone in a watched chat can write text that tries to steer the Bot. It runs with no secrets, and asks you first before shell, file or network actions.'))),
      h(Toggle, { on: draft.safety.askFirst, onChange: askFirst => edit({ safety: { askFirst } }), title: t('Ask me first'), compact: true })),
    h('div', { className: 'os-save' },
      h('button', {
        type: 'button', className: 'oc-primary', disabled: !ready,
        onClick: () => { if (draft.name.trim() === '') edit({ name: autoName(draft, roster) }); omni.save() },
      }, draft.id ? t('Save') : t('Create subscription')),
      ready ? null : h('span', { className: 'os-save-why' }, draft.sources.length === 0 ? t('Pick at least one chat, group or channel.') : t('Add a word to look for.'))))
}

const Step = ({ n, title, hint, children }) => h('section', { className: 'os-step' },
  h('div', { className: 'os-step-head' }, h('span', { className: 'os-step-n' }, String(n)), h('strong', null, title), h('span', null, hint)),
  h('div', { className: 'os-step-body' }, children))

const Toggle = ({ on, onChange, title, text, compact }) => h('button', { type: 'button', role: 'switch', 'aria-checked': on, className: `os-toggle${compact ? ' os-toggle-compact' : ''}`, onClick: () => onChange(!on) },
  h('span', { className: 'os-toggle-text' }, h('strong', null, title), text ? h('span', null, text) : null), h('span', { className: 'os-switch', 'aria-hidden': true }, h('span')))

function SourcePicker({ draft, state, edit }) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const has = (sourceKind, id) => draft.sources.some(source => source.kind === sourceKind && source.id === id)
  const flip = (source) => {
    const next = has(source.kind, source.id) ? draft.sources.filter(item => !(item.kind === source.kind && item.id === source.id)) : [...draft.sources, source]
    edit({ sources: next })
  }
  const needle = query.trim().toLowerCase()
  const chats = state.chats
    .filter(chat => kind === 'all' || (kind === 'group' ? chat.kind === 'group' : chat.kind !== 'group'))
    .filter(chat => needle === '' || chat.name.toLowerCase().includes(needle))
    .toSorted((a, b) => b.at - a.at)
    .slice(0, 40)
  return h(Fragment, null,
    draft.sources.length > 0 ? h('div', { className: 'os-picked' }, draft.sources.map(source => h('button', { key: `${source.kind}-${source.id}`, type: 'button', className: 'os-picked-chip', onClick: () => flip(source), title: t('Remove') },
      source.kind === 'channel' ? h(Tile, { type: source.type, size: 18 }) : h(ChatAvatar, { chat: { name: source.name, initials: initials(source.name) }, size: 18 }),
      source.kind === 'channel' ? t('All of {name}', { name: source.name }) : source.name, h('span', { className: 'os-x', 'aria-hidden': true }, '×')))) : null,
    h('div', { className: 'os-channels' }, state.channels.map(channel => h('button', {
      key: channel.id, type: 'button', className: 'os-channel-opt', 'aria-pressed': has('channel', channel.id), onClick: () => flip(sourceOfChannel(channel)),
    }, h(Tile, { type: channel.type, size: 22 }), h('span', null, t('All of {name}', { name: channel.name }))))),
    h('div', { className: 'os-search' },
      h('label', null, h(SearchIcon), h('input', { value: query, placeholder: t('Find a chat or group'), onChange: event => setQuery(event.target.value), 'aria-label': t('Find a chat or group') })),
      h('span', { className: 'os-seg', role: 'radiogroup' }, [['all', t('All')], ['group', t('Groups')], ['direct', t('Chats')]].map(([value, label]) => h('button', { key: value, type: 'button', role: 'radio', 'aria-checked': kind === value, onClick: () => setKind(value) }, label)))),
    h('div', { className: 'os-chatlist' }, chats.map((chat) => {
      const channel = state.channels.find(item => item.id === chat.channelId)
      const picked = has('chat', chat.id)
      return h('button', { key: chat.id, type: 'button', className: 'os-chat-opt', 'aria-pressed': picked, onClick: () => flip(chatSource(state, chat)) },
        h('span', { className: 'os-check', 'aria-hidden': true }, picked ? '✓' : ''),
        h(ChatAvatar, { chat, channel, size: 30 }),
        h('span', { className: 'os-chat-opt-body' }, h('strong', null, chat.name), h('span', null, `${chat.kind === 'group' ? t('Group') : chat.kind === 'self' ? t('Your own chat') : t('Direct chat')} · ${channel ? typeOf(channel.type).label : ''}`)),
        h('time', null, relativeShort(chat.at)))
    })))
}

function TriggerPicker({ draft, edit }) {
  const [word, setWord] = useState('')
  const { trigger } = draft
  const pick = kind => edit({ trigger: kind === 'reaction' ? { kind, emoji: trigger.emoji ?? '🤖' } : kind === 'keyword' ? { kind, words: trigger.words ?? [] } : { kind } })
  const addWord = () => {
    const value = word.trim()
    if (value && !trigger.words.includes(value)) edit({ trigger: { ...trigger, words: [...trigger.words, value] } })
    setWord('')
  }
  return h(Fragment, null,
    h('div', { className: 'os-triggers' }, Object.entries(TRIGGERS).map(([kind, info]) => h('button', {
      key: kind, type: 'button', className: 'os-trigger-opt', 'aria-pressed': trigger.kind === kind, onClick: () => pick(kind),
    }, h('span', { className: 'os-trigger-icon' }, kind === 'reaction' ? (trigger.kind === 'reaction' ? trigger.emoji : '🤖') : info.icon), t(info.label)))),
    trigger.kind === 'reaction' ? h('div', { className: 'os-emojis' },
      h('span', { className: 'os-emojis-label' }, t('Your reaction on any message in these chats hands it over:')),
      REACTIONS.map(emoji => h('button', { key: emoji, type: 'button', className: 'os-emoji-opt', 'aria-pressed': trigger.emoji === emoji, onClick: () => edit({ trigger: { ...trigger, emoji } }) }, emoji))) : null,
    trigger.kind === 'keyword' ? h('div', { className: 'os-words' },
      trigger.words.map(item => h('button', { key: item, type: 'button', className: 'os-picked-chip', onClick: () => edit({ trigger: { ...trigger, words: trigger.words.filter(other => other !== item) } }) }, `“${item}”`, h('span', { className: 'os-x', 'aria-hidden': true }, '×'))),
      h('input', { value: word, placeholder: t('Add a word, then Enter'), onChange: event => setWord(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) addWord() } })) : null)
}

function WorkerPicker({ draft, roster, edit }) {
  const bots = (roster?.bots ?? []).filter(bot => bot.id !== roster?.mainBotId)
  const { worker } = draft
  const option = (key, selected, onClick, mark, title, text) => h('button', { key, type: 'button', className: 'os-worker-opt', 'aria-pressed': selected, onClick }, mark, h('span', null, h('strong', null, title), h('span', null, text)))
  return h(Fragment, null,
    h('div', { className: 'os-workers' },
      option('main', worker.kind === 'main', () => edit({ worker: { kind: 'main' } }), h(WorkerMark, { worker: { kind: 'main' }, roster, size: 32 }), workerOf({ kind: 'main' }, roster).name, t('Main Bot: triages, or hands it to the right Bot')),
      bots.map(bot => option(bot.id, worker.kind === 'bot' && worker.botId === bot.id, () => edit({ worker: { kind: 'bot', botId: bot.id, name: bot.name } }), h(BotMark, { bot, size: 32 }), bot.name, bot.role || t('Bot'))),
      option('session', worker.kind === 'session', () => edit({ worker: { kind: 'session', mode: worker.mode ?? 'new', title: worker.title ?? '' } }), h(WorkerMark, { worker: { kind: 'session' }, roster, size: 32 }), t('DSH session'), t('A plain agent session, no Bot'))),
    worker.kind === 'session' ? h('div', { className: 'os-seg os-seg-wide', role: 'radiogroup' },
      [['new', t('A new session each time')], ['ongoing', t('One ongoing session')]].map(([mode, label]) => h('button', { key: mode, type: 'button', role: 'radio', 'aria-checked': worker.mode === mode, onClick: () => edit({ worker: { ...worker, mode } }) }, label))) : null)
}

// -------------------------------------------------------------------------

export const SUBSCRIPTIONS_CSS = `
.os-trigger{display:inline-grid;place-items:center;flex:none;border-radius:30%;background:color-mix(in srgb,var(--bt-accent) 12%,var(--bt-card));box-shadow:inset 0 0 0 .5px var(--bt-line-2);line-height:1}
.os-trigger:not([data-kind=reaction]){color:var(--bt-accent);font-weight:700}
.os-session{display:inline-grid;place-items:center;flex:none;border-radius:30%;background:var(--bt-ink);color:var(--bt-main)}
.os-stack{display:inline-flex;align-items:center;flex:none}
.os-stack-item{display:inline-flex;margin-left:-4px;border-radius:50%;box-shadow:0 0 0 1.5px var(--bt-sidebar)}
.os-stack-item:first-child{margin-left:0}
.os-stack-item .oc-ava-badge{display:none}
.os-stack-more{margin-left:3px;font-size:10.5px;color:var(--bt-ink-3)}

/* Sidebar */
.os-side-title{border:0;background:none;padding:0;font:inherit;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--bt-ink-3);cursor:pointer}
.os-side-title:hover,.os-side-title[aria-current=page]{color:var(--bt-ink)}
.os-side-tools{display:inline-flex;align-items:center;gap:2px}
.os-add{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;border:0;background:none;color:var(--bt-ink-2);cursor:pointer}
.os-add:hover{background:var(--bt-hover);color:var(--bt-ink)}
.os-add svg{width:15px;height:15px}
.os-row[data-off]{opacity:.55}
.os-row[aria-current=page]{background:var(--bt-active)}
.os-row-line{display:flex;align-items:center;gap:5px;min-width:0}
.os-row-line .bt-row-preview{flex:1;min-width:0}
.os-arrow{color:var(--bt-ink-3);font-size:12px}
.os-pending{flex:none;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#f59e0b;color:#fff;font-size:11px;font-weight:600;line-height:18px;text-align:center;box-sizing:border-box}
.os-paused{flex:none;font-size:11px;color:var(--bt-ink-3)}
.os-empty{margin:2px 6px;padding:10px 12px;border:1px dashed var(--bt-line-2);border-radius:12px;background:none;color:var(--bt-ink-2);font:inherit;font-size:12.5px;line-height:18px;text-align:left;cursor:pointer}
.os-activity-head{margin-top:8px}
.os-needs{font-size:11.5px;font-weight:600;color:#d97706;padding-right:8px}
.os-run{display:flex;align-items:flex-start;gap:8px;width:100%;padding:7px 8px;border:0;border-radius:10px;background:none;color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;box-sizing:border-box}
.os-run:hover{background:var(--bt-hover)}
.os-run-body{display:flex;flex-direction:column;min-width:0;flex:1}
.os-run-top{display:flex;align-items:center;gap:6px;font-size:12.5px;line-height:18px}
.os-run-top strong{font-weight:500}
.os-run-top time{margin-left:auto;font-size:11px;color:var(--bt-ink-3)}
.os-run-status{font-size:11px;font-weight:600;color:color-mix(in srgb,var(--oc-tone) 75%,var(--bt-ink))}
.os-run[data-tone=busy] .os-run-status{animation:oc-pulse 1.4s ease-in-out infinite}
.os-run-text{font-size:12px;line-height:17px;color:var(--bt-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-tone=bad]{--oc-tone:#e5484d}

/* Sentence */
.os-sentence{margin:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 4px;font-size:14px;line-height:28px}
.os-w{color:var(--bt-ink-3);font-weight:500}
.os-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;background:var(--bt-card);border:.5px solid var(--bt-line-2);white-space:nowrap}
.os-chip-trigger{background:color-mix(in srgb,var(--bt-accent) 10%,var(--bt-card));border-color:color-mix(in srgb,var(--bt-accent) 30%,transparent)}
.os-chip-worker{font-weight:500}
.os-chip-soft{background:none;color:var(--bt-ink-2);border-style:dashed}
.os-emoji{font-size:16px}
.os-sentence-card{display:flex;flex-direction:column;gap:12px;padding:16px 18px;border-radius:16px;background:color-mix(in srgb,var(--bt-accent) 5%,var(--bt-main));border:1px solid color-mix(in srgb,var(--bt-accent) 22%,transparent)}
.os-sticky{position:sticky;top:0;z-index:2;box-shadow:0 10px 24px -18px rgba(0,0,0,.35);backdrop-filter:blur(8px);background:color-mix(in srgb,var(--bt-main) 92%,var(--bt-accent))}
.os-name{height:34px;padding:0 12px;border-radius:10px;border:1px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:14px;font-weight:500;outline:none}
.os-name:focus{border-color:var(--bt-accent)}

/* Page */
.os-describe{display:flex;align-items:center;gap:10px;padding:6px 6px 6px 14px;border-radius:999px;border:1px solid var(--bt-line-2);background:var(--bt-card);box-shadow:0 4px 18px -12px rgba(0,0,0,.3)}
.os-describe:focus-within{border-color:var(--bt-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--bt-accent) 14%,transparent)}
.os-describe-mark{display:inline-flex;color:var(--bt-accent)}
.os-describe input{flex:1;min-width:0;height:38px;border:0;background:none;color:var(--bt-ink);font:inherit;font-size:14px;outline:none}
.os-cards{display:flex;flex-direction:column;gap:10px}
.os-card{display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:18px;border:.5px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer;transition:transform .14s ease,box-shadow .14s ease}
.os-card:hover{transform:translateY(-1px);box-shadow:0 12px 28px -14px rgba(0,0,0,.2)}
.os-card[data-off]{opacity:.6}
.os-card-top{display:flex;align-items:center;gap:12px}
.os-card-top strong{flex:1;font-size:15.5px;font-weight:600}
.os-card-meta{font-size:12.5px;color:var(--bt-ink-2)}
.os-timeline{display:flex;flex-direction:column;gap:8px}
.os-runcard{display:flex;gap:12px;padding:14px 16px;border-radius:16px;background:var(--bt-card);border:.5px solid var(--bt-line-2);transition:box-shadow .2s ease}
.os-runcard[data-tone=warn]{border:1px solid color-mix(in srgb,#f59e0b 40%,transparent);background:color-mix(in srgb,#f59e0b 6%,var(--bt-card))}
.os-runcard[data-focus]{box-shadow:0 0 0 3px color-mix(in srgb,var(--bt-accent) 30%,transparent)}
.os-runcard-compact{padding:10px 14px}
.os-runcard-body{display:flex;flex-direction:column;gap:6px;flex:1;min-width:0}
.os-runcard-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13.5px}
.os-runcard-top time{margin-left:auto;font-size:12px;color:var(--bt-ink-3)}
.os-runcard .oc-pill{height:20px;font-size:11px;padding:0 8px}
.os-runcard[data-tone=busy] .oc-pill-dot{animation:oc-pulse 1.2s ease-in-out infinite}
.os-link{border:0;background:none;padding:0;color:var(--bt-ink-2);font:inherit;font-size:12.5px;cursor:pointer}
.os-link:hover{color:var(--bt-ink);text-decoration:underline}
.os-quote{padding:6px 10px;border-left:3px solid var(--bt-line-2);border-radius:4px;background:var(--bt-hover);font-size:13px;line-height:19px;color:var(--bt-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.os-quote span{font-weight:600;color:var(--bt-ink)}
.os-summary{font-size:13.5px;line-height:20px}
.os-approve{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px}
.os-approve .oc-primary,.os-approve .oc-secondary{height:32px;font-size:13px;padding:0 14px}
.os-approve-why{font-size:12px;color:var(--bt-ink-3)}
.os-switch{position:relative;flex:none;width:42px;height:24px;border-radius:999px;border:0;padding:0;background:var(--bt-line-2);cursor:pointer;transition:background-color .15s ease}
.os-switch span{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .18s cubic-bezier(.2,0,0,1)}
[aria-checked=true]>.os-switch,.os-switch[aria-checked=true]{background:var(--bt-accent)}
[aria-checked=true]>.os-switch span,.os-switch[aria-checked=true] span{transform:translateX(18px)}
.os-sources{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px}
.os-source{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:var(--bt-card);border:.5px solid var(--bt-line-2)}
.os-source>span:last-child{display:flex;flex-direction:column;min-width:0}
.os-source strong{font-size:13.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.os-source small{font-size:12px;color:var(--bt-ink-2)}

/* Editor */
.os-step{display:flex;flex-direction:column;gap:12px;padding:18px;border-radius:18px;background:var(--bt-card);border:.5px solid var(--bt-line-2)}
.os-step-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.os-step-head strong{font-size:16px;font-weight:600}
.os-step-head>span:last-child{font-size:13px;color:var(--bt-ink-2)}
.os-step-n{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--bt-accent);color:var(--bt-accent-ink,#fff);font-size:12px;font-weight:700;align-self:center}
.os-step-body{display:flex;flex-direction:column;gap:10px}
.os-picked,.os-words{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.os-picked-chip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 6px 0 4px;border-radius:999px;border:1px solid color-mix(in srgb,var(--bt-accent) 35%,transparent);background:color-mix(in srgb,var(--bt-accent) 9%,var(--bt-card));color:var(--bt-ink);font:inherit;font-size:13px;cursor:pointer}
.os-words .os-picked-chip{padding-left:10px}
.os-x{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;color:var(--bt-ink-2)}
.os-picked-chip:hover .os-x{background:var(--bt-hover);color:var(--bt-ink)}
.os-words input{flex:1;min-width:160px;height:32px;padding:0 10px;border-radius:10px;border:1px solid var(--bt-line-2);background:var(--bt-main);color:var(--bt-ink);font:inherit;font-size:13.5px;outline:none}
.os-channels{display:flex;flex-wrap:wrap;gap:6px}
.os-channel-opt{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px 0 7px;border-radius:12px;border:1px solid var(--bt-line-2);background:var(--bt-main);color:var(--bt-ink);font:inherit;font-size:13px;cursor:pointer}
.os-channel-opt[aria-pressed=true],.os-chat-opt[aria-pressed=true],.os-trigger-opt[aria-pressed=true],.os-worker-opt[aria-pressed=true]{border-color:var(--bt-accent);background:color-mix(in srgb,var(--bt-accent) 9%,var(--bt-card));box-shadow:0 0 0 3px color-mix(in srgb,var(--bt-accent) 12%,transparent)}
.os-search{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.os-search label{flex:1;min-width:200px;display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;border-radius:12px;border:1px solid var(--bt-line-2);background:var(--bt-main);color:var(--bt-ink-3)}
.os-search input{flex:1;min-width:0;border:0;background:none;color:var(--bt-ink);font:inherit;font-size:13.5px;outline:none}
.os-seg{display:inline-flex;padding:3px;border-radius:12px;background:var(--bt-hover);gap:2px}
.os-seg button{height:30px;padding:0 12px;border:0;border-radius:9px;background:none;color:var(--bt-ink-2);font:inherit;font-size:13px;cursor:pointer}
.os-seg button[aria-checked=true]{background:var(--bt-card);color:var(--bt-ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.os-seg-wide{align-self:flex-start}
.os-chatlist{display:flex;flex-direction:column;gap:2px;max-height:300px;overflow-y:auto;padding:2px;margin:0 -2px}
.os-chat-opt{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:12px;border:1px solid transparent;background:none;color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer}
.os-chat-opt:hover{background:var(--bt-hover)}
.os-check{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:6px;border:1.5px solid var(--bt-line-2);font-size:12px;font-weight:700;color:var(--bt-accent-ink,#fff);flex:none}
.os-chat-opt[aria-pressed=true] .os-check{background:var(--bt-accent);border-color:var(--bt-accent)}
.os-chat-opt-body{display:flex;flex-direction:column;flex:1;min-width:0}
.os-chat-opt-body strong{font-size:13.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.os-chat-opt-body span{font-size:12px;color:var(--bt-ink-2)}
.os-chat-opt time{font-size:11.5px;color:var(--bt-ink-3)}
.os-triggers{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
.os-trigger-opt{display:flex;align-items:center;gap:10px;height:46px;padding:0 12px;border-radius:14px;border:1px solid var(--bt-line-2);background:var(--bt-main);color:var(--bt-ink);font:inherit;font-size:13.5px;text-align:left;cursor:pointer}
.os-trigger-icon{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:9px;background:var(--bt-hover);font-size:15px;font-weight:700;color:var(--bt-accent)}
.os-emojis{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.os-emojis-label{width:100%;font-size:12.5px;color:var(--bt-ink-2)}
.os-emoji-opt{width:44px;height:44px;border-radius:14px;border:1px solid var(--bt-line-2);background:var(--bt-main);font-size:22px;cursor:pointer;transition:transform .12s ease}
.os-emoji-opt:hover{transform:scale(1.08)}
.os-emoji-opt[aria-pressed=true]{border-color:var(--bt-accent);background:color-mix(in srgb,var(--bt-accent) 12%,var(--bt-card));transform:scale(1.08);box-shadow:0 0 0 3px color-mix(in srgb,var(--bt-accent) 14%,transparent)}
.os-workers{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.os-worker-opt{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;border:1px solid var(--bt-line-2);background:var(--bt-main);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer}
.os-worker-opt>span:last-child{display:flex;flex-direction:column;min-width:0}
.os-worker-opt strong{font-size:14px;font-weight:600}
.os-worker-opt>span:last-child>span{font-size:12px;line-height:16px;color:var(--bt-ink-2)}
.os-toggle{display:flex;align-items:center;gap:14px;width:100%;padding:12px 14px;border-radius:14px;border:1px solid var(--bt-line-2);background:var(--bt-main);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer}
.os-toggle-compact{width:auto;padding:0;border:0;background:none}
.os-toggle-text{display:flex;flex-direction:column;flex:1;gap:2px}
.os-toggle-text strong{font-size:14px;font-weight:500}
.os-toggle-text span{font-size:12.5px;color:var(--bt-ink-2)}
.os-toggle-compact .os-toggle-text strong{font-size:13px;white-space:nowrap}
.os-safety{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:16px;background:color-mix(in srgb,#0ea5e9 7%,var(--bt-card));border:1px solid color-mix(in srgb,#0ea5e9 25%,transparent)}
.os-safety-icon{font-size:22px}
.os-safety>div{display:flex;flex-direction:column;gap:2px;flex:1;font-size:12.5px;line-height:18px;color:var(--bt-ink-2)}
.os-safety strong{font-size:14px;color:var(--bt-ink)}
.os-save{display:flex;align-items:center;gap:12px;padding-bottom:8px}
.os-save-why{font-size:13px;color:var(--bt-ink-2)}
`
