import { createElement as h, Fragment, useEffect, useState } from 'react'
import { AtIcon, CloseIcon, FileIcon, KeywordIcon, MessageIcon, ShieldIcon, UnplugIcon, VoiceIcon } from './icons.js'
import { OctopusLogo } from './logo.js'
import { BotMark } from './mark.js'
import { MAIN_LOOK } from './characters.js'
import { t } from './i18n.js'
import { relativeShort } from './text.js'
import { call } from './api.js'
import { ChatAvatar, PreviewChip, Tile, useOmni } from './channels.js'
import { TRIGGERS, runsOf, startLive, waitingRuns } from './omni-store.js'

// Tentacall's board: what it actually does, beside its chat. The user never fills a form here;
// they tell Tentacall what to watch, Tentacall saves it with its own tools (src/host/
// subscriptions.js), and the board shows the change at the next poll, with the card that
// changed lit up. The board only pauses, tests and deletes.

const TRIGGER_ICONS = { message: MessageIcon, mention: AtIcon, keyword: KeywordIcon, voice: VoiceIcon, media: FileIcon, down: UnplugIcon }
const EVENTS_LOOK = { shape: 'octopus', color: 'violet' }
// A card changed this recently is lit up: the board reacting to the conversation.
const FRESH_MS = 6000

export const isEventsBot = (roster, id) => Boolean(roster?.eventsBotId) && roster.byId?.[id]?.id === roster.eventsBotId

export function workerOf(worker, roster) {
  if (worker.kind === 'events') {
    const bot = roster?.byId?.[roster.eventsBotId]
    return { name: bot?.name ?? 'Tentacall', bot, look: EVENTS_LOOK }
  }
  if (worker.kind === 'main') {
    const bot = roster?.byId?.[roster.mainBotId]
    return { name: bot?.name ?? 'Omni', bot, look: MAIN_LOOK }
  }
  if (worker.kind === 'session') return { name: worker.mode === 'ongoing' ? t('One ongoing session') : t('A new session each time'), session: true }
  const bot = roster?.byId?.[worker.botId]
  return { name: bot?.name ?? t('A deleted Bot'), bot, look: MAIN_LOOK }
}

export function WorkerMark({ worker, roster, size = 24 }) {
  const info = workerOf(worker, roster)
  if (info.session) return h('span', { className: 'os-session', style: { width: size, height: size } }, h(OctopusLogo, { size: Math.round(size * 0.62) }))
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
// Tentacall's row and chat header

// On Tentacall's sidebar row: runs waiting for your approval.
export function EventsBadge({ roster }) {
  const waiting = waitingRuns(roster)
  return waiting > 0 ? h('span', { className: 'os-pending', title: t('{n} waiting for you', { n: waiting }) }, String(waiting)) : null
}

// In Tentacall's chat header: shows or hides the board beside the chat.
export function SubscriptionsButton({ sessionId, roster, actions, open }) {
  const count = (roster.subscriptions ?? []).filter(sub => sub.on).length
  const waiting = waitingRuns(roster)
  return h('button', { type: 'button', className: 'os-head-btn', 'aria-pressed': open, onClick: () => actions.toggleWork(sessionId) },
    t('Subscriptions'), h('span', { className: 'os-head-count' }, String(count)),
    waiting > 0 ? h('span', { className: 'os-pending' }, String(waiting)) : null)
}

// -------------------------------------------------------------------------
// The board, in the right panel's "work" view

export function SubscriptionsBoard({ bot, roster, actions, onDetails }) {
  const omni = useOmni()
  useEffect(() => { startLive(call) }, [])
  const subs = roster.subscriptions ?? []
  const runs = runsOf(roster)
  const waiting = runs.filter(run => run.status === 'waiting')
  const watched = new Set(subs.filter(sub => sub.on).flatMap(sub => sub.sources.map(source => `${source.kind}:${source.id}`))).size
  return h('div', { className: 'bt-panel-view os-board' },
    h('div', { className: 'os-board-head' },
      h('button', { type: 'button', className: 'os-board-who', onClick: onDetails, title: t('{name}’s profile', { name: bot.name }) }, h(BotMark, { bot, size: 26 }), h('strong', null, t('Subscriptions'))),
      h(PreviewChip),
      h('button', { type: 'button', className: 'bt-icon-btn', 'aria-label': t('Close panel'), title: t('Close panel'), onClick: () => actions.closePanel() }, h(CloseIcon))),
    h('div', { className: 'os-board-body' },
      subs.length === 0
        ? h(Empty, { bot, live: omni.source.kind === 'live' })
        : h(Fragment, null,
          h('p', { className: 'os-board-note' }, subs.some(sub => sub.on)
            ? `${watched === 1 ? t('Watching 1 chat or channel.') : t('Watching {n} chats and channels.', { n: watched })} ${t('Events start arriving once omni’s event stream is connected here.')}`
            : t('Everything is paused.')),
          waiting.length > 0 ? h(Fragment, null,
            h('h3', { className: 'os-board-h' }, t('Waiting for you')),
            waiting.map(run => h(RunCard, { key: run.id, run, sub: subs.find(sub => sub.id === run.subId), roster }))) : null,
          h('h3', { className: 'os-board-h' }, t('Watching')),
          subs.map(sub => h(SubCard, { key: sub.id, sub, roster, runs: runs.filter(run => run.subId === sub.id) })),
          runs.length > waiting.length ? h(Fragment, null,
            h('h3', { className: 'os-board-h' }, t('Activity')),
            runs.filter(run => run.status !== 'waiting').slice(0, 12).map(run => h(RunCard, { key: run.id, run, sub: subs.find(sub => sub.id === run.subId), roster, compact: true }))) : null),
      h('div', { className: 'os-safety' },
        h('span', { className: 'os-safety-icon', 'aria-hidden': true }, h(ShieldIcon)),
        h('div', null, h('strong', null, t('Messages come from other people')),
          h('span', null, t('Anyone in a watched chat can write text that tries to steer a Bot. Work started by an event runs with no secrets and asks you before shell, file or network actions, unless you tell {name} otherwise.', { name: bot.name }))))))
}

function Empty({ bot, live }) {
  const examples = [
    t('Watch #ci-alerts for “failed” or “error” and hand it to Ops'),
    t('When I react 📌 to a message in any WhatsApp chat, save it to my notes'),
    t('Voice notes in my own chat go to one ongoing session'),
  ]
  return h('div', { className: 'os-empty-board' },
    h(BotMark, { bot, size: 64, live: true }),
    h('strong', null, t('Tell {name} what to watch', { name: bot.name })),
    h('span', null, live ? t('Say it in the chat. {name} finds the chats, asks what is missing, and the subscription shows up here.', { name: bot.name })
      : t('Omni is not connected to this DSH yet, so there is nothing to watch.')),
    h('div', { className: 'os-examples' }, examples.map(text => h('span', { key: text, className: 'os-example' }, text))))
}

function SubCard({ sub, roster, runs }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState('')
  const fresh = Date.now() - (sub.updatedAt ?? 0) < FRESH_MS
  const run = async (endpoint, payload) => {
    setBusy(endpoint)
    try { await call(endpoint, payload) } finally { setBusy('') }
  }
  const last = runs[0]
  return h('div', { className: 'os-card', 'data-off': sub.on ? undefined : true, 'data-fresh': fresh || undefined },
    h('div', { className: 'os-card-top' },
      h(TriggerBadge, { trigger: sub.trigger, size: 34 }),
      h('strong', null, sub.name),
      h('button', {
        type: 'button', role: 'switch', 'aria-checked': sub.on, className: 'os-switch', disabled: busy !== '',
        'aria-label': sub.on ? t('Pause {name}', { name: sub.name }) : t('Resume {name}', { name: sub.name }),
        onClick: () => run('subscription-set-on', { id: sub.id, on: !sub.on }),
      }, h('span'))),
    h(Sentence, { sub, roster }),
    h('div', { className: 'os-card-foot' },
      h('span', { className: 'os-card-meta' }, last ? t('last run {time}', { time: relativeShort(last.at) }) : t('not fired yet')),
      sub.askFirst ? null : h('span', { className: 'os-card-meta os-card-warn' }, t('acts without asking')),
      h('button', { type: 'button', className: 'os-link', disabled: busy !== '', onClick: () => run('subscription-test', { id: sub.id }) }, t('Test')),
      h('button', {
        type: 'button', className: confirming ? 'os-link os-link-danger' : 'os-link', disabled: busy !== '',
        onBlur: () => setConfirming(false),
        onClick: () => (confirming ? run('subscription-delete', { id: sub.id }) : setConfirming(true)),
      }, confirming ? t('Click again to delete') : t('Delete'))))
}

function RunCard({ run, sub, roster, compact = false }) {
  if (!sub) return null
  const status = RUN_STATUS[run.status]
  return h('div', { className: `os-runcard${compact ? ' os-runcard-compact' : ''}`, 'data-tone': status.tone },
    h(WorkerMark, { worker: sub.worker, roster, size: compact ? 24 : 30 }),
    h('div', { className: 'os-runcard-body' },
      h('div', { className: 'os-runcard-top' },
        h('strong', null, workerOf(sub.worker, roster).name),
        h('span', { className: 'oc-pill', 'data-tone': status.tone === 'bad' ? 'warn' : status.tone }, h('span', { className: 'oc-pill-dot', 'aria-hidden': true }), run.test ? t('Test') : t(status.label)),
        h('span', { className: 'os-runcard-sub' }, sub.name),
        h('time', null, relativeShort(run.at))),
      run.excerpt && !run.test ? h('div', { className: 'os-quote' }, h('span', null, run.from), ' ', run.excerpt) : null,
      h('div', { className: 'os-summary' }, run.summary)))
}

// -------------------------------------------------------------------------

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

/* Tentacall's header button */
.os-head-btn{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 10px 0 12px;margin-left:8px;border-radius:999px;border:.5px solid var(--bt-line-2);background:var(--bt-main);color:var(--bt-ink);font:inherit;font-size:13px;cursor:pointer;pointer-events:auto;box-shadow:0 2px 8px -1px rgba(0,0,0,.06)}
.os-head-btn:hover,.os-head-btn[aria-pressed=true]{background:var(--bt-hover)}
.os-head-count{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--bt-hover);color:var(--bt-ink-2);font-size:11px;line-height:18px;text-align:center;box-sizing:border-box}

/* Board */
.os-to-board{align-self:flex-start;margin:10px 0 0 12px;height:28px;padding:0 10px;border:0;border-radius:999px;background:var(--bt-hover);color:var(--bt-ink-2);font:inherit;font-size:12.5px;cursor:pointer}
.os-to-board:hover{color:var(--bt-ink)}
.os-board{display:flex;flex-direction:column;min-height:0;flex:1}
.os-board-head{display:flex;align-items:center;gap:8px;height:52px;flex:none;padding:0 10px 0 12px;border-bottom:.5px solid var(--bt-line)}
.os-board-who{display:inline-flex;align-items:center;gap:8px;margin-right:auto;padding:4px 8px 4px 4px;border:0;border-radius:10px;background:none;color:var(--bt-ink);font:inherit;font-size:15px;cursor:pointer}
.os-board-who:hover{background:var(--bt-hover)}
.os-board-who strong{font-weight:600}
.os-board .oc-preview-chip{margin-left:0}
.os-board-body{flex:1;min-height:0;overflow-y:auto;padding:14px 14px 20px;display:flex;flex-direction:column;gap:10px}
.os-board-note{margin:0;font-size:12.5px;line-height:18px;color:var(--bt-ink-2)}
.os-board-h{margin:8px 2px 0;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--bt-ink-3)}
.os-empty-board{display:flex;flex-direction:column;align-items:center;gap:10px;padding:28px 12px 12px;text-align:center}
.os-empty-board>strong{font-size:17px;font-weight:600}
.os-empty-board>span{max-width:340px;font-size:13.5px;line-height:20px;color:var(--bt-ink-2)}
.os-examples{display:flex;flex-direction:column;gap:6px;width:100%;margin-top:6px}
.os-example{padding:9px 12px;border-radius:14px;background:var(--bt-card);border:.5px dashed var(--bt-line-2);font-size:13px;line-height:19px;color:var(--bt-ink-2);text-align:left}
.os-example::before{content:"“";color:var(--bt-ink-3)}
.os-example::after{content:"”";color:var(--bt-ink-3)}

/* Sentence */
.os-sentence{margin:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 4px;font-size:13.5px;line-height:26px}
.os-w{color:var(--bt-ink-3);font-weight:500}
.os-chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px;border-radius:999px;background:var(--bt-main);border:.5px solid var(--bt-line-2);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.os-chip-trigger{background:color-mix(in srgb,var(--bt-accent) 10%,var(--bt-card));border-color:color-mix(in srgb,var(--bt-accent) 30%,transparent)}
.os-chip-worker{font-weight:500}
.os-chip-soft{background:none;color:var(--bt-ink-2);border-style:dashed}
.os-emoji{font-size:15px}

/* Cards */
.os-card{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:16px;border:.5px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink)}
.os-card[data-off]{opacity:.6}
.os-card[data-fresh]{animation:os-fresh 2.4s cubic-bezier(.2,0,0,1)}
@keyframes os-fresh{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--bt-accent) 0%,transparent);transform:translateY(6px);opacity:.4}20%{box-shadow:0 0 0 4px color-mix(in srgb,var(--bt-accent) 35%,transparent);transform:none;opacity:1}100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--bt-accent) 0%,transparent)}}
.os-card-top{display:flex;align-items:center;gap:10px}
.os-card-top strong{flex:1;min-width:0;font-size:14.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.os-card-foot{display:flex;align-items:center;gap:12px}
.os-card-meta{font-size:12px;color:var(--bt-ink-3)}
.os-card-meta:first-child{margin-right:auto}
.os-card-warn{color:#d97706}
.os-link{border:0;background:none;padding:0;color:var(--bt-ink-2);font:inherit;font-size:12.5px;cursor:pointer}
.os-link:hover:not(:disabled){color:var(--bt-ink);text-decoration:underline}
.os-link:disabled{opacity:.5;cursor:default}
.os-link-danger{color:var(--bt-danger);font-weight:600}
.os-switch{position:relative;flex:none;width:38px;height:22px;border-radius:999px;border:0;padding:0;background:var(--bt-line-2);cursor:pointer;transition:background-color .15s ease}
.os-switch span{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .18s cubic-bezier(.2,0,0,1)}
.os-switch[aria-checked=true]{background:var(--bt-accent)}
.os-switch[aria-checked=true] span{transform:translateX(16px)}
.os-switch:disabled{opacity:.6}
.os-runcard{display:flex;gap:10px;padding:12px 14px;border-radius:14px;background:var(--bt-card);border:.5px solid var(--bt-line-2)}
.os-runcard[data-tone=warn]{border:1px solid color-mix(in srgb,#f59e0b 40%,transparent);background:color-mix(in srgb,#f59e0b 6%,var(--bt-card))}
.os-runcard-compact{padding:9px 12px}
.os-runcard-body{display:flex;flex-direction:column;gap:5px;flex:1;min-width:0}
.os-runcard-top{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:13px}
.os-runcard-top time{margin-left:auto;font-size:11.5px;color:var(--bt-ink-3)}
.os-runcard-sub{font-size:12px;color:var(--bt-ink-2)}
.os-runcard .oc-pill{height:20px;font-size:11px;padding:0 8px}
.os-quote{padding:5px 9px;border-left:3px solid var(--bt-line-2);border-radius:4px;background:var(--bt-hover);font-size:12.5px;line-height:18px;color:var(--bt-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.os-quote span{font-weight:600;color:var(--bt-ink)}
.os-summary{font-size:13px;line-height:19px}
.os-safety{display:flex;align-items:flex-start;gap:12px;margin-top:6px;padding:12px 14px;border-radius:14px;background:color-mix(in srgb,#0ea5e9 7%,var(--bt-card));border:1px solid color-mix(in srgb,#0ea5e9 25%,transparent)}
.os-safety-icon{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:10px;background:color-mix(in srgb,#0ea5e9 14%,transparent);color:#0284c7;flex:none}
.os-safety-icon svg{width:17px;height:17px}
.os-safety>div{display:flex;flex-direction:column;gap:2px;flex:1;font-size:12px;line-height:17px;color:var(--bt-ink-2)}
.os-safety strong{font-size:13px;color:var(--bt-ink)}
@media (prefers-reduced-motion:reduce){.os-card[data-fresh]{animation:none}}
`
