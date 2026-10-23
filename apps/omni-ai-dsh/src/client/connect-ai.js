import { createElement as h, useCallback, useEffect, useState } from 'react'
import { call } from './api.js'
import { Stage, useFinish, useGate, useGlitch } from './stage.js'
import { SUBSCRIPTION_TILES, SubscriptionSignIn, signedInCount } from './subscriptions.js'
import { ClaudeLoginTerminal } from './terminal.js'

// Step omni-connect-ai (order -200): every AI is a row with a switch, and several can be on.
// What this computer already has comes first, on (src/host/ais.js finds it). A row that is not
// set up opens its setup in place: a key, the provider's own sign-in in DSH, Claude Code's own
// login in a terminal, a gateway. Off stops using an AI and keeps its key or sign-in.
//
// One way to reach each AI: Claude only through Claude Code, the others through DSH's own
// sign-ins, and dsh-subscriptions for what nothing else covers.

export const VENDOR_TERMS = 'Personal use under the vendor\'s terms'
// How many "Add another" rows show before "Show N more".
export const FIRST_OTHERS = 4
export const LOGOS = { claude: 'C', chatgpt: 'G', deepseek: 'D', kimi: 'K', copilot: 'P', grok: 'X', openai: 'O', anthropic: 'A', openrouter: 'R', zai: 'Z', moonshot: 'M', opencode: 'OC', cliproxy: '⇄', ollama: 'L' }
export const CLAUDE_INSTALL = 'curl -fsSL https://claude.ai/install.sh | bash'

// dsh-subscriptions' vendors as rows, when that plugin is here.
export function subscriptionRows(subscriptions) {
  if (!subscriptions) return []
  return SUBSCRIPTION_TILES.map((tile) => {
    const count = signedInCount(subscriptions.accounts.map(account => ({ ...account, configured: true })), tile.provider)
    const on = count > 0 && !subscriptions.hidden.includes(tile.provider)
    return { id: `sub:${tile.provider}`, name: tile.name, via: `${tile.note} · dsh-subscriptions`, kind: 'subscription', tile, ready: count > 0, on, found: count > 1 ? `${count} accounts` : count === 1 ? 'Signed in' : null }
  })
}

// The two sections: what was found (on by default, or set up already), then the rest.
export function sections(rows) {
  const found = rows.filter(row => row.found || row.on)
  const others = rows.filter(row => !found.includes(row))
  return { found, others }
}

export const onCount = rows => rows.filter(row => row.on).length

// What a switch does when flipped: turn it off, turn on what is set up, or open its setup.
export function flipAction(row) {
  if (row.on) return 'off'
  return row.ready ? 'on' : 'setup'
}

function Copyable({ text }) {
  const [copied, setCopied] = useState(false)
  return h('div', { className: 'oai-code oai-command' },
    h('code', null, text),
    h('button', { type: 'button', className: 'oai-ghost', onClick: () => navigator.clipboard?.writeText(text).then(() => setCopied(true)) }, copied ? 'Copied' : 'Copy'))
}

function KeyForm({ row, provider, onSaved }) {
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      await call('provider-key', { provider, apiKey })
      setApiKey('')
      onSaved()
    } catch (error) {
      setProblem(error.message)
      setBusy(false)
    }
  }
  return h('form', { onSubmit: submit, className: 'oai-setup-form' },
    h('div', { className: 'oai-field' },
      h('input', { type: 'password', required: true, autoComplete: 'off', spellCheck: false, autoFocus: true, placeholder: `Paste your ${row.name} key`, 'aria-label': `${row.name} key`, value: apiKey, onChange: e => setApiKey(e.target.value) }),
      h('button', { type: 'submit', className: 'oai-primary', disabled: busy }, busy ? 'Turning on…' : 'Turn on')),
    h('p', { className: 'oai-muted' }, 'It stays on this computer, in DSH\'s own credential store.', row.keyUrl ? [' ', h('a', { key: 'k', className: 'oai-link', href: row.keyUrl, target: '_blank', rel: 'noreferrer' }, `Get a ${row.name} key`)] : null),
    problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null)
}

// A sign-in running in DSH: its latest notice (a page to open, a code to type), its open
// question, and how it ended. Polled, so a reload finds it again. The route is written by the
// host only once the sign-in succeeds.
function SignIn({ row, provider, onSaved, onCancel }) {
  const [attempt, setAttempt] = useState(null)
  const [problem, setProblem] = useState(null)
  const [answer, setAnswer] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let live = true
    let timer = 0
    const poll = async (first) => {
      try {
        const next = await call(first ? 'signin-start' : 'signin-status', { provider })
        if (!live) return
        setAttempt(next)
        if (next.status === 'authorized') return onSaved()
        if (next.status === 'running') timer = setTimeout(() => poll(false), 1000)
      } catch (error) {
        if (live) setProblem(error.message)
      }
    }
    poll(true)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [provider])
  const reply = async (value) => {
    setProblem(null)
    try {
      setAttempt(await call('signin-answer', { provider, promptId: attempt.prompt.id, value }))
      setAnswer('')
    } catch (error) {
      setProblem(error.message)
    }
  }
  const cancel = async () => {
    await call('signin-cancel', { provider }).catch(() => {})
    onCancel()
  }
  const notice = attempt?.notice
  const prompt = attempt?.prompt
  const ended = attempt && ['cancelled', 'failed', 'none'].includes(attempt.status)
  const endedText = { failed: `The sign-in did not finish: ${attempt?.error}`, cancelled: 'The sign-in was cancelled. Nothing was turned on.', none: 'The sign-in stopped before it finished. Flip the switch to start again.' }
  return h('div', { className: 'oai-signin' },
    !attempt && !problem ? h('p', { className: 'oai-muted' }, `Starting the ${row.name} sign-in…`) : null,
    notice?.message ? h('p', null, notice.message) : null,
    notice?.code ? h('div', { className: 'oai-code' },
      h('code', null, notice.code),
      h('button', { type: 'button', className: 'oai-ghost', onClick: () => navigator.clipboard?.writeText(notice.code).then(() => setCopied(true)) }, copied ? 'Copied' : 'Copy code')) : null,
    notice?.url ? h('a', { className: 'oai-primary oai-button', href: notice.url, target: '_blank', rel: 'noreferrer' }, `Sign in with ${row.name}`) : null,
    prompt?.kind === 'select' ? h('div', { className: 'oai-choices', role: 'group', 'aria-label': prompt.message },
      h('p', null, prompt.message),
      prompt.options.map(option => h('button', { key: option.id, type: 'button', onClick: () => reply(option.id) }, h('strong', null, option.label), option.description ? h('span', null, option.description) : null))) : null,
    prompt && prompt.kind !== 'select' ? h('form', { onSubmit: (event) => { event.preventDefault(); reply(answer) } },
      h('label', { htmlFor: `oai-answer-${row.id}` }, prompt.message),
      h('input', { id: `oai-answer-${row.id}`, type: prompt.kind === 'secret' ? 'password' : 'text', required: true, autoComplete: 'off', spellCheck: false, autoFocus: true, placeholder: prompt.placeholder, value: answer, onChange: e => setAnswer(e.target.value) }),
      h('button', { type: 'submit', className: 'oai-primary' }, 'Continue')) : null,
    attempt?.status === 'running' && !prompt ? h('p', { className: 'oai-muted oai-waiting' }, 'Finish signing in on their page…') : null,
    ended ? h('p', { className: 'oai-error', role: 'alert' }, endedText[attempt.status]) : null,
    problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null,
    !ended && !problem ? h('button', { type: 'button', className: 'oai-quiet', onClick: cancel }, 'Cancel') : null)
}

function CliproxyForm({ onSaved }) {
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      await call('cliproxy', { baseURL, apiKey })
      setApiKey('')
      onSaved()
    } catch (error) {
      setProblem(error.message)
      setBusy(false)
    }
  }
  return h('form', { onSubmit: submit, className: 'oai-setup-form' },
    h('input', { type: 'url', required: true, placeholder: 'http://localhost:8317/v1', 'aria-label': 'Gateway address', autoComplete: 'off', value: baseURL, onChange: e => setBaseURL(e.target.value) }),
    h('div', { className: 'oai-field' },
      h('input', { type: 'password', required: true, placeholder: 'Gateway key', 'aria-label': 'Gateway key', autoComplete: 'off', spellCheck: false, value: apiKey, onChange: e => setApiKey(e.target.value) }),
      h('button', { type: 'submit', className: 'oai-primary', disabled: busy }, busy ? 'Turning on…' : 'Turn on')),
    h('p', { className: 'oai-muted' }, 'Omni lists the gateway\'s models with your key and keeps the key in DSH\'s credential store.'),
    problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null)
}

// Claude through the person's own Claude Code: Omni never signs anyone in to Claude. The CLI
// signs itself in, here in a terminal, and the row turns on once it says so.
function ClaudeSetup({ row, onSaved, onClose }) {
  if (row.needs === 'plugin') return h('p', null, 'Claude runs through the Oh My Claude plugin, which this DSH does not have. Add it from Settings → Plugins.')
  if (row.needs === 'install') {
    return h('div', null,
      h('p', null, 'Install Claude Code, Anthropic\'s own app. In a terminal:'),
      h(Copyable, { text: CLAUDE_INSTALL }),
      h('p', { className: 'oai-muted' }, 'Or follow ', h('a', { className: 'oai-link', href: 'https://code.claude.com/docs/en/setup', target: '_blank', rel: 'noreferrer' }, 'Anthropic\'s setup guide'), '. Then flip this again.'))
  }
  if (row.needs === 'restart') return h('p', { className: 'oai-error' }, 'Claude Code is signed in, but this app cannot start it from where it is installed. Restart the app to pick it up.')
  return h('div', null,
    h(ClaudeLoginTerminal, { onClose, onEnded: (reply) => { if (reply.state === 'done') onSaved() } }),
    h('p', { className: 'oai-muted' }, 'Press Enter in the terminal. Claude Code signs in with your own Claude account; Omni only talks to the Claude Code app.'))
}

function Setup({ row, onSaved, onClose }) {
  if (row.kind === 'claude') return h(ClaudeSetup, { row, onSaved, onClose })
  if (row.kind === 'key') return h(KeyForm, { row, provider: providerOf(row), onSaved })
  if (row.kind === 'signin') {
    if (row.signIn) return h(SignIn, { row, provider: providerOf(row), onSaved, onCancel: onClose })
    if (row.keyUrl) return h(KeyForm, { row, provider: providerOf(row), onSaved })
    return h('p', null, `This DSH offers no ${row.name} sign-in.`)
  }
  if (row.kind === 'gateway') return h(CliproxyForm, { onSaved })
  if (row.kind === 'local') return h('p', { className: 'oai-muted' }, 'Ollama is not running on this computer. Start it, then flip this again.')
  if (row.kind === 'subscription') return h(SubscriptionSignIn, { tile: row.tile, onBack: onClose, onSaved, glitch: () => {} })
  return null
}

export const PROVIDER_OF = { chatgpt: 'openai-codex', kimi: 'kimi-coding', copilot: 'github-copilot', grok: 'xai', openai: 'openai', anthropic: 'anthropic', openrouter: 'openrouter', zai: 'zai', moonshot: 'moonshotai', opencode: 'opencode', deepseek: 'deepseek' }
const providerOf = row => PROVIDER_OF[row.id] ?? row.id

// "Also connected through …": the other ways this row's AI is connected, which Omni does not use.
function Duplicates({ row, onDedupe }) {
  if (!row.duplicates?.length) return null
  const shown = row.duplicates.filter(duplicate => !duplicate.hidden)
  return h('div', { className: 'oai-dupes' },
    row.duplicates.map(duplicate => h('p', { key: `${duplicate.via}:${duplicate.provider}`, className: 'oai-muted' },
      `Also connected through ${duplicate.via}; Omni uses ${row.name} ${row.kind === 'claude' ? 'through Claude Code' : 'here'}.`,
      duplicate.hidden ? ' Its models are hidden.' : null)),
    shown.length && row.on ? h('button', { type: 'button', className: 'oai-ghost', onClick: onDedupe }, `Use only this ${row.name}`) : null)
}

function Row({ row, open, busy, problem, onFlip, onSaved, onClose, onDedupe }) {
  const logo = LOGOS[row.id] ?? row.name.slice(0, 1)
  return h('div', { className: `oai-ai${row.on ? ' oai-ai-on' : ''}` },
    h('div', { className: 'oai-ai-row' },
      h('div', { className: 'oai-logo', 'aria-hidden': true }, logo),
      h('div', { className: 'oai-ai-what' },
        h('strong', null, row.name),
        h('span', null, row.detail ? `${row.via} · ${row.detail}` : row.via)),
      row.found ? h('em', { className: 'oai-found' }, row.found) : null,
      h('button', { type: 'button', role: 'switch', className: 'oai-switch', 'aria-checked': row.on ? 'true' : 'false', 'aria-label': row.name, disabled: busy, onClick: onFlip })),
    open && !row.on ? h('div', { className: 'oai-ai-setup' }, h(Setup, { row, onSaved, onClose })) : null,
    problem ? h('p', { className: 'oai-error oai-ai-problem', role: 'alert' }, problem) : null,
    h(Duplicates, { row, onDedupe }))
}

export function ConnectAiStep(props) {
  const state = useGate(props)
  const finish = useFinish(props)
  const [glitching, glitch] = useGlitch()
  const [rows, setRows] = useState(null)
  const [subs, setSubs] = useState(null)
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(null)
  const [problems, setProblems] = useState({})
  const [showAll, setShowAll] = useState(false)

  const refresh = useCallback(async () => {
    const reply = await call('ais').catch(() => ({ rows: [], subscriptions: null }))
    setRows(reply.rows ?? [])
    setSubs(reply.subscriptions ?? null)
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (state) glitch() }, [state, glitch])
  if (!state) return null

  const all = rows === null ? null : [...rows, ...subscriptionRows(subs)]
  const say = (id, message) => setProblems(previous => ({ ...previous, [id]: message }))

  const flip = async (row) => {
    const action = flipAction(row)
    say(row.id, null)
    if (action === 'setup') {
      setOpen(current => (current === row.id ? null : row.id))
      return
    }
    setBusy(row.id)
    try {
      if (row.kind === 'subscription') await call('ai-subscription', { provider: row.tile.provider, on: action === 'on' })
      else await call('ai-switch', { id: row.id, on: action === 'on' })
      if (action === 'on') glitch()
      await refresh()
    } catch (error) {
      say(row.id, error.message)
    }
    setBusy(null)
  }
  const saved = row => async () => {
    setOpen(null)
    glitch()
    // A row set up just now stops its duplicates, as turning it on does.
    if (row.kind !== 'subscription') await call('ai-dedupe', { id: row.id }).catch(() => {})
    await refresh()
  }
  const dedupe = row => async () => {
    say(row.id, null)
    try {
      await call('ai-dedupe', { id: row.id })
      await refresh()
    } catch (error) {
      say(row.id, error.message)
    }
  }

  const count = all ? onCount(all) : 0
  const { found, others } = sections(all ?? [])
  const visible = showAll ? others : others.slice(0, FIRST_OTHERS)
  const rowOf = row => h(Row, { key: row.id, row, open: open === row.id, busy: busy !== null, problem: problems[row.id], onFlip: () => flip(row), onSaved: saved(row), onClose: () => setOpen(null), onDedupe: dedupe(row) })

  return h(Stage, {
    title: 'Turn on your AIs',
    speech: count > 0 ? `Turn on everything you have. More brains, more ${state.companionName ?? 'Omni'}.` : 'Now give me a brain. Turn on every AI you have; you can change it any time.',
    at: 'omni-connect-ai',
    glitching,
  },
  all === null ? h('p', { className: 'oai-muted' }, 'Looking at what this computer has…') : [
    found.length ? h('section', { key: 'found', className: 'oai-group', 'aria-label': 'Found on this computer' },
      h('h2', null, 'Found on this computer'),
      h('div', { className: 'oai-list' }, found.map(rowOf))) : null,
    h('section', { key: 'others', className: 'oai-group', 'aria-label': found.length ? 'Add another' : 'Your AIs' },
      h('h2', null, found.length ? 'Add another' : 'Your AIs'),
      h('p', { className: 'oai-terms oai-muted' }, `Subscriptions: ${VENDOR_TERMS.toLowerCase()}.`),
      h('div', { className: 'oai-list' }, visible.map(rowOf),
        !showAll && others.length > FIRST_OTHERS ? h('button', { type: 'button', className: 'oai-more', onClick: () => setShowAll(true) }, `Show ${others.length - FIRST_OTHERS} more`) : null)),
    h('p', { key: 'more', className: 'oai-muted oai-every' }, 'Every other provider DSH knows is in ', h('button', { type: 'button', className: 'oai-inline', onClick: () => finish('models') }, 'Settings → Models'), '.'),
  ],
  h('div', { className: 'oai-actions' },
    h('button', { type: 'button', className: 'oai-quiet', onClick: () => finish() }, 'Skip for now'),
    h('span', { className: 'oai-count' }, count > 0 ? `${count} on` : 'Turn on at least one'),
    h('button', { type: 'button', className: 'oai-primary', disabled: count === 0, onClick: () => finish() }, count > 0 ? 'Continue →' : 'Continue')))
}
