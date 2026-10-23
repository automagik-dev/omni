import { createElement as h, useEffect, useRef, useState } from 'react'
import { call, t } from './core.js'

// Updating an Omni (src/host/omni-update.js): the app asks, the Omni asks its owner on
// WhatsApp, and the owner's reply there runs it. An Omni from before that is updated where
// it runs, with the command shown here to copy.

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

// Status, then the one action it allows. `id` is an Omni found on this computer; without
// it, the linked Omni. `compact` shows nothing until there is an update to offer.
export function UpdateOffer({ id, compact = false }) {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [asked, setAsked] = useState(null)
  const [problem, setProblem] = useState(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => {
    // The notice on the Channels page stays out of the way when the check itself fails.
    call('omni-update-status', id ? { id } : {}).then((reply) => { if (alive.current) setStatus(reply) }, (error) => { if (alive.current && !compact) setProblem(error.message) })
  }, [id, compact])

  const ask = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const reply = await call('omni-update-request', { ...(id ? { id } : {}), version: status.latest })
      if (alive.current) setAsked(reply)
    } catch (error) {
      if (alive.current) setProblem(error.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  if (compact && !['available', 'off', 'pending', 'updating'].includes(status?.state) && !asked && !problem) return null
  const words = asked ? t(CONFIRM_ON_WHATSAPP) : updateWords(status)
  return h('div', { className: `ox-update${compact ? ' ox-update-notice' : ''}`, role: 'status' },
    words ? h('span', { className: 'ox-muted' }, words) : status === null && !problem ? h('span', { className: 'ox-muted' }, t('Checking for updates…')) : null,
    !asked && status?.command && status.state !== 'available' ? h(CopyCommand, { command: status.command }) : null,
    !asked && status?.state === 'available' ? h('button', { type: 'button', className: 'oc-primary', disabled: busy, onClick: ask }, busy ? t('Asking…') : t('Update to {version}', { version: status.latest })) : null,
    problem ? h('span', { className: 'ox-problem', role: 'alert' }, problem) : null)
}

export const OMNI_UPDATE_CSS = `
.ox-update{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:6px}
.ox-update-notice{margin:0 0 16px;padding:10px 14px;border:1px solid var(--bt-line);border-radius:12px;background:color-mix(in srgb,var(--bt-accent) 7%,transparent)}
.ox-command{display:inline-flex;align-items:center;gap:8px}
.ox-command code{padding:4px 8px;border-radius:8px;background:var(--bt-bg,rgba(0,0,0,.2));font:13px ui-monospace,SFMono-Regular,Menlo,monospace;user-select:all}
.ox-copy{height:28px!important;padding:0 10px!important;font-size:12.5px!important}
.ox-confirm{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--bt-line-2);border-radius:12px}
.ox-progress{display:inline-flex;align-items:center;gap:8px;color:var(--bt-ink-2);font-size:13px}
`
