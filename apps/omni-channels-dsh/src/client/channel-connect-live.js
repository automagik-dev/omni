import { createElement as h, Fragment, useEffect, useRef, useState } from 'react'
import { QrSvg } from './omni-live.js'
import { CHANNEL_TYPES, canWrite } from './omni-store.js'
import { ADD, copiedTelegramToken, offered, stepState, telegramChat } from './channel-add.js'
import { call, t, icons } from './core.js'
import { rich } from './omni-update.js'
const { ChevronLeftIcon } = icons

// Adding a channel to the linked Omni, for real, with nothing to type in a terminal. The grid
// shows the types this Omni has loaded; each opens a guided page with its steps on the left:
// - WhatsApp: the host creates the channel (omni-channel-create), and the page shows the code
//   Omni is waiting on, refreshed as WhatsApp rotates it, or a code to type on the phone.
// - Telegram and Discord: a bot token connects it; Discord then offers the invite to a server.
// - Slack: Omni signs in to Slack itself, as a bot or as the person (omni-slack-start), and the
//   page waits for how it ended (omni-slack-result).
// - WhatsApp Business: the Meta details, created and connected in one go (omni-wab-connect).
// - ClickUp: a personal API token, created and connected in one go (omni-clickup-connect); it
//   carries tasks, not messages.
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
  if (type === 'clickup') return h(ClickUpFlow, props)
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
function FlowShell({ type, at, Tile, PreviewChip, onBack, children }) {
  const info = CHANNEL_TYPES[type]
  const add = ADD[type]
  return h(Fragment, null,
    h('button', { type: 'button', className: 'oc-back', onClick: onBack }, h(ChevronLeftIcon), t('All channels')),
    h('header', { className: 'oc-head' }, h('div', null,
      h('h1', null, h(Tile, { type, size: 34 }), info.label, h(PreviewChip)),
      h('p', null, t('About {time}. You can disconnect any time from the channel\'s page.', { time: add.time })))),
    h('div', { className: 'oc-guide' },
      h('ol', { className: 'oc-guide-steps' }, add.steps.map((label, index) => h('li', { key: label, 'data-state': stepState(index, at) },
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
        setPairing(reply)
        setProblem(null)
        if (reply.connected) return onConnected(reply)
      } catch (error) {
        if (live) setProblem(error.message)
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
      setProblem(error.message)
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
      setProblem(error.message)
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
  const { pairing, problem: pollProblem } = usePairing(channel, channel !== null && done === null, (reply) => { unfinished.current = null; setDone(reply) })

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
      setProblem(error.message)
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
    body = h(Fragment, null, h('h2', null, t('Connecting…')), h(Spinner, { text: pairing?.message ?? t('Waiting for Omni to say the bot is up') }))
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
        if (reply.status === 'error') { setFlow(null); return setProblem(reply.message) }
      } catch (error) {
        if (live) setProblem(error.message)
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
      setProblem(error.message)
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
// WhatsApp Business: the details from Meta's WhatsApp Manager.

function BusinessFlow({ type, omni, Tile, PreviewChip }) {
  const info = CHANNEL_TYPES[type]
  const [fields, setFields] = useState({ accessToken: '', phoneNumberId: '', wabaId: '' })
  const [channel, setChannel] = useState(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const set = key => event => setFields(value => ({ ...value, [key]: event.target.value }))
  const ready = fields.accessToken.trim().length >= 8 && /^\d{5,25}$/.test(fields.phoneNumberId.trim()) && /^\d{5,25}$/.test(fields.wabaId.trim())
  const connect = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const made = await call('omni-wab-connect', { name: info.label, accessToken: fields.accessToken.trim(), phoneNumberId: fields.phoneNumberId.trim(), wabaId: fields.wabaId.trim() })
      setFields({ accessToken: '', phoneNumberId: '', wabaId: '' })
      setChannel(made)
    } catch (error) {
      setProblem(error.message)
    } finally {
      setBusy(false)
    }
  }
  const field = (key, label, extra) => h('label', { className: 'oc-field' }, h('span', null, label), h('input', { value: fields[key], onChange: set(key), autoComplete: 'off', ...extra }))
  return h(FlowShell, { type, at: channel ? 1 : 0, Tile, PreviewChip, onBack: () => omni.showPage({ type: null, step: 0 }) },
    channel ? h(Connected, { type, channel, omni })
      : h(Fragment, null,
        h('h2', null, t('Connect your Business number')),
        h('p', null, rich('Find these in Meta\'s {manager} → API setup.', { manager: h('a', { href: 'https://business.facebook.com/wa/manage/home/', target: '_blank', rel: 'noreferrer' }, t('WhatsApp Manager')) })),
        field('accessToken', t('Access token'), { type: 'password', placeholder: 'EAAG…', autoFocus: true }),
        field('phoneNumberId', t('Phone number ID'), { inputMode: 'numeric', placeholder: '123456789012345' }),
        field('wabaId', t('WhatsApp Business Account ID'), { inputMode: 'numeric', placeholder: '987654321098765' }),
        h('div', { className: 'oc-row' }, h('button', { type: 'button', className: 'oc-primary', disabled: !ready || busy, onClick: connect }, busy ? t('Connecting…') : t('Connect'))),
        h('p', { className: 'oc-fine' }, t('The token stays with your Omni. Omni only gets that number\'s messages.'))),
    h(Problem, { text: problem }))
}

// -------------------------------------------------------------------------
// ClickUp: a personal API token. Omni uses it for tasks, not messages, so its connected
// block says so rather than talking about chats and contacts.

const CLICKUP_HELP = () => h(Fragment, null,
  h('h2', null, t('Connect your ClickUp workspace')),
  h('p', null, t('Omni uses ClickUp for tasks, not messages. Automations and agents can create tasks, move their status, comment and list them.')),
  h('ol', { className: 'oc-numbered' },
    h('li', null, rich('In ClickUp, open {settings} → Apps and copy your personal API Token', { settings: h('a', { href: 'https://app.clickup.com/settings/apps', target: '_blank', rel: 'noreferrer' }, t('ClickUp settings')) })),
    h('li', null, t('The token belongs to you: it acts with your permissions in ClickUp, and it stops working if you leave the workspace. Omni stores it and never shows it again.')),
    h('li', null, t('Optional: the workspace (team) ID is the number in your ClickUp address, right after app.clickup.com/.')),
    h('li', null, t('Optional: a default List ID lets task actions leave the list out. Open a List and copy the number in its address.'))),
  h('p', { className: 'oc-fine' }, t('If connecting fails: 401 means the token is wrong or was revoked; 403 means it cannot open that workspace; a workspace ID the token cannot see is reported as unavailable; and a request that never arrives means this Omni cannot reach api.clickup.com.')))

function ClickUpFlow({ type, omni, Tile, PreviewChip }) {
  const [fields, setFields] = useState({ token: '', teamId: '', listId: '' })
  const [channel, setChannel] = useState(null)
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  // No useUnfinished here: omni-clickup-connect either leaves a connected channel or deletes
  // the one it made, so there is nothing for this page to clean up when it is left.
  const { pairing, problem: pollProblem } = usePairing(channel, channel !== null && done === null, setDone)
  const set = key => event => setFields(value => ({ ...value, [key]: event.target.value }))
  const ready = fields.token.trim().length >= 8
  const connect = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const made = await call('omni-clickup-connect', {
        token: fields.token.trim(),
        ...(fields.teamId.trim() ? { teamId: fields.teamId.trim() } : {}),
        ...(fields.listId.trim() ? { listId: fields.listId.trim() } : {}),
      })
      setFields(value => ({ ...value, token: '' }))
      setChannel(made)
    } catch (error) {
      setProblem(error.message)
    } finally {
      setBusy(false)
    }
  }
  const field = (key, label, extra) => h('label', { className: 'oc-field' }, h('span', null, label), h('input', { value: fields[key], onChange: set(key), autoComplete: 'off', ...extra }))
  const at = done ? 2 : channel ? 1 : 0
  let body
  if (done) {
    body = h(Fragment, null,
      h('h2', null, t('ClickUp is connected')),
      h('p', null, [done.detail ? t('Workspace {team}', { team: done.detail }) : null, t('No messages are sent: Omni can create and update tasks and comments in this workspace.')].filter(Boolean).join(' · ')),
      h('div', { className: 'oc-row' }, h('button', { type: 'button', className: 'oc-primary', onClick: () => omni.finishConnect(type, channel.name, channel.id) }, t('See its health'))))
  } else if (channel) {
    body = h(Fragment, null, h('h2', null, t('Connecting…')), h(Spinner, { text: pairing?.message ?? t('Waiting for Omni to say ClickUp is ready') }))
  } else {
    body = h(Fragment, null,
      CLICKUP_HELP(),
      field('token', t('API token'), { type: 'password', required: true, autoFocus: true, placeholder: 'pk_…', onKeyDown: (event) => { if (event.key === 'Enter' && ready && !busy) void connect() } }),
      field('teamId', t('Workspace / Team ID (optional)'), { inputMode: 'numeric', placeholder: '9013…' }),
      field('listId', t('Default List ID (optional)'), { inputMode: 'numeric', placeholder: '9013…' }),
      h('div', { className: 'oc-row' }, h('button', { type: 'button', className: 'oc-primary', disabled: !ready || busy, onClick: connect }, busy ? t('Connecting…') : t('Connect'))),
      h('p', { className: 'oc-fine' }, t('The token stays with your Omni. Nothing is sent to ClickUp until an automation or agent acts.')))
  }
  return h(FlowShell, { type, at, Tile, PreviewChip, onBack: () => omni.showPage({ type: null, step: 0 }) }, body, h(Problem, { text: problem ?? pollProblem }))
}
