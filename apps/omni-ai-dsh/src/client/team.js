import { createElement as h, useEffect, useRef, useState } from 'react'
import { call, callOmniUi } from './api.js'
import { genieSvg } from './genie.js'
import { OCTOPUS_SVG } from './octopus.js'
import { Stage, reducedMotion, useFinish, useGate, useGlitch } from './stage.js'

// Step omni-team (order -270): who joins the companion's team. Each Bot type is a card with
// what it starts with (its model, plugins, tools, skills, folder and permissions), read from
// this DSH (src/host/bot-types.js), with a switch where the person sets it.
//
// Omni's card starts asleep. Its power button wakes it: when this DSH lacks the Omni plugins
// (a plain DSH; the desktop app ships them) it installs them through DSH's plugin manager,
// then it looks for an Omni to connect (the channels plugin's omni-discover) and offers
// what it found, or the ways to reach one. A link made here completes the Connect Omni step
// by itself; anything the card cannot finish waits for that step. Genie has no DSH plugin
// yet, and says so.

export const WAKE_MS = 1100
export const LOOK_MS = 1800
export const POLL_MS = 900
// After an install, how long the new plugins may take to come up before a restart is asked.
export const READY_POLLS = 20

const abortError = () => Object.assign(new Error('Omni was switched off'), { name: 'AbortError' })
export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortError())
  if (ms <= 0) return resolve()
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => {
    clearTimeout(timer)
    reject(abortError())
  }, { once: true })
})

/**
 * Pressing the power button. `show(phase, detail)` draws each step: waking, installing
 * ({ plugins }), looking, then linked ({ origin }), found ({ omnis, sandbox }), none
 * ({ sandbox }), restart ({ plugins }) or failed ({ message }). Returns the last phase.
 * `signal` is the power going off; `quick` (reduced motion) skips the pauses.
 */
export async function powerOn({ show, signal, omniAi = call, omniUi = callOmniUi, wait = sleep, quick = reducedMotion() }) {
  const check = () => { if (signal?.aborted) throw abortError() }
  const pause = ms => wait(quick ? 0 : ms, signal)
  const end = (phase, detail) => {
    check()
    show(phase, detail)
    return phase
  }
  show('waking')
  await pause(WAKE_MS)
  check()
  let plugins = await omniAi('omni-plugins')
  check()
  if (!plugins.ready) {
    show('installing', { plugins })
    if (plugins.install?.phase !== 'installing') {
      try {
        plugins = await omniAi('omni-plugins-install')
      } catch (error) {
        return end('failed', { message: error.message })
      }
    }
    let polls = 0
    while (plugins.install?.phase === 'installing' || (plugins.install?.phase === 'done' && !plugins.ready && polls < READY_POLLS)) {
      check()
      show('installing', { plugins })
      await wait(POLL_MS, signal)
      plugins = await omniAi('omni-plugins')
      if (plugins.install?.phase !== 'installing') polls += 1
    }
    if (plugins.install?.phase === 'failed') return end('failed', { message: plugins.install.error })
    if (!plugins.ready) return end('restart', { plugins })
  }
  show('looking')
  const started = Date.now()
  // The channels plugin answers on the Omni plugins' route once it runs; a route that is not
  // there yet waits for DSH to restart.
  let link = null
  try {
    link = await omniUi('omni-link')
  } catch (error) {
    if (error?.code === 'HTTP_404') return end('restart', { plugins })
  }
  check()
  if (link?.linked === true || link?.configured === true) {
    await pause(LOOK_MS / 2)
    return end('linked', { origin: link.origin ?? null })
  }
  const found = await omniUi('omni-discover').catch(() => null)
  check()
  await pause(Math.max(0, LOOK_MS - (Date.now() - started)))
  const omnis = Array.isArray(found?.omnis) ? found.omnis : []
  return end(omnis.length > 0 ? 'found' : 'none', { omnis, sandbox: found?.sandbox ?? null })
}

const onMac = (scope = globalThis) => /Mac/i.test(scope.navigator?.platform ?? '') || /Mac OS X/.test(scope.navigator?.userAgent ?? '')
const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
const portOf = (url) => {
  try {
    return new URL(url).port
  } catch {
    return ''
  }
}

/**
 * One found Omni as a choice: its title, the line under it, and its one-tap action — `use`
 * (this computer has its key), `connect` (approve this device from the phone) — or none,
 * with a note on what the Connect Omni step can do for it instead.
 */
export function foundChoice(omni, { mac = false } = {}) {
  const here = mac ? 'this Mac' : 'this computer'
  const title = omni.source === 'sandbox' ? `Your Omni on ${here}` : omni.local ? `Omni on ${here}` : hostOf(omni.url)
  const port = omni.local ? portOf(omni.url) : ''
  const sub = [omni.version ? `v${omni.version}` : null, port ? `port ${port}` : null, !omni.local ? 'saved in your Omni CLI' : null].filter(Boolean).join(' · ')
  const row = (action, note = null) => ({ id: omni.id, title, sub, action, note })
  if (omni.local && omni.reachable === false) return row(null, 'Not answering right now.')
  if (omni.updateTo || (omni.pairing === 'too-old' && !omni.hasKey)) return row(null, 'Needs an update first; Connect Omni, next, does it.')
  if (omni.hasKey) return row('use')
  if (omni.pairing === 'off') return row(null, 'Sign-in from devices is off on it.')
  return row('connect')
}

// The link an Omni sends its owner (https://<omni>/api/login/app?grant=…, or the
// omni://connect?url=…&grant=… it opens), or an address to sign in to.
export function readRemote(text) {
  const value = String(text ?? '').trim()
  if (value === '') return null
  let link = null
  try {
    link = new URL(value)
  } catch { /* an address without a scheme */ }
  const grant = link?.searchParams.get('grant') ?? ''
  if (/^[A-Za-z0-9_-]{24}$/.test(grant)) {
    if (link.protocol === 'omni:') {
      const url = link.searchParams.get('url')
      return url ? { kind: 'grant', url, grant } : { kind: 'bad-link' }
    }
    if (/\/api\/login\/app\/?$/.test(link.pathname)) return { kind: 'grant', url: `${link.origin}${link.pathname.replace(/\/api\/login\/app\/?$/, '')}`, grant }
  }
  if (/^omni:/i.test(value) || /[?&]grant=/.test(value)) return { kind: 'bad-link' }
  return { kind: 'address', url: value }
}

const TYPE_LABEL = { 'whatsapp-baileys': 'WhatsApp', 'whatsapp-cloud': 'WhatsApp Business', slack: 'Slack', telegram: 'Telegram', discord: 'Discord', gupshup: 'Gupshup' }
export const channelLabel = channel => TYPE_LABEL[channel.type] ?? channel.type ?? 'Channel'

// Genie's setup, until it has a DSH plugin to read it from.
export const GENIE_TYPE = {
  type: 'genie',
  groups: [
    { id: 'plugins', label: 'Plugins', rows: [{ id: 'genie', label: 'Genie', detail: 'Not released for DSH yet' }] },
    { id: 'tools', label: 'Tools', rows: [{ id: 'threads', label: 'Threads of itself', detail: 'One per wish, under Genie' }, { id: 'computer', label: 'Shell and files', detail: 'In its project' }] },
    { id: 'setup', label: 'Setup', rows: [{ id: 'folder', label: 'Folder', detail: 'Its own, per wish' }] },
  ],
}

// The switches the person sets: the tool groups that are not locked, as `{ id: on }`.
export const abilitiesOf = type => Object.fromEntries((type?.groups ?? []).find(group => group.id === 'tools')?.rows.filter(row => typeof row.on === 'boolean').map(row => [row.id, row.on]) ?? [])

// A long folder, shortened in the middle so it fits on one line: ~/…/workspace/omni.
export function shortPath(path, keep = 2) {
  const parts = String(path).split('/')
  const head = parts[0] === '~' ? '~' : ''
  const tail = parts.slice(-keep).filter(Boolean)
  return parts.length - (head ? 1 : 0) > keep + 1 ? `${head}/…/${tail.join('/')}` : path
}

const Check = () => h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': true }, h('path', { d: 'M3 8.5l3 3 7-7', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }))

/** A Bot type's preloaded setup, group by group, with a switch where it is tunable. */
export function Capabilities({ type, abilities = {}, onToggle, disabled = false }) {
  if (!type) return h('p', { className: 'oai-muted oai-caps-wait' }, 'Reading what it starts with…')
  return h('div', { className: 'oai-caps' }, type.groups.map(group => h('section', { key: group.id, className: 'oai-cap-group', 'aria-label': group.label },
    h('h3', null, group.label),
    group.rows.length === 0
      ? h('p', { className: 'oai-muted oai-cap-empty' }, group.empty ?? 'None')
      : h('ul', null, group.rows.map((row) => {
        const on = typeof row.on === 'boolean' ? abilities[row.id] ?? row.on : null
        return h('li', { key: row.id, className: `oai-cap${on === false ? ' oai-off' : ''}`, 'data-cap': row.id },
          h('span', { className: 'oai-cap-what' },
            h('strong', null, row.label),
            row.detail ? h('small', row.path ? { title: row.detail } : null, row.path ? shortPath(row.detail) : row.detail) : null,
            row.installed === false ? h('small', null, 'Installs when Omni powers on') : null,
            row.tools ? h('code', null, row.tools.join(' · ')) : null),
          row.version ? h('span', { className: `oai-version${row.installed === false ? ' oai-pending' : ''}` }, `v${row.version}`) : null,
          row.installed === true ? h('span', { className: 'oai-tick', title: 'Installed' }, h(Check)) : null,
          row.locked ? h('span', { className: 'oai-core', title: 'What this Bot is for: always on' }, 'Always on')
            : on !== null && onToggle ? h('button', { type: 'button', role: 'switch', className: 'oai-switch', 'aria-checked': on, 'aria-label': `${row.label} for this Bot`, disabled, onClick: () => onToggle(row.id, !on) })
              : null)
      })))))
}

const CLOSED_EYES = '<g class="oai-closed" fill="none" stroke="#06121f" stroke-width="3" stroke-linecap="round"><path d="M33 37Q40 42 47 37"/><path d="M53 37Q60 42 67 37"/></g>'
const PORTRAIT_SVG = OCTOPUS_SVG.replace('</svg>', `${CLOSED_EYES}</svg>`)

const PowerIcon = () => h('svg', { viewBox: '0 0 24 24', width: 22, height: 22, 'aria-hidden': true },
  h('path', { d: 'M12 3v8', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' }),
  h('path', { d: 'M6.4 6.6a8 8 0 1 0 11.2 0', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' }))

// What the card says under the portrait in each phase.
const STATUS = {
  asleep: 'Asleep. Press the power button to wake Omni up.',
  waking: 'Waking up…',
  installing: 'Installing Omni in this DSH…',
  looking: 'Looking for a connection…',
  found: 'Found one. Pick it to connect.',
  none: 'No Omni on this computer yet.',
  linked: 'Connected.',
  pairing: 'Approve this device to connect.',
  removed: 'Not on your team. Press the power button to bring Omni back.',
  restart: 'Installed. Restart DSH to finish.',
  failed: 'Omni could not be installed.',
}

function InstallProgress({ plugins }) {
  const install = plugins?.install
  const rows = plugins?.plugins ?? []
  const done = new Set(install?.done ?? [])
  return h('ol', { className: 'oai-install', 'aria-label': 'Installing the Omni plugins' }, rows.map((row) => {
    const state = done.has(row.name) || (row.installed && row.enabled !== false) ? 'done' : install?.current === row.name ? 'now' : 'next'
    return h('li', { key: row.name, className: `oai-install-${state}` },
      h('span', { className: 'oai-install-dot', 'aria-hidden': true }, state === 'done' ? h(Check) : null),
      h('span', null, row.title),
      h('small', null, state === 'done' ? 'Installed' : state === 'now' ? 'Installing…' : 'Waiting'))
  }))
}

function Pairing({ pairing, onCancel }) {
  return h('div', { className: 'oai-pairing', 'aria-live': 'polite' },
    h('p', { className: 'oai-muted' }, pairing.waLink
      ? 'Send this code to yourself on WhatsApp, and Omni connects.'
      : 'Approve this device on the page your Omni opens, with Face ID, a fingerprint or a code.'),
    h('div', { className: 'oai-code' }, h('code', null, pairing.code)),
    h('div', { className: 'oai-row' },
      pairing.waLink ? h('a', { className: 'oai-pill oai-pill-primary', href: pairing.waLink, target: '_blank', rel: 'noreferrer' }, 'Open WhatsApp') : null,
      pairing.approveUrl ? h('a', { className: `oai-pill${pairing.waLink ? '' : ' oai-pill-primary'}`, href: pairing.approveUrl, target: '_blank', rel: 'noreferrer' }, 'Approve') : null,
      h('button', { type: 'button', className: 'oai-pill', onClick: onCancel }, 'Cancel')),
    h('p', { className: 'oai-muted oai-waiting' }, `Waiting for ${pairing.origin ?? 'your Omni'}…`))
}

function Found({ omnis, busy, onUse }) {
  const mac = onMac()
  return h('ul', { className: 'oai-found-list' }, omnis.map((omni) => {
    const choice = foundChoice(omni, { mac })
    return h('li', { key: omni.id, className: 'oai-found-row' },
      h('span', { className: `oai-found-mark${choice.action ? '' : ' oai-quiet'}`, 'aria-hidden': true }),
      h('span', { className: 'oai-cap-what' }, h('strong', null, choice.title), choice.sub ? h('small', null, choice.sub) : null, choice.note ? h('small', null, choice.note) : null),
      choice.action ? h('button', { type: 'button', className: 'oai-pill oai-pill-primary', disabled: busy !== null, onClick: () => onUse(omni) }, busy === omni.id ? 'Connecting…' : choice.action === 'use' ? 'Use it' : 'Connect') : null)
  }))
}

function Elsewhere({ busy, onRemote, onLocal, local }) {
  const [text, setText] = useState('')
  const wanted = readRemote(text)
  const submit = (event) => {
    event.preventDefault()
    if (wanted !== null) onRemote(wanted)
  }
  return h('div', { className: 'oai-elsewhere' },
    h('form', { className: 'oai-field', onSubmit: submit },
      h('input', { type: 'text', inputMode: 'url', autoComplete: 'off', spellCheck: false, value: text, placeholder: 'omni.example.com, or the link Omni sent you', 'aria-label': 'Omni address or link', onChange: event => setText(event.target.value) }),
      h('button', { type: 'submit', className: 'oai-pill oai-pill-primary', disabled: busy !== null || wanted === null }, busy === 'remote' ? 'Connecting…' : 'Connect')),
    h('p', { className: 'oai-muted' }, 'No address? Text connect to yourself on WhatsApp, and your Omni replies with a link.'),
    local ? h('button', { type: 'button', className: 'oai-pill oai-local', onClick: onLocal }, h('strong', null, onMac() ? 'Run Omni on this Mac' : 'Run Omni on this computer'), h('small', null, 'A private Omni, about 1 GB. Set up in the next step.')) : null)
}

// Omni's card: asleep, then each phase of powerOn, then connecting from what it found.
export function OmniCard({ power, onPower, type, abilities, onToggle, live }) {
  const { phase, detail, busy, problem } = power
  const awake = phase !== 'asleep'
  const scanning = phase === 'looking'
  const omnis = detail?.omnis ?? []
  const hasSandbox = omnis.some(omni => omni.source === 'sandbox')
  const channels = live?.configured ? live.channels ?? [] : []
  let body = null
  if (phase === 'installing') body = h(InstallProgress, { plugins: detail?.plugins })
  else if (phase === 'restart') body = h('p', { className: 'oai-note' }, 'DSH needs a restart to start the Omni plugins. Restart it, then press the power button again: Omni is already installed.')
  else if (phase === 'failed') body = h('p', { className: 'oai-error', role: 'alert' }, detail?.message ?? 'Try again, or add the Omni plugins on DSH\'s Plugins page.')
  else if (phase === 'pairing') body = h(Pairing, { pairing: detail.pairing, onCancel: power.cancelPairing })
  else if (phase === 'found') {
    body = h('div', { className: 'oai-connect' },
      h(Found, { omnis, busy, onUse: power.use }),
      h('details', { className: 'oai-more' }, h('summary', null, 'Somewhere else?'), h(Elsewhere, { busy, onRemote: power.remote, onLocal: power.local, local: !hasSandbox })))
  } else if (phase === 'none') body = h('div', { className: 'oai-connect' }, h(Elsewhere, { busy, onRemote: power.remote, onLocal: power.local, local: true }))
  else if (phase === 'linked') {
    body = h('p', { className: 'oai-linked', role: 'status' }, h(Check), detail?.origin ? `Connected to ${detail.origin}` : 'Connected to your Omni')
  }
  // The linked Omni's channels, each with its live state, as they will sit in the menu.
  const menu = channels.length > 0
    ? h('ul', { className: 'oai-menu-preview' }, channels.slice(0, 5).map(channel => h('li', { key: channel.id }, h('span', { className: `oai-dot ${channel.status === 'connected' ? 'ok' : 'warn'}` }), `${channelLabel(channel)} · ${channel.name}`)))
    : h('p', { className: 'oai-muted' }, live === undefined ? 'Reading your Omni…' : 'Link an Omni, and each of its channels gets a place in your menu.')
  const removed = phase === 'asleep' && detail?.removed === true

  return h('article', { className: `oai-fighter oai-omni oai-is-${phase}${awake ? ' oai-chosen' : ''}`, 'data-phase': phase },
    h('div', { className: 'oai-portrait', 'aria-hidden': 'true' },
      scanning ? h('div', { className: 'oai-scan' }, h('i'), h('i'), h('i')) : null,
      phase === 'asleep' ? h('div', { className: 'oai-zzz' }, h('i', null, 'z'), h('i', null, 'z'), h('i', null, 'z')) : null,
      awake ? h('div', { className: 'oai-bubbles' }, [0, 1, 2, 3, 4, 5].map(index => h('i', { key: index }))) : null,
      h('div', { className: 'oai-octo-wrap', dangerouslySetInnerHTML: { __html: PORTRAIT_SVG } })),
    h('header', null, h('h2', null, 'Omni')),
    h('div', { className: 'oai-power-row' },
      h('button', { type: 'button', className: `oai-power${awake ? ' on' : ''}`, 'aria-pressed': awake, 'aria-label': awake ? 'Power Omni off' : 'Power Omni on', onClick: onPower, disabled: phase === 'installing' }, h(PowerIcon)),
      h('p', { className: `oai-status${scanning || phase === 'waking' || phase === 'installing' ? ' oai-working' : ''}`, role: 'status', 'aria-live': 'polite' }, removed ? STATUS.removed : STATUS[phase] ?? '')),
    awake && phase !== 'failed'
      ? h('div', { className: 'oai-team-line' },
        h('span', { className: 'oai-on-team' }, h(Check), 'On your team'),
        h('button', { type: 'button', className: 'oai-remove', onClick: onPower, disabled: phase === 'installing' }, 'Remove'))
      : null,
    body,
    problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null,
    h('p', { className: 'oai-about' }, 'Keeps your Omni: every chat on every channel, answered by your team. A little Omni sits in each chat to help there.'),
    h('div', { className: 'oai-menu-label' }, 'In your menu'),
    menu,
    h(Capabilities, { type, abilities, onToggle, disabled: !awake }))
}

// The power button's state, and the connecting a found Omni or a typed address does.
function usePower() {
  const [phase, setPhase] = useState('asleep')
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(null)
  const [problem, setProblem] = useState(null)
  const run = useRef(null)
  const back = useRef(null)
  useEffect(() => () => run.current?.abort(), [])

  const show = (next, value = null) => {
    setPhase(next)
    setDetail(value)
  }
  const on = () => {
    run.current?.abort()
    const controller = new AbortController()
    run.current = controller
    setProblem(null)
    powerOn({ show, signal: controller.signal }).catch((error) => {
      if (error?.name !== 'AbortError') show('failed', { message: error.message })
    })
  }
  // Off is Remove: Omni sleeps again and does not join the team.
  const off = () => {
    run.current?.abort()
    if (phase === 'pairing') void callOmniUi('omni-pair-cancel').catch(() => {})
    setProblem(null)
    setBusy(null)
    show('asleep', { removed: true })
  }

  // Each connect answers `paired`, `pairing` (approve it on the phone) or a message.
  const connect = async (row, endpoint, payload) => {
    setBusy(row)
    setProblem(null)
    try {
      const reply = await callOmniUi(endpoint, payload)
      if (run.current?.signal.aborted) return
      if (reply.status === 'paired') show('linked', { origin: reply.origin ?? null })
      else if (reply.pairing) {
        back.current = { phase, detail }
        show('pairing', { pairing: reply.pairing })
      } else setProblem(reply.message ?? 'That Omni cannot approve this app from here. Connect Omni, next, can use its API key.')
    } catch (error) {
      setProblem(error.message)
    } finally {
      setBusy(null)
    }
  }

  // A sign-in waits for the person's phone.
  useEffect(() => {
    if (phase !== 'pairing') return undefined
    let timer = 0
    let alive = true
    const tick = async () => {
      try {
        const reply = await callOmniUi('omni-pair-poll')
        if (!alive) return
        if (reply.status === 'paired') return show('linked', { origin: reply.origin ?? null })
        if (reply.status !== 'pending') {
          setProblem(reply.status === 'denied' ? 'The sign-in was denied.' : 'The code expired. Try again for a new one.')
          return show(back.current?.phase ?? 'none', back.current?.detail ?? null)
        }
      } catch (error) {
        if (alive) setProblem(error.message)
      }
      if (alive) timer = setTimeout(tick, detail?.pairing?.pollIntervalMs ?? 2000)
    }
    timer = setTimeout(tick, detail?.pairing?.pollIntervalMs ?? 2000)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [phase])

  return {
    phase, detail, busy, problem,
    toggle: () => (phase === 'asleep' ? on() : off()),
    use: omni => connect(omni.id, 'omni-discover-use', { id: omni.id }),
    remote: wanted => (wanted.kind === 'bad-link'
      ? setProblem('That is not a link your Omni sends. It looks like https://your-omni/api/login/app?grant=…')
      : wanted.kind === 'grant' ? connect('remote', 'omni-connect-grant', { url: wanted.url, grant: wanted.grant }) : connect('remote', 'omni-pair-start', { url: wanted.url })),
    cancelPairing: () => {
      void callOmniUi('omni-pair-cancel').catch(() => {})
      show(back.current?.phase ?? 'none', back.current?.detail ?? null)
    },
  }
}

// The speech bubble, by Omni's phase.
const speechOf = (phase, name, origin) => ({
  asleep: `${name} here! Omni is asleep. Press its power button to bring it along.`,
  waking: 'Omni is waking up…',
  installing: 'Bringing Omni into this DSH. One moment.',
  looking: 'Omni is looking for a connection…',
  found: 'Omni found where your channels live!',
  none: 'No Omni here yet. Tell Omni where yours lives.',
  pairing: 'Approve this device, and Omni connects.',
  linked: origin ? `Omni is connected to ${origin}!` : 'Omni is connected!',
  restart: 'Omni is installed. Restart DSH to wake it.',
  failed: 'Omni could not be installed here.',
})[phase]

export function TeamStep(props) {
  const state = useGate(props)
  const finish = useFinish(props)
  const [glitching, glitch] = useGlitch()
  const power = usePower()
  const [omniType, setOmniType] = useState(null)
  const [abilities, setAbilities] = useState({})
  const [live, setLive] = useState(undefined)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState(null)

  const { phase } = power
  // Read again once Omni is awake, when what it brings may have just been installed.
  const awakeNow = phase === 'looking' || phase === 'linked'
  useEffect(() => { call('bot-type', { type: 'omni' }).then(setOmniType, () => {}) }, [awakeNow])
  useEffect(() => { callOmniUi('omni-overview', {}).then(setLive, () => setLive(null)) }, [])
  useEffect(() => {
    if (phase !== 'linked') return
    callOmniUi('omni-overview', {}).then(setLive, () => setLive(null))
    glitch()
  }, [phase, glitch])
  useEffect(() => { if (state) glitch() }, [state, glitch])
  if (!state) return null

  const name = state.companionName ?? 'Your companion'
  const omni = phase !== 'asleep' && phase !== 'failed'
  const working = ['waking', 'installing', 'looking'].includes(phase)
  const local = () => go({ omni: true })

  async function go({ omni: joined = omni } = {}) {
    setSaving(true)
    setProblem(null)
    try {
      await call('team-save', { omni: joined, genie: false, omniAbilities: { ...abilitiesOf(omniType), ...abilities } })
      finish()
    } catch (error) {
      setProblem(error.message)
      setSaving(false)
    }
  }
  const omniPower = { ...power, local }

  return h(Stage, {
    title: 'Grow your team',
    speech: speechOf(phase, name, power.detail?.origin),
    at: 'omni-team',
    glitching,
    wide: true,
  },
  h('p', { className: 'oai-lede' }, `${name} leads. Each friend comes with its own plugins, tools and project. Switch on the ones you want.`),
  h('div', { className: 'oai-select' },
    h(OmniCard, { power: omniPower, onPower: power.toggle, type: omniType, abilities, onToggle: (id, on) => setAbilities(rows => ({ ...rows, [id]: on })), live }),
    h('article', { className: 'oai-fighter oai-genie oai-locked' },
      h('div', { className: 'oai-portrait', 'aria-hidden': 'true' },
        h('div', { className: 'oai-genie-wrap', dangerouslySetInnerHTML: { __html: genieSvg(150, { uid: 'oaig' }) } })),
      h('header', null, h('h2', null, 'Genie')),
      h('span', { className: 'oai-join oai-soon-badge', 'aria-disabled': 'true' }, 'Coming soon'),
      h('p', { className: 'oai-about' }, 'Give it a wish, get one delivery. It works in threads of itself, in its own project, and hands you the result.'),
      h(Capabilities, { type: GENIE_TYPE }))),
  problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null,
  h('div', { className: 'oai-actions' },
    phase !== 'linked' && omni && !working ? h('span', { className: 'oai-count' }, 'Connect Omni comes next.') : null,
    h('button', { type: 'button', className: 'oai-primary oai-big', disabled: saving || working, onClick: () => go() },
      saving ? 'Bringing them in…' : working ? 'Omni is waking…' : omni ? 'Continue with Omni' : `Continue with just ${name}`)))
}
