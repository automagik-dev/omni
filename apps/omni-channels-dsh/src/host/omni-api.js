// Omni's hands on the platform: the Bot that operates Omni (a Main Bot or an Omni Bot) finds any omni API operation in the API's own
// OpenAPI description (omni_endpoints) and calls it with this host's key (omni_call). Every
// call is drawn in the chat as a card (src/client/omni-live.js), so the user watches each
// read and each change happen. The browser reads through `omni-get`, GET operations only,
// for the live parts of those cards and of the canvases Omni draws.
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { operatesHere, operatesOmni } from './grants.js'
import { output } from './output.js'
import { SOURCE_ROUTES } from './omni-routes.js'
import { HANDOFF_TOOL } from './omni-rules.js'
import { THREAD_TOOLS } from './threads.js'

const SPEC_TTL_MS = 10 * 60_000
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const FOUND_MAX = 12
const DETAILED = 3
const RESULT_MAX = 14_000
const SCHEMA_DEPTH = 3
const CARD_BODY_MAX = 12_000

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })

// Omni operates the platform through its tools; files and the shell belong to the sessions
// it hands work to. With an omni to operate, the Sessions of a Bot that operates it lose DSH's
// computer tools and the team's start_task, and its hand-off (HANDOFF_TOOL, handoff.js) hands
// that work to a session under its row.
export const COMPUTER_TOOLS = ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'subagent', 'subagent_fork', 'workflow', 'job_kill', 'job_list', 'job_output', 'todo_write', 'working_directory']
const COMPUTER_REFUSAL = `Omni works through its own tools, not files or the shell. Hand this to a session under you with ${HANDOFF_TOOL}.`

// Chat keys (POST /keys/children…) answer with key text, which must never reach a model: the
// host mints and revokes them itself, so omni_call refuses them before any request and
// omni_endpoints never lists them.
const KEY_ROUTE = /^\/keys\/children(\/|$)/
export const KEY_ROUTE_REFUSAL = 'Chat keys are not an operation for a Bot: this app mints and revokes them itself, and their answers carry key text.'

/** Whether a path, as fetch and omni would route it (percent-decoded, slashes collapsed, dot segments resolved), is a chat-key route. */
export function isKeyRoute(path) {
  let decoded = String(path ?? '')
  try { decoded = decodeURIComponent(decoded) } catch { /* malformed: test it as written */ }
  const collapsed = decoded.replace(/\/{2,}/g, '/')
  let resolved = collapsed
  try { resolved = new URL(collapsed, 'http://omni.invalid').pathname } catch { /* test it as collapsed */ }
  return KEY_ROUTE.test(collapsed) || KEY_ROUTE.test(resolved)
}

// "/instances/{id}/qr" → /^\/instances\/[^/]+\/qr$/
const patternOf = path => new RegExp(`^${path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '[^/]+')}$`)

// Each documented operation, with what the model needs to call it.
export function operationsOf(spec) {
  const ops = []
  for (const [path, item] of Object.entries(spec?.paths ?? {})) {
    for (const [method, op] of Object.entries(item ?? {})) {
      if (!METHODS.includes(method.toUpperCase()) || typeof op !== 'object') continue
      const body = op.requestBody?.content?.['application/json']?.schema
      ops.push({
        method: method.toUpperCase(), path, pattern: patternOf(path), summary: op.summary ?? op.operationId ?? '', tag: op.tags?.[0] ?? '',
        id: op.operationId ?? '', description: String(op.description ?? '').slice(0, 300),
        params: (op.parameters ?? []).map(param => ({ name: param.name, in: param.in, required: param.required === true, type: shapeOf(param.schema, 1), description: param.description ?? param.schema?.description ?? '' })),
        body: body ? shapeOf(body, 0) : null,
      })
    }
  }
  return ops
}

// A compact, readable type for a JSON schema: {name: string, kind?: "a" | "b", tags: string[]}.
export function shapeOf(schema, depth = 0) {
  if (!schema || typeof schema !== 'object') return 'any'
  if (schema.enum) return schema.enum.map(value => JSON.stringify(value)).join(' | ')
  const variants = schema.anyOf ?? schema.oneOf
  if (variants) return variants.map(variant => shapeOf(variant, depth)).join(' | ')
  if (schema.allOf) return schema.allOf.map(part => shapeOf(part, depth)).join(' & ')
  if (schema.type === 'array') return `${shapeOf(schema.items, depth)}[]`
  if (schema.type === 'object' || schema.properties) {
    if (depth >= SCHEMA_DEPTH || !schema.properties) return 'object'
    const required = new Set(schema.required ?? [])
    return `{${Object.entries(schema.properties).map(([name, value]) => `${name}${required.has(name) ? '' : '?'}: ${shapeOf(value, depth + 1)}`).join(', ')}}`
  }
  return schema.format ? `${schema.type ?? 'any'}(${schema.format})` : schema.type ?? 'any'
}

// Operations ranked by how many of the words they carry, best first.
export function search(ops, text) {
  const words = String(text ?? '').toLowerCase().split(/[^a-z0-9{}]+/).filter(word => word.length > 1)
  if (words.length === 0) return ops
  const scored = ops.map((op) => {
    // Parameter names count too: "unread chats" finds the list that takes unreadOnly.
    const hay = `${op.method} ${op.path} ${op.summary} ${op.tag} ${op.id} ${op.query ?? ''}`.toLowerCase()
    const score = words.reduce((sum, word) => sum + (hay.includes(word) ? (op.path.toLowerCase().includes(word) ? 2 : 1) : 0), 0)
    return { op, score }
  })
  return scored.filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).map(entry => entry.op)
}

export const findOperation = (ops, method, path) => ops.find(op => op.method === method && op.pattern.test(path))

// The omni_call writes that run without asking: reads sent as POST, the user's own chat
// housekeeping, sending to themselves or to a group, connecting and syncing a channel, and
// generating media. Every other write, any DELETE included, asks the user first, Main Bot or
// not (grants.js), on a card with the whole call. That takes in automations, routes, agents,
// providers and webhook sources too: each can make Omni message someone, or post their
// messages somewhere, later and with no card of its own.
const QUIET_WRITES = [
  /^POST \/(access\/check|auth\/validate|events\/search|batch-jobs\/estimate|messages\/media\/download|messages\/read|messages\/send-self|messages\/send\/presence|chats\/sync-names)$/,
  /^POST \/events\/schemas\/[^/]+\/validate$/,
  /^POST \/instances\/[^/]+\/(connect|check-number|sync|sync\/profile)$/,
  /^POST \/chats\/[^/]+\/(archive|unarchive|hide|unhide|mute|unmute|pin|unpin|read|label)$/,
  /^POST \/messages\/[^/]+\/(read|star)$/,
  /^POST \/media\/(tts|stt|vision|imagine|music|film)$/,
]
const SENDS = /^\/messages\/send(\/(media|contact|location|sticker|tts|forward|poll|embed))?$/
// Where many people read one shared room, not a person's inbox: a WhatsApp group or channel.
const SHARED_ROOM = /@(g\.us|newsletter)$/

/** What an omni_call is when it asks first (send, delete, disconnect, change); null when it runs quietly. */
export function sensitiveCall(method, path, body) {
  if (method === 'GET') return null
  if (method === 'POST' && SENDS.test(path)) return SHARED_ROOM.test(String(body?.to ?? '')) ? null : 'send'
  const route = `${method} ${path}`
  if (QUIET_WRITES.some(pattern => pattern.test(route))) return null
  if (method === 'DELETE' || /\/(delete|edit)-channel$|\/groups\/[^/]+\/leave$|\/participants/.test(path)) return 'delete'
  if (/^\/instances\/[^/]+\/(disconnect|logout|restart)$|\/whatsapp-business\/connection$/.test(path)) return 'disconnect'
  if (/^\/instances\/[^/]+$/.test(path) && body?.isActive === false) return 'disconnect'
  if (/send|scheduled-messages|\/replay$|\/retry$|\/execute$|\/trigger$|\/say$/.test(path)) return 'send'
  return 'change'
}

// "/instances/{id}/self/chats" → "instances · self · chats", for a route with no summary.
const pathWords = path => path.split('/').filter(part => part && !part.startsWith('{')).map(part => part.replace(/[-_]/g, ' ')).join(' · ')

// The documented operations, then the routes omni's source declares that its OpenAPI
// description leaves out (chats, sending, …), with their path parameters and body schema.
export function withSourceRoutes(ops, routes = SOURCE_ROUTES) {
  const known = new Set(ops.map(op => `${op.method} ${op.path}`))
  const extra = routes.filter(route => !known.has(`${route.method} ${route.path}`)).map(route => ({
    method: route.method, path: route.path, pattern: patternOf(route.path), summary: route.summary || pathWords(route.path), tag: route.tag, id: '', description: '',
    params: [...route.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({ name, in: 'path', required: true, type: 'string', description: '' })),
    body: route.body ?? null, query: route.query ?? null, undocumented: true,
  }))
  return [...ops, ...extra]
}

/**
 * Each of `names` that DSH serves this agent, denied on the agent's own scope one name at a
 * time: restrict() refuses a name that is not a global tool here (a scope-local `subagent`, a
 * tool this dsh does not ship) and refuses the whole list for it, and restrictions intersect,
 * so a refused name is skipped and the others still go. Returns how many were denied; throws
 * when DSH's list for the agent cannot be read.
 */
export function denyEach(ctx, agent, names) {
  const served = new Set(ctx.tools.schemas(agent).map(schema => schema.name))
  let denied = 0
  for (const name of names) {
    if (!served.has(name)) continue
    try {
      agent.ctx.tools.restrict({ deny: [name] })
      denied += 1
    } catch {}
  }
  return denied
}

// Large answers keep their shape: lists lose their tail (and say so) until the text fits.
export function fitted(value, max = RESULT_MAX) {
  let text = JSON.stringify(value)
  if (text === undefined || text.length <= max) return text ?? 'null'
  const lists = []
  const visit = (node) => {
    if (Array.isArray(node)) lists.push(node)
    if (node && typeof node === 'object') for (const child of Object.values(node)) visit(child)
  }
  const copy = structuredClone(value)
  visit(copy)
  lists.sort((a, b) => b.length - a.length)
  for (let round = 0; round < 12 && text.length > max && lists.some(list => list.length > 1); round += 1) {
    for (const list of lists) if (list.length > 1) list.splice(Math.ceil(list.length / 2))
    text = JSON.stringify({ ...copy, _cut: 'Lists were shortened to fit; page with limit/cursor for the rest.' })
  }
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

export function install(rt) {
  const { ctx, state } = rt
  let spec = null

  const operating = sessionId => operatesHere(rt, sessionId)
  // `trimmed`: the agents this list was trimmed from.
  const trimFrom = (agent, names, trimmed, what) => {
    if (trimmed.has(agent) || typeof agent.ctx?.tools?.restrict !== 'function') return
    let denied
    try {
      denied = denyEach(ctx, agent, names)
    } catch (error) {
      rt.warn('ds-bot: the %s stay in the Main Bot session %s: %s', what, agent.session?.id, error)
      return
    }
    // Nothing denied can mean the schemas are not up yet: the next refusal tries again.
    if (denied > 0) trimmed.add(agent)
  }
  const trimmedComputer = new WeakSet()
  const trimComputer = (agent) => {
    if (agent === undefined || !operating(agent.session?.id)) return
    trimFrom(agent, [...COMPUTER_TOOLS, 'start_task'], trimmedComputer, 'computer tools')
  }
  // A chat thread's tools are for its own Session only (thread-tools.js): the Omni Bot's
  // Sessions never list them, whether or not an Omni is named yet.
  const trimmedThread = new WeakSet()
  const trimThreadTools = (agent) => {
    if (agent === undefined || !operatesOmni(rt, rt.selfOf(agent.session?.id))) return
    trimFrom(agent, THREAD_TOOLS, trimmedThread, 'chat thread tools')
  }
  ctx.on('agent/created', async ({ agent }) => {
    try {
      await rt.load()
      trimComputer(agent)
      trimThreadTools(agent)
    } catch (error) {
      rt.warn('ds-bot: trimming the Main Bot tools failed: %s', error)
    }
  })
  // A Session resolved before this plugin knew it was the Main Bot's still refuses them.
  // A refused call also trims the list, in case the tools were not up when the Session began.
  ctx.tools.guard((exec) => {
    if (!COMPUTER_TOOLS.includes(exec.name) || !operating(exec.agent?.id)) return undefined
    trimComputer(exec.agent)
    return COMPUTER_REFUSAL
  })

  async function operations() {
    if (spec && Date.now() - spec.at < SPEC_TTL_MS) return spec.ops
    const response = await rt.omniRequest('GET', '/openapi.json')
    if (response === null) throw invalid('Omni is not connected here: connect one on the Channels page (pair by code).')
    if (!response.ok) throw invalid(`omni answered ${response.status} for its API description`)
    spec = { at: Date.now(), ops: withSourceRoutes(operationsOf(await response.json())).filter(op => !isKeyRoute(op.path)) }
    return spec.ops
  }

  // A Main Bot or an Omni Bot operates omni. In a Session that handles an automation's event, whose text
  // came from other people, it only reads.
  async function allowed(exec, method) {
    await rt.load()
    const id = exec.agent?.id
    const self = rt.selfOf(id)
    if (!operatesOmni(rt, self)) return 'Only an Omni Bot or a Main Bot operates omni. Ask one in its chat.'
    const eventRun = (state.subscriptionRuns ?? []).some(run => run.sessionId === id)
    if (eventRun && method !== 'GET') return 'This Session handles an automation event, so it only reads omni. Tell the user what you would change instead.'
    return null
  }

  async function call(method, path, body) {
    const response = await rt.omniRequest(method, path, body === undefined ? {} : { body })
    if (response === null) throw invalid('Omni is not connected here.')
    const text = await response.text()
    let data = text
    try { data = text ? JSON.parse(text) : null } catch { /* not JSON: keep the text */ }
    return { status: response.status, ok: response.ok, data }
  }

  const parse = (text, what) => {
    if (text === undefined || text === null || text === '') return undefined
    if (typeof text === 'object') return text
    try { return JSON.parse(text) } catch { throw invalid(`${what} must be JSON`) }
  }

  ctx.tools.register(defineTool({
    name: 'omni_endpoints',
    description: 'Omni and Main Bots only. Finds omni API operations (channels/instances, chats, messages, automations, agents, providers, routes, keys, events, settings…) by words. Returns METHOD /path — summary; the best matches also list their parameters and JSON body.',
    parameters: { search: { type: 'string', required: true, description: 'Words for what you want to do, e.g. "connect whatsapp qr" or "send message"' } },
    output,
    async execute(args, exec) {
      const refusal = await allowed(exec, 'GET')
      if (refusal) return refusal
      try {
        const found = search(await operations(), args.search).slice(0, FOUND_MAX)
        if (found.length === 0) return `Nothing matches "${args.search}". Try other words.`
        return found.map((op, index) => {
          const head = `${op.method} ${op.path} — ${op.summary}${op.tag ? ` [${op.tag}]` : ''}`
          if (index >= DETAILED) return head
          const params = op.params.map(param => `  ${param.in} ${param.name}${param.required ? '' : '?'}: ${param.type}${param.description ? ` — ${param.description.slice(0, 120)}` : ''}`)
          return [head, ...(op.description && op.description !== op.summary ? [`  ${op.description}`] : []), ...params, ...(op.query ? [`  query: ${op.query}`] : []), ...(op.body ? [`  body: ${op.body}`] : [])].join('\n')
        }).join('\n')
      } catch (error) {
        return error.message
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'omni_call',
    description: 'Omni and Main Bots only. Calls one omni API operation with full permissions, on the user\'s behalf. The user sees every call as a card in the chat (a QR code to scan, a channel, a table), so do not repeat its data in text. Find the operation with omni_endpoints first.',
    parameters: {
      method: { type: 'string', required: true, enum: METHODS, description: 'HTTP method' },
      path: { type: 'string', required: true, description: 'API path under /api/v2 with ids filled in, e.g. /instances/<id>/connect' },
      query: { type: 'string', description: 'Query parameters as JSON, e.g. {"limit": 20}' },
      body: { type: 'string', description: 'JSON request body' },
    },
    output,
    async execute(args, exec) {
      const method = String(args.method ?? '').toUpperCase()
      const refusal = await allowed(exec, method)
      if (refusal) return refusal
      try {
        if (!METHODS.includes(method)) throw invalid(`method must be one of ${METHODS.join(', ')}`)
        const path = String(args.path ?? '').trim().replace(/^\/api\/v2(?=\/)/, '')
        if (!/^\/[A-Za-z0-9/_\-.~%:@]*$/.test(path)) throw invalid('path must be an API path such as /instances/<id>, without the host or a query string')
        if (isKeyRoute(path)) throw invalid(KEY_ROUTE_REFUSAL)
        const op = findOperation(await operations(), method, path)
        if (!op) throw invalid(`${method} ${path} is not an omni API operation. Find it with omni_endpoints.`)
        const query = parse(args.query, 'query')
        const body = parse(args.body, 'body')
        const act = sensitiveCall(method, path, body)
        if (act !== null) {
          // The card shows the whole call, or nothing runs.
          const shown = body === undefined ? undefined : JSON.stringify(body, null, 2)
          if (shown !== undefined && shown.length > CARD_BODY_MAX) return fitted({ status: 0, error: `This call's body is too long to show the user on a card (${shown.length} characters, at most ${CARD_BODY_MAX}). Split it into smaller calls.` })
          const channelId = body?.instanceId ?? /^\/instances\/([^/]+)/.exec(path)?.[1]
          const channel = channelId ? (await channelOf(channelId)).name : undefined
          const asked = await rt.omniPermit(exec, {
            action: act, force: 'confirm',
            resource: { type: 'call', id: `${method} ${path}`, name: op.summary || `${method} ${path}` },
            call: { tool: 'omni_call', args: { method, path, query, body } },
            preview: {
              method, path, ...(channel ? { channel } : {}),
              ...(typeof body?.to === 'string' ? { to: body.to } : {}), ...(typeof body?.text === 'string' ? { text: body.text } : {}),
              ...(query && typeof query === 'object' && Object.keys(query).length > 0 ? { query: JSON.stringify(query) } : {}),
              ...(body !== undefined ? { body: shown } : {}),
            },
          })
          if (asked) return asked
        }
        return await runCall({ method, path, query, body }, op)
      } catch (error) {
        return fitted({ status: 0, error: error.message })
      }
    },
  }))
  async function runCall({ method, path, query, body }, op) {
    // A confirmed card runs here too: it never reaches a chat-key route either.
    if (isKeyRoute(path)) return fitted({ status: 0, error: KEY_ROUTE_REFUSAL })
    const qs = query && typeof query === 'object' ? new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)])).toString() : ''
    const result = await call(method, `${path}${qs ? `?${qs}` : ''}`, body)
    return fitted({ status: result.status, operation: op?.summary ?? `${method} ${path}`, data: result.data })
  }
  rt.omniExecutor('omni_call', args => runCall(args, findOperation(spec?.ops ?? [], args.method, args.path)))

  // The everyday reads and the one change people ask for most, as tools of their own: one
  // call each, and the chat draws each as its card.
  const ok = response => response.status >= 200 && response.status < 300
  const phone = owner => (typeof owner === 'string' ? owner.replace(/[:@].*$/, '').replace(/^(\d{6,})$/, '+$1') : undefined)
  async function channels() {
    const list = await call('GET', '/instances?limit=100')
    if (!ok(list)) throw invalid(`omni answered ${list.status} listing channels`)
    const items = list.data?.items ?? []
    const statuses = await Promise.all(items.map(item => call('GET', `/instances/${encodeURIComponent(item.id)}/status`).then(reply => (ok(reply) ? reply.data?.data : null), () => null)))
    return items.map((item, index) => {
      const live = statuses[index]
      const state = item.isActive === false ? 'paused' : live?.isConnected || live?.state === 'connected' ? 'connected' : live?.state ?? 'unknown'
      return { id: item.id, name: item.name, channel: item.channel, state, profile: live?.profileName ?? item.profileName ?? undefined, phone: phone(live?.ownerIdentifier ?? item.ownerIdentifier), active: item.isActive !== false }
    })
  }
  // A channel by id, or by its name as the user says it.
  async function channelId(ref) {
    const value = String(ref ?? '').trim()
    if (/^[0-9a-f-]{36}$/i.test(value)) return value
    const found = (await channels()).filter(item => item.name.toLowerCase() === value.toLowerCase())
    if (found.length !== 1) throw invalid(`No channel named "${value}". omni_channels lists them.`)
    return found[0].id
  }
  const tool = (definition, execute, method = 'GET') => ctx.tools.register(defineTool({
    ...definition,
    output,
    async execute(args, exec) {
      const refusal = await allowed(exec, method)
      if (refusal) return refusal
      try {
        return await execute(args, exec)
      } catch (error) {
        return fitted({ status: 0, error: error.message })
      }
    },
  }))

  tool({
    name: 'omni_channels',
    description: 'Omni and Main Bots only. Every omni channel with its live connection state (connected, connecting, paused…), profile and number, in one call. The user sees them as live cards.',
    parameters: {},
  }, async () => fitted({ status: 200, operation: 'Channels', data: { items: await channels() } }))

  // The reads behind omni_chats and omni_messages, shared with canvases (Query("omni_chats", …)).
  async function chats(args = {}) {
    const query = new URLSearchParams({ sort: 'activity', limit: String(Math.min(100, Math.max(1, Number(args.limit) || 20))) })
    if (args.channel) query.set('instanceId', await channelId(args.channel))
    if (args.search) query.set('search', String(args.search))
    if (args.unread_only === true || args.unread_only === 'true') query.set('unreadOnly', 'true')
    const result = await call('GET', `/chats?${query}`)
    if (!ok(result)) throw invalid(`omni answered ${result.status} listing chats`)
    const items = (result.data?.items ?? []).map(chat => ({
      id: chat.id, name: chat.name, type: chat.isGroup ? 'group' : chat.chatType, channelId: chat.instanceId, unread: chat.unreadCount ?? 0, avatarUrl: chat.avatarUrl ?? undefined,
      lastMessageAt: chat.lastMessageAt, preview: chat.lastMessagePreview ? String(chat.lastMessagePreview).slice(0, 120) : undefined,
    }))
    return { items, more: result.data?.meta?.hasMore === true }
  }
  async function messages(args = {}) {
    const id = String(args.chat ?? '').trim()
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw invalid('chat must be a chat id from omni_chats')
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 20))
    const [chat, list] = await Promise.all([call('GET', `/chats/${id}`), call('GET', `/chats/${id}/messages?limit=${limit}`)])
    if (!ok(chat)) throw invalid(`omni answered ${chat.status} for that chat`)
    const items = (list.data?.items ?? []).map(message => ({
      id: message.id, from: message.isFromMe ? 'you' : message.senderDisplayName ?? 'them', at: message.platformTimestamp ?? message.createdAt,
      text: String(message.textContent || message.transcription || (message.hasMedia ? `[${message.messageType ?? 'media'}]` : '')).slice(0, 500),
      ...(message.hasMedia ? { media: message.messageType ?? 'media' } : {}),
    })).sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0))
    return { chat: { id, name: chat.data?.data?.name, channel: chat.data?.data?.channel }, items }
  }
  // One documented GET, with its query given apart or in the path.
  async function get(args = {}) {
    const [bare, inline = ''] = String(args.path ?? '').trim().split('?')
    if (!/^\/[A-Za-z0-9/_\-.~%:@]*$/.test(bare)) throw invalid('Not an API path')
    if (!findOperation(await operations(), 'GET', bare)) throw invalid(`GET ${bare} is not an omni API operation`)
    const query = new URLSearchParams(inline)
    for (const [key, value] of Object.entries(args.query && typeof args.query === 'object' ? args.query : {})) if (value !== undefined && value !== null) query.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
    const qs = query.toString()
    return call('GET', `${bare}${qs ? `?${qs}` : ''}`)
  }

  // What any Bot reaches on Omni, checked against its permissions (grants.js): the chats it
  // can name, then per chat what it reads, sends, reacts, opens and deletes.
  const uuid = (value, what) => {
    const id = String(value ?? '').trim()
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw invalid(`${what} must be an id from omni_${what === 'chat' ? 'chats' : 'messages'}`)
    return id
  }
  // A channel's owner number and name, for ten minutes; a failed read is not kept.
  const channelCache = new Map()
  async function channelOf(instanceId) {
    const kept = channelCache.get(instanceId)
    if (kept && Date.now() - kept.at < SPEC_TTL_MS) return kept
    const reply = await call('GET', `/instances/${encodeURIComponent(instanceId)}`)
    if (!ok(reply)) return { owner: '', name: undefined }
    const found = { owner: String(reply.data?.data?.ownerIdentifier ?? ''), name: reply.data?.data?.name ?? undefined, at: Date.now() }
    channelCache.set(instanceId, found)
    return found
  }
  const digits = value => String(value ?? '').replace(/[:@].*$/, '').replace(/\D/g, '')
  // Rooms many people read: what is posted there reaches no one's private inbox. A direct
  // chat, a broadcast list (it lands in each person's chat) and anything unknown are a person.
  const ROOMS = new Set(['group', 'channel', 'thread', 'forum', 'voice', 'community', 'announcement', 'stage'])
  // A chat as a permission's resource: the user's own chat, a person ('chat'), or a group.
  async function chatResource(chatId) {
    const reply = await call('GET', `/chats/${chatId}`)
    if (!ok(reply)) throw invalid(`omni answered ${reply.status} for that chat`)
    const chat = reply.data?.data ?? {}
    const channel = await channelOf(chat.instanceId)
    const owner = digits(channel.owner)
    const self = chat.chatType === 'dm' && owner !== '' && digits(chat.externalId) === owner
    const type = self ? 'self' : ROOMS.has(chat.chatType) ? 'group' : 'chat'
    return {
      chat,
      resource: { type, id: chat.id, name: chat.name || chat.externalId || 'a chat', channelId: chat.instanceId, ...(channel.name ? { channelName: channel.name } : {}) },
    }
  }
  async function messageIn(chat, messageId) {
    const reply = await call('GET', `/messages/${messageId}`)
    const message = reply.data?.data
    if (!ok(reply) || message?.chatId !== chat.id) throw invalid('That message is not in this chat')
    return message
  }
  const snippet = message => String(message.textContent || message.transcription || (message.hasMedia ? `[${message.messageType ?? 'media'}]` : '')).slice(0, 300)

  // Each action: what it needs to know before asking, and what it does once allowed. The
  // card shows `preview`; allowing it runs `run` with the same arguments.
  const ACTS = {
    omni_messages: {
      action: 'read',
      prepare: async args => ({ chat: uuid(args.chat, 'chat'), ...(args.limit !== undefined ? { limit: args.limit } : {}) }),
      run: async args => fitted({ status: 200, operation: 'Messages', data: await messages(args) }),
    },
    omni_send: {
      action: 'send',
      prepare: async (args) => {
        const text = String(args.text ?? '')
        if (text.trim() === '') throw invalid('text is empty')
        if (text.length > 4000) throw invalid('text is longer than 4000 characters')
        return { chat: uuid(args.chat, 'chat'), text }
      },
      preview: args => ({ text: args.text }),
      run: async (args) => {
        const { chat } = await chatResource(args.chat)
        const result = await call('POST', '/messages/send', { instanceId: chat.instanceId, to: chat.externalId, text: args.text })
        return fitted({ status: result.status, operation: 'Send message', data: result.data })
      },
    },
    omni_react: {
      action: 'react',
      prepare: async (args) => {
        const emoji = String(args.emoji ?? '').trim()
        if (emoji === '' || emoji.length > 16) throw invalid('emoji must be one emoji')
        return { chat: uuid(args.chat, 'chat'), message: uuid(args.message, 'message'), emoji }
      },
      preview: (args, message) => ({ emoji: args.emoji, text: snippet(message) }),
      run: async (args) => {
        const { chat } = await chatResource(args.chat)
        await messageIn(chat, args.message)
        const result = await call('POST', '/messages/send/reaction', { instanceId: chat.instanceId, to: chat.externalId, messageId: args.message, emoji: args.emoji })
        return fitted({ status: result.status, operation: 'React', data: result.data })
      },
    },
    omni_media: {
      action: 'media',
      prepare: async args => ({ chat: uuid(args.chat, 'chat'), message: uuid(args.message, 'message') }),
      preview: (_args, message) => ({ text: snippet(message) }),
      run: async (args) => {
        const { chat } = await chatResource(args.chat)
        const message = await messageIn(chat, args.message)
        if (!message.hasMedia) throw invalid('That message has no media')
        // The same download as the chat view's (omni.js), refusing a path outside /media.
        const media = await rt.omniMediaFile(message.id)
        if (!media.ok) throw invalid(media.reason)
        const { response, path: where } = media
        // Each Bot's files apart, under its own id.
        const dir = join(rt.home, 'media', String(args.bot ?? 'bot').replace(/[^\w-]/g, '_'))
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        const file = join(dir, `${message.id}-${basename(where)}`)
        writeFileSync(file, Buffer.from(await response.arrayBuffer()), { mode: 0o600 })
        return fitted({ status: 200, operation: 'Media', data: { path: file, type: message.messageType, mimeType: media.stored.mediaMimeType ?? null, text: message.transcription || undefined } })
      },
    },
    omni_delete: {
      action: 'delete',
      prepare: async args => ({ chat: uuid(args.chat, 'chat'), message: uuid(args.message, 'message') }),
      preview: (_args, message) => ({ text: snippet(message) }),
      run: async (args) => {
        const { chat } = await chatResource(args.chat)
        const message = await messageIn(chat, args.message)
        const result = await call('POST', '/messages/delete-channel', { instanceId: chat.instanceId, channelId: chat.externalId, messageId: message.externalId, fromMe: message.isFromMe === true })
        return fitted({ status: result.status, operation: 'Delete message', data: result.data })
      },
    },
  }
  const act = (definition) => {
    const spec = ACTS[definition.name]
    rt.omniExecutor(definition.name, args => spec.run(args))
    ctx.tools.register(defineTool({
      ...definition,
      output,
      async execute(raw, exec) {
        try {
          await rt.load()
          const args = { ...await spec.prepare(raw ?? {}), bot: rt.selfOf(exec.agent?.id) }
          const { chat, resource } = await chatResource(args.chat)
          const message = args.message ? await messageIn(chat, args.message) : undefined
          const asked = await rt.omniPermit(exec, { action: spec.action, resource, call: { tool: definition.name, args }, preview: spec.preview?.(args, message) ?? {} })
          if (asked) return asked
          return await spec.run(args)
        } catch (error) {
          return fitted({ status: 0, error: error.message })
        }
      },
    }))
  }

  ctx.tools.register(defineTool({
    name: 'omni_chats',
    description: 'Chats and groups on omni, most recent first: on one channel or all, by name, or only unread ones. Gives the chat ids the other omni tools take. An Omni Bot or a Main Bot also sees each chat\'s last message.',
    parameters: {
      channel: { type: 'string', description: 'Channel id or exact name; all channels when left out' },
      search: { type: 'string', description: 'Part of a chat or group name' },
      unread_only: { type: 'boolean', description: 'Only chats with unread messages' },
      limit: { type: 'number', description: 'How many, 1-100 (default 20)' },
    },
    output,
    async execute(args, exec) {
      await rt.load()
      const self = rt.selfOf(exec.agent?.id)
      if (rt.botOf(self) === undefined) return 'Only Bots on the team use Omni.'
      try {
        const data = await chats(args)
        // What was said in a chat is for the Bots allowed to read it.
        if (!operatesOmni(rt, self)) for (const item of data.items) delete item.preview
        return fitted({ status: 200, operation: 'Chats', data })
      } catch (error) {
        return fitted({ status: 0, error: error.message })
      }
    },
  }))
  const asking = 'Without permission for that chat, the user is asked on a card first and your turn ends; the answer comes back as a note.'
  act({
    name: 'omni_messages',
    description: `The latest messages of one chat (id from omni_chats), oldest first, each with its id. The user sees the chat as a live card. ${asking}`,
    parameters: {
      chat: { type: 'string', required: true, description: 'Chat id from omni_chats' },
      limit: { type: 'number', description: 'How many messages, 1-50 (default 20)' },
    },
  })
  act({
    name: 'omni_send',
    description: `Sends a text message to one chat or group, as the user. Sending to a person (not a group) always asks the user to confirm the exact text first. ${asking}`,
    parameters: {
      chat: { type: 'string', required: true, description: 'Chat id from omni_chats' },
      text: { type: 'string', required: true, description: 'The message, exactly as it should arrive' },
    },
  })
  act({
    name: 'omni_react',
    description: `Reacts to one message with an emoji. ${asking}`,
    parameters: {
      chat: { type: 'string', required: true, description: 'Chat id from omni_chats' },
      message: { type: 'string', required: true, description: 'Message id from omni_messages' },
      emoji: { type: 'string', required: true, description: 'One emoji' },
    },
  })
  act({
    name: 'omni_media',
    description: `Saves one message's media (photo, audio, video, document) to a file and returns its path, to read or look at. ${asking}`,
    parameters: {
      chat: { type: 'string', required: true, description: 'Chat id from omni_chats' },
      message: { type: 'string', required: true, description: 'Message id from omni_messages, one with media' },
    },
  })
  act({
    name: 'omni_delete',
    description: 'Deletes one message for everyone. The user always confirms first, on a card showing the message.',
    parameters: {
      chat: { type: 'string', required: true, description: 'Chat id from omni_chats' },
      message: { type: 'string', required: true, description: 'Message id from omni_messages' },
    },
  })

  tool({
    name: 'omni_connect',
    description: 'Omni and Main Bots only. Starts connecting a channel (WhatsApp shows a QR code to scan). The user sees the live QR code, which turns into Connected once scanned; do not read it back.',
    parameters: { channel: { type: 'string', required: true, description: 'Channel id or exact name' } },
  }, async (args) => {
    const id = await channelId(args.channel)
    const result = await call('POST', `/instances/${id}/connect`, {})
    return fitted({ status: result.status, operation: 'Connect channel', channelId: id, data: result.data })
  }, 'POST')

  // A canvas reads through the same tools Omni has, under the same names and arguments.
  const READS = {
    omni_channels: async () => ({ items: await channels() }),
    omni_chats: chats,
    omni_messages: messages,
    omni_get: async (args) => {
      const result = await get(args)
      if (!ok(result)) throw invalid(result.data?.error?.message ?? `omni answered ${result.status}`)
      return result.data
    },
  }
  rt.omniRead = async (name, args) => {
    const read = Object.hasOwn(READS, name) ? READS[name] : undefined
    if (read === undefined) throw invalid(`A canvas cannot read with ${name}`)
    return read(args && typeof args === 'object' ? args : {})
  }
  // The browser's live reads: one documented GET operation per request.
  rt.omniGet = path => get({ path })
  ctx.effect(() => rt.hooks.endpoint('omni-get', body => rt.omniGet(body?.path), { read: true }), 'ds-bot: omni-get')
  ctx.effect(() => rt.hooks.endpoint('omni-read', body => rt.omniRead(String(body?.tool ?? ''), body?.args), { read: true }), 'ds-bot: omni-read')
}
