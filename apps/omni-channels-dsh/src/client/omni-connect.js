import { createElement as h, useEffect, useRef, useState } from 'react'
import { parseConnectLink } from './connect-link.js'
import { QrSvg } from './omni-live.js'
import { refreshLive } from './omni-store.js'
import { call, OmniMark, t } from './core.js'
import { InlineTerminal, OMNI_TERMINAL_CSS } from './omni-terminal.js'
import { OMNI_UPDATE_CSS } from './omni-update.js'

// Connecting this Omni UI to an Omni, one choice at a time: each Omni this computer already
// has (src/host/omni-discover.js), an Omni somewhere else (its address, or the link it sent
// on WhatsApp), or a new one run here. Only the row picked opens. Updating a found Omni and
// setting one up here happen in a terminal on the row (omni-terminal.js), where nothing runs
// until the person presses Enter. Keys stay on the host: the page sees where it linked.

const DEFAULT_POLL_MS = 2000
// A sign-in the desktop app started (connectFromApp) is announced to any Connect card on screen.
const PAIRING_EVENT = 'omni:pairing'
const REMOTE = 'remote'
const LOCAL = 'local'

/**
 * An omni://connect link the person confirmed in the desktop app. One with a grant (the
 * owner texted "connect" and tapped the link their Omni sent) links at once. One without
 * starts signing in to that Omni and opens its approval page in the browser, where they
 * approve with a passkey (or a code on WhatsApp); the host finishes the sign-in by itself.
 */
export async function connectFromApp(url, grant) {
  if (typeof url !== 'string' || url === '') return
  try {
    if (typeof grant === 'string' && grant !== '') {
      const reply = await call('omni-connect-grant', { url, grant })
      await refreshLive(call).catch(() => {})
      window.dispatchEvent(new CustomEvent(PAIRING_EVENT, { detail: { paired: reply.origin } }))
      return
    }
    const reply = await call('omni-pair-start', { url, auto: true })
    if (reply.status === 'unavailable') {
      window.dispatchEvent(new CustomEvent(PAIRING_EVENT, { detail: { problem: unavailableWords(reply) } }))
      return
    }
    window.dispatchEvent(new CustomEvent(PAIRING_EVENT, { detail: reply.pairing }))
    if (reply.pairing?.approveUrl) window.open(reply.pairing.approveUrl, '_blank', 'noopener')
  } catch (error) {
    window.dispatchEvent(new CustomEvent(PAIRING_EVENT, { detail: { problem: error.message } }))
  }
}

export const onMac = (scope = globalThis) => /Mac/i.test(scope.navigator?.platform ?? '') || /Mac OS X/.test(scope.navigator?.userAgent ?? '')

const portOf = (url) => {
  try {
    return new URL(url).port
  } catch {
    return ''
  }
}
const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * What a found Omni's row shows and offers: its title and the line under it, a badge with
 * its tone, a note for when it is open, and its one action: `update` (the Omni CLI runs it
 * and it is too old to pair), `reinstall` (the sandboxed one, from an earlier release), `use`
 * (this computer has its key), `connect` (sign this device in), `elsewhere` (another app runs
 * it, so the person runs a new one here instead), or none.
 */
export function foundRow(omni, { mac = false, linked = false } = {}) {
  const title = omni.source === 'sandbox' ? (mac ? t('Your Omni on this Mac') : t('Your Omni on this computer'))
    : !omni.local ? hostOf(omni.url)
      : mac ? t('Omni on this Mac') : t('Omni on this computer')
  const port = portOf(omni.url)
  const where = omni.local ? (port ? t('port {port}', { port }) : null)
    : omni.name && omni.name !== 'default' ? t('saved in your Omni CLI as {name}', { name: omni.name }) : t('saved in your Omni CLI')
  const sub = [omni.version ? `v${omni.version}` : null, where].filter(Boolean).join(' · ')
  // An Omni that cannot approve this app takes a pasted API key instead (`keyEntry`); `keyHint`
  // when another app runs it, so its key is wherever that app keeps its settings.
  const keyEntry = !linked && !omni.hasKey && omni.reachable !== false && ['too-old', 'off', 'unclaimed'].includes(omni.pairing)
  const row = (badge, tone, action, note) => ({ title, sub, badge, tone, action, note, keyEntry, keyHint: keyEntry && action === 'elsewhere' })
  if (linked) return row(t('Connected'), 'ok', null, null)
  if (omni.local && omni.reachable === false) return row(t('Not answering'), 'muted', null, t('It is not answering right now.'))
  if (omni.updateTo) return row(t('Needs an update'), 'warn', 'reinstall', t('It runs an older Omni than this app. Updating takes about a minute and keeps its chats and channels.'))
  if (omni.pairing === 'too-old') {
    if (omni.manager === 'cli') return row(t('Needs an update'), 'warn', 'update', t('It is too old to pair with this app. Updating takes about a minute and keeps your chats and channels.'))
    if (omni.hasKey) return row(t('Ready'), 'ok', 'use', t('This computer has its key, so it connects without a code.'))
    return row(t('Managed by another app'), 'muted', 'elsewhere', mac
      ? t('It is too old to pair with this app, and another app runs it, so this one cannot update it. Update it where it runs, or run a new Omni on this Mac.')
      : t('It is too old to pair with this app, and another app runs it, so this one cannot update it. Update it where it runs, or run a new Omni on this computer.'))
  }
  if (omni.hasKey) return row(t('Ready'), 'ok', 'use', t('This computer has its key, so it connects without a code.'))
  if (omni.pairing === 'off') return row(t('Sign-in off'), 'muted', null, t('Sign-in from devices is off on this Omni.'))
  return row(t('Ready'), 'ok', 'connect', t('Approve this device from your phone.'))
}

/**
 * What the page says when a typed address answers that it cannot approve this app
 * (omni-link.js start): too old (`version` from its health), or pairing off.
 */
export function unavailableWords(reply) {
  if (reply?.reason === 'too-old') {
    return reply.version
      ? t('Omni {version} is too old to pair from here. Update it, or paste an API key or the link it sent you.', { version: reply.version })
      : t('This Omni is too old to pair from here. Update it, or paste an API key or the link it sent you.')
  }
  if (reply?.reason === 'off') return t('Pairing is off on this Omni. Its owner can turn it on, or you can paste an API key.')
  return reply?.message ?? null
}

// A link made with a key that can do everything (it could not make this device its own).
export const noticeWords = notice => (notice === 'broad-key' ? t('This key can do everything on your Omni; consider giving this device its own key.') : null)

/**
 * The row to open first: the first found Omni with something to do, else the remote one.
 */
export function firstOpen(found, { mac = false } = {}) {
  const ready = found.find(omni => ['use', 'connect', 'update', 'reinstall'].includes(foundRow(omni, { mac }).action))
  return ready ? ready.id : REMOTE
}

/**
 * What the one remote input holds: a link the Omni sent (`grant`) or an address (`address`),
 * or nothing to act on yet.
 */
export function readRemote(text) {
  const value = String(text ?? '').trim()
  if (value === '') return null
  const link = parseConnectLink(value)
  if (link) return { kind: 'grant', ...link }
  if (/^omni:/i.test(value) || /[?&]grant=/.test(value)) return { kind: 'bad-link' }
  return { kind: 'address', url: value }
}

function Choice({ id, open, icon, accent, title, sub, badge, tone, onToggle, children }) {
  return h('li', { className: `ox-choice${open ? ' ox-open' : ''}` },
    h('button', { type: 'button', className: 'ox-head', 'aria-expanded': open, 'aria-controls': `ox-body-${id}`, onClick: onToggle },
      h('span', { className: `ox-icon${accent ? ' ox-accent' : ''}`, 'aria-hidden': true }, icon),
      h('span', { className: 'ox-what' }, h('strong', null, title), sub ? h('small', null, sub) : null),
      badge ? h('span', { className: `ox-badge ox-${tone}` }, badge) : null,
      h('span', { className: 'ox-chev', 'aria-hidden': true }, '›')),
    open ? h('div', { className: 'ox-body', id: `ox-body-${id}` }, children) : null)
}

// A pasted API key for an Omni that cannot approve this app. It goes to this host, which
// checks it with that Omni and keeps it (omni-discover.js); nothing sends it back here.
function KeyEntry({ hint, disabled, onConnect, startOpen = false }) {
  const [open, setOpen] = useState(startOpen)
  const [value, setValue] = useState('')
  if (!open) return h('button', { type: 'button', className: 'ox-link', onClick: () => setOpen(true) }, t('Use it with an API key'))
  const submit = (event) => {
    event.preventDefault()
    const key = value.trim()
    if (key === '') return
    setValue('')
    onConnect(key)
  }
  return h('form', { className: 'ox-keyform', onSubmit: submit },
    h('p', { className: 'ox-muted' }, t('Older Omnis can\'t approve this app. Paste its API key instead; it stays on this computer.')),
    hint ? h('p', { className: 'ox-muted' }, t('Find the key where that app keeps its settings.')) : null,
    h('div', { className: 'ox-field' },
      h('input', { className: 'ox-input', type: 'password', autoComplete: 'off', spellCheck: false, value, placeholder: t('API key'), 'aria-label': t('API key for this Omni'), onChange: event => setValue(event.target.value) }),
      h('button', { type: 'submit', className: 'oc-primary', disabled: disabled || value.trim() === '' }, t('Connect'))))
}

const Linked = ({ text }) => h('p', { className: 'ox-linked', role: 'status' }, h('span', { 'aria-hidden': true }, '✓'), text)

// `onPaired(origin)` hears a pairing that succeeded (the onboarding step's Continue lights up
// on it); `embedded` drops the card's own mark and heading where its host already titles it.
export function ConnectOmni({ onPaired, embedded = false } = {}) {
  const mac = onMac()
  const [found, setFound] = useState(null)
  const [sandbox, setSandbox] = useState(null)
  const [open, setOpen] = useState(null)
  const [remote, setRemote] = useState('')
  const [pairing, setPairing] = useState(null)
  const [busy, setBusy] = useState(null)
  const [problem, setProblem] = useState(null)
  const [note, setNote] = useState(null)
  // `{row, origin, version}` once this card linked an Omni.
  const [linked, setLinked] = useState(null)
  // `{row, kind, id, title}` while a row's terminal is open.
  const [terminal, setTerminal] = useState(null)
  // `{url, reason, version}` when a typed address cannot approve this app: its key instead.
  const [remoteKey, setRemoteKey] = useState(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    // A pairing started before a reload keeps going, and one the desktop app started shows here.
    call('omni-link').then((link) => { if (alive.current && link?.pairing) setPairing(link.pairing) }, () => {})
    call('omni-discover').then((reply) => {
      if (!alive.current) return
      const omnis = Array.isArray(reply?.omnis) ? reply.omnis : []
      setFound(omnis)
      setSandbox(reply?.sandbox ?? null)
      setOpen(current => current ?? firstOpen(omnis, { mac }))
    }, () => {
      if (!alive.current) return
      setFound([])
      setOpen(current => current ?? REMOTE)
    })
    const onPairing = (event) => {
      if (!alive.current) return
      if (event.detail?.problem) setProblem(event.detail.problem)
      else if (event.detail?.paired) void finish(REMOTE, event.detail.paired)
      else if (event.detail) setPairing(event.detail)
    }
    window.addEventListener(PAIRING_EVENT, onPairing)
    return () => window.removeEventListener(PAIRING_EVENT, onPairing)
  }, [])

  // The row a pairing started from, so its success shows there.
  const pairingRow = useRef(REMOTE)
  const finish = async (row, origin, version = null) => {
    setPairing(null)
    setTerminal(null)
    setLinked({ row, origin, version })
    setOpen(row)
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
        if (reply.status === 'paired') return finish(pairingRow.current, reply.origin)
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
  const run = async (row, endpoint, payload) => {
    setBusy(row)
    setProblem(null)
    setNote(null)
    try {
      const reply = await call(endpoint, payload)
      if (!alive.current) return
      if (reply.status === 'paired') {
        await finish(row, reply.origin)
        if (alive.current) setNote(noticeWords(reply.notice))
      } else if (reply.status === 'unavailable') {
        if (row === REMOTE) setRemoteKey({ url: reply.url, reason: reply.reason, version: reply.version ?? null })
        setProblem(unavailableWords(reply))
      } else if (reply.pairing) {
        pairingRow.current = row
        setPairing(reply.pairing)
      } else if (reply.message) setNote(reply.message)
    } catch (error) {
      if (alive.current) setProblem(error.message)
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  const submitRemote = (event) => {
    event.preventDefault()
    const wanted = readRemote(remote)
    if (wanted === null) return undefined
    if (wanted.kind === 'bad-link') {
      setNote(null)
      setProblem(t('That is not a link your Omni sends. It looks like https://your-omni/api/login/app?grant=…'))
      return undefined
    }
    return wanted.kind === 'grant'
      ? run(REMOTE, 'omni-connect-grant', { url: wanted.url, grant: wanted.grant })
      : run(REMOTE, 'omni-pair-start', { url: wanted.url })
  }

  const openTerminal = (row, kind, id) => {
    setProblem(null)
    setNote(null)
    setTerminal({ row, kind, id, title: kind === 'update' ? t('Update Omni') : mac ? t('Install Omni on this Mac') : t('Install Omni on this computer') })
  }
  // A terminal that ended well linked this host (or started a sign-in); any other end
  // leaves its output on screen.
  const terminalEnded = (reply) => {
    if (reply.state !== 'done' || !reply.result) return
    if (reply.result.status === 'paired') void finish(terminal?.row ?? LOCAL, reply.result.origin, reply.result.version ?? null)
    else if (reply.result.pairing) {
      pairingRow.current = terminal?.row ?? REMOTE
      setTerminal(null)
      setPairing(reply.result.pairing)
    }
  }

  const cancelPairing = async () => {
    setPairing(null)
    await call('omni-pair-cancel').catch(() => {})
  }

  if (pairing) {
    return h('section', { className: 'ox-card', 'aria-live': 'polite' },
      h('div', { className: 'ox-steps' },
        h('h2', null, t('Approve this device')),
        h('p', { className: 'ox-muted' }, pairing.waLink
          ? t('Scan the QR with your phone: it opens your WhatsApp chat with yourself with the code typed. Send it, and this page goes live.')
          : t('Open the approval page on your phone or here, and approve with Face ID, Touch ID, your fingerprint or a code.')),
        h('div', { className: 'ox-code', 'aria-label': t('Pairing code') }, pairing.code),
        // The operator owns the Omni, so approving from its own terminal works without a phone.
        h('p', { className: 'ox-muted' }, t('Or, on the computer that runs that Omni:'), ' ', h('code', null, `omni approve ${pairing.code}`)),
        h('div', { className: 'ox-row' },
          pairing.waLink ? h('a', { className: 'oc-primary', href: pairing.waLink, target: '_blank', rel: 'noreferrer' }, t('Open WhatsApp')) : null,
          pairing.approveUrl ? h('a', { className: pairing.waLink ? 'oc-ghost' : 'oc-primary', href: pairing.approveUrl, target: '_blank', rel: 'noreferrer' }, t('Approve with Face ID or fingerprint')) : null,
          h('button', { type: 'button', className: 'oc-ghost', onClick: cancelPairing }, t('Cancel'))),
        h('span', { className: 'ox-wait' }, h('span', { className: 'oc-spinner', 'aria-hidden': true }), t('Waiting for the code to arrive at {origin}…', { origin: pairing.origin })),
        problem ? h('p', { className: 'ox-problem', role: 'alert' }, problem) : null),
      h('div', { className: 'ox-qr' },
        h(QrSvg, { text: pairing.waLink ?? pairing.approveUrl, size: 168 }),
        h('span', { className: 'ox-muted' }, pairing.waLink ? t('Scan to send it on WhatsApp') : t('Scan to approve on your phone'))))
  }

  const omnis = found ?? []
  const hasSandbox = omnis.some(omni => omni.source === 'sandbox')
  const anyBusy = busy !== null || terminal !== null
  const toggle = row => () => setOpen(current => (current === row ? null : row))
  const terminalOn = row => (terminal?.row === row
    ? h(InlineTerminal, { key: `${terminal.kind}:${terminal.id ?? ''}`, kind: terminal.kind, id: terminal.id, title: terminal.title, onEnded: terminalEnded, onClose: () => setTerminal(null) })
    : null)
  const primary = (label, onClick, disabled = false) => h('button', { type: 'button', className: 'oc-primary', disabled: disabled || anyBusy, onClick }, label)
  const whatRuns = command => h('details', { className: 'ox-more' },
    h('summary', null, t('What runs')),
    h('code', null, command), ' ', t('runs in a terminal you can watch. Nothing runs until you press Enter.'))

  const rows = omnis.map((omni) => {
    const isLinked = linked?.row === omni.id
    const view = foundRow(omni, { mac, linked: isLinked })
    let body
    if (isLinked) body = h(Linked, { text: linked.version ? t('Connected to Omni {version}', { version: linked.version }) : t('Connected to {origin}', { origin: linked.origin }) })
    else if (terminal?.row === omni.id) body = terminalOn(omni.id)
    else {
      const action = view.action === 'update' ? h('div', null, primary(t('Update and connect'), () => openTerminal(omni.id, 'update', omni.id)), whatRuns('omni update --yes'))
        : view.action === 'reinstall' ? h('div', null, primary(t('Update and connect'), () => openTerminal(omni.id, 'install')), whatRuns(`bun x --bun @automagik/omni@${omni.updateTo} install --sandbox --at-login`))
          : view.action === 'use' ? primary(busy === omni.id ? t('Connecting…') : t('Use it'), () => run(omni.id, 'omni-discover-use', { id: omni.id }))
            : view.action === 'connect' ? primary(busy === omni.id ? t('Connecting…') : t('Connect'), () => run(omni.id, 'omni-discover-use', { id: omni.id }))
              : view.action === 'elsewhere' && !hasSandbox ? h('button', { type: 'button', className: 'oc-ghost', onClick: () => setOpen(LOCAL) }, mac ? t('Run Omni on this Mac') : t('Run Omni on this computer'))
                : null
      body = h('div', null,
        view.note ? h('p', { className: 'ox-muted' }, view.note) : null,
        action ? h('div', { className: 'ox-row ox-act' }, action) : null,
        view.keyEntry ? h(KeyEntry, { hint: view.keyHint, disabled: anyBusy, onConnect: apiKey => run(omni.id, 'omni-discover-key', { id: omni.id, apiKey }) }) : null)
    }
    return h(Choice, { key: omni.id, id: omni.id, open: open === omni.id, icon: '◉', title: view.title, sub: view.sub, badge: view.badge, tone: view.tone, onToggle: toggle(omni.id) }, body)
  })

  const remoteLinked = linked?.row === REMOTE
  rows.push(h(Choice, {
    key: REMOTE, id: REMOTE, open: open === REMOTE, icon: '⌁', title: t('An Omni somewhere else'), sub: t('On a server, a VPS, or another computer'),
    badge: remoteLinked ? t('Connected') : null, tone: 'ok', onToggle: toggle(REMOTE),
  }, remoteLinked
    ? h(Linked, { text: t('Connected to {origin}', { origin: linked.origin }) })
    : h('div', null,
      h('form', { className: 'ox-field', onSubmit: submitRemote },
        h('input', {
          className: 'ox-input', type: 'text', inputMode: 'url', autoComplete: 'off', spellCheck: false, value: remote,
          placeholder: t('omni.example.com, or the link Omni sent you'), 'aria-label': t('Omni address or link'), onChange: (event) => { setRemote(event.target.value); setRemoteKey(null) },
        }),
        h('button', { type: 'submit', className: 'oc-primary', disabled: anyBusy || readRemote(remote) === null }, busy === REMOTE ? t('Connecting…') : t('Continue'))),
      h('p', { className: 'ox-muted ox-hint' }, t('No address? Text connect to yourself on WhatsApp, and your Omni replies with a link that connects this app.')),
      remoteKey ? h(KeyEntry, { key: remoteKey.url, startOpen: true, disabled: anyBusy, onConnect: apiKey => run(REMOTE, 'omni-discover-key', { url: remoteKey.url, apiKey }) }) : null)))

  if (!hasSandbox) {
    const localLinked = linked?.row === LOCAL
    rows.push(h(Choice, {
      key: LOCAL, id: LOCAL, open: open === LOCAL, icon: '✦', accent: true,
      title: mac ? t('Run Omni on this Mac') : t('Run Omni on this computer'),
      sub: mac ? t('A private Omni just for this Mac · about 1 GB') : t('A private Omni just for this computer · about 1 GB'),
      badge: localLinked ? t('Connected') : null, tone: 'ok', onToggle: toggle(LOCAL),
    }, localLinked
      ? h(Linked, { text: linked.version ? t('Connected to Omni {version}', { version: linked.version }) : t('Connected to {origin}', { origin: linked.origin }) })
      : terminal?.row === LOCAL ? terminalOn(LOCAL)
        : h('div', null,
          h('p', { className: 'ox-muted' }, mac ? t('It starts with your Mac, stays on it, and never touches another Omni.') : t('It starts with your computer, stays on it, and never touches another Omni.')),
          h('div', { className: 'ox-row ox-act' }, primary(t('Set it up'), () => openTerminal(LOCAL, 'install'))),
          sandbox?.home ? h('details', { className: 'ox-more' }, h('summary', null, t('Where it lives')), t('{home}, with its own database, NATS and ports.', { home: sandbox.home })) : null)))
  }

  const lede = linked ? null : omnis.length > 0
    ? (mac ? t('We found an Omni on this Mac. Use it, or pick another.') : t('We found an Omni on this computer. Use it, or pick another.'))
    : t('Where does your Omni live?')
  return h('section', { className: 'ox-card ox-start' },
    embedded ? null : h('span', { className: 'ox-mark', 'aria-hidden': true }, h(OmniMark, { size: 34 })),
    h('div', { className: 'ox-steps' },
      embedded ? null : h('h2', null, t('Connect your Omni')),
      lede ? h('p', { className: 'ox-muted ox-lede' }, lede) : null,
      found === null ? h('span', { className: 'ox-wait' }, h('span', { className: 'oc-spinner', 'aria-hidden': true }), t('Looking for Omnis on this computer…')) : h('ul', { className: 'ox-choices' }, rows),
      note ? h('p', { className: 'ox-muted ox-note', role: 'status' }, note) : null,
      problem ? h('p', { className: 'ox-problem', role: 'alert' }, problem) : null))
}

export const OMNI_CONNECT_CSS = OMNI_UPDATE_CSS + OMNI_TERMINAL_CSS + `
.ox-card{display:flex;gap:22px;align-items:flex-start;margin:4px 0 22px;padding:20px 22px;border:1px solid var(--bt-line);border-radius:16px;background:color-mix(in srgb,var(--bt-accent) 5%,var(--bt-surface,transparent))}
.ox-mark{flex:none;display:inline-grid;place-items:center;width:56px;height:56px;border-radius:16px;background:color-mix(in srgb,var(--bt-accent) 12%,transparent);color:var(--bt-ink)}
.ox-steps{display:flex;flex-direction:column;gap:10px;min-width:0;flex:1}
.ox-steps h2{margin:0;font-size:16px;font-weight:600}
.ox-muted{margin:0;color:var(--bt-ink-2);font-size:13px;line-height:1.45}
.ox-lede{font-size:14px}
.ox-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ox-input{flex:1;min-width:200px;height:38px;padding:0 12px;border-radius:10px;border:1px solid var(--bt-line-2);background:var(--bt-bg,transparent);color:var(--bt-ink);font:inherit;font-size:14px}
.ox-input:focus{outline:2px solid color-mix(in srgb,var(--bt-accent) 55%,transparent);outline-offset:1px}
.ox-field{display:flex;gap:8px;flex-wrap:wrap}
.ox-code{font:600 34px/1.1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;color:var(--bt-ink);user-select:all}
.ox-wait{display:inline-flex;align-items:center;gap:8px;color:var(--bt-ink-2);font-size:12.5px}
.ox-problem{margin:0;color:var(--oc-bad,#c0392b);font-size:13px}
.ox-qr{flex:none;display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px;border-radius:12px;background:#fff}
.ox-qr .ox-muted{color:#555;font-size:11.5px}
.ox-choices{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.ox-choice{border:1px solid var(--bt-line);border-radius:14px;background:var(--bt-bg,transparent);transition:border-color .15s}
.ox-choice.ox-open{border-color:var(--bt-line-2);background:color-mix(in srgb,var(--bt-accent) 4%,var(--bt-bg,transparent))}
.ox-head{display:flex;align-items:center;gap:14px;width:100%;padding:14px 16px;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:14px}
.ox-head:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.ox-icon{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:color-mix(in srgb,var(--bt-accent) 10%,transparent);color:var(--bt-accent);font-size:17px}
.ox-icon.ox-accent{color:var(--oxs-accent-2,#ff3bd4);background:color-mix(in srgb,var(--oxs-accent-2,#ff3bd4) 10%,transparent)}
.ox-what{flex:1;min-width:0;display:flex;flex-direction:column}
.ox-what strong{font-size:14.5px;font-weight:600;overflow-wrap:anywhere}
.ox-what small{color:var(--bt-ink-2);font-size:12.5px}
.ox-badge{flex:none;font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid var(--bt-line-2);color:var(--bt-ink-2);white-space:nowrap}
.ox-badge.ox-warn{border-color:#5a4a1c;color:#f0c86a}
.ox-badge.ox-ok{border-color:#1c5a44;color:#4fe0a8}
.ox-chev{flex:none;color:var(--bt-ink-2);transition:transform .15s}
.ox-open .ox-chev{transform:rotate(90deg)}
.ox-body{padding:0 16px 16px 66px;display:flex;flex-direction:column;gap:10px}
.ox-act{margin-top:2px}
.ox-hint,.ox-note{font-size:12.5px}
.ox-more{color:var(--bt-ink-2);font-size:12.5px;margin-top:8px}
.ox-more summary{cursor:pointer}
.ox-more code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--bt-ink)}
.ox-link{align-self:flex-start;margin-top:8px;padding:0;border:0;background:none;color:var(--bt-accent);font:inherit;font-size:13px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.ox-keyform{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.ox-linked{display:flex;align-items:center;gap:10px;margin:0;color:#4fe0a8;font-weight:600}
@media (max-width:720px){.ox-card{flex-direction:column}.ox-qr{align-self:center}.ox-body{padding-left:16px}}
`
