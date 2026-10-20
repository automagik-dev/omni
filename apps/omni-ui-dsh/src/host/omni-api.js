// Omni's hands on the platform: the Main Bot finds any omni API operation in the API's own
// OpenAPI description (omni_endpoints) and calls it with this host's key (omni_call). Every
// call is drawn in the chat as a card (src/client/omni-cards.js), so the user watches each
// read and each change happen. The browser reads through `omni-get`, GET operations only,
// for the live parts of those cards and of the canvases Omni draws.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { output } from './tools.js'

const SPEC_TTL_MS = 10 * 60_000
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const FOUND_MAX = 12
const DETAILED = 3
const RESULT_MAX = 14_000
const SCHEMA_DEPTH = 3

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })

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
    const hay = `${op.method} ${op.path} ${op.summary} ${op.tag} ${op.id}`.toLowerCase()
    const score = words.reduce((sum, word) => sum + (hay.includes(word) ? (op.path.toLowerCase().includes(word) ? 2 : 1) : 0), 0)
    return { op, score }
  })
  return scored.filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).map(entry => entry.op)
}

export const findOperation = (ops, method, path) => ops.find(op => op.method === method && op.pattern.test(path))

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

  async function operations() {
    if (spec && Date.now() - spec.at < SPEC_TTL_MS) return spec.ops
    const response = await rt.omniRequest('GET', '/openapi.json')
    if (response === null) throw invalid('Omni is not connected here: config.omni.url and the OMNI_API_KEY secret are both needed.')
    if (!response.ok) throw invalid(`omni answered ${response.status} for its API description`)
    spec = { at: Date.now(), ops: operationsOf(await response.json()) }
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
          return [head, ...(op.description && op.description !== op.summary ? [`  ${op.description}`] : []), ...params, ...(op.body ? [`  body: ${op.body}`] : [])].join('\n')
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

  // The browser's live reads: one documented GET operation per request.
  rt.omniGet = async (path) => {
    const clean = String(path ?? '').trim()
    const [bare] = clean.split('?')
    if (!/^\/[A-Za-z0-9/_\-.~%:@]*$/.test(bare)) throw invalid('Not an API path')
    if (!findOperation(await operations(), 'GET', bare)) throw invalid(`GET ${bare} is not an omni API operation`)
    return call('GET', clean)
  }
}
