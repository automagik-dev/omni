import { createElement as h, Fragment, useEffect, useMemo, useState } from 'react'
import { ClockIcon, PlusIcon, SearchIcon } from './icons.js'
import { BotMark } from './mark.js'
import { t } from './i18n.js'
import { relativeShort } from './text.js'
import { call } from './api.js'
import { AutomationRow } from './subscriptions.js'
import { runsOf } from './omni-store.js'
import { whenText } from './automation-time.js'

// Automations: one place for everything that runs on its own, in the shape of DSH's
// Automation tasks page (filters, search, rows). Event automations (Omni's) and the
// team's scheduled tasks (DSH's schedule service) sit in one list. There is no form: "New"
// opens Omni's chat, where the user says what to automate.

export const AUTOMATIONS_PANEL = 'omni-automations'

export function AutomationsPage({ useRoster, actions }) {
  const roster = useRoster(value => value)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [schedules, setSchedules] = useState({ available: false, tasks: [] })
  useEffect(() => {
    let live = true
    const load = () => call('schedules').then((value) => { if (live) setSchedules(value) }, () => {})
    load()
    const timer = setInterval(load, 10_000)
    return () => { live = false; clearInterval(timer) }
  }, [])
  const events = roster.subscriptions ?? []
  const runs = runsOf(roster)
  const autopilot = roster.byId?.[roster.eventsBotId]
  const needle = query.trim().toLowerCase()
  const rows = useMemo(() => {
    const list = [
      ...events.map(sub => ({ kind: 'event', id: sub.id, on: sub.on, title: sub.name, sort: sub.createdAt, sub })),
      ...schedules.tasks.map(task => ({ kind: 'schedule', id: `${task.sessionId}:${task.id}`, on: task.status === 'active', title: task.title, sort: Date.parse(task.scheduledAt) || 0, task })),
    ]
    return list
      .filter(row => filter === 'all' || (filter === 'enabled' ? row.on : !row.on))
      .filter(row => needle === '' || row.title.toLowerCase().includes(needle) || (row.task?.prompt ?? '').toLowerCase().includes(needle))
  }, [events, schedules, filter, needle])
  const talk = () => { if (autopilot) actions.openSession(autopilot.id) }
  return h('div', { className: 'oa-page' },
    h('div', { className: 'oa-in' },
      h('header', { className: 'oa-head' },
        h('h1', null, t('Automations')),
        h('button', { type: 'button', className: 'oa-new', disabled: !autopilot, onClick: talk, title: autopilot ? t('Tell {name} what to automate', { name: autopilot.name }) : undefined }, h(PlusIcon), t('New'))),
      h('p', { className: 'oa-lede' }, autopilot
        ? t('Things that run on their own: when something happens in your chats, or on a schedule. Say what you want to {name}; it sets it up and it shows here.', { name: autopilot.name })
        : t('Things that run on their own, on a schedule or when something happens in your chats.')),
      h('div', { className: 'oa-filters', role: 'radiogroup', 'aria-label': t('Show') },
        [['all', t('All')], ['enabled', t('Enabled')], ['inactive', t('Inactive')]].map(([value, label]) => h('button', {
          key: value, type: 'button', role: 'radio', 'aria-checked': filter === value, onClick: () => setFilter(value),
        }, label))),
      h('label', { className: 'oa-search' }, h(SearchIcon), h('input', { value: query, placeholder: t('Search automations'), 'aria-label': t('Search automations'), onChange: event => setQuery(event.target.value) })),
      rows.length === 0
        ? h('div', { className: 'oa-empty' },
          h(ClockIcon),
          h('span', null, events.length + schedules.tasks.length === 0 ? t('Nothing runs on its own yet.') : t('No automations match.')),
          autopilot ? h('button', { type: 'button', className: 'oa-empty-go', onClick: talk }, t('Tell {name} what to automate', { name: autopilot.name })) : null)
        : h('div', { className: 'oa-list' }, rows.map(row => (row.kind === 'event'
          ? h(AutomationRow, { key: row.id, sub: row.sub, roster, runs: runs.filter(run => run.subId === row.id), onOpen: talk })
          : h(ScheduleRow, { key: row.id, task: row.task, roster, actions }))))))
}

function ScheduleRow({ task, roster, actions }) {
  const owner = roster.byId?.[task.botId]
  const room = roster.roomsById?.[task.roomId]
  const active = task.status === 'active'
  return h('button', { type: 'button', className: 'os-row oa-schedule', 'data-off': active ? undefined : true, onClick: () => actions.selectPanel('schedules'), title: t('Edit the timing in Automation tasks') },
    h('span', { className: 'os-trigger', 'data-kind': 'schedule', style: { width: 28, height: 28, '--os-icon': '15px' } }, h(ClockIcon)),
    h('span', { className: 'os-row-body' },
      h('span', { className: 'os-row-top' }, h('span', { className: 'os-row-name' }, task.title),
        h('span', { className: 'oa-tag' }, active ? t('Scheduled') : t('Inactive'))),
      h('span', { className: 'os-sentence' },
        h('span', { className: 'os-chip' }, whenText(task)),
        h('span', { className: 'os-w' }, '→'),
        h('span', { className: 'os-chip' }, owner ? h(Fragment, null, h(BotMark, { bot: owner, size: 16 }), owner.name) : room?.name ?? t('a chat'))),
      h('span', { className: 'os-row-foot' },
        h('span', null, active && task.scheduledAt ? t('next run {time}', { time: new Date(task.scheduledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })
          : task.lastDelivery ? t('last run {time}', { time: relativeShort(Date.parse(task.lastDelivery.deliveredAt ?? task.lastDelivery) || Date.now()) }) : t('not run yet')))))
}

export const AUTOMATIONS_CSS = `
.oa-page{height:100%;overflow-y:auto;background:var(--bt-main);color:var(--bt-ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.oa-in{max-width:880px;margin:0 auto;padding:32px 32px 48px;display:flex;flex-direction:column;gap:14px}
.oa-head{display:flex;align-items:center;justify-content:space-between}
.oa-head h1{margin:0;font-size:24px;line-height:32px;font-weight:600}
.oa-new{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 16px;border:0;border-radius:999px;background:var(--bt-ink);color:var(--bt-main);font:inherit;font-size:14px;font-weight:500;cursor:pointer}
.oa-new svg{width:15px;height:15px}
.oa-new:disabled{opacity:.4;cursor:default}
.oa-lede{margin:-6px 0 4px;max-width:620px;font-size:13.5px;line-height:20px;color:var(--bt-ink-2)}
.oa-filters{display:flex;gap:4px}
.oa-filters button{height:32px;padding:0 14px;border:0;border-radius:10px;background:none;color:var(--bt-ink-2);font:inherit;font-size:14px;cursor:pointer}
.oa-filters button[aria-checked=true]{background:var(--bt-hover);color:var(--bt-ink)}
.oa-search{display:flex;align-items:center;gap:10px;height:42px;padding:0 14px;border-radius:12px;border:1px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink-3)}
.oa-search input{flex:1;min-width:0;border:0;background:none;color:var(--bt-ink);font:inherit;font-size:14px;outline:none}
.oa-list{display:flex;flex-direction:column;border:1px solid var(--bt-line);border-radius:14px;background:var(--bt-card);padding:4px}
.oa-list .os-row{font-size:13.5px}
.oa-schedule{width:100%;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.os-trigger[data-kind=schedule]{color:var(--bt-ink-2)}
.oa-tag{flex:none;font-size:11px;color:var(--bt-ink-3)}
.oa-empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:64px 16px;color:var(--bt-ink-3);font-size:14px}
.oa-empty svg{width:28px;height:28px}
.oa-empty-go{height:38px;padding:0 16px;border-radius:12px;border:1px solid var(--bt-line-2);background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:14px;cursor:pointer}
@media (max-width:720px){.oa-in{padding:20px 16px 40px}}
`
