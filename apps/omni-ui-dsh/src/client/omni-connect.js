import { createElement as h, useEffect, useRef, useState } from 'react'
import { call } from './api.js'
import { OmniMark } from './logo.js'
import { QrSvg } from './omni-live.js'
import { refreshLive } from './omni-store.js'
import { t } from './i18n.js'

// Connecting this Omni UI to an Omni, by code: no key to find or paste. The host asks the
// Omni at the address for a pairing (src/host/omni-link.js); this card shows the code and
// where to send it on WhatsApp, polls until it arrives, and the Channels page goes live.
// The poll token stays on the host.

const DEFAULT_POLL_MS = 2000

export function ConnectOmni() {
  const [address, setAddress] = useState('')
  const [pairing, setPairing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const [done, setDone] = useState(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  // A pairing started before a reload keeps going.
  useEffect(() => {
    call('omni-link').then((link) => { if (alive.current && link?.pairing) setPairing(link.pairing) }, () => {})
  }, [])

  useEffect(() => {
    if (!pairing) return undefined
    let timer = 0
    const tick = async () => {
      try {
        const reply = await call('omni-pair-poll')
        if (!alive.current) return
        if (reply.status === 'paired') {
          setPairing(null)
          setDone(reply.origin)
          await refreshLive(call).catch(() => {})
          return
        }
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

  const start = async (event) => {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const reply = await call('omni-pair-start', { url: address })
      if (alive.current) setPairing(reply.pairing)
    } catch (error) {
      if (alive.current) setProblem(error.message)
    } finally {
      if (alive.current) setBusy(false)
    }
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

  return h('form', { className: 'ox-card ox-start', onSubmit: start },
    h('span', { className: 'ox-mark', 'aria-hidden': true }, h(OmniMark, { size: 34 })),
    h('div', { className: 'ox-steps' },
      h('h2', null, t('Connect your Omni')),
      h('p', { className: 'ox-muted' }, t('Type its address, then approve this device from your phone: on WhatsApp, or with Face ID or your fingerprint. No keys to copy.')),
      h('div', { className: 'ox-row' },
        h('input', {
          className: 'ox-input', type: 'text', inputMode: 'url', autoComplete: 'url', spellCheck: false, value: address,
          placeholder: 'omni.example.com', 'aria-label': t('Omni address'), onChange: event => setAddress(event.target.value),
        }),
        h('button', { type: 'submit', className: 'oc-primary', disabled: busy || address.trim() === '' }, busy ? t('Connecting…') : t('Get a code'))),
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
.ox-done{align-items:center;gap:12px}
.ox-check{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--bt-accent);color:#fff;font-weight:700}
@media (max-width:720px){.ox-card{flex-direction:column}.ox-qr{align-self:center}}
`
