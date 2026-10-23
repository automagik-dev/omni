// Connect AI as switches: one row per AI, one way to reach each, and what this computer
// already has turned into rows that are on before anyone types anything.
//
//   ais                  every row: how it connects, whether it is set up and on, what was
//                        found on this computer, and the duplicates of it that are connected
//   ai-switch { id, on } turns a row that is set up on or off. Off stops using it and keeps
//                        its key, sign-in or account; a row that is not set up is refused,
//                        and the page opens its setup instead
//   ai-dedupe { id }     stops using the other ways a row's AI is connected (hides their
//                        models), keeping their accounts
//   ai-subscription { provider, on }
//                        a dsh-subscriptions vendor nothing else covers: off hides its models
//                        in that plugin's own picker settings, on shows them again; the
//                        account stays signed in either way
//
// One source per vendor. Claude comes only through the Claude Code app (dsh-oh-my-claude):
// DSH's own Claude sign-in and dsh-subscriptions' claude both present as Claude Code, so
// Omni never offers them, and when Claude is on their models are hidden. The other vendors
// keep DSH's own sign-in, and dsh-subscriptions keeps the ones nothing else covers.
//
// Replies carry names and states only: never a key, a token or an account's credential.
import { z } from 'zod'
import { PI_AI, keyRefOf } from './providers.js'

const RECORD_SCOPE = 'llm-pi-ai'
export const DEEPSEEK_REF = 'DEEPSEEK_API_KEY'
export const DEEPSEEK_ACCOUNT = 'deepseek-account-platform/default'
export const SUBSCRIPTIONS = 'dsh-subscriptions'
export const OH_MY_CLAUDE = 'dsh-oh-my-claude'
export const CLIPROXY_ROUTE = 'cliproxy'
export const OLLAMA_ROUTE = 'ollama'
export const OLLAMA_URL = 'http://127.0.0.1:11434'
// Ollama ignores the key; pi-ai's OpenAI route still sends one, so the route names this.
export const OLLAMA_KEY_REF = 'OMNI_AI_OLLAMA_API_KEY'
const OLLAMA_PROBE_MS = 800

// The rows, in the order "Add another" lists them. `envRefs` are the variables pi-ai reads
// for that provider, so a key already in the environment is found.
export const VENDORS = [
  { id: 'claude', name: 'Claude', via: 'Through the Claude Code app you already use', kind: 'claude' },
  { id: 'chatgpt', name: 'ChatGPT', via: 'Your ChatGPT Plus or Pro plan, through Codex', kind: 'signin', provider: 'openai-codex' },
  { id: 'deepseek', name: 'DeepSeek', via: 'With your API key, or your DeepSeek account', kind: 'key', provider: 'deepseek', ref: DEEPSEEK_REF, route: false, keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'kimi', name: 'Kimi', via: 'Your Kimi Code plan', kind: 'signin', provider: 'kimi-coding' },
  { id: 'copilot', name: 'GitHub Copilot', via: 'Your Copilot plan', kind: 'signin', provider: 'github-copilot' },
  { id: 'grok', name: 'Grok', via: 'SuperGrok or X Premium, or an xAI key', kind: 'signin', provider: 'xai', envRefs: ['XAI_API_KEY'], keyUrl: 'https://console.x.ai' },
  { id: 'openai', name: 'OpenAI API', via: 'With an API key, billed per use', kind: 'key', provider: 'openai', envRefs: ['OPENAI_API_KEY'], keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic API', via: 'With an API key, billed per use', kind: 'key', provider: 'anthropic', envRefs: ['ANTHROPIC_API_KEY'], keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openrouter', name: 'OpenRouter', via: 'One key, hundreds of models', kind: 'key', provider: 'openrouter', envRefs: ['OPENROUTER_API_KEY'], keyUrl: 'https://openrouter.ai/keys' },
  { id: 'zai', name: 'Z.ai', via: 'GLM models, with an API key', kind: 'key', provider: 'zai', envRefs: ['ZAI_API_KEY'], keyUrl: 'https://z.ai/manage-apikey/apikey-list' },
  { id: 'moonshot', name: 'Moonshot', via: 'Kimi models, with an API key', kind: 'key', provider: 'moonshotai', envRefs: ['MOONSHOT_API_KEY'], keyUrl: 'https://platform.moonshot.ai/console/api-keys' },
  { id: 'opencode', name: 'OpenCode', via: 'An OpenCode Zen key', kind: 'key', provider: 'opencode', envRefs: ['OPENCODE_API_KEY'], keyUrl: 'https://opencode.ai/zen' },
  { id: 'cliproxy', name: 'CLIProxyAPI', via: 'Your own gateway', kind: 'gateway' },
  { id: 'ollama', name: 'Ollama', via: 'Models running on this computer', kind: 'local' },
]

// dsh-subscriptions' vendors that another row covers (Omni never offers them), and the row.
export const COVERED = { claude: 'claude', codex: 'chatgpt', kimi: 'kimi', copilot: 'copilot', grok: 'grok', ollama: 'ollama' }
// The dsh-subscriptions vendors Omni offers: nothing else reaches them.
export const SUBSCRIPTION_ONLY = ['antigravity', 'glm', 'cursor', 'kiro', 'qwen', 'ernie', 'spark', 'jetbrains', 'perplexity', 'replit', 'cody']

const Switch = z.object({ id: z.string().max(40), on: z.boolean() }).strict()
const RowId = z.object({ id: z.string().max(40) }).strict()
const SubscriptionSwitch = z.object({ provider: z.enum(SUBSCRIPTION_ONLY), on: z.boolean() }).strict()

const failure = (code, message) => Object.assign(new Error(message), { code })
const invalid = message => failure('omni-ai/invalid', message)
const refused = message => failure('omni-ai/refused', message)

const recordKeyOf = provider => `${RECORD_SCOPE}/${provider}`
const oauthRef = (provider, index) => `${String(provider).toUpperCase()}_OAUTH_${index}`

const quietly = async (read, fallback) => {
  try {
    return (await read()) ?? fallback
  } catch {
    return fallback
  }
}
const describeAll = (ctx) => {
  try {
    return ctx.settings.describe()
  } catch {
    return []
  }
}
const entryOf = (ctx, ns) => describeAll(ctx).find(row => row.ns === ns)
const routesOf = ctx => entryOf(ctx, PI_AI)?.value?.providers ?? {}
const service = (ctx, name) => {
  try {
    return ctx.get?.(name) ?? undefined
  } catch {
    return undefined
  }
}

// Where a key for this row lives: DSH's store ("file"), the environment, or nowhere.
async function keyOf(ctx, vendor) {
  for (const ref of [vendor.ref ?? keyRefOf(vendor.provider), ...(vendor.envRefs ?? [])]) {
    const found = await quietly(() => ctx.credentials.describe(ref), {})
    if (found?.configured === true) return { ref, source: found.source === 'file' ? 'file' : 'env' }
  }
  return null
}

// dsh-subscriptions' accounts: its slots, each signed in when its credential exists.
async function subscriptionAccounts(ctx) {
  const entry = entryOf(ctx, SUBSCRIPTIONS)
  if (entry === undefined) return null
  const slots = Array.isArray(entry.value?.slots) ? entry.value.slots : []
  const accounts = []
  for (const slot of slots) {
    if (typeof slot?.provider !== 'string' || !Number.isInteger(Number(slot.index)) || Number(slot.index) < 1) continue
    const signedIn = (await quietly(() => ctx.credentials.describe(oauthRef(slot.provider, slot.index)), {}))?.configured === true
    if (signedIn) accounts.push({ provider: slot.provider, index: Number(slot.index) })
  }
  return { accounts, hidden: Array.isArray(entry.value?.hiddenModels) ? entry.value.hiddenModels : [], revision: entry.revision }
}

// The Claude Code plugin's row in DSH's plugin manager, when it manages one.
async function ohMyClaudeRow(ctx) {
  const manager = service(ctx, 'pluginManager')
  const rows = await quietly(() => manager?.listPlugins?.(), [])
  return { manager, row: rows.find(row => row?.moduleName === OH_MY_CLAUDE) }
}

async function ollamaRunning(fetchImpl) {
  try {
    const response = await fetchImpl(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(OLLAMA_PROBE_MS), redirect: 'error' })
    return response.ok
  } catch {
    return false
  }
}

export function createAiActions(ctx, { fetch: fetchImpl = globalThis.fetch, claudeCode, saveRoute, unsetRoute } = {}) {
  const llm = () => service(ctx, 'llm')
  const authorization = () => service(ctx, 'authorization')

  // One row's state, from what DSH and this computer have.
  async function rowFor(vendor, seen) {
    const routes = seen.routes
    const base = { id: vendor.id, name: vendor.name, via: vendor.via, kind: vendor.kind }
    if (vendor.kind === 'claude') {
      const check = seen.claude ?? {}
      const plugin = seen.ohMyClaude.row
      const hasPlugin = plugin !== undefined || check.plugin === true
      const pluginOn = plugin ? plugin.enabled !== false : check.plugin === true
      // On only once Claude Code is signed in: the plugin alone serves nothing.
      const ready = check.installed === true && check.loggedIn === true && hasPlugin
      const found = check.loggedIn ? 'Signed in to Claude Code' : check.installed ? 'Claude Code found, not signed in' : null
      const needs = !hasPlugin ? 'plugin' : !check.installed ? 'install' : !check.loggedIn ? 'login' : check.reachable === false ? 'restart' : null
      return { ...base, ready, on: ready && pluginOn && check.reachable !== false, found, needs, ...(check.email ? { detail: check.email } : {}), ...(check.plan ? { plan: check.plan } : {}) }
    }
    if (vendor.kind === 'key') {
      const key = await keyOf(ctx, vendor)
      const account = vendor.id === 'deepseek' && (await quietly(() => ctx.credentials.describeRecord(DEEPSEEK_ACCOUNT), {}))?.configured === true
      const routed = vendor.route === false || Object.hasOwn(routes, vendor.provider)
      const ready = key !== null || account
      const found = account ? 'Signed in to DeepSeek' : key?.source === 'env' ? `${key.ref} found` : key ? 'Key saved' : null
      // A route on the provider's own sign-in (no key named) is a sign-in, not this row's key.
      const keyed = vendor.route === false || routes[vendor.provider]?.apiKeyEnv !== undefined || (key?.source === 'env' && routed)
      return { ...base, ready, on: ready && routed && (keyed || account), found, keyUrl: vendor.keyUrl }
    }
    if (vendor.kind === 'signin') {
      const signedIn = (await quietly(() => ctx.credentials.describeRecord(recordKeyOf(vendor.provider)), {}))?.configured === true
      const key = vendor.envRefs ? await keyOf(ctx, vendor) : null
      const flow = authorization()?.describe?.(recordKeyOf(vendor.provider)) !== undefined
      const ready = signedIn || key !== null
      const found = signedIn ? `Signed in to ${vendor.name}` : key?.source === 'env' ? `${key.ref} found` : null
      return { ...base, ready, on: ready && Object.hasOwn(routes, vendor.provider), found, signIn: flow, ...(vendor.keyUrl ? { keyUrl: vendor.keyUrl } : {}) }
    }
    if (vendor.kind === 'gateway') {
      const routed = Object.hasOwn(routes, CLIPROXY_ROUTE)
      return { ...base, ready: routed, on: routed, found: routed ? 'Gateway saved' : null }
    }
    // Ollama: a pi-ai OpenAI-compatible route at the local server.
    const routed = Object.hasOwn(routes, OLLAMA_ROUTE)
    const running = seen.ollama
    return { ...base, ready: running, on: routed, found: running ? 'Running on this computer' : null, ...(routed && !running ? { needs: 'start' } : {}) }
  }

  async function look() {
    const [claude, ohMyClaude, subscriptions, ollama] = await Promise.all([
      quietly(() => claudeCode?.(), null),
      ohMyClaudeRow(ctx),
      subscriptionAccounts(ctx),
      ollamaRunning(fetchImpl),
    ])
    return { routes: routesOf(ctx), claude, ohMyClaude, subscriptions, ollama }
  }

  // The other ways a row's AI is connected right now, and whether their models still show.
  function duplicatesOf(row, seen) {
    const out = []
    const subs = seen.subscriptions
    for (const [vendor, rowId] of Object.entries(COVERED)) {
      if (rowId !== row.id || !subs) continue
      if (!subs.accounts.some(account => account.provider === vendor)) continue
      out.push({ via: 'dsh-subscriptions', provider: vendor, hidden: subs.hidden.some(model => model?.provider === vendor) })
    }
    // DSH's own Claude sign-in: a pi-ai anthropic route that names no key runs on that sign-in.
    if (row.id === 'claude' && Object.hasOwn(seen.routes, 'anthropic') && seen.routes.anthropic?.apiKeyEnv === undefined) {
      out.push({ via: 'DSH\'s Claude sign-in', provider: 'anthropic', hidden: false })
    }
    return out
  }

  async function rows() {
    const seen = await look()
    const out = []
    for (const vendor of VENDORS) {
      const row = await rowFor(vendor, seen)
      const duplicates = duplicatesOf(row, seen)
      out.push(duplicates.length ? { ...row, duplicates } : row)
    }
    return { rows: out, seen }
  }

  // Hides the models of the other ways this row's AI is connected; their accounts stay.
  async function dedupe(rowId, seen) {
    const done = []
    const subs = seen.subscriptions
    const vendors = Object.entries(COVERED).filter(([, id]) => id === rowId).map(([vendor]) => vendor)
    if (subs && vendors.some(vendor => subs.accounts.some(account => account.provider === vendor))) {
      const hidden = [...subs.hidden]
      for (const vendor of vendors) {
        if (!subs.accounts.some(account => account.provider === vendor)) continue
        const models = await quietly(() => llm()?.listModels?.(vendor), [])
        for (const model of models) {
          if (typeof model?.id === 'string' && !hidden.some(row => row?.provider === vendor && row?.id === model.id)) hidden.push({ provider: vendor, id: model.id })
        }
        done.push(vendor)
      }
      await ctx.settings.update(SUBSCRIPTIONS, { hiddenModels: hidden }, subs.revision)
    }
    if (rowId === 'claude' && Object.hasOwn(seen.routes, 'anthropic') && seen.routes.anthropic?.apiKeyEnv === undefined) {
      // The route goes; DSH keeps the sign-in's stored credential.
      await unsetRoute('anthropic')
      done.push('anthropic')
    }
    return done
  }

  async function turn(vendor, on, seen) {
    if (vendor.kind === 'claude') {
      const { manager, row } = seen.ohMyClaude
      if (!row) {
        if (on) return
        throw refused('This DSH does not let Omni turn the Claude Code plugin off. Turn it off in Settings → Plugins.')
      }
      if (row.readOnlyReason !== undefined) throw refused('DSH keeps the Claude Code plugin as it is. Change it in Settings → Plugins.')
      if ((row.enabled !== false) !== on) await manager.setPluginEnabled(row.entryId, on)
      return
    }
    if (vendor.kind === 'key') {
      if (vendor.route === false) {
        if (!on) throw refused('DeepSeek is DSH\'s own route. Remove its key in Settings → Models to stop using it.')
        return
      }
      if (!on) return unsetRoute(vendor.provider)
      const key = await keyOf(ctx, vendor)
      return saveRoute(vendor.provider, { apiKeyEnv: key.ref })
    }
    if (vendor.kind === 'signin') {
      if (!on) return unsetRoute(vendor.provider)
      const signedIn = (await quietly(() => ctx.credentials.describeRecord(recordKeyOf(vendor.provider)), {}))?.configured === true
      // A sign-in sits beneath a key: a route that names no key uses the sign-in.
      if (signedIn) return saveRoute(vendor.provider, {})
      const key = await keyOf(ctx, vendor)
      return saveRoute(vendor.provider, { apiKeyEnv: key.ref })
    }
    if (vendor.kind === 'gateway') {
      if (on) return
      return unsetRoute(CLIPROXY_ROUTE)
    }
    if (!on) return unsetRoute(OLLAMA_ROUTE)
    return turnOnOllama()
  }

  async function turnOnOllama() {
    let models = []
    try {
      const response = await fetchImpl(`${OLLAMA_URL}/v1/models`, { signal: AbortSignal.timeout(5000), redirect: 'error' })
      const body = await response.json()
      models = (Array.isArray(body?.data) ? body.data : []).map(item => item?.id).filter(id => typeof id === 'string' && id.length > 0 && id.length <= 200).slice(0, 200)
    } catch {
      throw refused('Ollama is not answering on this computer. Start it, then turn this on again.')
    }
    if (models.length === 0) throw refused('Ollama has no models yet. Pull one (ollama pull <model>), then turn this on again.')
    await ctx.credentials.set(OLLAMA_KEY_REF, 'ollama')
    await saveRoute(OLLAMA_ROUTE, { displayName: 'Ollama', api: 'openai-completions', baseURL: `${OLLAMA_URL}/v1`, apiKeyEnv: OLLAMA_KEY_REF, models: models.map(id => ({ id, name: id })) })
  }

  const vendorOf = (id) => {
    const vendor = VENDORS.find(row => row.id === id)
    if (!vendor) throw invalid(`No AI "${String(id).slice(0, 40)}" here`)
    return vendor
  }

  // A subscription vendor's models hidden in, or shown again by, dsh-subscriptions' own settings.
  async function setSubscriptionHidden(provider, hide) {
    const subs = await subscriptionAccounts(ctx)
    if (subs === null) throw refused('dsh-subscriptions is not installed in this DSH.')
    let hidden = subs.hidden.filter(row => row?.provider !== provider)
    if (hide) {
      const models = await quietly(() => llm()?.listModels?.(provider), [])
      const ids = models.map(model => model?.id).filter(id => typeof id === 'string')
      if (ids.length === 0) throw refused('Its models are not listed right now, so there is nothing to hide. Try again in a moment.')
      hidden = [...hidden, ...ids.map(id => ({ provider, id }))]
    }
    await ctx.settings.update(SUBSCRIPTIONS, { hiddenModels: hidden }, subs.revision)
  }

  const subscriptionView = (subs) => {
    if (subs === null) return null
    const providers = [...new Set(subs.accounts.map(account => account.provider))].filter(provider => SUBSCRIPTION_ONLY.includes(provider))
    return {
      accounts: subs.accounts.filter(account => SUBSCRIPTION_ONLY.includes(account.provider)),
      hidden: providers.filter(provider => subs.hidden.some(row => row?.provider === provider)),
    }
  }

  return {
    async ais() {
      const { rows: out, seen } = await rows()
      return { rows: out, subscriptions: subscriptionView(seen.subscriptions) }
    },

    async 'ai-subscription'(payload) {
      const parsed = SubscriptionSwitch.safeParse(payload)
      if (!parsed.success) throw invalid('Say which subscription to turn on or off.')
      const { provider, on } = parsed.data
      const subs = await subscriptionAccounts(ctx)
      if (on && !subs?.accounts.some(account => account.provider === provider)) throw refused('Sign in to it first.')
      await setSubscriptionHidden(provider, !on)
      return { subscriptions: subscriptionView(await subscriptionAccounts(ctx)) }
    },

    async 'ai-switch'(payload) {
      const parsed = Switch.safeParse(payload)
      if (!parsed.success) throw invalid('Say which AI to turn on or off.')
      const vendor = vendorOf(parsed.data.id)
      const seen = await look()
      const row = await rowFor(vendor, seen)
      if (parsed.data.on && !row.ready) throw refused(`${vendor.name} is not set up yet.`)
      await turn(vendor, parsed.data.on, seen)
      // Turning an AI on stops the duplicates of it Omni does not offer.
      if (parsed.data.on) await dedupe(vendor.id, seen).catch(error => ctx.logger?.warn?.('omni-ai: duplicates of %s stay: %s', vendor.id, error?.message ?? error))
      const after = await look()
      const next = await rowFor(vendor, after)
      const duplicates = duplicatesOf(next, after)
      return duplicates.length ? { ...next, duplicates } : next
    },

    async 'ai-dedupe'(payload) {
      const parsed = RowId.safeParse(payload)
      if (!parsed.success) throw invalid('Say which AI.')
      vendorOf(parsed.data.id)
      return { hidden: await dedupe(parsed.data.id, await look()) }
    },

    // Whether an AI is really on, for the step's done state and its speech.
    async anyOn() {
      const { rows: out, seen } = await rows()
      const subs = subscriptionView(seen.subscriptions)
      return out.some(row => row.on) || (subs?.accounts.some(account => !subs.hidden.includes(account.provider)) ?? false)
    },
  }
}

