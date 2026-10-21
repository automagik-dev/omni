import { createElement as h, useEffect, useState } from 'react'
import { call } from './api.js'
import { Stage, useFinish, useGate, useGlitch } from './stage.js'

// Step omni-connect-ai (order -200): every way rc.2 already has to reach an AI, API keys
// first. Each tile leads into DSH's own sign-in; Omni ships no provider code. The one
// form is CLIProxyAPI's, whose route the host writes into pi-ai's settings.

export const VENDOR_TERMS = 'Personal use under the vendor\'s terms'

export const GROUPS = [
  {
    title: 'With an API key',
    tiles: [
      { id: 'deepseek', name: 'DeepSeek', note: 'With a DeepSeek API key', section: 'models' },
      { id: 'zai', name: 'Z.ai', note: 'GLM models, with a Z.ai API key', section: 'models' },
      { id: 'opencode', name: 'OpenCode', note: 'With an OpenCode API key', section: 'models' },
      { id: 'api-key', name: 'Any API key', note: 'Any provider on DSH\'s Models page', section: 'models' },
    ],
  },
  {
    title: 'With a subscription sign-in',
    terms: VENDOR_TERMS,
    tiles: [
      { id: 'codex', name: 'Codex', note: VENDOR_TERMS, section: 'models' },
      { id: 'claude', name: 'Claude', note: VENDOR_TERMS, section: 'models' },
      { id: 'kimi', name: 'Kimi', note: VENDOR_TERMS, section: 'models' },
    ],
  },
  {
    title: 'Through your own gateway',
    tiles: [{ id: 'cliproxy', name: 'CLIProxyAPI', note: 'An OpenAI-compatible gateway you run', form: true }],
  },
]

function Tiles({ onTile }) {
  return GROUPS.map(group => h('section', { key: group.title, className: 'oai-group', 'aria-label': group.title },
    h('h2', null, group.title),
    group.terms ? h('p', { className: 'oai-terms oai-muted' }, group.terms) : null,
    h('div', { className: 'oai-tiles' }, group.tiles.map(tile => h('button', {
      key: tile.id, type: 'button', className: 'oai-tile', onClick: () => onTile(tile),
    }, h('strong', null, tile.name), h('span', null, tile.note))))))
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
  useEffect(() => { if (state) glitch() }, [state, glitch])
  if (!state) return null

  if (view === 'cliproxy') {
    return h(Stage, { title: 'Connect CLIProxyAPI', speech: 'Point me at your gateway. Its key stays in DSH, never in a settings file.', at: 'omni-connect-ai', glitching },
      h(CliproxyForm, { onBack: () => setView('tiles'), onSaved: (value) => { setSaved(value); setView('saved') }, glitch }))
  }
  if (view === 'saved') {
    const count = saved?.models?.length ?? 0
    return h(Stage, { title: 'Gateway connected', speech: `Connected! ${count} ${count === 1 ? 'model' : 'models'} from your gateway, ready in the model picker.`, at: 'omni-connect-ai', glitching },
      h('div', { className: 'oai-models', 'aria-label': 'Models' }, (saved?.models ?? []).map(id => h('div', { key: id }, id))),
      h('button', { type: 'button', className: 'oai-primary', onClick: () => finish() }, 'Done'))
  }
  const connected = state.aiConnected === true
  return h(Stage, {
    title: 'Connect an AI',
    speech: connected ? 'You already have an AI connected. Add another, or carry on.' : 'Now give me a brain. Pick how you reach your AI; you can add more later.',
    at: 'omni-connect-ai',
    glitching,
  },
  h(Tiles, { onTile: tile => (tile.form ? setView('cliproxy') : finish(tile.section)) }),
  h('button', { type: 'button', className: connected ? 'oai-primary' : 'oai-quiet', style: { marginTop: '16px' }, onClick: () => finish() }, connected ? 'Continue' : 'Skip for now'))
}
