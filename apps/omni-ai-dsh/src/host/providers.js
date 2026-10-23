// Connect AI's real connections: an API key saved the way DSH's Models page saves one, and a
// subscription sign-in run through DSH's own authorization flows (pi-ai registers one per
// provider), with the flow's links, codes and questions relayed to the page that asked.
//
//   providers                     what each tile's provider has: a key, a sign-in, a route
//   provider-key { provider, apiKey }
//                                 stores the key in DSH's credential store under the
//                                 reference the Models page would use, and points the
//                                 provider's pi-ai route at it (DeepSeek: DSH's own key)
//   signin-start { provider }     adds the provider's pi-ai route and starts its sign-in
//   signin-status { provider }    the attempt: running, authorized, cancelled or failed,
//                                 its latest notice (message, url, code) and open question
//   signin-answer { provider, promptId, value }
//   signin-cancel { provider }
//   claude-code                   Claude through the person's own Claude Code: whether the
//                                 `claude` CLI is installed and signed in (`claude auth
//                                 status`), as the dsh-oh-my-claude plugin drives it. Claude has
//                                 no sign-in of ours: Anthropic allows its subscriptions in
//                                 other apps through Claude Code, not through a login of theirs
//
// The browser never sees a key or a token: it sees the flow's notices and answers its
// questions. A sign-in lives in this process; reloading the page leaves it running, and
// signin-status picks it up again.
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export const PI_AI = 'llm-pi-ai'
// pi-ai's credential record scope: a sign-in is the record llm-pi-ai/<provider>.
const RECORD_SCOPE = 'llm-pi-ai'
// Providers a key can connect. DeepSeek's key is DSH's own DeepSeek route's, not a pi-ai route.
export const KEY_PROVIDERS = {
  deepseek: { label: 'DeepSeek', ref: 'DEEPSEEK_API_KEY', route: false },
  openai: { label: 'OpenAI' },
  anthropic: { label: 'Anthropic' },
  zai: { label: 'Z.ai' },
  opencode: { label: 'OpenCode' },
  openrouter: { label: 'OpenRouter' },
  moonshotai: { label: 'Moonshot (Kimi API)' },
}
// Providers a subscription sign-in can connect, by pi-ai's provider id. Claude is not one:
// see claude-code.
export const SIGNIN_PROVIDERS = {
  'openai-codex': { label: 'ChatGPT (Codex)' },
  'kimi-coding': { label: 'Kimi Code' },
  'github-copilot': { label: 'GitHub Copilot' },
}
const MAX_KEY = 4096
const MAX_ANSWER = 4096
// A finished attempt is kept this long, so a page that comes back still learns how it ended.
const KEEP_MS = 10 * 60 * 1000

// dsh-oh-my-claude's model route, and where Claude Code installs itself when not on PATH (an
// app opened from the Dock or a launcher does not get the shell's PATH).
export const CLAUDE_CODE_ROUTE = 'claude-code'
const CLAUDE_STATUS_MS = 15_000
export function claudeCandidates(env = process.env, home = homedir()) {
  const onPath = String(env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, 'claude'))
  const nvm = join(home, '.nvm', 'versions', 'node')
  let nvmBins = []
  try {
    nvmBins = readdirSync(nvm).map(version => join(nvm, version, 'bin', 'claude'))
  } catch {}
  return [...onPath, join(home, '.local', 'bin', 'claude'), join(home, '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', join(home, '.bun', 'bin', 'claude'), join(home, '.npm-global', 'bin', 'claude'), ...nvmBins]
}
const executable = (path) => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
// `claude auth status`: JSON from a current CLI; an older one prints prose.
export function parseClaudeStatus(text) {
  try {
    const status = JSON.parse(text)
    return { loggedIn: status?.loggedIn === true, email: typeof status?.email === 'string' ? status.email : null, plan: typeof status?.subscriptionType === 'string' ? status.subscriptionType : null, method: typeof status?.authMethod === 'string' ? status.authMethod : null }
  } catch {
    return { loggedIn: /logged in/i.test(text) && !/not logged in/i.test(text), email: null, plan: null, method: null }
  }
}
const runStatus = (path, env) => new Promise((resolve) => {
  execFile(path, ['auth', 'status'], { timeout: CLAUDE_STATUS_MS, env, maxBuffer: 256 * 1024 }, (error, stdout) => resolve(error && !stdout ? null : String(stdout)))
})

const failure = (code, message) => Object.assign(new Error(message), { code })
const invalid = message => failure('omni-ai/invalid', message)
const refused = message => failure('omni-ai/refused', message)

// The reference DSH's Models page derives for a provider's key (OPENAI_CODEX_API_KEY).
export const keyRefOf = provider => `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
const recordKeyOf = provider => `${RECORD_SCOPE}/${provider}`

const providerArg = (payload, table) => {
  const provider = typeof payload?.provider === 'string' ? payload.provider : ''
  if (!Object.hasOwn(table, provider)) throw invalid(`No provider "${provider.slice(0, 40)}" here`)
  return provider
}

const piAiEntry = (ctx) => {
  try {
    return ctx.settings.describe().find(row => row.ns === PI_AI)
  } catch {
    return undefined
  }
}

// Write one route under llm-pi-ai.providers, keeping what it already holds. A route that
// does not exist yet is added; DSH checks it before the change applies.
async function saveRoute(ctx, provider, patch) {
  const entry = piAiEntry(ctx)
  if (entry === undefined) throw refused('This DSH has no pi-ai entry (llm-pi-ai) to connect providers with.')
  const current = entry.value?.providers?.[provider]
  const route = { ...(current && typeof current === 'object' ? current : {}), ...patch }
  try {
    await ctx.settings.mutate(PI_AI, [{ op: 'set', path: ['providers', provider], value: route }], entry.revision)
  } catch (error) {
    if (error?.code === 'SETTINGS_CONFLICT') throw refused('DSH\'s model settings changed while saving. Try again.')
    throw refused(`DSH did not save the ${provider} route: ${error?.message ?? error}`)
  }
}

const configured = async (read) => {
  try {
    return (await read())?.configured === true
  } catch {
    return false
  }
}

// DSH's authorization service, looked up when used: it is not a declared dependency, so the
// welcome still loads in a DSH that has none (sign-ins are then refused, keys still work).
const authorizationOf = (ctx) => {
  try {
    return ctx.get?.('authorization') ?? undefined
  } catch {
    return undefined
  }
}

export function createProviderActions(ctx) {
  // One attempt per provider: { id, status, notice, prompt, error, answer, finishedAt }.
  const attempts = new Map()
  const view = (provider) => {
    const attempt = attempts.get(provider)
    if (!attempt) return { provider, status: 'none' }
    const prompt = attempt.prompt ? { id: attempt.prompt.id, kind: attempt.prompt.kind, message: attempt.prompt.message, placeholder: attempt.prompt.placeholder, options: attempt.prompt.options } : null
    return { provider, status: attempt.status, notice: attempt.notice, prompt, error: attempt.error }
  }
  const prune = () => {
    for (const [provider, attempt] of attempts) {
      if (attempt.finishedAt && Date.now() - attempt.finishedAt > KEEP_MS) attempts.delete(provider)
    }
  }

  return {
    async 'claude-code'() {
      // dsh-oh-my-claude registers the claude-code model route; DSH's model service lists it.
      let plugin = false
      try {
        plugin = (ctx.get?.('llm')?.listProviders?.() ?? []).some(provider => provider?.id === CLAUDE_CODE_ROUTE)
      } catch {}
      const path = claudeCandidates().find(executable) ?? null
      if (path === null) return { plugin, installed: false, loggedIn: false }
      const status = parseClaudeStatus((await runStatus(path, process.env)) ?? '')
      // The plugin starts a plain `claude`, so it reaches the CLI only through DSH's own PATH.
      const reachable = String(process.env.PATH ?? '').split(delimiter).filter(Boolean).some(dir => executable(join(dir, 'claude')))
      return { plugin, installed: true, path, reachable, loggedIn: status.loggedIn, email: status.email, plan: status.plan }
    },

    async providers() {
      const providers = piAiEntry(ctx)?.value?.providers ?? {}
      const out = {}
      for (const [provider, info] of Object.entries(KEY_PROVIDERS)) {
        out[provider] = { ...out[provider], key: await configured(() => ctx.credentials.describe(info.ref ?? keyRefOf(provider))), route: info.route === false || Object.hasOwn(providers, provider) }
      }
      for (const provider of Object.keys(SIGNIN_PROVIDERS)) {
        out[provider] = { ...out[provider], signedIn: await configured(() => ctx.credentials.describeRecord(recordKeyOf(provider))), route: Object.hasOwn(providers, provider), signIn: authorizationOf(ctx)?.describe?.(recordKeyOf(provider)) !== undefined }
      }
      return out
    },

    async 'provider-key'(payload) {
      const provider = providerArg(payload, KEY_PROVIDERS)
      const apiKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : ''
      if (apiKey === '' || apiKey.length > MAX_KEY || /\s/.test(apiKey)) throw invalid('Paste the whole API key.')
      const info = KEY_PROVIDERS[provider]
      const ref = info.ref ?? keyRefOf(provider)
      await ctx.credentials.set(ref, apiKey)
      if (info.route !== false) await saveRoute(ctx, provider, { apiKeyEnv: ref })
      return { provider, connected: true }
    },

    async 'signin-start'(payload) {
      const provider = providerArg(payload, SIGNIN_PROVIDERS)
      prune()
      const authorization = authorizationOf(ctx)
      if (!authorization) throw refused('This DSH cannot run sign-ins (no authorization service).')
      const key = recordKeyOf(provider)
      if (authorization.describe(key) === undefined) throw refused(`This DSH offers no ${SIGNIN_PROVIDERS[provider].label} sign-in.`)
      const running = attempts.get(provider)
      if (running?.status === 'running') return view(provider)
      // A sign-in sits beneath a key: a route with apiKeyEnv uses the key, so the route
      // this adds has none (one the person already keyed keeps its key).
      await saveRoute(ctx, provider, {})
      const attempt = { id: randomUUID(), status: 'running', notice: null, prompt: null, error: null, finishedAt: 0 }
      attempts.set(provider, attempt)
      const interaction = {
        notify(notice) {
          attempt.notice = { message: String(notice?.message ?? ''), url: typeof notice?.url === 'string' ? notice.url : undefined, code: typeof notice?.code === 'string' ? notice.code : undefined }
        },
        prompt(prompt) {
          return new Promise((resolve, reject) => {
            const asked = {
              id: randomUUID(),
              kind: ['text', 'secret', 'select'].includes(prompt?.kind) ? prompt.kind : 'text',
              message: String(prompt?.message ?? ''),
              placeholder: typeof prompt?.placeholder === 'string' ? prompt.placeholder : undefined,
              options: Array.isArray(prompt?.options) ? prompt.options.map(option => ({ id: String(option.id), label: String(option.label ?? option.id), description: option.description ? String(option.description) : undefined })) : undefined,
              resolve,
              reject,
            }
            attempt.prompt = asked
            prompt?.signal?.addEventListener?.('abort', () => {
              if (attempt.prompt === asked) attempt.prompt = null
              reject(new Error('withdrawn'))
            }, { once: true })
          })
        },
      }
      authorization.begin({ key, method: 'oauth', interaction })
        .then((outcome) => {
          attempt.status = outcome?.status === 'authorized' ? 'authorized' : 'cancelled'
        }, (error) => {
          attempt.status = 'failed'
          attempt.error = String(error?.message ?? error).slice(0, 300)
        })
        .finally(() => {
          attempt.prompt = null
          attempt.finishedAt = Date.now()
        })
      return view(provider)
    },

    async 'signin-status'(payload) {
      return view(providerArg(payload, SIGNIN_PROVIDERS))
    },

    async 'signin-answer'(payload) {
      const provider = providerArg(payload, SIGNIN_PROVIDERS)
      const attempt = attempts.get(provider)
      const asked = attempt?.prompt
      if (!asked || asked.id !== payload?.promptId) throw refused('That question is no longer open.')
      const value = typeof payload?.value === 'string' ? payload.value.trim() : ''
      if (value === '' || value.length > MAX_ANSWER) throw invalid('Type an answer.')
      if (asked.kind === 'select' && !asked.options?.some(option => option.id === value)) throw invalid('Pick one of the options.')
      attempt.prompt = null
      asked.resolve(value)
      return view(provider)
    },

    async 'signin-cancel'(payload) {
      const provider = providerArg(payload, SIGNIN_PROVIDERS)
      const attempt = attempts.get(provider)
      if (attempt?.status === 'running') {
        authorizationOf(ctx)?.cancel?.(recordKeyOf(provider))
        attempt.prompt?.reject(new Error('cancelled'))
        attempt.prompt = null
      }
      return view(provider)
    },
  }
}
