import { CliproxyPayload, DonePayload, RequestBody, Secret, parse } from './payloads.js'
import { createAiActions } from './ais.js'
import { checkClaudeCode, createProviderActions, saveRoute, unsetRoute } from './providers.js'
import { createTerminalActions } from './terminal.js'
import { createCompanionActions } from './companion.js'
import { createBotTypeActions } from './bot-types.js'

// The host endpoint the onboarding steps call: POST /api/omni-ai with
// { endpoint, payload }, answered { ok: true, value } or { ok: false, error }.
//
//   state              the done flags, and whether an AI is already connected
//   done { stepId }    keeps a step finished, in this plugin's own settings entry
//   cliproxy { baseURL, apiKey }
//                      lists the gateway's models with the key, stores the key in DSH's
//                      credential store and writes a pi-ai route that references it
//   providers, provider-key, signin-*
//                      the rows' own connections (src/host/providers.js)
//   ais, ai-switch, ai-dedupe
//                      the rows themselves: what is found, set up and on (src/host/ais.js)
//   ai-terminal-*      the terminal that signs Claude Code in (src/host/terminal.js)
//   companion, companion-generate, companion-save, companion-image, team-save
//                      the person's own companion and team (src/host/companion.js)
//   omni-plugins, omni-plugins-install, bot-type
//                      the Omni plugins, installed through DSH's plugin manager, and what
//                      a Bot type starts with (src/host/bot-types.js)
//
// The key never enters settings, a reply or a log line: the route names it by the
// env-shaped reference OMNI_AI_CLIPROXY_API_KEY, which DSH resolves per request.

export const ROUTE = '/api/omni-ai'
export const ENTRY = 'omni-ai'
export const PI_AI = 'llm-pi-ai'
export const ROUTE_ID = 'cliproxy'
export const KEY_REF = 'OMNI_AI_CLIPROXY_API_KEY'
// Which flag keeps each step finished. omni-connect is the Omni plugin's step; its skip
// is kept here so a skipped connect stays skipped.
export const FLAGS = { 'omni-companion': 'companionDone', 'omni-team': 'teamDone', 'omni-welcome': 'welcomeDone', 'omni-connect-ai': 'connectAiDone', 'omni-connect': 'connectOmniSkipped' }
// Where DSH keeps a DeepSeek API key, and a DeepSeek account sign-in.
const DEEPSEEK_REF = 'DEEPSEEK_API_KEY'
const DEEPSEEK_ACCOUNT = 'deepseek-account-platform/default'
const TIMEOUT_MS = 15_000
const MAX_MODELS = 500
const MAX_ID = 200
// A model listing is small; a gateway that sends more is not read past this.
const MAX_BODY = 2 * 1024 * 1024

const failure = (code, message) => Object.assign(new Error(message), { code })
const invalid = message => failure('omni-ai/invalid', message)
const refused = message => failure('omni-ai/refused', message)

// A gateway base URL: http(s) only, no credentials, query or fragment, no trailing
// slash. A bare origin gets /v1, where CLIProxyAPI serves its OpenAI-compatible API.
export function cleanBaseUrl(text) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (!/^https?:\/\//i.test(value)) return null
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash) return null
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${path === '' ? '/v1' : path}`
}

// Model ids from an OpenAI-style listing ({ data: [{ id }] }), unique, in its order.
export function modelIdsOf(body) {
  const ids = []
  for (const item of Array.isArray(body?.data) ? body.data : []) {
    const id = typeof item?.id === 'string' ? item.id.trim() : ''
    if (id !== '' && id.length <= MAX_ID && !ids.includes(id)) ids.push(id)
    if (ids.length === MAX_MODELS) break
  }
  return ids
}

// The body as text, refused past MAX_BODY without reading the rest.
async function cappedText(response) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => {})
      throw new Error('too large')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

async function listModels(fetchImpl, baseURL, apiKey, signal) {
  const signals = [AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])]
  let response
  try {
    // No redirects: the key is for this address only.
    response = await fetchImpl(`${baseURL}/models`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.any(signals),
    })
  } catch {
    throw refused(`Could not reach ${baseURL}/models. Check the address and that the gateway is running.`)
  }
  if (response.status === 401 || response.status === 403) throw refused(`The gateway at ${baseURL} refused this key (HTTP ${response.status}).`)
  if (!response.ok) throw refused(`The gateway at ${baseURL} answered HTTP ${response.status} for /models.`)
  try {
    return modelIdsOf(JSON.parse(await cappedText(response)))
  } catch {
    throw refused(`The gateway at ${baseURL} did not answer /models with a JSON model list.`)
  }
}

const describeAll = (ctx) => {
  try {
    return ctx.settings.describe()
  } catch {
    return []
  }
}
const entryOf = (rows, ns) => rows.find(row => row.ns === ns)
const isConfigured = async (read) => {
  try {
    return (await read())?.configured === true
  } catch {
    return false
  }
}

export function createActions(ctx, { fetch: fetchImpl = globalThis.fetch, anyOn } = {}) {
  return {
    async state() {
      const rows = describeAll(ctx)
      const own = entryOf(rows, ENTRY)?.value ?? {}
      const providers = entryOf(rows, PI_AI)?.value?.providers
      const piAiRoutes = providers && typeof providers === 'object' ? Object.keys(providers) : []
      const deepseek = await isConfigured(() => ctx.credentials.describe(DEEPSEEK_REF)) || await isConfigured(() => ctx.credentials.describeRecord(DEEPSEEK_ACCOUNT))
      return {
        companionDone: own.companionDone === true,
        teamDone: own.teamDone === true,
        welcomeDone: own.welcomeDone === true,
        companionName: typeof own.companionName === 'string' ? own.companionName : undefined,
        companionShape: typeof own.companionShape === 'string' ? own.companionShape : undefined,
        companionColor: typeof own.companionColor === 'string' ? own.companionColor : undefined,
        companionImage: typeof own.companionImage === 'string',
        teamOmni: own.teamOmni !== false,
        teamGenie: own.teamGenie === true,
        connectAiDone: own.connectAiDone === true,
        connectOmniSkipped: own.connectOmniSkipped === true,
        deepseek,
        piAiRoutes,
        // Really on: a route that is set up, Claude Code signed in, or a subscription account.
        aiConnected: anyOn ? await anyOn().catch(() => false) : deepseek || piAiRoutes.length > 0,
      }
    },

    async done(payload) {
      const stepId = parse(DonePayload, payload)?.stepId ?? ''
      const field = Object.hasOwn(FLAGS, stepId) ? FLAGS[stepId] : undefined
      if (field === undefined) throw invalid(`No onboarding step "${stepId.slice(0, 40)}"`)
      await ctx.settings.update(ENTRY, { [field]: true })
      return { [field]: true }
    },

    async cliproxy(payload, signal) {
      const fields = parse(CliproxyPayload, payload)
      const baseURL = cleanBaseUrl(fields?.baseURL)
      if (baseURL === null) throw invalid('Type the gateway address as an http:// or https:// URL, such as http://localhost:8317/v1.')
      const apiKey = parse(Secret, fields?.apiKey)
      if (apiKey === undefined) throw invalid('Paste the gateway\'s API key.')
      const piAi = entryOf(describeAll(ctx), PI_AI)
      if (piAi === undefined) throw refused('This DSH has no pi-ai entry (llm-pi-ai) to hold the route.')
      const models = await listModels(fetchImpl, baseURL, apiKey, signal)
      if (models.length === 0) throw refused(`The gateway at ${baseURL} lists no models. Add a provider there, then try again.`)
      // Kept to put back if DSH refuses the route, so a failed save leaves the old route on its old key.
      // A key that came from the environment rather than DSH's store ("file") is not copied into the store.
      const previous = await ctx.credentials.resolve(KEY_REF).catch(() => undefined)
      await ctx.credentials.set(KEY_REF, apiKey)
      // A deep merge: other routes stay as they are; this route's model list is replaced.
      const route = { displayName: 'CLIProxyAPI', api: 'openai-completions', baseURL, apiKeyEnv: KEY_REF, models: models.map(id => ({ id, name: id })) }
      try {
        await ctx.settings.update(PI_AI, { providers: { [ROUTE_ID]: route } }, piAi.revision)
      } catch (error) {
        await (previous?.source === 'file' ? ctx.credentials.set(KEY_REF, previous.value) : ctx.credentials.unset(KEY_REF)).catch(() => {})
        if (error?.code === 'SETTINGS_CONFLICT') throw refused('DSH\'s model settings changed while saving. Try again.')
        throw refused(`DSH did not save the route: ${error?.message ?? error}`)
      }
      return { route: ROUTE_ID, baseURL, models }
    },
  }
}

export function install(ctx, deps = {}) {
  const checkClaude = deps.checkClaude ?? (() => checkClaudeCode(ctx))
  const ai = createAiActions(ctx, { fetch: deps.fetch, claudeCode: checkClaude, saveRoute: (provider, patch) => saveRoute(ctx, provider, patch), unsetRoute: provider => unsetRoute(ctx, provider) })
  const terminal = createTerminalActions(ctx, { checkClaude, ...deps.terminal })
  const { anyOn, ...aiEndpoints } = ai
  const { closeAll, ...terminalEndpoints } = terminal
  const { team, omniProjectOf, ...companion } = createCompanionActions(ctx, deps.companion)
  const actions = { ...createActions(ctx, { ...deps, anyOn }), ...createProviderActions(ctx), ...aiEndpoints, ...terminalEndpoints, ...companion, ...createBotTypeActions(ctx, { team, omniProjectOf }) }
  if (deps.checkClaude) actions['claude-code'] = () => checkClaude()
  const handle = async (endpoint, payload, signal) => {
    if (!Object.hasOwn(actions, endpoint)) return { ok: false, error: { code: 'omni-ai/not-found', message: `Unknown endpoint ${endpoint.slice(0, 40)}` } }
    try {
      return { ok: true, value: await actions[endpoint](payload, signal) }
    } catch (error) {
      const known = typeof error?.code === 'string' && error.code.startsWith('omni-ai/')
      if (!known) ctx.logger?.warn?.('omni-ai: %s failed: %s', endpoint, error?.message ?? error)
      return { ok: false, error: { code: known ? error.code : 'omni-ai/internal', message: known ? error.message : `${endpoint} failed` } }
    }
  }

  // The steps' own live flags are no settings page of their own.
  ctx.effect(() => ctx.settings.configure?.({ auto: false }, ctx.fiber), 'omni-ai: settings form')
  // An exact Fetch route on the shared /api channel; the browser authenticates with its session cookie.
  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body
      try { body = await request.json() } catch { body = {} }
      const asked = parse(RequestBody, body) ?? { endpoint: '' }
      const result = await handle(asked.endpoint, asked.payload, request.signal)
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  }), 'omni-ai: api route')
  ctx.effect(() => closeAll, 'omni-ai: close terminals')
  return { actions, handle }
}
