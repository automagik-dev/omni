// Omni's hands on the platform: the Main Bot finds any omni API operation in the API's own
// OpenAPI description (omni_endpoints) and calls it with this host's key (omni_call). Every
// call is drawn in the chat as a card (src/client/omni-cards.js), so the user watches each
// read and each change happen. The browser reads through `omni-get`, GET operations only,
// for the live parts of those cards and of the canvases Omni draws.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { output } from './tools.js'
import { checkProgram, refusalText } from './omni-ui-check.bundle.js'
import { SOURCE_ROUTES } from './omni-routes.js'

const SPEC_TTL_MS = 10 * 60_000
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const FOUND_MAX = 12
const DETAILED = 3
const RESULT_MAX = 14_000
const SCHEMA_DEPTH = 3

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })

// Omni operates the platform through its tools; files and the shell belong to Tasks. With
// an omni to operate, a Main Bot's Sessions lose DSH's computer tools, and start_task hands
// that work on.
export const COMPUTER_TOOLS = ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'subagent', 'subagent_fork', 'workflow', 'job_kill', 'job_list', 'job_output', 'todo_write', 'working_directory']
const COMPUTER_REFUSAL = 'Omni works through its own tools, not files or the shell. Hand this to a task with start_task.'

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

  const operating = (sessionId) => {
    if (!(rt.omniNamed?.() ?? Boolean(rt.config?.omni?.url))) return false
    const self = rt.selfOf(sessionId)
    return self !== undefined && rt.isMain(self)
  }
  const trimmed = new WeakSet()
  const trimComputer = (agent) => {
    if (agent === undefined || trimmed.has(agent) || !operating(agent.session?.id) || typeof agent.ctx?.tools?.restrict !== 'function') return
    try {
      // restrict() throws on a name this profile does not serve.
      const served = new Set(ctx.tools.schemas(agent).map(schema => schema.name))
      const deny = COMPUTER_TOOLS.filter(name => served.has(name))
      // An empty list can mean the schemas are not up yet: the next refusal tries again.
      if (deny.length === 0) return
      agent.ctx.tools.restrict({ deny })
      trimmed.add(agent)
    } catch (error) {
      rt.warn('ds-bot: the computer tools stay in the Main Bot session %s: %s', agent.session?.id, error)
    }
  }
  ctx.on('agent/created', async ({ agent }) => {
    try {
      await rt.load()
      trimComputer(agent)
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
    spec = { at: Date.now(), ops: withSourceRoutes(operationsOf(await response.json())) }
    return spec.ops
  }

  // The Main Bot operates omni. In a Session that handles an automation's event, whose text
  // came from other people, it only reads.
  async function allowed(exec, method) {
    await rt.load()
    const id = exec.agent?.id
    const self = rt.selfOf(id)
    if (!rt.isMain(self)) return 'Only a Main Bot operates omni. Ask it in its chat.'
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
    description: 'Main Bot only. Finds omni API operations (channels/instances, chats, messages, automations, agents, providers, routes, keys, events, settings…) by words. Returns METHOD /path — summary; the best matches also list their parameters and JSON body.',
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
    description: 'Main Bot only. Calls one omni API operation with full permissions, on the user\'s behalf. The user sees every call as a card in the chat (a QR code to scan, a channel, a table), so do not repeat its data in text. Find the operation with omni_endpoints first.',
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
        const op = findOperation(await operations(), method, path)
        if (!op) throw invalid(`${method} ${path} is not an omni API operation. Find it with omni_endpoints.`)
        const query = parse(args.query, 'query')
        const qs = query && typeof query === 'object' ? new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)])).toString() : ''
        const result = await call(method, `${path}${qs ? `?${qs}` : ''}`, parse(args.body, 'body'))
        return fitted({ status: result.status, operation: op.summary, data: result.data })
      } catch (error) {
        return fitted({ status: 0, error: error.message })
      }
    },
  }))

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
    description: 'Main Bot only. Every omni channel with its live connection state (connected, connecting, paused…), profile and number, in one call. The user sees them as live cards.',
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
      from: message.isFromMe ? 'you' : message.senderDisplayName ?? 'them', at: message.platformTimestamp ?? message.createdAt,
      text: String(message.textContent || message.transcription || (message.hasMedia ? `[${message.messageType ?? 'media'}]` : '')).slice(0, 500),
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

  tool({
    name: 'omni_chats',
    description: 'Main Bot only. Chats and groups on omni, most recent first: on one channel or all, by name, or only unread ones. The user sees them as a list.',
    parameters: {
      channel: { type: 'string', description: 'Channel id or exact name; all channels when left out' },
      search: { type: 'string', description: 'Part of a chat or group name' },
      unread_only: { type: 'boolean', description: 'Only chats with unread messages' },
      limit: { type: 'number', description: 'How many, 1-100 (default 20)' },
    },
  }, async args => fitted({ status: 200, operation: 'Chats', data: await chats(args) }))

  tool({
    name: 'omni_messages',
    description: 'Main Bot only. The latest messages of one chat (id from omni_chats), oldest first. The user sees the chat as a live card.',
    parameters: {
      chat: { type: 'string', required: true, description: 'Chat id from omni_chats' },
      limit: { type: 'number', description: 'How many messages, 1-50 (default 20)' },
    },
  }, async args => fitted({ status: 200, operation: 'Messages', data: await messages(args) }))

  tool({
    name: 'omni_connect',
    description: 'Main Bot only. Starts connecting a channel (WhatsApp shows a QR code to scan). The user sees the live QR code, which turns into Connected once scanned; do not read it back.',
    parameters: { channel: { type: 'string', required: true, description: 'Channel id or exact name' } },
  }, async (args) => {
    const id = await channelId(args.channel)
    const result = await call('POST', `/instances/${id}/connect`, {})
    return fitted({ status: result.status, operation: 'Connect channel', channelId: id, data: result.data })
  }, 'POST')

  ctx.tools.register(defineTool({
    name: 'show_canvas',
    description: 'Main Bot only. Shows the user a canvas: an openui-lang program, rendered live in the chat. It is checked first; when it is refused, fix what the reason says and call again. Prefer it to long text, lists or tables.',
    parameters: { program: { type: 'string', required: true, description: 'The openui-lang program, root = Stack([...]) first, one statement per line' } },
    output,
    async execute(args, exec) {
      const refusal = await allowed(exec, 'GET')
      if (refusal) return refusal
      const problem = checkProgram(String(args.program ?? ''))
      return problem === null ? 'Shown.' : `Not shown: ${refusalText(problem)} Fix it and call show_canvas again.`
    },
  }))

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
}
