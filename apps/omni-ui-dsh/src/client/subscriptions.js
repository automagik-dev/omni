import { createElement as h, Fragment, useEffect, useState } from 'react'
import { AtIcon, FileIcon, KeywordIcon, MessageIcon, ShieldIcon, UnplugIcon, VoiceIcon } from './icons.js'
import { OmniMark } from './logo.js'
import { BotMark } from './mark.js'
import { MAIN_LOOK } from './characters.js'
import { t } from './i18n.js'
import { relativeShort } from './text.js'
import { call } from './api.js'
import { ChatAvatar, Tile, useOmni } from './channels.js'
import { TRIGGERS, runsOf, startLive, waitingRuns } from './omni-store.js'

// Omni's board: what it actually does, beside its chat. The user never fills a form here;
// they tell Omni what to watch, Omni saves it with its own tools (src/host/
// subscriptions.js), and the board shows the change at the next poll, with the card that
// changed lit up. The board only pauses, tests and deletes.

const TRIGGER_ICONS = { message: MessageIcon, mention: AtIcon, keyword: KeywordIcon, voice: VoiceIcon, media: FileIcon, down: UnplugIcon }
// A card changed this recently is lit up: the board reacting to the conversation.
const FRESH_MS = 6000

export const isEventsBot = (roster, id) => Boolean(roster?.eventsBotId) && roster.byId?.[id]?.id === roster.eventsBotId

export function workerOf(worker, roster) {
  // The Main Bot runs the automations it handles itself (it was Autopilot's job once).
  if (worker.kind === 'events' || worker.kind === 'main') {
    const bot = roster?.byId?.[roster.eventsBotId ?? roster.mainBotId]
    return { name: bot?.name ?? 'Omni', bot, look: MAIN_LOOK }
  }
  if (worker.kind === 'session') return { name: worker.mode === 'ongoing' ? t('One ongoing session') : t('A new session each time'), session: true }
  const bot = roster?.byId?.[worker.botId]
  return { name: bot?.name ?? t('A deleted Bot'), bot, look: MAIN_LOOK }
}

export function WorkerMark({ worker, roster, size = 24 }) {
  const info = workerOf(worker, roster)
  if (info.session) return h('span', { className: 'os-session', style: { width: size, height: size } }, h(OmniMark, { size: Math.round(size * 0.62) }))
  return h(BotMark, info.bot ? { bot: info.bot, size } : { look: info.look, size })
}

// A reaction shows the emoji itself; every other trigger has a line icon.
const TriggerBadge = ({ trigger, size = 36 }) => h('span', { className: 'os-trigger', 'data-kind': trigger.kind, style: { width: size, height: size, fontSize: Math.round(size * 0.5), '--os-icon': `${Math.round(size * 0.52)}px` } },
  trigger.kind === 'reaction' ? trigger.emoji : h(TRIGGER_ICONS[trigger.kind]))

function triggerText(trigger) {
  if (trigger.kind === 'reaction') return t('you react')
  if (trigger.kind === 'keyword') return t('a message says {words}', { words: trigger.words.map(word => `“${word}”`).join(t(' or ')) })
  return t(TRIGGERS[trigger.kind].label).toLowerCase()
}

function sourcesText(sources) {
  if (sources.length === 1) return sources[0].kind === 'channel' ? t('anywhere on {name}', { name: sources[0].name }) : sources[0].name
  const channels = sources.filter(source => source.kind === 'channel').length
  const groups = sources.filter(source => source.kind === 'chat' && source.chatKind === 'group').length
  const chats = sources.length - channels - groups
  const count = (n, one, many) => (n === 0 ? '' : n === 1 ? t(one) : t(many, { n }))
  return [count(channels, '1 channel', '{n} channels'), count(groups, '1 group', '{n} groups'), count(chats, '1 chat', '{n} chats')].filter(Boolean).join(' + ')
}

const initials = name => (name.startsWith('#') ? '#' : name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || '?')
const SourceMark = ({ source, size }) => (source.kind === 'channel'
  ? h(Tile, { type: source.type, size })
  : h(ChatAvatar, { chat: { name: source.name, initials: initials(source.name) }, size }))

function SourceStack({ sources, size = 16 }) {
  return h('span', { className: 'os-stack' }, sources.slice(0, 3).map(source => h('span', { key: `${source.kind}-${source.id}`, className: 'os-stack-item' }, h(SourceMark, { source, size }))),
    sources.length > 3 ? h('span', { className: 'os-stack-more' }, `+${sources.length - 3}`) : null)
}

// The whole subscription as one sentence.
function Sentence({ sub, roster }) {
  return h('p', { className: 'os-sentence' },
    h('span', { className: 'os-w' }, t('When')), ' ',
    h('span', { className: 'os-chip os-chip-trigger' }, sub.trigger.kind === 'reaction' ? h('b', { className: 'os-emoji' }, sub.trigger.emoji) : null, triggerText(sub.trigger)), ' ',
    h('span', { className: 'os-w' }, t('in')), ' ',
    h('span', { className: 'os-chip' }, h(SourceStack, { sources: sub.sources }), sourcesText(sub.sources)), ' ',
    h('span', { className: 'os-w' }, '→'), ' ',
    h('span', { className: 'os-chip os-chip-worker' }, h(WorkerMark, { worker: sub.worker, roster, size: 18 }), workerOf(sub.worker, roster).name),
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
// Omni's row and chat header

// The task Sessions with an approval open, as a Set; picked as text so a row redraws only
// when it changes.
const useWaiting = useWork => new Set((useWork ? useWork(work => (work.approvals ?? []).map(entry => entry.sessionId).join(',')) : '').split(',').filter(Boolean))

// On Omni's sidebar row: runs waiting for your approval.
export function EventsBadge({ roster, useWork }) {
  const waiting = waitingRuns(roster, useWaiting(useWork))
  return waiting > 0 ? h('span', { className: 'os-pending', title: t('{n} waiting for you', { n: waiting }) }, String(waiting)) : null
}

// In Omni's chat header: shows or hides its board in the right sidebar.
export function SubscriptionsButton({ roster, actions, useWork }) {
  const count = (roster.subscriptions ?? []).filter(sub => sub.on).length
  const waiting = waitingRuns(roster, useWaiting(useWork))
  return h('button', { type: 'button', className: 'os-head-btn', onClick: () => actions.toggleBoard() },
    t('Automations'), h('span', { className: 'os-head-count' }, String(count)),
    waiting > 0 ? h('span', { className: 'os-pending' }, String(waiting)) : null)
}

// -------------------------------------------------------------------------
// The board: a tab of DSH's own right sidebar, so it sits beside Omni's chat like
// Files or a terminal, keeps to that Session, and steps aside with it.

export const BOARD_KIND = 'omni-subscriptions'
export const BOARD_TAB_ID = 'ds-bot/omni-subscriptions'
export const boardTabDefinition = () => ({ id: BOARD_TAB_ID, kind: BOARD_KIND, title: () => t('Automations') })

export function BoardTab({ useRoster, useWork, actions }) {
  const roster = useRoster(value => value)
  const waiting = useWaiting(useWork)
  const bot = roster.byId?.[roster.eventsBotId]
  if (!bot) return h('div', { className: 'os-board' }, h('p', { className: 'os-board-note' }, t('Automations belong to the Main Bot, which this team does not have.')))
  return h(SubscriptionsBoard, { bot, roster, actions, waiting })
}

export function SubscriptionsBoard({ bot, roster, actions, waiting }) {
  const omni = useOmni()
  useEffect(() => { startLive(call) }, [])
  const subs = roster.subscriptions ?? []
  const runs = runsOf(roster)
  const watched = new Set(subs.filter(sub => sub.on).flatMap(sub => sub.sources.map(source => `${source.kind}:${source.id}`))).size
  const listening = (roster.omniEvents?.listening ?? []).length > 0
  return h('div', { className: 'os-board' },
    subs.length === 0
      ? h(Empty, { bot, live: omni.source.kind === 'live' })
      : h(Fragment, null,
        h('div', { className: 'os-board-status' },
          h('span', { className: 'oc-live-dot', 'data-on': listening || undefined, 'aria-hidden': true }),
          !subs.some(sub => sub.on) ? t('Everything is paused.')
            : `${watched === 1 ? t('Watching 1 chat or channel.') : t('Watching {n} chats and channels.', { n: watched })} ${listening ? t('Listening to omni.') : t('Connecting to omni…')}`),
        subs.some(sub => sub.on && (sub.outputs.react || sub.outputs.replyToMe))
          ? h('div', { className: 'os-board-note os-board-pending' }, t('Reactions and replies to you are not sent yet. Results stay in the runs below.'))
          : null,
        h('div', { className: 'os-list' }, subs.map(sub => h(AutomationRow, { key: sub.id, sub, roster, runs: runs.filter(run => run.subId === sub.id) }))),
        runs.length > 0 ? h(Fragment, null,
          h('div', { className: 'os-board-h' }, t('Runs')),
          h('div', { className: 'os-list' }, runs.slice(0, 20).map(run => h(RunRow, { key: run.id, run, sub: subs.find(sub => sub.id === run.subId), roster, actions, asking: waiting?.has(run.sessionId) && run.status === 'working' })))) : null),
    h('div', { className: 'os-safety' },
      h(ShieldIcon),
      h('span', null, t('Anyone in a watched chat can write text that tries to steer a Bot. Work started by an event runs with no secrets and asks you before shell, file or network actions, unless you tell {name} otherwise.', { name: bot.name }))))
}

function Empty({ bot, live }) {
  const examples = [
    t('Watch #ci-alerts for “failed” or “error” and hand it to Ops'),
    t('When I react 📌 to a message in any WhatsApp chat, save it to my notes'),
    t('Voice notes in my own chat go to one ongoing session'),
  ]
  return h('div', { className: 'os-empty-board' },
    h(BotMark, { bot, size: 48, live: true }),
    h('strong', null, t('Tell {name} what to watch', { name: bot.name })),
    h('span', null, live ? t('Say it in the chat. {name} finds the chats, asks what is missing, and the subscription shows up here.', { name: bot.name })
      : t('Omni is not connected to this DSH yet, so there is nothing to watch.')),
    h('ul', { className: 'os-examples' }, examples.map(text => h('li', { key: text }, text))))
}

// One automation: its trigger, name, sentence and switch. `onOpen` makes the name a way into
// Omni's chat (the Automations page); beside that chat the board needs none.
export function AutomationRow({ sub, roster, runs, onOpen }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState('')
  const fresh = Date.now() - (sub.updatedAt ?? 0) < FRESH_MS
  const run = async (endpoint, payload) => {
    setBusy(endpoint)
    try { await call(endpoint, payload) } finally { setBusy('') }
  }
  const last = runs[0]
  return h('div', { className: 'os-row', 'data-off': sub.on ? undefined : true, 'data-fresh': fresh || undefined },
    h(TriggerBadge, { trigger: sub.trigger, size: 28 }),
    h('div', { className: 'os-row-body' },
      h('div', { className: 'os-row-top' },
        onOpen ? h('button', { type: 'button', className: 'os-row-name os-row-open', onClick: onOpen }, sub.name) : h('span', { className: 'os-row-name' }, sub.name),
        h('button', {
          type: 'button', role: 'switch', 'aria-checked': sub.on, className: 'os-switch', disabled: busy !== '',
          'aria-label': sub.on ? t('Pause {name}', { name: sub.name }) : t('Resume {name}', { name: sub.name }),
          onClick: () => run('automation-set-on', { id: sub.id, on: !sub.on }),
        }, h('span'))),
      h(Sentence, { sub, roster }),
      h('div', { className: 'os-row-foot' },
        h('span', null, last ? t('last run {time}', { time: relativeShort(last.at) }) : t('not fired yet')),
        sub.askFirst ? null : h('span', { className: 'os-row-warn' }, t('acts without asking')),
        h('span', { className: 'os-row-actions' },
          h('button', { type: 'button', className: 'os-link', disabled: busy !== '', onClick: () => run('automation-test', { id: sub.id }) }, t('Test')),
          h('button', {
            type: 'button', className: confirming ? 'os-link os-link-danger' : 'os-link', disabled: busy !== '',
            onBlur: () => setConfirming(false),
            onClick: () => (confirming ? run('automation-delete', { id: sub.id }) : setConfirming(true)),
          }, confirming ? t('Click again to delete') : t('Delete'))))))
}

// A run opens its own Session: the task the worker ran for one event.
function RunRow({ run, sub, roster, actions, asking = false }) {
  if (!sub) return null
  const status = RUN_STATUS[asking ? 'waiting' : run.status]
  const open = run.sessionId ? () => actions.openSession(run.sessionId) : undefined
  return h('button', { type: 'button', className: 'os-run', 'data-tone': status.tone, disabled: !open, onClick: open, title: open ? t('Open this run') : undefined },
    h(WorkerMark, { worker: sub.worker, roster, size: 22 }),
    h('span', { className: 'os-run-body' },
      h('span', { className: 'os-run-top' },
        h('span', { className: 'os-run-name' }, workerOf(sub.worker, roster).name),
        h('span', { className: 'os-run-status' }, run.test ? `${t('Test')} · ${t(status.label)}` : t(status.label)),
        h('time', null, relativeShort(run.at))),
      run.excerpt && !run.test ? h('span', { className: 'os-run-quote' }, run.from ? `${run.from}: ` : '', run.excerpt) : null,
      h('span', { className: 'os-run-text' }, run.summary)))
}

export const SUBSCRIPTIONS_CSS = `
.os-trigger{display:inline-grid;place-items:center;flex:none;border-radius:30%;background:color-mix(in srgb,var(--bt-accent) 12%,var(--bt-card));box-shadow:inset 0 0 0 .5px var(--bt-line-2);line-height:1}
.os-trigger:not([data-kind=reaction]){color:var(--bt-accent)}
.os-trigger svg{width:var(--os-icon,18px);height:var(--os-icon,18px)}
.os-session{display:inline-grid;place-items:center;flex:none;border-radius:30%;background:var(--bt-ink);color:var(--bt-main)}
.os-stack{display:inline-flex;align-items:center;flex:none}
.os-stack-item{display:inline-flex;margin-left:-4px;border-radius:50%;box-shadow:0 0 0 1.5px var(--bt-card)}
.os-stack-item:first-child{margin-left:0}
.os-stack-item .oc-ava-badge{display:none}
.os-stack-more{margin-left:3px;font-size:10.5px;color:var(--bt-ink-3)}
.os-pending{flex:none;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#f59e0b;color:#fff;font-size:11px;font-weight:600;line-height:18px;text-align:center;box-sizing:border-box}
[data-tone=bad]{--oc-tone:#e5484d}

/* Omni's header button */
.os-head-btn{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 10px 0 12px;margin-left:8px;border-radius:999px;border:.5px solid var(--bt-line-2);background:var(--bt-main);color:var(--bt-ink);font:inherit;font-size:13px;cursor:pointer;pointer-events:auto;box-shadow:0 2px 8px -1px rgba(0,0,0,.06)}
.os-head-btn:hover{background:var(--bt-hover)}
.os-head-count{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--bt-hover);color:var(--bt-ink-2);font-size:11px;line-height:18px;text-align:center;box-sizing:border-box}

/* Board: a plain list in the sidebar's own type and spacing */
.os-board{height:100%;overflow-y:auto;padding:10px 8px 16px;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;color:var(--bt-ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:13px}
.os-board-status{display:flex;align-items:center;gap:8px;padding:2px 8px 6px;font-size:12px;color:var(--bt-ink-2)}
.os-board-status .oc-live-dot{width:6px;height:6px;border-radius:50%;background:var(--bt-ink-3)}
.os-board-status .oc-live-dot[data-on]{background:#16a34a}
.os-board-h{margin:10px 8px 2px;font-size:11.5px;font-weight:600;color:var(--bt-ink-3)}
.os-board-note{margin:8px;font-size:12.5px;color:var(--bt-ink-2)}
.os-board-pending{margin:0 8px 4px;padding:7px 10px;border-radius:8px;background:var(--bt-hover);font-size:11.5px;line-height:16px;color:var(--bt-ink-2)}
.os-list{display:flex;flex-direction:column}
.os-row{display:flex;gap:10px;padding:10px 8px;border-radius:10px;transition:background-color .12s ease}
.os-row+.os-row{border-top:.5px solid var(--bt-line)}
.os-row:hover{background:var(--bt-hover)}
.os-row[data-off]{opacity:.55}
.os-row[data-fresh]{animation:os-fresh 2.4s cubic-bezier(.2,0,0,1)}
@keyframes os-fresh{0%{background:color-mix(in srgb,var(--bt-accent) 22%,transparent);transform:translateY(4px)}25%{transform:none}100%{background:transparent}}
.os-row-body{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
.os-row-top{display:flex;align-items:center;gap:8px;min-height:22px}
.os-row-name{flex:1;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.os-row-open{border:0;background:none;padding:0;color:inherit;font:inherit;font-weight:600;text-align:left;cursor:pointer}
.os-row-open:hover{text-decoration:underline}
.os-row-foot{display:flex;align-items:center;gap:10px;font-size:11.5px;color:var(--bt-ink-3)}
.os-row-warn{color:#d97706}
.os-row-actions{display:inline-flex;gap:10px;margin-left:auto;opacity:0;transition:opacity .12s ease}
.os-row:hover .os-row-actions,.os-row:focus-within .os-row-actions{opacity:1}
.os-empty-board{display:flex;flex-direction:column;align-items:center;gap:8px;padding:28px 12px 8px;text-align:center}
.os-empty-board>strong{font-size:14px;font-weight:600}
.os-empty-board>span{max-width:300px;font-size:12.5px;line-height:18px;color:var(--bt-ink-2)}
.os-examples{list-style:none;margin:8px 0 0;padding:0;width:100%;display:flex;flex-direction:column;text-align:left}
.os-examples li{padding:8px 10px;font-size:12.5px;line-height:18px;color:var(--bt-ink-2)}
.os-examples li+li{border-top:.5px solid var(--bt-line)}
.os-examples li::before{content:"“";color:var(--bt-ink-3)}
.os-examples li::after{content:"”";color:var(--bt-ink-3)}

/* Sentence: inline, quiet */
.os-sentence{margin:0;display:flex;flex-wrap:wrap;align-items:center;gap:3px 4px;font-size:12.5px;line-height:20px;color:var(--bt-ink-2)}
.os-w{color:var(--bt-ink-3)}
.os-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;color:var(--bt-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.os-chip-soft{color:var(--bt-ink-3)}
.os-emoji{font-size:13px;font-weight:400}

.os-link{border:0;background:none;padding:0;color:var(--bt-ink-2);font:inherit;font-size:11.5px;cursor:pointer}
.os-link:hover:not(:disabled){color:var(--bt-ink);text-decoration:underline}
.os-link:disabled{opacity:.5;cursor:default}
.os-link-danger{color:var(--bt-danger);font-weight:600}
.os-switch{position:relative;flex:none;width:30px;height:18px;border-radius:999px;border:0;padding:0;background:var(--bt-line-2);cursor:pointer;transition:background-color .15s ease}
.os-switch span{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .18s cubic-bezier(.2,0,0,1)}
.os-switch[aria-checked=true]{background:var(--bt-accent)}
.os-switch[aria-checked=true] span{transform:translateX(12px)}
.os-switch:disabled{opacity:.6}

/* Runs */
.os-run{display:flex;gap:9px;width:100%;padding:8px;border:0;border-radius:10px;background:none;color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer}
.os-run:hover:not(:disabled){background:var(--bt-hover)}
.os-run:disabled{cursor:default}
.os-run-body{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.os-run-top{display:flex;align-items:center;gap:6px;font-size:12.5px}
.os-run-name{font-weight:500}
.os-run-top time{margin-left:auto;font-size:11px;color:var(--bt-ink-3)}
.os-run-status{font-size:11px;font-weight:600;color:color-mix(in srgb,var(--oc-tone) 75%,var(--bt-ink))}
.os-run[data-tone=busy] .os-run-status{animation:oc-pulse 1.4s ease-in-out infinite}
.os-run-quote{font-size:12px;color:var(--bt-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.os-run-text{font-size:12.5px;line-height:18px;color:var(--bt-ink-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

.os-safety{display:flex;gap:8px;margin-top:auto;padding:10px 8px 0;border-top:.5px solid var(--bt-line);font-size:11.5px;line-height:16px;color:var(--bt-ink-3)}
.os-safety svg{flex:none;margin-top:1px}
@media (prefers-reduced-motion:reduce){.os-row[data-fresh]{animation:none}}
`
