import { createElement as h, Fragment, useEffect, useRef, useState } from 'react'
import { QrSvg } from './omni-live.js'
import { CHANNEL_TYPES, canWrite } from './omni-store.js'
import { call, t, icons } from './core.js'
const { ChevronLeftIcon } = icons

// Adding a channel to the linked Omni, for real: the host creates it (omni-channel-create),
// then WhatsApp shows the code Omni is waiting on, refreshed as WhatsApp rotates it, and a
// bot token connects as it is pasted. The flow ends when omni reports the channel connected.
// A channel created here and left before it connects is deleted again (omni-channel-cancel).
// The types Omni cannot pair from here (CHANNEL_TYPES[…].cli) show the CLI commands instead.

const POLL_MS = 2000
export const liveType = type => CHANNEL_TYPES[type] !== undefined && CHANNEL_TYPES[type].cli === undefined

// `Tile` and `PreviewChip` come from channels.js, which imports this module.
export function LiveConnectFlow({ state, omni, Tile, PreviewChip }) {
  const { type } = state.page
  const writable = canWrite(state)
  if (type === null) {
    return h(Fragment, null,
      h('button', { type: 'button', className: 'oc-back', onClick: () => omni.showPage({ view: 'overview' }) }, h(ChevronLeftIcon), t('Channels')),
      h('header', { className: 'oc-head' }, h('div', null,
        h('h1', null, t('Add a channel'), h(PreviewChip)),
        h('p', null, writable ? t('Pick where people talk to you. It takes about a minute, and you can disconnect at any time.') : t('This device\'s key can\'t change channels; ask your Omni\'s owner.')))),
      h('div', { className: 'oc-types' }, Object.entries(CHANNEL_TYPES).map(([id, info]) => (info.cli
        ? h('div', { key: id, className: 'oc-type oc-type-cli' }, h(Tile, { type: id, size: 48 }), h('strong', null, info.label), h('span', null, info.blurb),
          h('em', null, t('Set up from the CLI')),
          h('code', { className: 'oc-cli' }, info.cli.join('\n')))
        : h('button', { key: id, type: 'button', className: 'oc-type', disabled: !writable, onClick: () => omni.showPage({ type: id, step: 0 }) },
          h(Tile, { type: id, size: 48 }), h('strong', null, info.label), h('span', null, info.blurb),
          h('em', null, info.pairing === 'qr' ? t('Scan a QR code') : t('Paste a token')))))))
  }
  return h(LivePairing, { key: type, type, omni, Tile })
}

function LivePairing({ type, omni, Tile }) {
  const info = CHANNEL_TYPES[type]
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [channel, setChannel] = useState(null)
  const [pairing, setPairing] = useState(null)
  const [problem, setProblem] = useState(null)
  const [busy, setBusy] = useState(false)
  // The channel this flow created and that has not connected: leaving deletes it.
  const unfinished = useRef(null)
  useEffect(() => () => {
    if (unfinished.current) void call('omni-channel-cancel', { id: unfinished.current }).catch(() => {})
  }, [])

  // While pairing, ask omni where it stands; connected ends the flow.
  useEffect(() => {
    if (step !== 1 || !channel) return undefined
    let live = true
    let timer = 0
    const poll = async () => {
      try {
        const reply = await call('omni-channel-pairing', { id: channel.id })
        if (!live) return
        setPairing(reply)
        if (reply.connected) {
          unfinished.current = null
          setStep(2)
          return
        }
      } catch (error) {
        if (live) setProblem(error.message)
      }
      if (live) timer = setTimeout(poll, POLL_MS)
    }
    void poll()
    return () => { live = false; clearTimeout(timer) }
  }, [step, channel?.id])

  const create = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const made = await call('omni-channel-create', { type, name: name.trim() || info.label, ...(info.pairing === 'token' ? { token: token.trim() } : {}) })
      unfinished.current = made.id
      setChannel(made)
      setStep(1)
    } catch (error) {
      setProblem(error.message)
    } finally {
      setBusy(false)
    }
  }
  const back = () => omni.showPage({ type: null, step: 0 })
  // WhatsApp is created at once, to show its code; a token channel once its token is pasted.
  const next = () => {
    if (info.pairing === 'qr') void create()
    else setStep(0.5)
  }
  const steps = [t('Name it'), info.pairing === 'qr' ? t('Scan') : t('Paste token'), t('Done')]
  // 0.5 is the token step: it belongs to the second dot, before anything is created.
  const shown = Math.ceil(step)
  const named = name.trim() !== ''
  return h(Fragment, null,
    h('button', { type: 'button', className: 'oc-back', onClick: back }, h(ChevronLeftIcon), t('All channels')),
    h('ol', { className: 'oc-steps' }, steps.map((label, index) => h('li', { key: label, 'data-state': index < shown ? 'done' : index === shown ? 'now' : undefined }, h('span', null, index < shown ? '✓' : String(index + 1)), label))),
    h('div', { className: 'oc-flow' },
      h(Tile, { type, size: 64, ring: true }),
      step === 0 ? h(Fragment, null,
        h('h1', null, t('Connect {app}', { app: info.label })),
        h('p', null, info.blurb),
        h('label', { className: 'oc-field' }, h('span', null, t('Name')), h('input', {
          value: name, placeholder: t('For example: Sales, Support, Personal'), onChange: event => setName(event.target.value), autoFocus: true,
          onKeyDown: (event) => { if (event.key === 'Enter' && named) next() },
        })),
        h('button', { type: 'button', className: 'oc-primary', disabled: !named || busy, onClick: next }, busy ? t('Starting…') : t('Continue')))
        : step === 0.5 ? h(Fragment, null,
          h('h1', null, t('Paste the {app} token', { app: info.label })),
          h('p', null, info.label === 'Telegram' ? t('Message @BotFather, send /newbot, and copy the token it gives you.') : t('Create the token in {app}\'s settings and paste it here.', { app: info.label })),
          h('label', { className: 'oc-field' }, h('span', null, t('Token')), h('input', { type: 'password', value: token, onChange: event => setToken(event.target.value), placeholder: '123456:ABC-…', autoComplete: 'off', autoFocus: true })),
          h('button', { type: 'button', className: 'oc-primary', disabled: token.trim().length < 8 || busy, onClick: create }, busy ? t('Connecting…') : t('Connect')))
          : step === 1 ? (info.pairing === 'qr' ? h(QrStep, { info, channel, pairing }) : h(Waiting, { pairing }))
            : h(Fragment, null,
              h('h1', null, t('{app} is connected', { app: info.label })),
              h('p', null, [pairing?.detail, t('New chats appear under your Bots. Nothing is sent to your contacts until Omni or you reply.')].filter(Boolean).join(' · ')),
              h('button', { type: 'button', className: 'oc-primary', onClick: () => omni.finishConnect(type, channel.name, channel.id) }, t('See its health'))),
      problem ? h('p', { className: 'oc-problem', role: 'alert' }, problem) : null))
}

function Waiting({ pairing }) {
  return h(Fragment, null,
    h('h1', null, t('Connecting…')),
    h('span', { className: 'oc-qr-wait' }, h('span', { className: 'oc-spinner', 'aria-hidden': true }), pairing?.message ?? t('Waiting for Omni to say the channel is up')))
}

// The code Omni is waiting on; WhatsApp swaps it every few seconds and so does this.
function QrStep({ info, channel, pairing }) {
  const [byPhone, setByPhone] = useState(false)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState(null)
  const [problem, setProblem] = useState(null)
  const askCode = async () => {
    setProblem(null)
    try {
      setCode((await call('omni-channel-phone-code', { id: channel.id, phone })).code)
    } catch (error) {
      setProblem(error.message)
    }
  }
  if (byPhone) {
    return h(Fragment, null,
      h('h1', null, t('Link with a phone number')),
      code === null ? h(Fragment, null,
        h('p', null, t('Omni shows an 8-character code. Type it on your phone instead of scanning.')),
        h('label', { className: 'oc-field' }, h('span', null, t('Phone number with country code')), h('input', { value: phone, inputMode: 'tel', placeholder: '+55 11 91234-5678', onChange: event => setPhone(event.target.value), autoFocus: true })),
        h('button', { type: 'button', className: 'oc-primary', disabled: phone.replace(/\D/g, '').length < 8, onClick: askCode }, t('Get code')))
        : h(Fragment, null,
          h('ol', { className: 'oc-howto' },
            h('li', null, t('On your phone, open {app} → Linked devices → Link a device', { app: info.label })),
            h('li', null, t('Tap “Link with phone number instead”')),
            h('li', null, t('Type this code'))),
          h('div', { className: 'oc-code', 'aria-label': t('Pairing code') }, code.split('').map((char, index) => h('span', { key: index, 'data-dash': char === '-' || undefined }, char))),
          h('span', { className: 'oc-qr-wait' }, h('span', { className: 'oc-spinner', 'aria-hidden': true }), t('Waiting for your phone…'))),
      problem ? h('p', { className: 'oc-problem', role: 'alert' }, problem) : null,
      h('button', { type: 'button', className: 'oc-link', onClick: () => { setByPhone(false); setCode(null) } }, t('Scan a QR code instead')))
  }
  return h(Fragment, null,
    h('h1', null, t('Scan with your phone')),
    h('ol', { className: 'oc-howto' },
      h('li', null, t('Open {app} on your phone', { app: info.label })),
      h('li', null, t('Tap Settings, then Linked devices')),
      h('li', null, t('Tap Link a device and point the camera here'))),
    h('div', { className: 'oc-qr' },
      pairing?.qr ? h('span', { className: 'oc-qr-code' }, h(QrSvg, { text: pairing.qr, size: 196 })) : h('span', { className: 'oc-qr-empty' }, h('span', { className: 'oc-spinner', 'aria-hidden': true })),
      h('span', { className: 'oc-qr-wait' }, h('span', { className: 'oc-spinner', 'aria-hidden': true }), pairing?.qr ? t('Waiting for your phone · the code refreshes by itself') : t('Waiting for a code…'))),
    h('span', { className: 'oc-alt' },
      h('button', { type: 'button', className: 'oc-link', onClick: () => setByPhone(true) }, t('Use a phone number instead'))))
}
