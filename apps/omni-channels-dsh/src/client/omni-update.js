import { createElement as h, Fragment, useEffect, useRef, useState } from 'react'
import { call, t } from './core.js'
import { askUpdate, dismiss, dismissedFor, updateBar, watchStatus } from './update-bar.js'

// Updating an Omni (src/host/omni-update.js): the app asks, the Omni asks its owner on
// WhatsApp, and the owner's reply there runs it. A sandboxed Omni on this computer takes the
// yes here instead (`confirm: 'app'`): the bar asks first, and the update starts at once. An
// Omni from before that is updated where it runs, with the command shown here to copy. On the
// Channels page that is a slim bar.

// A translated sentence with elements in it: each {name} in the template becomes parts[name].
export function rich(template, parts) {
  const marks = Object.fromEntries(Object.keys(parts).map(key => [key, `\uE000${key}\uE000`]))
  return t(template, marks).split(/\uE000(\w+)\uE000/).map((piece, index) => (index % 2 === 1 ? h(Fragment, { key: index }, parts[piece]) : piece))
}

// A command to type in a terminal, with a button that copies it.
export function CopyCommand({ command }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
    } catch {}
  }
  return h('span', { className: 'ox-command' },
    h('code', null, command),
    h('button', { type: 'button', className: 'oc-ghost ox-copy', onClick: copy }, copied ? t('Copied') : t('Copy')))
}

// What an answer from omni-update-status says, in words; null when there is nothing to say.
export function updateWords(status) {
  switch (status?.state) {
    case 'available': return t('Omni {latest} is out. This one runs {current}.', { latest: status.latest, current: status.current ?? '?' })
    case 'off': return t('Omni {latest} is out, but updates from the app are off on this Omni. Update it where it runs:', { latest: status.latest })
    case 'pending': return t('An update to {version} is waiting for your yes on WhatsApp.', { version: status.version })
    case 'updating': return t('Updating to {version}…', { version: status.version })
    case 'current': return t('Up to date ({version}).', { version: status.current ?? status.latest })
    case 'terminal': return t('Update it from a terminal:')
    case 'forbidden': return status.message
    case 'unreachable': return t('Could not reach this Omni to check for updates.')
    case 'unknown': return t('Could not tell whether this Omni has an update.')
    default: return null
  }
}

const CONFIRM_ON_WHATSAPP = 'Confirm on WhatsApp: your Omni sent you a code. Reply update and that code in your chat with yourself.'
const UPDATING_HERE = 'Updating to {version}. Omni restarts by itself in a minute or two.'

// The slim bar on the Channels page (update-bar.js decides what it says): one action, and a ×
// that hides it until the next version of this Omni.
export function UpdateBar({ origin }) {
  const [status, setStatus] = useState(null)
  const [dismissed, setDismissed] = useState(() => dismissedFor(origin))
  // What asking answered: null, 'awaiting-confirmation' (WhatsApp) or 'updating' (the yes was here).
  const [asked, setAsked] = useState(null)
  // An Omni on this computer: the person said Update once, and is asked to be sure.
  const [sure, setSure] = useState(false)
  const [how, setHow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  // Looked at again while it is on screen: the Omni may move on meanwhile. The bar stays out of
  // the way when a look itself fails.
  useEffect(() => watchStatus(() => call('omni-update-status', {}).then((reply) => { if (alive.current) setStatus(reply) }, () => {})), [origin])
  const bar = updateBar(status, dismissed)
  if (!bar) return null
  const close = () => { dismiss(origin, bar.latest); setDismissed(bar.latest) }
  const ask = async () => {
    setBusy(true)
    setProblem(null)
    // What a fresh look says replaces what the bar offered when it no longer offers it.
    const redraw = (next) => { setStatus(next); setSure(false) }
    try {
      const result = await askUpdate(call, bar.latest)
      if (!alive.current) return
      if (result.status) redraw(result.status)
      else setAsked(result.reply?.state === 'updating' ? 'updating' : 'awaiting-confirmation')
    } catch (error) {
      if (!alive.current) return
      if (error.stale) redraw(error.status)
      else setProblem(error.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const here = bar.confirm === 'app'
  let words
  if (asked === 'updating') words = t(UPDATING_HERE, { version: bar.latest })
  else if (asked) words = t(CONFIRM_ON_WHATSAPP)
  else if (sure) words = rich('Update the Omni on this computer to {version}? It stops for a minute or two and comes back by itself.', { version: h('b', null, bar.latest) })
  else if (bar.kind === 'available') {
    const version = h('b', null, `Omni ${bar.latest}`)
    words = bar.current ? rich('{version} is available · you\'re on {current}', { version, current: bar.current }) : rich('{version} is available', { version })
  } else if (bar.kind === 'admin') words = rich('{version} is available. Its admin updates this Omni.', { version: h('b', null, `Omni ${bar.latest}`) })
  else words = updateWords({ state: bar.kind, version: bar.version })
  return h('div', { className: 'ox-bar', role: 'status', 'data-kind': bar.kind },
    h('span', { className: 'ox-bar-dot', 'aria-hidden': true }),
    h('span', { className: 'ox-bar-text' }, words),
    !asked && bar.action === 'update' && !sure ? h('button', { type: 'button', className: 'oc-primary ox-bar-go', disabled: busy, onClick: here ? () => setSure(true) : ask }, busy ? t('Asking…') : t('Update')) : null,
    !asked && sure ? h('button', { type: 'button', className: 'oc-primary ox-bar-go', disabled: busy, onClick: ask }, busy ? t('Starting…') : t('Update now')) : null,
    !asked && sure && !busy ? h('button', { type: 'button', className: 'oc-link', onClick: () => setSure(false) }, t('Not now')) : null,
    bar.action === 'how' ? h('button', { type: 'button', className: 'oc-link', 'aria-expanded': how, onClick: () => setHow(value => !value) }, t('How')) : null,
    bar.action !== 'none' ? h('button', { type: 'button', className: 'ox-bar-x', 'aria-label': t('Hide until the next version'), title: t('Hide until the next version'), onClick: close }, '×') : null,
    how ? h('div', { className: 'ox-bar-how' }, bar.command
      ? h(Fragment, null, h('span', null, t('Whoever runs this Omni updates it with:')), h(CopyCommand, { command: bar.command }))
      : h('span', null, t('Ask whoever runs your Omni to update it.'))) : null,
    problem ? h('span', { className: 'ox-problem', role: 'alert' }, problem) : null)
}

export const OMNI_UPDATE_CSS = `
.ox-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 6px;padding:9px 12px 9px 14px;border:1px solid var(--bt-line-2);border-radius:12px;background:var(--bt-card);font-size:13.5px}
.ox-bar-dot{width:8px;height:8px;border-radius:50%;background:var(--bt-accent);flex:none}
.ox-bar[data-kind=admin] .ox-bar-dot{background:var(--bt-ink-3)}
.ox-bar-text{flex:1;min-width:200px;color:var(--bt-ink-2)}
.ox-bar-text b{color:var(--bt-ink);font-weight:600}
.ox-bar-go{height:30px!important;padding:0 12px!important;font-size:13px!important}
.ox-bar-x{width:26px;height:26px;border:0;border-radius:8px;background:none;color:var(--bt-ink-3);font-size:18px;line-height:1;cursor:pointer}
.ox-bar-x:hover{background:var(--bt-hover);color:var(--bt-ink)}
.ox-bar-how{flex-basis:100%;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 0 2px 20px;color:var(--bt-ink-2)}
.ox-command{display:inline-flex;align-items:center;gap:8px}
.ox-command code{padding:4px 8px;border-radius:8px;background:var(--bt-bg,rgba(0,0,0,.2));font:13px ui-monospace,SFMono-Regular,Menlo,monospace;user-select:all}
.ox-copy{height:28px!important;padding:0 10px!important;font-size:12.5px!important}
.ox-confirm{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--bt-line-2);border-radius:12px}
.ox-progress{display:inline-flex;align-items:center;gap:8px;color:var(--bt-ink-2);font-size:13px}
`
