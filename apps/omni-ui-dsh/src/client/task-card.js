import { createElement as h, Fragment, useEffect, useState } from 'react'
import { t } from './i18n.js'

// A task a Bot handed on (start_task, agents.js): it shows itself working, where the user
// can watch, then what it found.

// Now, once a second, while `on`.
function useNow(on) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [on])
  return now
}

const duration = (ms) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}:${String(seconds % 60).padStart(2, '0')}` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function TaskCard({ sessionId, title, task, onOpen }) {
  const status = task?.status ?? 'working'
  const working = status === 'working'
  const now = useNow(working)
  const started = task?.at ?? now
  const elapsed = (task?.endedAt ?? now) - started
  return h('section', { className: 'op-task', 'data-state': status },
    h('div', { className: 'op-task-in' },
      h('div', { className: 'op-task-head' },
        h('span', { className: 'op-task-mark', 'aria-hidden': true },
          working ? h('span', { className: 'op-orbit' }, h('i'), h('i'), h('i'))
            : status === 'done' ? h('svg', { viewBox: '0 0 20 20', width: 18, height: 18 }, h('path', { d: 'M5 10.5l3.2 3L15 6.5', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }))
              : h('svg', { viewBox: '0 0 20 20', width: 16, height: 16 }, h('path', { d: 'M6 6l8 8M14 6l-8 8', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' }))),
        h('div', { className: 'op-task-titles' },
          h('span', { className: 'op-task-kicker' }, working ? t('Task running') : status === 'done' ? t('Task finished') : t('Task stopped')),
          h('strong', { className: 'op-task-title' }, title)),
        h('span', { className: 'op-task-time' }, duration(elapsed))),
      working ? h(Fragment, null,
        h('div', { className: 'op-task-live' },
          task?.said ? h('span', { key: task.said, className: 'op-task-said' }, task.said)
            : h('span', { className: 'op-task-said op-task-quiet' }, t('Getting started…')),
          task?.steps ? h('span', { className: 'op-task-steps' }, t('step {count}', { count: task.steps })) : null),
        h('div', { className: 'op-task-bar', 'aria-hidden': true }, h('i')))
        : task?.summary ? h('p', { className: 'op-task-summary' }, task.summary) : null,
      sessionId ? h('button', { type: 'button', className: 'op-task-open', onClick: onOpen }, working ? t('Watch it work') : t('Open task'), ' →') : null))
}

export const TASK_CSS = `
@property --op-angle{syntax:'<angle>';inherits:false;initial-value:0deg}
@keyframes op-spin{to{--op-angle:360deg}}
@keyframes op-card-in{from{opacity:0;transform:translateY(8px) scale(.985);filter:blur(3px)}}
@keyframes op-pop{from{transform:scale(0)}}
@keyframes op-row-in{from{opacity:0;transform:translateY(6px);filter:blur(2px)}}
.op-task{position:relative;max-width:640px;padding:1.5px;border-radius:20px;background:conic-gradient(from var(--op-angle),color-mix(in srgb,var(--bt-accent) 30%,transparent),var(--bt-accent),#a78bfa,#f472b6,color-mix(in srgb,var(--bt-accent) 30%,transparent));animation:op-card-in .45s cubic-bezier(.2,.8,.2,1),op-spin 3s linear infinite}
.op-task[data-state=done]{background:linear-gradient(135deg,#00c972,color-mix(in srgb,#00c972 30%,var(--bt-line)));animation:op-card-in .45s cubic-bezier(.2,.8,.2,1)}
.op-task[data-state=failed]{background:color-mix(in srgb,#e5484d 50%,var(--bt-line));animation:none}
.op-task-in{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:18.5px;background:var(--bt-card)}
.op-task-head{display:flex;align-items:center;gap:12px;min-width:0}
.op-task-mark{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:12px;background:color-mix(in srgb,var(--bt-accent) 12%,transparent);color:var(--bt-accent)}
.op-task[data-state=done] .op-task-mark{background:#00c972;color:#fff;animation:op-pop .55s cubic-bezier(.3,1.6,.5,1)}
.op-task[data-state=failed] .op-task-mark{background:#e5484d;color:#fff}
.op-orbit{position:relative;width:20px;height:20px;animation:op-turn 1.1s linear infinite}
.op-orbit i{position:absolute;width:6px;height:6px;border-radius:50%;background:currentColor}
.op-orbit i:nth-child(1){top:0;left:7px}
.op-orbit i:nth-child(2){bottom:2px;left:1px;opacity:.6}
.op-orbit i:nth-child(3){bottom:2px;right:1px;opacity:.3}
@keyframes op-turn{to{transform:rotate(360deg)}}
.op-task-titles{display:flex;flex-direction:column;flex:1;min-width:0}
.op-task-kicker{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--bt-ink-3)}
.op-task-title{font-size:14.5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.op-task-time{flex:none;font-size:13px;font-variant-numeric:tabular-nums;color:var(--bt-ink-2)}
.op-task-live{display:flex;align-items:baseline;gap:10px;min-width:0;font-size:13px}
.op-task-said{flex:1;min-width:0;color:var(--bt-ink-2);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;animation:op-row-in .4s ease both}
.op-task-quiet{color:var(--bt-ink-3)}
.op-task-steps{flex:none;font-size:11.5px;color:var(--bt-ink-3)}
.op-task-bar{position:relative;height:3px;border-radius:2px;overflow:hidden;background:var(--bt-hover)}
.op-task-bar i{position:absolute;top:0;bottom:0;width:35%;border-radius:2px;background:linear-gradient(90deg,transparent,var(--bt-accent),#a78bfa,transparent);animation:op-slide 1.4s ease-in-out infinite}
@keyframes op-slide{from{left:-35%}to{left:100%}}
.op-task-summary{margin:0;font-size:13.5px;line-height:20px;color:var(--bt-ink);display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;animation:op-row-in .45s ease both}
.op-task-open{align-self:flex-start;padding:0;border:0;background:none;color:var(--bt-accent);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.op-task-open:hover{text-decoration:underline;text-underline-offset:3px}
@media (prefers-reduced-motion:reduce){.op-task,.op-task-said,.op-task-summary,.op-orbit,.op-task-bar i{animation:none!important}}
body[data-bt-motion=quiet] :is(.op-task,.op-task-said,.op-task-summary,.op-orbit,.op-task-bar i){animation:none!important}
`
