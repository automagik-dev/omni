import { createElement as h, useEffect, useState } from 'react'
import { call } from './api.js'
import { Stage, useFinish, useGate, useGlitch } from './stage.js'
import { SUBSCRIPTION_TILES, SubscriptionSignIn, signedInCount, subscriptionAccounts } from './subscriptions.js'

// Step omni-connect-ai (order -200): each tile connects for real. A subscription tile runs
// that provider's own sign-in in DSH (src/host/providers.js relays its link, code and
// questions here); a key tile saves the key where DSH's Models page would; the gateway
// form writes a CLIProxyAPI route. "Another provider" opens DSH's Models page.

export const VENDOR_TERMS = 'Personal use under the vendor\'s terms'

export const GROUPS = [
  {
    title: 'Sign in with a plan you have',
    terms: VENDOR_TERMS,
    tiles: [
      { id: 'codex', provider: 'openai-codex', name: 'ChatGPT', note: 'Plus, Pro or Team, through Codex', signin: true },
      { id: 'claude', name: 'Claude', note: 'Pro or Max, through your Claude Code', claudeCode: true },
      { id: 'kimi', provider: 'kimi-coding', name: 'Kimi', note: 'Kimi Code', signin: true },
      { id: 'copilot', provider: 'github-copilot', name: 'GitHub Copilot', note: 'Your Copilot plan', signin: true },
    ],
  },
  {
    title: 'With an API key',
    tiles: [
      { id: 'deepseek', provider: 'deepseek', name: 'DeepSeek', note: 'A DeepSeek API key', key: 'https://platform.deepseek.com/api_keys' },
      { id: 'openai', provider: 'openai', name: 'OpenAI', note: 'An OpenAI API key', key: 'https://platform.openai.com/api-keys' },
      { id: 'anthropic', provider: 'anthropic', name: 'Anthropic', note: 'An Anthropic API key', key: 'https://console.anthropic.com/settings/keys' },
      { id: 'openrouter', provider: 'openrouter', name: 'OpenRouter', note: 'Hundreds of models, one key', key: 'https://openrouter.ai/keys' },
      { id: 'zai', provider: 'zai', name: 'Z.ai', note: 'GLM models', key: 'https://z.ai/manage-apikey/apikey-list' },
      { id: 'moonshot', provider: 'moonshotai', name: 'Moonshot', note: 'Kimi models by API key', key: 'https://platform.moonshot.ai/console/api-keys' },
      { id: 'opencode', provider: 'opencode', name: 'OpenCode', note: 'An OpenCode Zen key', key: 'https://opencode.ai/zen' },
    ],
  },
  {
    title: 'Something else',
    tiles: [
      { id: 'cliproxy', name: 'Your own gateway', note: 'CLIProxyAPI or any OpenAI-compatible server', form: true },
      { id: 'api-key', name: 'Another provider', note: 'Every provider DSH knows, in Settings', section: 'models' },
    ],
  },
]

// The subscriptions dsh-subscriptions adds, as a group after DSH's own sign-ins.
export const SUBSCRIPTIONS_GROUP = { title: 'More subscriptions', terms: VENDOR_TERMS, tiles: SUBSCRIPTION_TILES.map(tile => ({ ...tile, subscription: true })) }

// How many of a tile's connections exist: a signed-in account, a stored key, or the
// subscription plugin's signed-in accounts for that provider.
export function connectionsOf(tile, status, accounts) {
  if (tile.subscription) return signedInCount(accounts, tile.provider)
  if (tile.claudeCode) return status?.claudeCode?.loggedIn ? 1 : 0
  const own = status?.[tile.provider]
  if (tile.signin) return own?.signedIn ? 1 : 0
  if (tile.key) return own?.key ? 1 : 0
  return 0
}

function Tiles({ onTile, status, accounts }) {
  const groups = accounts ? [GROUPS[0], SUBSCRIPTIONS_GROUP, ...GROUPS.slice(1)] : GROUPS
  return groups.map(group => h('section', { key: group.title, className: 'oai-group', 'aria-label': group.title },
    h('h2', null, group.title),
    group.terms ? h('p', { className: 'oai-terms oai-muted' }, group.terms) : null,
    h('div', { className: 'oai-tiles' }, group.tiles.map((tile) => {
      const count = connectionsOf(tile, status, accounts)
      return h('button', {
        key: tile.id, type: 'button', className: count > 0 ? 'oai-tile oai-tile-on' : 'oai-tile', onClick: () => onTile(tile),
      }, h('strong', null, tile.name), h('span', null, tile.note),
      count > 0 ? h('em', { className: 'oai-on' }, count === 1 ? 'Connected' : `${count} accounts`) : null)
    }))))
}

function KeyForm({ tile, onBack, onSaved, glitch }) {
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      await call('provider-key', { provider: tile.provider, apiKey })
      setApiKey('')
      glitch()
      onSaved({ name: tile.name })
    } catch (error) {
      setProblem(error.message)
      setBusy(false)
    }
  }
  return h('form', { onSubmit: submit },
    h('p', null, 'The key stays in DSH\'s own credential store on this computer. ', h('a', { className: 'oai-link', href: tile.key, target: '_blank', rel: 'noreferrer' }, `Get a ${tile.name} key`), '.'),
    h('label', { htmlFor: 'oai-key' }, `${tile.name} API key`),
    h('input', { id: 'oai-key', type: 'password', required: true, autoComplete: 'off', spellCheck: false, autoFocus: true, value: apiKey, onChange: e => setApiKey(e.target.value) }),
    problem ? h('p', { className: 'oai-error', role: 'alert', style: { marginTop: '10px' } }, problem) : null,
    h('button', { type: 'submit', className: 'oai-primary', disabled: busy }, busy ? 'Connecting…' : 'Connect'),
    h('button', { type: 'button', className: 'oai-quiet', disabled: busy, onClick: onBack }, 'Back'))
}

// Claude through the person's own Claude Code (the dsh-oh-my-claude plugin runs `claude -p`):
// Anthropic lets a Claude plan work in other apps that way, never through a sign-in of ours.
// This only checks, every few seconds, that the CLI is installed and signed in, and says the
// next step: Anthropic's installer, then Anthropic's own `claude auth login`.
export const CLAUDE_INSTALL = 'curl -fsSL https://claude.ai/install.sh | bash'
export const CLAUDE_LOGIN = 'claude auth login'
function Copyable({ text }) {
  const [copied, setCopied] = useState(false)
  return h('div', { className: 'oai-code oai-command' },
    h('code', null, text),
    h('button', { type: 'button', className: 'oai-ghost', onClick: () => navigator.clipboard?.writeText(text).then(() => setCopied(true)) }, copied ? 'Copied' : 'Copy'))
}
function ClaudeCode({ onBack, onSaved, glitch }) {
  const [check, setCheck] = useState(null)
  const [problem, setProblem] = useState(null)
  useEffect(() => {
    let live = true
    let timer = 0
    const poll = async () => {
      try {
        const next = await call('claude-code')
        if (!live) return
        setCheck(next)
        setProblem(null)
        if (next.plugin && next.loggedIn && next.reachable !== false) {
          glitch()
          onSaved({ name: 'Claude', detail: [next.email, next.plan ? `${next.plan[0].toUpperCase()}${next.plan.slice(1)} plan` : null].filter(Boolean).join(' · ') })
          return
        }
      } catch (error) {
        if (live) setProblem(error.message)
      }
      if (live) timer = setTimeout(poll, 3000)
    }
    poll()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [])
  return h('div', { className: 'oai-signin' },
    !check && !problem ? h('p', { className: 'oai-muted' }, 'Looking for Claude Code on this computer…') : null,
    check && !check.plugin ? h('p', null, 'Claude runs through the Oh My Claude plugin, which this DSH does not have. Add it from Settings → Plugins.') : null,
    check?.plugin && !check.installed ? [
      h('p', { key: 'p' }, 'Install Claude Code, Anthropic\'s own app. In a terminal:'),
      h(Copyable, { key: 'c', text: CLAUDE_INSTALL }),
      h('p', { key: 'm', className: 'oai-muted' }, 'Or follow ', h('a', { className: 'oai-link', href: 'https://code.claude.com/docs/en/setup', target: '_blank', rel: 'noreferrer' }, 'Anthropic\'s setup guide'), '.'),
    ] : null,
    check?.plugin && check.installed && check.loggedIn && check.reachable === false ? h('p', { className: 'oai-error' }, `Claude Code is signed in, at ${check.path}, but this app cannot start it from there. Restart the app to pick it up.`) : null,
    check?.plugin && check.installed && !check.loggedIn ? [
      h('p', { key: 'p' }, 'Claude Code is here. Sign it in with your Claude account, in a terminal:'),
      h(Copyable, { key: 'c', text: CLAUDE_LOGIN }),
    ] : null,
    check?.plugin && !check.loggedIn ? h('p', { className: 'oai-muted oai-waiting' }, 'I\'ll notice as soon as it\'s done.') : null,
    problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null,
    h('button', { type: 'button', className: 'oai-quiet', onClick: onBack }, 'Back'))
}

// A sign-in running in DSH: its latest notice (a page to open, a code to type), its open
// question, and how it ended. Polled, so a reload finds it again.
function SignIn({ tile, onBack, onSaved, glitch }) {
  const [attempt, setAttempt] = useState(null)
  const [problem, setProblem] = useState(null)
  const [answer, setAnswer] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let live = true
    let timer = 0
    const poll = async (first) => {
      try {
        const next = await call(first ? 'signin-start' : 'signin-status', { provider: tile.provider })
        if (!live) return
        setAttempt(next)
        if (next.status === 'authorized') {
          glitch()
          onSaved({ name: tile.name })
          return
        }
        if (next.status === 'running' || next.status === 'none') timer = setTimeout(() => poll(false), 1000)
      } catch (error) {
        if (live) setProblem(error.message)
      }
    }
    poll(true)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [tile.provider])
  const reply = async (value) => {
    setProblem(null)
    try {
      setAttempt(await call('signin-answer', { provider: tile.provider, promptId: attempt.prompt.id, value }))
      setAnswer('')
    } catch (error) {
      setProblem(error.message)
    }
  }
  const cancel = async () => {
    await call('signin-cancel', { provider: tile.provider }).catch(() => {})
    onBack()
  }
  const notice = attempt?.notice
  const prompt = attempt?.prompt
  const ended = attempt && ['cancelled', 'failed'].includes(attempt.status)
  return h('div', { className: 'oai-signin' },
    !attempt && !problem ? h('p', { className: 'oai-muted' }, `Starting the ${tile.name} sign-in…`) : null,
    notice?.message ? h('p', null, notice.message) : null,
    notice?.code ? h('div', { className: 'oai-code' },
      h('code', null, notice.code),
      h('button', { type: 'button', className: 'oai-ghost', onClick: () => navigator.clipboard?.writeText(notice.code).then(() => setCopied(true)) }, copied ? 'Copied' : 'Copy code')) : null,
    notice?.url ? h('a', { className: 'oai-primary oai-button', href: notice.url, target: '_blank', rel: 'noreferrer' }, `Open ${tile.name} to sign in`) : null,
    prompt?.kind === 'select' ? h('div', { className: 'oai-choices', role: 'group', 'aria-label': prompt.message },
      h('p', null, prompt.message),
      prompt.options.map(option => h('button', { key: option.id, type: 'button', onClick: () => reply(option.id) }, h('strong', null, option.label), option.description ? h('span', null, option.description) : null))) : null,
    prompt && prompt.kind !== 'select' ? h('form', { onSubmit: (event) => { event.preventDefault(); reply(answer) } },
      h('label', { htmlFor: 'oai-answer' }, prompt.message),
      h('input', { id: 'oai-answer', type: prompt.kind === 'secret' ? 'password' : 'text', required: true, autoComplete: 'off', spellCheck: false, autoFocus: true, placeholder: prompt.placeholder, value: answer, onChange: e => setAnswer(e.target.value) }),
      h('button', { type: 'submit', className: 'oai-primary' }, 'Continue')) : null,
    attempt?.status === 'running' && !prompt ? h('p', { className: 'oai-muted oai-waiting' }, 'Waiting for you to finish signing in…') : null,
    ended ? h('p', { className: 'oai-error', role: 'alert' }, attempt.status === 'failed' ? `The sign-in did not finish: ${attempt.error}` : 'The sign-in was cancelled.') : null,
    problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null,
    h('button', { type: 'button', className: 'oai-quiet', onClick: ended || problem ? onBack : cancel }, ended || problem ? 'Back' : 'Cancel'))
}

function CliproxyForm({ onBack, onSaved, glitch }) {
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      const saved = await call('cliproxy', { baseURL, apiKey })
      setApiKey('')
      glitch()
      onSaved(saved)
    } catch (error) {
      setProblem(error.message)
      setBusy(false)
    }
  }
  return h('form', { onSubmit: submit },
    h('p', null, 'Omni lists the gateway\'s models with your key, keeps the key in DSH\'s credential store, and adds the models to the model picker.'),
    h('label', { htmlFor: 'oai-cliproxy-url' }, 'Gateway address'),
    h('input', { id: 'oai-cliproxy-url', type: 'url', required: true, placeholder: 'http://localhost:8317/v1', autoComplete: 'off', value: baseURL, onChange: e => setBaseURL(e.target.value) }),
    h('label', { htmlFor: 'oai-cliproxy-key' }, 'API key'),
    h('input', { id: 'oai-cliproxy-key', type: 'password', required: true, autoComplete: 'off', spellCheck: false, value: apiKey, onChange: e => setApiKey(e.target.value) }),
    problem ? h('p', { className: 'oai-error', role: 'alert', style: { marginTop: '10px' } }, problem) : null,
    h('button', { type: 'submit', className: 'oai-primary', disabled: busy }, busy ? 'Connecting…' : 'Connect'),
    h('button', { type: 'button', className: 'oai-quiet', disabled: busy, onClick: onBack }, 'Back'))
}

export function ConnectAiStep(props) {
  const state = useGate(props)
  const finish = useFinish(props)
  const [glitching, glitch] = useGlitch()
  const [view, setView] = useState('tiles')
  const [saved, setSaved] = useState(null)
  // What is connected already, refreshed whenever the tiles show again.
  const [status, setStatus] = useState(null)
  const [accounts, setAccounts] = useState(null)
  useEffect(() => {
    if (view !== 'tiles') return
    Promise.all([call('providers').catch(() => ({})), call('claude-code').catch(() => null)])
      .then(([providers, claudeCode]) => setStatus({ ...providers, claudeCode }))
    subscriptionAccounts().then(setAccounts)
  }, [view])
  useEffect(() => { if (state) glitch() }, [state, glitch])
  if (!state) return null

  if (view?.claudeCode) {
    return h(Stage, { title: 'Claude, through your Claude Code', speech: 'I\'ll think with your own Claude Code: your login, your plan.', at: 'omni-connect-ai', glitching },
      h(ClaudeCode, { onBack: () => setView('tiles'), onSaved: (value) => { setSaved(value); setView('saved') }, glitch }))
  }
  if (view?.subscription) {
    return h(Stage, { title: `Connect ${view.subscription.name}`, speech: 'Sign in with your plan; I\'ll add it to what you already have.', at: 'omni-connect-ai', glitching },
      h(SubscriptionSignIn, { tile: view.subscription, onBack: () => setView('tiles'), onSaved: (value) => { setSaved(value); setView('saved') }, glitch }))
  }
  if (view?.signin) {
    return h(Stage, { title: `Sign in to ${view.signin.name}`, speech: 'Sign in on their page; I\'ll wait right here.', at: 'omni-connect-ai', glitching },
      h(SignIn, { tile: view.signin, onBack: () => setView('tiles'), onSaved: (value) => { setSaved(value); setView('saved') }, glitch }))
  }
  if (view?.key) {
    return h(Stage, { title: `Connect ${view.key.name}`, speech: 'Paste your key and I\'m ready to think.', at: 'omni-connect-ai', glitching },
      h(KeyForm, { tile: view.key, onBack: () => setView('tiles'), onSaved: (value) => { setSaved(value); setView('saved') }, glitch }))
  }
  if (view === 'cliproxy') {
    return h(Stage, { title: 'Connect CLIProxyAPI', speech: 'Point me at your gateway. Its key stays in DSH, never in a settings file.', at: 'omni-connect-ai', glitching },
      h(CliproxyForm, { onBack: () => setView('tiles'), onSaved: (value) => { setSaved(value); setView('saved') }, glitch }))
  }
  if (view === 'saved' && saved?.models) {
    const count = saved.models.length
    return h(Stage, { title: 'Gateway connected', speech: `Connected! ${count} ${count === 1 ? 'model' : 'models'} from your gateway, ready in the model picker.`, at: 'omni-connect-ai', glitching },
      h('div', { className: 'oai-models', 'aria-label': 'Models' }, saved.models.map(id => h('div', { key: id }, id))),
      h('button', { type: 'button', className: 'oai-primary', onClick: () => finish() }, 'Done'))
  }
  if (view === 'saved') {
    return h(Stage, { title: `${saved?.name ?? 'AI'} connected`, speech: `Connected! ${saved?.name ?? 'Its'} models join the others in the model picker.`, at: 'omni-connect-ai', glitching },
      saved?.detail ? h('p', { className: 'oai-muted' }, saved.detail) : null,
      h('button', { type: 'button', className: 'oai-primary', onClick: () => finish() }, 'Done'),
      h('button', { type: 'button', onClick: () => setView('tiles') }, 'Connect another'))
  }
  const connected = state.aiConnected === true
  return h(Stage, {
    title: 'Connect an AI',
    speech: connected ? 'You already have an AI connected. Add another, or carry on.' : 'Now give me a brain. Pick how you reach your AI; you can add more later.',
    at: 'omni-connect-ai',
    glitching,
  },
  h(Tiles, { status, accounts, onTile: tile => (tile.claudeCode ? setView({ claudeCode: true }) : tile.subscription ? setView({ subscription: tile }) : tile.form ? setView('cliproxy') : tile.signin ? setView({ signin: tile }) : tile.key ? setView({ key: tile }) : finish(tile.section)) }),
  h('button', { type: 'button', className: connected ? 'oai-primary' : 'oai-quiet', style: { marginTop: '16px' }, onClick: () => finish() }, connected ? 'Continue' : 'Skip for now'))
}
