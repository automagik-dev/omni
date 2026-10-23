import { createElement as h, useEffect, useState } from 'react'

// The subscriptions only the dsh-subscriptions plugin (@goodandready/dsh-subscriptions)
// brings: its own sign-in routes, called from this page (same origin, so they accept it).
// The ones DSH signs in to by itself (ChatGPT, Claude, Kimi, Copilot) stay on DSH's flows.
// Every sign-in takes the provider's next free account slot, so accounts add up.
const BASE = 'dsh-subscriptions'

export const SUBSCRIPTION_TILES = [
  { id: 'grok', provider: 'grok', name: 'Grok', note: 'SuperGrok or X Premium', kind: 'device' },
  { id: 'perplexity', provider: 'perplexity', name: 'Perplexity', note: 'Perplexity Pro', kind: 'browser' },
  { id: 'jetbrains', provider: 'jetbrains', name: 'JetBrains AI', note: 'Your JetBrains AI plan', kind: 'browser' },
  { id: 'cursor', provider: 'cursor', name: 'Cursor', note: 'Your Cursor plan', kind: 'token', where: 'https://cursor.com/settings', what: 'Cursor session token' },
  { id: 'kiro', provider: 'kiro', name: 'Kiro', note: 'AWS Kiro', kind: 'token', where: 'https://kiro.dev', what: 'Kiro token' },
  { id: 'glm', provider: 'glm', name: 'Zhipu GLM', note: 'GLM coding plan', kind: 'token', where: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys', what: 'GLM API key' },
  { id: 'qwen', provider: 'qwen', name: 'Qwen', note: 'Alibaba Bailian', kind: 'token', where: 'https://bailian.console.aliyun.com/', what: 'DashScope API key' },
  { id: 'cody', provider: 'cody', name: 'Sourcegraph Cody', note: 'Cody Pro', kind: 'token', where: 'https://sourcegraph.com/user/settings/tokens', what: 'Sourcegraph access token' },
  { id: 'replit', provider: 'replit', name: 'Replit', note: 'Replit Core', kind: 'token', where: 'https://replit.com/account', what: 'Replit token' },
]

async function request(path, init) {
  let response
  try {
    response = await fetch(`${BASE}/${path}`, { credentials: 'same-origin', ...init })
  } catch {
    throw new Error('Could not reach the subscriptions plugin.')
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.ok === false) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
  return body
}
const post = (path, payload) => request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })

// The plugin's accounts, or null when it is not installed in this DSH.
export async function subscriptionAccounts() {
  try {
    return (await request('config')).accounts ?? []
  } catch {
    return null
  }
}

// The provider's first account slot not signed in yet, else one past the last.
export function nextIndex(accounts, provider) {
  const own = (accounts ?? []).filter(account => account.provider === provider)
  const free = own.find(account => !account.configured)
  if (free) return free.index
  return own.reduce((top, account) => Math.max(top, account.index), 0) + 1
}

export const signedInCount = (accounts, provider) => (accounts ?? []).filter(account => account.provider === provider && account.configured).length

// One sign-in, whatever its kind: a device code (start, show, poll), a browser page (the
// plugin catches the redirect on this machine; elsewhere the landing URL is pasted back), or
// a token pasted from the provider's settings.
export function SubscriptionSignIn({ tile, onBack, onSaved, glitch }) {
  const [step, setStep] = useState(null)
  const [problem, setProblem] = useState(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [index, setIndex] = useState(null)

  useEffect(() => {
    let live = true
    let timer = 0
    const done = () => {
      if (!live) return
      glitch()
      onSaved({ name: tile.name })
    }
    const start = async () => {
      try {
        const slot = nextIndex(await subscriptionAccounts(), tile.provider)
        if (!live) return
        setIndex(slot)
        if (tile.kind === 'device') {
          const device = await post('oauth/device/start', { provider: tile.provider, index: slot })
          if (!live) return
          setStep({ code: device.userCode, url: device.authUrl })
          const every = Math.max(device.intervalMs ?? 5000, 2000)
          // A failed poll is shown and polled again: the sign-in may still finish in the
          // browser. An expired code ends it.
          const poll = async () => {
            try {
              const out = await post('oauth/device/poll', { state: device.state })
              if (out.status === 'authorized') return done()
              if (!live) return
              if (out.status === 'expired') return setProblem('The code expired before the sign-in finished. Go back and start again.')
              setProblem(null)
            } catch (error) {
              if (!live) return
              setProblem(error.message)
            }
            timer = setTimeout(poll, every)
          }
          timer = setTimeout(poll, every)
        } else if (tile.kind === 'browser') {
          const started = await request(`oauth/start?provider=${encodeURIComponent(tile.provider)}&index=${slot}`)
          if (!live) return
          setStep({ url: started.url, state: started.state, autoCatch: started.autoCatch })
          // The plugin finishes on its own when it catches the redirect: watch the slot.
          const watch = async () => {
            const accounts = await subscriptionAccounts()
            if (accounts?.some(account => account.provider === tile.provider && account.index === slot && account.configured)) return done()
            if (live) timer = setTimeout(watch, 2000)
          }
          timer = setTimeout(watch, 2000)
        } else setStep({ url: tile.where })
      } catch (error) {
        if (live) setProblem(error.message)
      }
    }
    start()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [tile.provider])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      if (tile.kind === 'token') await post('import-token', { provider: tile.provider, index, apiKey: value.trim() })
      else {
        // Either the whole address the sign-in ended on, or just the code it shows.
        const pasted = value.trim()
        await post('oauth/complete', { provider: tile.provider, index, state: step.state, ...(/^https?:\/\//i.test(pasted) ? { url: pasted } : { code: pasted }) })
      }
      setValue('')
      glitch()
      onSaved({ name: tile.name })
    } catch (error) {
      setProblem(error.message)
      setBusy(false)
    }
  }

  return h('div', { className: 'oai-signin' },
    !step && !problem ? h('p', { className: 'oai-muted' }, `Starting the ${tile.name} sign-in…`) : null,
    step?.code ? h('p', null, `Open ${tile.name}, sign in, and enter this code:`) : null,
    step?.code ? h('div', { className: 'oai-code' }, h('code', null, step.code)) : null,
    step?.url && tile.kind !== 'token' ? h('a', { className: 'oai-primary oai-button', href: step.url, target: '_blank', rel: 'noreferrer' }, `Open ${tile.name} to sign in`) : null,
    tile.kind === 'device' && step ? h('p', { className: 'oai-muted oai-waiting' }, 'Waiting for you to finish signing in…') : null,
    tile.kind === 'browser' && step ? h('p', { className: 'oai-muted' }, step.autoCatch ? 'Sign in on their page; this finishes on its own. If it ends on a page that does not load, paste its address here.' : 'Sign in on their page, then paste the address it ends on here.') : null,
    tile.kind === 'token' && step ? h('p', null, `Copy your ${tile.what} from `, h('a', { className: 'oai-link', href: tile.where, target: '_blank', rel: 'noreferrer' }, tile.name), ' and paste it here. It stays in DSH\'s credential store on this computer.') : null,
    step && tile.kind !== 'device' ? h('form', { onSubmit: submit },
      h('label', { htmlFor: 'oai-sub-value' }, tile.kind === 'token' ? tile.what : 'The address you landed on'),
      h('input', { id: 'oai-sub-value', type: tile.kind === 'token' ? 'password' : 'text', required: true, autoComplete: 'off', spellCheck: false, value, onChange: e => setValue(e.target.value) }),
      h('button', { type: 'submit', className: tile.kind === 'token' ? 'oai-primary' : '', disabled: busy }, busy ? 'Connecting…' : 'Connect')) : null,
    problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null,
    h('button', { type: 'button', className: 'oai-quiet', onClick: onBack }, 'Back'))
}
