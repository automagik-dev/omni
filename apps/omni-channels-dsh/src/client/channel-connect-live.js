import { createElement as h, Fragment, useEffect, useRef, useState } from 'react'
import { QrSvg } from './omni-live.js'
import { CHANNEL_TYPES, canWrite } from './omni-store.js'
import { ADD, copiedTelegramToken, offered, stepState, telegramChat } from './channel-add.js'
import { call, t, icons } from './core.js'
import { rich } from './omni-update.js'
import { MetaWebhookSetup } from './meta-webhook-setup.js'
const { ChevronLeftIcon } = icons

// Adding a channel to the linked Omni, for real, with nothing to type in a terminal. The grid
// shows the types this Omni has loaded; each opens a guided page with its steps on the left:
// - WhatsApp: the host creates the channel (omni-channel-create), and the page shows the code
//   Omni is waiting on, refreshed as WhatsApp rotates it, or a code to type on the phone.
// - Telegram and Discord: a bot token connects it; Discord then offers the invite to a server.
// - Slack: Omni signs in to Slack itself, as a bot or as the person (omni-slack-start), and the
//   page waits for how it ended (omni-slack-result).
// - WhatsApp Business: through Kapso by clicks (a key once, a setup link, pick a number:
//   omni-kapso-*), or the Meta details, created and connected in one go (omni-wab-connect).
// A channel created here and left before it connects is deleted again (omni-channel-cancel).

const POLL_MS = 2000

// `Tile` and `PreviewChip` come from channels.js, which imports this module.
export function LiveConnectFlow({ state, omni, Tile, PreviewChip }) {
  const { type } = state.page
  const [supported, setSupported] = useState(undefined)
  useEffect(() => {
    let live = true
    call('omni-channel-types').then(reply => { if (live) setSupported(reply.types ?? null) }, () => { if (live) setSupported(null) })
    return () => { live = false }
  }, [])
  if (type === null) {
    return h(AddGrid, {
      types: supported === undefined ? [] : offered(supported), loading: supported === undefined, writable: canWrite(state),
      onPick: id => omni.showPage({ type: id, step: 0 }), onBack: () => omni.showPage({ view: 'overview' }), Tile, PreviewChip,
    })
  }
  const props = { key: type, type, omni, Tile, PreviewChip }
  if (type === 'slack') return h(SlackFlow, props)
  if (type === 'whatsapp-business') return h(BusinessFlow, props)
  if (type === 'telegram' || type === 'discord') return h(TokenFlow, props)
  return h(WhatsAppFlow, props)
}

// The cards: same height, the same parts in the same places, and the one action at the foot.
export function AddGrid({ types, loading = false, writable = true, onPick, onBack, Tile, PreviewChip }) {
  return h(Fragment, null,
    h('button', { type: 'button', className: 'oc-back', onClick: onBack }, h(ChevronLeftIcon), t('Channels')),
    h('header', { className: 'oc-head' }, h('div', null,
      h('h1', null, t('Add a channel'), h(PreviewChip)),
      h('p', null, writable ? t('Pick where people talk to you. Every option connects from here.') : t('This device\'s key can\'t change channels; ask your Omni\'s owner.')))),
    loading ? h('span', { className: 'oc-qr-wait' }, h('span', { className: 'oc-spinner', 'aria-hidden': true }), t('Looking at what this Omni offers…')) : null,
    h('div', { className: 'oc-types' }, types.map((id) => {
      const info = CHANNEL_TYPES[id]
      const add = ADD[id]
      return h('button', { key: id, type: 'button', className: 'oc-type', disabled: !writable, onClick: () => onPick(id) },
        h('span', { className: 'oc-type-top' }, h(Tile, { type: id, size: 44 }), h('strong', null, info.label), h('span', { className: 'oc-type-time' }, add.time)),
        h('span', { className: 'oc-type-blurb' }, t(info.blurb)),
        h('span', { className: 'oc-type-how' }, h('span', null, t('How')), h('b', null, t(add.how), ' →')))
    })))
}

// A guided page: the steps on the left, the current one on the right.
function FlowShell({ type, at, steps, Tile, PreviewChip, onBack, children }) {
  const info = CHANNEL_TYPES[type]
  const add = ADD[type]
  return h(Fragment, null,
    h('button', { type: 'button', className: 'oc-back', onClick: onBack }, h(ChevronLeftIcon), t('All channels')),
    h('header', { className: 'oc-head' }, h('div', null,
      h('h1', null, h(Tile, { type, size: 34 }), info.label, h(PreviewChip)),
      h('p', null, t('About {time}. You can disconnect any time from the channel\'s page.', { time: add.time })))),
    h('div', { className: 'oc-guide' },
      h('ol', { className: 'oc-guide-steps' }, (steps ?? add.steps).map((label, index) => h('li', { key: label, 'data-state': stepState(index, at) },
        h('span', null, index < at ? '✓' : String(index + 1)), t(label)))),
      h('section', { className: 'oc-guide-pane' }, children)))
}

const Problem = ({ text }) => (text ? h('p', { className: 'oc-problem', role: 'alert' }, text) : null)
const Spinner = ({ text }) => h('span', { className: 'oc-qr-wait' }, h('span', { className: 'oc-spinner', 'aria-hidden': true }), text)

// A channel this page created and that has not connected yet: leaving deletes it.
function useUnfinished() {
  const unfinished = useRef(null)
  useEffect(() => () => {
    if (unfinished.current) void call('omni-channel-cancel', { id: unfinished.current }).catch(() => {})
  }, [])
  return unfinished
}

// Asks omni where the channel stands until it says connected.
function usePairing(channel, on, onConnected) {
  const [pairing, setPairing] = useState(null)
  const [problem, setProblem] = useState(null)
  useEffect(() => {
    if (!on || !channel) return undefined
    let live = true
    let timer = 0
    const poll = async () => {
      try {
        const reply = await call('omni-channel-pairing', { id: channel.id })
        if (!live) return
        if (reply.message) console.warn('Channel pairing status:', reply.message)
        setPairing(reply)
        setProblem(null)
        if (reply.connected) return onConnected(reply)
      } catch (error) {
        console.warn('Could not refresh the connection:', error)
        if (live) setProblem(t('Could not refresh the connection. Retrying soon.'))
      }
      if (live) timer = setTimeout(poll, POLL_MS)
    }
    void poll()
    return () => { live = false; clearTimeout(timer) }
  }, [on, channel?.id])
  return { pairing, problem }
}

function Connected({ type, channel, detail, omni, children }) {
  const info = CHANNEL_TYPES[type]
  return h(Fragment, null,
    h('h2', null, t('{app} is connected', { app: info.label })),
    h('p', null, [detail, t('New chats appear under your Bots. Nothing is sent to your contacts until Omni or you reply.')].filter(Boolean).join(' · ')),
    children,
    h('div', { className: 'oc-row' }, h('button', { type: 'button', className: 'oc-primary', onClick: () => omni.finishConnect(type, channel.name, channel.id) }, t('See its health'))))
}

// -------------------------------------------------------------------------
// WhatsApp: name it, scan (or type a code on the phone), done.

function WhatsAppFlow({ type, omni, Tile, PreviewChip }) {
  const info = CHANNEL_TYPES[type]
  const [name, setName] = useState('')
  const [channel, setChannel] = useState(null)
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const unfinished = useUnfinished()
  const { pairing, problem: pollProblem } = usePairing(channel, channel !== null && done === null, (reply) => { unfinished.current = null; setDone(reply) })
  const start = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const made = await call('omni-channel-create', { type, name: name.trim() || info.label })
      unfinished.current = made.id
      setChannel(made)
    } catch (error) {
      console.warn('Could not create the channel:', error)
      setProblem(t('Could not create the channel. Try again.'))
    } finally {
      setBusy(false)
    }
  }
  const at = done ? 2 : channel ? 1 : 0
  return h(FlowShell, { type, at, Tile, PreviewChip, onBack: () => omni.showPage({ type: null, step: 0 }) },
    done ? h(Connected, { type, channel, detail: done.detail, omni })
      : channel ? h(QrStep, { info, channel, pairing })
        : h(Fragment, null,
          h('h2', null, t('Name this number')),
          h('p', null, t('So you can tell your channels apart, for example Sales or Personal.')),
          h('label', { className: 'oc-field' }, h('span', null, t('Name')), h('input', {
            value: name, placeholder: info.label, autoFocus: true, onChange: event => setName(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter' && !busy) void start() },
          })),
          h('div', { className: 'oc-row' }, h('button', { type: 'button', className: 'oc-primary', disabled: busy, onClick: start }, busy ? t('Starting…') : t('Show the code')))),
    h(Problem, { text: problem ?? pollProblem }))
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
      console.warn('Could not get a phone code:', error)
      setProblem(t('Could not get a phone code. Try again.'))
    }
  }
  if (byPhone) {
    return h(Fragment, null,
      h('h2', null, t('Link with a phone number')),
      code === null ? h(Fragment, null,
        h('p', null, t('Omni shows an 8-character code. Type it on your phone instead of scanning.')),
        h('label', { className: 'oc-field' }, h('span', null, t('Phone number with country code')), h('input', { value: phone, inputMode: 'tel', placeholder: '+55 11 91234-5678', onChange: event => setPhone(event.target.value), autoFocus: true })),
        h('div', { className: 'oc-row' }, h('button', { type: 'button', className: 'oc-primary', disabled: phone.replace(/\D/g, '').length < 8, onClick: askCode }, t('Get code'))))
        : h(Fragment, null,
          h('ol', { className: 'oc-howto' },
            h('li', null, t('On your phone, open {app} → Linked devices → Link a device', { app: info.label })),
            h('li', null, t('Tap “Link with phone number instead”')),
            h('li', null, t('Type this code'))),
          h('div', { className: 'oc-code', 'aria-label': t('Pairing code') }, code.split('').map((char, index) => h('span', { key: index, 'data-dash': char === '-' || undefined }, char))),
          h(Spinner, { text: t('Waiting for your phone…') })),
      h(Problem, { text: problem }),
      h('button', { type: 'button', className: 'oc-link', onClick: () => { setByPhone(false); setCode(null) } }, t('Scan a QR code instead')))
  }
  return h('div', { className: 'oc-qr-row' },
    h('div', { className: 'oc-qr' },
      pairing?.qr ? h('span', { className: 'oc-qr-code' }, h(QrSvg, { text: pairing.qr, size: 196 })) : h('span', { className: 'oc-qr-empty' }, h('span', { className: 'oc-spinner', 'aria-hidden': true }))),
    h('div', { className: 'oc-qr-side' },
      h('h2', null, t('Scan with your phone')),
      h('ol', { className: 'oc-howto' },
        h('li', null, t('Open {app} → Settings → Linked devices', { app: info.label })),
        h('li', null, t('Tap Link a device and point the camera here'))),
      h(Spinner, { text: pairing?.qr ? t('The code refreshes by itself') : t('Waiting for a code…') }),
      h('button', { type: 'button', className: 'oc-link', onClick: () => setByPhone(true) }, t('No camera? Link with your number instead'))))
}

// -------------------------------------------------------------------------
// Telegram and Discord: a bot token. Telegram then links to the bot's chat to say hi; Discord
// offers the invite that puts the bot on a server.

const TOKEN_HELP = {
  telegram: () => h(Fragment, null,
    h('h2', null, t('Make a Telegram bot for Omni')),
    h('ol', { className: 'oc-numbered' },
      h('li', null, rich('Open {bot} in Telegram', { bot: h('a', { href: 'https://t.me/BotFather', target: '_blank', rel: 'noreferrer' }, '@BotFather') })),
      h('li', null, rich('Send {command}, then pick a name and a username', { command: h('code', null, '/newbot') })),
      h('li', null, t('Copy the token it sends you and paste it here')))),
  discord: () => h(Fragment, null,
    h('h2', null, t('Connect your Discord bot')),
    h('ol', { className: 'oc-numbered' },
      h('li', null, rich('In the {portal}, open your app → Bot', { portal: h('a', { href: 'https://discord.com/developers/applications', target: '_blank', rel: 'noreferrer' }, t('Discord Developer Portal')) })),
      h('li', null, t('Turn on Message Content Intent, then Reset Token and copy it')))),
}

function TokenFlow({ type, omni, Tile, PreviewChip }) {
  const info = CHANNEL_TYPES[type]
  const [token, setToken] = useState('')
  const [copied, setCopied] = useState(null)
  const [channel, setChannel] = useState(null)
  const [done, setDone] = useState(null)
  const [invited, setInvited] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const unfinished = useUnfinished()
  const { problem: pollProblem } = usePairing(channel, channel !== null && done === null, (reply) => { unfinished.current = null; setDone(reply) })

  // Coming back from Telegram with a token copied: offer it. The clipboard is read only on that
  // focus, which browsers allow; a refusal changes nothing.
  useEffect(() => {
    if (type !== 'telegram' || channel) return undefined
    const onFocus = () => {
      if (token.trim() !== '' || !navigator.clipboard?.readText) return
      void copiedTelegramToken(() => navigator.clipboard.readText()).then(found => setCopied(found))
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [type, channel, token])

  const connect = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const made = await call('omni-channel-create', { type, name: info.label, token: token.trim() })
      unfinished.current = made.id
      setToken('')
      setChannel(made)
    } catch (error) {
      console.warn('Could not connect the bot:', error)
      setProblem(t('Could not connect the bot. Check its token and try again.'))
    } finally {
      setBusy(false)
    }
  }
  const at = type === 'discord' ? (invited ? 2 : done ? 1 : 0) : done ? 2 : 1
  let body
  if (done && type === 'telegram') {
    const chat = telegramChat(done.detail)
    body = h(Connected, { type, channel, detail: done.detail, omni },
      chat ? h('a', { className: 'oc-secondary', href: chat, target: '_blank', rel: 'noreferrer' }, t('Say hi to your bot')) : null)
  } else if (done && type === 'discord' && !invited) {
    body = h(Fragment, null,
      h('h2', null, t('Invite it to a server')),
      h('p', null, t('One click: Discord asks which server, with the permissions Omni needs filled in.')),
      h('div', { className: 'oc-row' },
        channel.inviteUrl ? h('a', { className: 'oc-primary', href: channel.inviteUrl, target: '_blank', rel: 'noreferrer', onClick: () => setInvited(true) }, t('Invite to a server')) : null,
        h('button', { type: 'button', className: 'oc-link', onClick: () => setInvited(true) }, channel.inviteUrl ? t('It is already on my server') : t('Continue'))))
  } else if (done) {
    body = h(Connected, { type, channel, detail: done.detail, omni })
  } else if (channel) {
    body = h(Fragment, null, h('h2', null, t('Connecting…')), h(Spinner, { text: t('Waiting for Omni to say the bot is up') }))
  } else {
    body = h(Fragment, null,
      TOKEN_HELP[type](),
      copied ? h('div', { className: 'oc-suggest' }, h('span', null, t('Use the token you just copied?')),
        h('button', { type: 'button', className: 'oc-secondary', onClick: () => { setToken(copied); setCopied(null) } }, t('Use it'))) : null,
      h('label', { className: 'oc-field' }, h('span', null, t('Bot token')), h('input', {
        type: 'password', value: token, autoComplete: 'off', autoFocus: true, placeholder: type === 'telegram' ? '123456:ABC-DEF…' : 'MTA…',
        onChange: event => setToken(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter' && token.trim().length >= 8 && !busy) void connect() },
      })),
      h('div', { className: 'oc-row' }, h('button', { type: 'button', className: 'oc-primary', disabled: token.trim().length < 8 || busy, onClick: connect }, busy ? t('Connecting…') : type === 'discord' ? t('Continue') : t('Connect'))),
      h('p', { className: 'oc-fine' }, type === 'telegram' ? t('Next we show a link to your bot so you can send it a first message.') : t('Next: one click to invite it to your server.')))
  }
  return h(FlowShell, { type, at, Tile, PreviewChip, onBack: () => omni.showPage({ type: null, step: 0 }) }, body, h(Problem, { text: problem ?? pollProblem }))
}

// -------------------------------------------------------------------------
// Slack: as a bot or as yourself, then Slack's own sign-in in the browser.

function SlackFlow({ type, omni, Tile, PreviewChip }) {
  const [app, setApp] = useState(undefined)
  const [mode, setMode] = useState('bot')
  const [flow, setFlow] = useState(null)
  const [done, setDone] = useState(null)
  const [problem, setProblem] = useState(null)
  useEffect(() => {
    let live = true
    call('omni-slack-app').then(reply => { if (live) setApp(reply.configured) }, () => { if (live) setApp(null) })
    return () => { live = false }
  }, [])
  useEffect(() => {
    if (!flow) return undefined
    let live = true
    let timer = 0
    const poll = async () => {
      try {
        const reply = await call('omni-slack-result', { nonce: flow.nonce })
        if (!live) return
        if (reply.status === 'done') return setDone({ id: reply.id })
        if (reply.status === 'error') {
          console.warn('Slack sign-in failed:', reply.message)
          setFlow(null); return setProblem(t('Slack did not finish the sign-in. Try again.'))
        }
      } catch (error) {
        console.warn('Could not refresh the Slack sign-in:', error)
        if (live) setProblem(t('Could not refresh the Slack sign-in. Retrying soon.'))
      }
      if (live) timer = setTimeout(poll, POLL_MS)
    }
    timer = setTimeout(poll, POLL_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [flow?.nonce])
  const start = async () => {
    setProblem(null)
    try {
      const reply = await call('omni-slack-start', { mode })
      if (!reply.configured) return setApp(false)
      setFlow(reply)
      window.open(reply.authorizeUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      console.warn('Could not start the Slack sign-in:', error)
      setProblem(t('Could not start the Slack sign-in. Try again.'))
    }
  }
  const at = done ? 2 : flow ? 1 : 0
  const channel = done ? { id: done.id, name: 'Slack' } : null
  let body
  if (app === false) {
    body = h(Fragment, null,
      h('h2', null, t('Slack isn\'t set up on this Omni yet')),
      h('p', null, t('Your Omni\'s owner sets up its Slack app once in Omni\'s settings. After that, everyone connects with one button here.')))
  } else if (done) {
    body = h(Connected, { type, channel, detail: mode === 'bot' ? t('As a bot') : t('As you'), omni })
  } else if (flow) {
    body = h(Fragment, null,
      h('h2', null, t('Approve in Slack')),
      h('p', null, t('Slack opened in your browser. Pick the workspace and allow Omni; this page goes on by itself.')),
      h(Spinner, { text: t('Waiting for Slack…') }),
      h('div', { className: 'oc-row' },
        h('a', { className: 'oc-link', href: flow.authorizeUrl, target: '_blank', rel: 'noreferrer' }, t('Open Slack again')),
        h('button', { type: 'button', className: 'oc-link', onClick: () => setFlow(null) }, t('Start over'))))
  } else {
    body = h(Fragment, null,
      h('h2', null, t('How should Omni join your workspace?')),
      h('p', null, t('You can change this later by connecting again.')),
      h('div', { className: 'oc-seg', role: 'radiogroup', 'aria-label': t('How Omni joins Slack') },
        [['bot', t('As a bot'), t('Omni shows up as its own app. People @mention it, and it only sees channels it is invited to.')],
          ['user', t('As yourself'), t('Omni reads and replies as you, in your DMs and channels, and can search them.')]].map(([value, title, text]) => h('button', {
          key: value, type: 'button', role: 'radio', 'aria-checked': mode === value, className: 'oc-seg-opt', onClick: () => setMode(value),
        }, h('strong', null, title), h('span', null, text)))),
      h('div', { className: 'oc-row' },
        h('button', { type: 'button', className: 'oc-brand', style: { background: '#4A154B' }, disabled: app === undefined, onClick: start }, t('Connect with Slack')),
        h('span', { className: 'oc-fine' }, t('Opens Slack in your browser.'))))
  }
  return h(FlowShell, { type, at, Tile, PreviewChip, onBack: () => omni.showPage({ type: null, step: 0 }) }, body, h(Problem, { text: problem }))
}

// -------------------------------------------------------------------------
// WhatsApp Business: through Kapso by clicks, or the details from Meta's WhatsApp Manager.

const KAPSO_STEPS = ['Pick your number', 'Send a test', 'Done']

function BusinessFlow({ type, omni, Tile, PreviewChip }) {
  const info = CHANNEL_TYPES[type]
  const [path, setPath] = useState('kapso')
  const [channel, setChannel] = useState(null)
  const [tested, setTested] = useState(false)
  // Kept here, so going to Meta's details and back never makes a second link (which revokes this one).
  const [link, setLink] = useState(null)
  const kapso = path === 'kapso'
  let body
  if (channel && kapso) {
    body = h(Connected, { type, channel, detail: channel.detail, omni }, h(KapsoTest, { channel, onSent: () => setTested(true) }))
  } else if (channel) {
    body = h(Connected, { type, channel, omni }, h(MetaWebhookSetup, { initiallyOpen: true }))
  } else {
    body = h(Fragment, null,
      h('div', { className: 'oc-seg', role: 'radiogroup', 'aria-label': t('How to connect the number') },
        [['kapso', t('Through Kapso'), t('Log in with Facebook on Kapso\'s page and pick your number. It keeps working in the WhatsApp Business app.')],
          ['meta', t('With Meta\'s details'), t('Paste the access token and IDs from Meta\'s WhatsApp Manager or another provider.')]].map(([value, title, text]) => h('button', {
          key: value, type: 'button', role: 'radio', 'aria-checked': path === value, className: 'oc-seg-opt', onClick: () => setPath(value),
        }, h('strong', null, title), h('span', null, text)))),
      kapso ? h(KapsoPath, { info, link, setLink, onConnected: setChannel }) : h(MetaDetails, { info, onConnected: setChannel }))
  }
  const at = kapso ? (tested ? 2 : channel ? 1 : 0) : channel ? 1 : 0
  return h(FlowShell, { type, at, steps: kapso ? KAPSO_STEPS : undefined, Tile, PreviewChip, onBack: () => omni.showPage({ type: null, step: 0 }) }, body)
}

// Kapso: Omni keeps one Kapso project key and makes every Kapso call. The key is asked for only
// while Omni has none; then a setup link (opened in a new tab), the project's numbers, Connect.
function KapsoPath({ info, link, setLink, onConnected }) {
  const [kapso, setKapso] = useState(undefined)
  const [key, setKey] = useState('')
  const [picked, setPicked] = useState(null)
  const [busy, setBusy] = useState(null)
  const [problem, setProblem] = useState(null)
  const run = async (what, work) => {
    setBusy(what)
    setProblem(null)
    try {
      await work()
    } catch (error) {
      console.warn('Kapso step failed:', what, error)
      setProblem(error?.message || t('Could not reach Kapso through Omni. Try again.'))
    } finally {
      setBusy(null)
    }
  }
  const refresh = () => run('refresh', async () => {
    const reply = await call('omni-kapso-numbers')
    setKapso(reply)
    if (reply.message) setProblem(reply.message)
    const numbers = reply.numbers ?? []
    setPicked(current => (numbers.some(number => number.phoneNumberId === current) ? current : numbers.length === 1 ? numbers[0].phoneNumberId : null))
  })
  useEffect(() => { void refresh() }, [])
  const saveKey = () => run('key', async () => {
    await call('omni-kapso-key', { apiKey: key.trim() })
    setKey('')
    const reply = await call('omni-kapso-numbers')
    setKapso(reply)
  })
  // Kapso revokes the previous link when it makes one, so this one stays on the page.
  const makeLink = () => run('link', async () => {
    const made = await call('omni-kapso-setup-link')
    setLink(made)
    window.open(made.url, '_blank', 'noopener,noreferrer')
  })
  const connect = () => run('connect', async () => {
    const number = kapso.numbers.find(item => item.phoneNumberId === picked)
    const name = (number?.name || number?.displayPhoneNumber || info.label).slice(0, 80)
    onConnected(await call('omni-kapso-connect', { name, phoneNumberId: picked }))
  })

  if (kapso === undefined) return h(Fragment, null, h(Spinner, { text: t('Asking Omni about Kapso…') }), h(Problem, { text: problem }))
  if (kapso === null || !kapso.configured) {
    return h(Fragment, null,
      h('h2', null, t('Add your Kapso key')),
      h('p', null, rich('Omni keeps one Kapso project key for all its numbers. Find it in {kapso} → API keys.', { kapso: h('a', { href: 'https://app.kapso.ai', target: '_blank', rel: 'noreferrer' }, 'Kapso') })),
      h('label', { className: 'oc-field' }, h('span', null, t('Kapso project API key')), h('input', {
        type: 'password', value: key, autoComplete: 'off', autoFocus: true, onChange: event => setKey(event.target.value),
        onKeyDown: (event) => { if (event.key === 'Enter' && key.trim().length >= 8 && !busy) void saveKey() },
      })),
      h('div', { className: 'oc-row' }, h('button', { type: 'button', className: 'oc-primary', disabled: key.trim().length < 8 || busy !== null, onClick: saveKey }, busy === 'key' ? t('Checking with Kapso…') : t('Save key'))),
      h('p', { className: 'oc-fine' }, t('Omni checks the key with Kapso and never shows it again.')),
      h(Problem, { text: problem }))
  }
  const numbers = kapso.numbers ?? []
  return h(Fragment, null,
    h('h2', null, t('Connect your number in Kapso')),
    h('p', null, t('Kapso\'s page asks you to log in with Facebook and pick your number. Come back here when it says done.')),
    h('div', { className: 'oc-row' },
      link ? h('a', { className: 'oc-secondary', href: link.url, target: '_blank', rel: 'noreferrer' }, t('Open the setup link again'))
        : h('button', { type: 'button', className: 'oc-secondary', disabled: busy !== null, onClick: makeLink }, busy === 'link' ? t('Making the link…') : t('Create setup link'))),
    h('div', { className: 'oc-row' },
      h('strong', null, t('Your Kapso numbers')),
      h('button', { type: 'button', className: 'oc-link', disabled: busy !== null, onClick: refresh }, busy === 'refresh' ? t('Refreshing…') : t('Refresh'))),
    numbers.length === 0
      ? h('p', { className: 'oc-fine' }, t('No numbers yet. Finish the setup link, then refresh.'))
      : h('div', { className: 'oc-seg', role: 'radiogroup', 'aria-label': t('Your Kapso numbers') }, numbers.map(number => h('button', {
        key: number.phoneNumberId, type: 'button', role: 'radio', 'aria-checked': picked === number.phoneNumberId, className: 'oc-seg-opt', onClick: () => setPicked(number.phoneNumberId),
      }, h('strong', null, number.displayPhoneNumber || number.phoneNumberId), h('span', null, number.name || t('No name yet'))))),
    kapso.publicAddress ? null : h('p', { className: 'oc-problem', role: 'alert' }, t('Omni has no public https address, so Kapso cannot send it messages. Set server.public_url (OMNI_PUBLIC_URL) on your Omni, then refresh.')),
    h('div', { className: 'oc-row' }, h('button', { type: 'button', className: 'oc-primary', disabled: !picked || !kapso.publicAddress || busy !== null, onClick: connect }, busy === 'connect' ? t('Connecting…') : t('Connect'))),
    h(Problem, { text: problem }))
}

// The first message, sent only when the person presses the button, to the number they typed.
function KapsoTest({ channel, onSent }) {
  const [phone, setPhone] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [problem, setProblem] = useState(null)
  const send = async () => {
    setSending(true)
    setProblem(null)
    try {
      await call('omni-kapso-test', { id: channel.id, phone })
      setSent(true)
      onSent()
    } catch (error) {
      console.warn('Could not send the test message:', error)
      setProblem(error?.message || t('Could not send the test message. Try again.'))
    } finally {
      setSending(false)
    }
  }
  return h(Fragment, null,
    h('label', { className: 'oc-field' }, h('span', null, t('Send a test message to')), h('input', {
      value: phone, inputMode: 'tel', placeholder: '+55 11 91234-5678', onChange: (event) => { setPhone(event.target.value); setSent(false) },
    })),
    h('div', { className: 'oc-row' },
      h('button', { type: 'button', className: 'oc-secondary', disabled: phone.replace(/\D/g, '').length < 8 || sending, onClick: send }, sending ? t('Sending…') : t('Send a test message')),
      sent ? h('span', { className: 'oc-fine' }, t('Sent. Look at that phone.')) : null),
    h('p', { className: 'oc-fine' }, t('WhatsApp delivers it only if that number wrote to yours in the last 24 hours.')),
    h(Problem, { text: problem }))
}

// Meta's details from WhatsApp Manager, or another Meta-compatible provider's.

const BUSINESS_FIELDS = { accessToken: '', phoneNumberId: '', wabaId: '', apiBaseUrl: '', authMode: 'x-api-key', webhookSecret: '', signatureMode: 'x-webhook-signature' }

// The connect body: Meta's details, plus a provider's only when its address or secret is filled in.
function businessDetails(fields) {
  const apiBaseUrl = fields.apiBaseUrl.trim()
  const webhookSecret = fields.webhookSecret.trim()
  return {
    accessToken: fields.accessToken.trim(), phoneNumberId: fields.phoneNumberId.trim(), wabaId: fields.wabaId.trim(),
    ...(apiBaseUrl ? { apiBaseUrl, authMode: fields.authMode } : {}),
    ...(webhookSecret ? { webhookSecret, signatureMode: fields.signatureMode } : {}),
  }
}

function MetaDetails({ info, onConnected }) {
  const [fields, setFields] = useState(BUSINESS_FIELDS)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const set = key => event => setFields(value => ({ ...value, [key]: event.target.value }))
  const providerReady = !fields.apiBaseUrl.trim() || /^https:\/\/\S+$/.test(fields.apiBaseUrl.trim())
  const ready = fields.accessToken.trim().length >= 8 && /^\d{5,25}$/.test(fields.phoneNumberId.trim()) && /^\d{5,25}$/.test(fields.wabaId.trim()) && providerReady
  const connect = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const made = await call('omni-wab-connect', { name: info.label, ...businessDetails(fields) })
      setFields(BUSINESS_FIELDS)
      onConnected(made)
    } catch (error) {
      console.warn('Could not connect the Business number:', error)
      setProblem(t('Could not connect the Business number. Check its details and try again.'))
    } finally {
      setBusy(false)
    }
  }
  const field = (key, label, extra) => h('label', { className: 'oc-field' }, h('span', null, label), h('input', { value: fields[key], onChange: set(key), autoComplete: 'off', ...extra }))
  const choice = (key, label, options) => h('label', { className: 'oc-field' }, h('span', null, label),
    h('select', { value: fields[key], onChange: set(key) }, options.map(([value, text]) => h('option', { key: value, value }, text))))
  return h(Fragment, null,
    h('h2', null, t('Connect your Business number')),
    h('p', null, rich('Find these in Meta\'s {manager} → API setup.', { manager: h('a', { href: 'https://business.facebook.com/wa/manage/home/', target: '_blank', rel: 'noreferrer' }, t('WhatsApp Manager')) })),
    field('accessToken', t('Access token'), { type: 'password', placeholder: 'EAAG…', autoFocus: true }),
    field('phoneNumberId', t('Phone number ID'), { inputMode: 'numeric', placeholder: '123456789012345' }),
    field('wabaId', t('WhatsApp Business Account ID'), { inputMode: 'numeric', placeholder: '987654321098765' }),
    h('details', { className: 'oc-field' }, h('summary', null, t('Through a provider such as Kapso (optional)')),
      field('apiBaseUrl', t('Provider API address'), { inputMode: 'url', placeholder: 'https://api.kapso.ai/meta/whatsapp/v24.0' }),
      choice('authMode', t('Send the access token as'), [['x-api-key', t('Provider key (X-API-Key)')], ['bearer', t('Bearer token')]]),
      field('webhookSecret', t('Provider webhook secret'), { type: 'password' }),
      choice('signatureMode', t('Webhook signature'), [['x-webhook-signature', t('Provider (X-Webhook-Signature)')], ['x-hub-signature-256', t('Meta app secret (X-Hub-Signature-256)')]])),
    h('div', { className: 'oc-row' }, h('button', { type: 'button', className: 'oc-primary', disabled: !ready || busy, onClick: connect }, busy ? t('Connecting…') : t('Connect'))),
    h('p', { className: 'oc-fine' }, t('The token stays with your Omni. Omni only gets that number\'s messages.')),
    h(Problem, { text: problem }))
}
