import { createElement as h, useEffect, useRef, useState } from 'react'
import { parseConnectLink } from './connect-link.js'
import { QrSvg } from './omni-live.js'
import { refreshLive } from './omni-store.js'
import { call, OmniMark, t } from './core.js'

// Connecting this Omni UI to an Omni, by code: no key to find or paste. The host asks the
// Omni at the address for a pairing (src/host/omni-link.js); this card shows the code and
// where to send it on WhatsApp, polls until it arrives, and the Channels page goes live.
// The poll token stays on the host.

const DEFAULT_POLL_MS = 2000
// A sign-in the desktop app started (connectFromApp) is announced to any Connect card on screen.
const PAIRING_EVENT = 'omni:pairing'

/**
 * An omni://connect link the person confirmed in the desktop app: start signing in to that
 * Omni and open its approval page in the browser, where they approve with a passkey (or a
 * code on WhatsApp). The host finishes the sign-in by itself once they have approved.
 */
export async function connectFromApp(url) {
  if (typeof url !== 'string' || url === '') return
  try {
    const reply = await call('omni-pair-start', { url, auto: true })
    window.dispatchEvent(new CustomEvent(PAIRING_EVENT, { detail: reply.pairing }))
    if (reply.pairing?.approveUrl) window.open(reply.pairing.approveUrl, '_blank', 'noopener')
  } catch (error) {
    window.dispatchEvent(new CustomEvent(PAIRING_EVENT, { detail: { problem: error.message } }))
  }
}

// How an Omni found on this computer (src/host/omni-discover.js) is named, and what it says
// under its name.
function foundLabel(omni) {
  if (omni.source === 'sandbox') return t('Your sandboxed Omni on this computer')
  if (!omni.local) return new URL(omni.url).host
  if (omni.source === 'running') return t('An Omni running on this computer')
  return omni.name && omni.name !== 'default' ? t('{name} on this computer', { name: omni.name }) : t('Omni on this computer')
}
function foundDetail(omni) {
  const port = new URL(omni.url).port
  const where = omni.source === 'cli' ? t('from your Omni CLI')
    : omni.source === 'cli-server' ? (omni.name ? t('from your Omni CLI as {name}', { name: omni.name }) : t('from your Omni CLI'))
      : omni.source === 'running' && port ? t('answering on port {port}', { port }) : null
  return [omni.version ? `v${omni.version}` : null, where].filter(Boolean).join(' · ')
}

// One row per Omni found: its one action, or why there is none yet.
function FoundOmni({ omni, busy, onUse }) {
  const action = (label, disabled = false) => h('button', { type: 'button', className: 'oc-primary', disabled: disabled || busy, onClick: disabled ? undefined : () => onUse(omni) }, label)
  let note = null
  let button = null
  if (omni.local && omni.reachable === false) note = t('Not answering right now.')
  else if (omni.hasKey) button = action(t('Use it'))
  else if (omni.pairing === 'too-old') {
    note = t('Omni {version} on this computer is too old to pair. Update it to connect.', { version: omni.version ?? '' })
    button = action(t('Update'), true)
  } else if (omni.pairing === 'off') note = t('Sign-in from devices is off on this Omni.')
  else button = action(t('Connect'))
  const detail = foundDetail(omni)
  return h('li', { className: 'ox-found-row' },
    h('span', { className: 'ox-found-dot', 'aria-hidden': true }),
    h('div', { className: 'ox-found-text' },
      h('strong', null, foundLabel(omni)),
      detail ? h('span', { className: 'ox-muted' }, detail) : null,
      note ? h('span', { className: 'ox-muted' }, note) : null),
    button)
}

// `onPaired(origin)` hears a pairing that succeeded (the onboarding step completes on it);
// `embedded` drops the card's own mark and heading where its host already titles it.
export function ConnectOmni({ onPaired, embedded = false } = {}) {
  const [address, setAddress] = useState('')
  const [linkText, setLinkText] = useState('')
  const [pairing, setPairing] = useState(null)
  const [found, setFound] = useState([])
  const [busy, setBusy] = useState(null)
  const [problem, setProblem] = useState(null)
  const [note, setNote] = useState(null)
  const [done, setDone] = useState(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  // A pairing started before a reload keeps going, and one the desktop app started shows here.
  useEffect(() => {
    call('omni-link').then((link) => { if (alive.current && link?.pairing) setPairing(link.pairing) }, () => {})
    // The Omnis this computer already has: its CLI's, a sandboxed one, one answering here.
    call('omni-discover').then((reply) => { if (alive.current) setFound(Array.isArray(reply?.omnis) ? reply.omnis : []) }, () => {})
    const onPairing = (event) => {
      if (!alive.current) return
      if (event.detail?.problem) setProblem(event.detail.problem)
      else if (event.detail) setPairing(event.detail)
    }
    window.addEventListener(PAIRING_EVENT, onPairing)
    return () => window.removeEventListener(PAIRING_EVENT, onPairing)
  }, [])

  const finish = async (origin) => {
    setPairing(null)
    setDone(origin)
    await refreshLive(call).catch(() => {})
    if (alive.current) onPaired?.(origin)
  }

  useEffect(() => {
    if (!pairing) return undefined
    let timer = 0
    const tick = async () => {
      try {
        const reply = await call('omni-pair-poll')
        if (!alive.current) return
        if (reply.status === 'paired') return finish(reply.origin)
        if (reply.status !== 'pending') {
          setPairing(null)
          setProblem(reply.status === 'denied' ? t('The sign-in was denied.') : reply.status === 'cancelled' ? t('The pairing was cancelled.') : t('The code expired. Start again for a new one.'))
          return
        }
      } catch (error) {
        if (alive.current) setProblem(error.message)
      }
      if (alive.current) timer = setTimeout(tick, pairing.pollIntervalMs ?? DEFAULT_POLL_MS)
    }
    timer = setTimeout(tick, pairing.pollIntervalMs ?? DEFAULT_POLL_MS)
    return () => clearTimeout(timer)
  }, [pairing])

  // Each action answers `paired` (linked already), `pairing` (approve it on the phone), or
  // a message to show (`unavailable`).
  const run = async (which, endpoint, payload) => {
    setBusy(which)
    setProblem(null)
    setNote(null)
    try {
      const reply = await call(endpoint, payload)
      if (!alive.current) return
      if (reply.status === 'paired') await finish(reply.origin)
      else if (reply.pairing) setPairing(reply.pairing)
      else if (reply.message) setNote(reply.message)
    } catch (error) {
      if (alive.current) setProblem(error.message)
    } finally {
      if (alive.current) setBusy(null)
    }
  }
  const start = (event) => {
    event.preventDefault()
    return run('address', 'omni-pair-start', { url: address })
  }
  const pasteLink = (event) => {
    event.preventDefault()
    const link = parseConnectLink(linkText)
    if (link === null) {
      setNote(null)
      setProblem(t('That is not a link your Omni sends. It looks like https://your-omni/api/login/app?grant=…'))
      return undefined
    }
    return run('link', 'omni-connect-grant', link)
  }
  const cancel = async () => {
    setPairing(null)
    await call('omni-pair-cancel').catch(() => {})
  }

  if (done) {
    return h('section', { className: 'ox-card ox-done' },
      h('span', { className: 'ox-check', 'aria-hidden': true }, '✓'),
      h('strong', null, t('Connected to {origin}', { origin: done })))
  }

  if (pairing) {
    return h('section', { className: 'ox-card', 'aria-live': 'polite' },
      h('div', { className: 'ox-steps' },
        h('h2', null, t('Approve this device')),
        h('p', { className: 'ox-muted' }, pairing.waLink
          ? t('Scan the QR with your phone: it opens your WhatsApp chat with yourself with the code typed. Send it, and this page goes live.')
          : t('Open the approval page on your phone or here, and approve with Face ID, Touch ID, your fingerprint or a code.')),
        h('div', { className: 'ox-code', 'aria-label': t('Pairing code') }, pairing.code),
        h('div', { className: 'ox-row' },
          pairing.waLink ? h('a', { className: 'oc-primary', href: pairing.waLink, target: '_blank', rel: 'noreferrer' }, t('Open WhatsApp')) : null,
          pairing.approveUrl ? h('a', { className: pairing.waLink ? 'oc-ghost' : 'oc-primary', href: pairing.approveUrl, target: '_blank', rel: 'noreferrer' }, t('Approve with Face ID or fingerprint')) : null,
          h('button', { type: 'button', className: 'oc-ghost', onClick: cancel }, t('Cancel'))),
        h('span', { className: 'ox-wait' }, h('span', { className: 'oc-spinner', 'aria-hidden': true }), t('Waiting for the code to arrive at {origin}…', { origin: pairing.origin })),
        problem ? h('p', { className: 'ox-problem', role: 'alert' }, problem) : null),
      h('div', { className: 'ox-qr' },
        h(QrSvg, { text: pairing.waLink ?? pairing.approveUrl, size: 168 }),
        h('span', { className: 'ox-muted' }, pairing.waLink ? t('Scan to send it on WhatsApp') : t('Scan to approve on your phone'))))
  }

  const anyBusy = busy !== null
  return h('section', { className: 'ox-card ox-start' },
    embedded ? null : h('span', { className: 'ox-mark', 'aria-hidden': true }, h(OmniMark, { size: 34 })),
    h('div', { className: 'ox-steps' },
      embedded ? null : h('h2', null, t('Connect your Omni')),
      found.length > 0 ? h('h3', { className: 'ox-sub' }, t('We found')) : null,
      found.length > 0 ? h('ul', { className: 'ox-found' }, found.map(omni => h(FoundOmni, { key: omni.id, omni, busy: anyBusy, onUse: entry => run(entry.id, 'omni-discover-use', { id: entry.id }) }))) : null,
      found.length > 0 ? h('h3', { className: 'ox-sub' }, t('Connect another Omni')) : null,
      h('p', { className: 'ox-muted' }, t('Type your Omni\'s address, or paste the link it sent you. Then approve with Face ID, Touch ID, your fingerprint or a code on WhatsApp. No keys to copy.')),
      h('form', { className: 'ox-row', onSubmit: start },
        h('input', {
          className: 'ox-input', type: 'text', inputMode: 'url', autoComplete: 'url', spellCheck: false, value: address,
          placeholder: 'omni.example.com', 'aria-label': t('Omni address'), onChange: event => setAddress(event.target.value),
        }),
        h('button', { type: 'submit', className: 'oc-primary', disabled: anyBusy || address.trim() === '' }, busy === 'address' ? t('Connecting…') : t('Get a code'))),
      h('form', { className: 'ox-row', onSubmit: pasteLink },
        h('input', {
          className: 'ox-input', type: 'text', inputMode: 'url', autoComplete: 'off', spellCheck: false, value: linkText,
          placeholder: t('or paste the link your Omni sent you'), 'aria-label': t('Link from your Omni'), onChange: event => setLinkText(event.target.value),
        }),
        h('button', { type: 'submit', className: 'oc-ghost', disabled: anyBusy || linkText.trim() === '' }, busy === 'link' ? t('Connecting…') : t('Connect'))),
      h('p', { className: 'ox-muted ox-hint' }, t('Text connect to yourself on WhatsApp and your Omni sends you the link.')),
      h('div', { className: 'ox-row' },
        h('button', { type: 'button', className: 'oc-ghost', disabled: anyBusy, onClick: () => run('local', 'omni-local-install') }, busy === 'local' ? t('Starting…') : t('Run Omni on this computer'))),
      note ? h('p', { className: 'ox-muted ox-note', role: 'status' }, note) : null,
      problem ? h('p', { className: 'ox-problem', role: 'alert' }, problem) : null))
}

export const OMNI_CONNECT_CSS = `
.ox-card{display:flex;gap:22px;align-items:flex-start;margin:4px 0 22px;padding:20px 22px;border:1px solid var(--bt-line);border-radius:16px;background:color-mix(in srgb,var(--bt-accent) 5%,var(--bt-surface,transparent))}
.ox-start{align-items:center}
.ox-mark{flex:none;display:inline-grid;place-items:center;width:56px;height:56px;border-radius:16px;background:color-mix(in srgb,var(--bt-accent) 12%,transparent);color:var(--bt-ink)}
.ox-steps{display:flex;flex-direction:column;gap:10px;min-width:0;flex:1}
.ox-steps h2{margin:0;font-size:16px;font-weight:600}
.ox-muted{margin:0;color:var(--bt-ink-2);font-size:13px;line-height:1.45}
.ox-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ox-input{flex:1;min-width:200px;height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--bt-line-2);background:var(--bt-bg,transparent);color:var(--bt-ink);font:inherit;font-size:14px}
.ox-input:focus{outline:2px solid color-mix(in srgb,var(--bt-accent) 55%,transparent);outline-offset:1px}
.ox-code{font:600 34px/1.1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;color:var(--bt-ink);user-select:all}
.ox-wait{display:inline-flex;align-items:center;gap:8px;color:var(--bt-ink-2);font-size:12.5px}
.ox-problem{margin:0;color:var(--oc-bad,#c0392b);font-size:13px}
.ox-qr{flex:none;display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px;border-radius:12px;background:#fff}
.ox-qr .ox-muted{color:#555;font-size:11.5px}
.ox-sub{margin:4px 0 0;font-size:11.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--bt-ink-2)}
.ox-found{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.ox-found-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-bg,transparent)}
.ox-found-dot{flex:none;width:9px;height:9px;border-radius:50%;background:var(--bt-accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--bt-accent) 18%,transparent)}
.ox-found-text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.ox-found-text strong{font-size:14px;font-weight:600;overflow-wrap:anywhere}
.ox-hint,.ox-note{font-size:12.5px}
.ox-done{align-items:center;gap:12px}
.ox-check{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--bt-accent);color:#fff;font-weight:700}
@media (max-width:720px){.ox-card{flex-direction:column}.ox-qr{align-self:center}}
`
