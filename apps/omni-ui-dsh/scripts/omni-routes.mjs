// The omni API routes as its source declares them (packages/api/src/routes/v2), for the
// operations its OpenAPI description leaves out (chats, sending, …). omni_endpoints searches
// both, and omni_call runs either. Each route is "METHOD /path" with the summary from its
// doc comment ("GET /chats - List chats").
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const METHODS = ['get', 'post', 'put', 'patch', 'delete']

const BODY_MAX = 600

// "const createChatSchema = z.object({ ... })" as one compact line, for the model to read.
function schemaText(text, name) {
  const start = text.search(new RegExp(`const ${name}\\s*=`))
  if (start === -1) return name
  let depth = 0
  let end = start
  for (let at = text.indexOf('=', start) + 1; at < text.length; at += 1) {
    const char = text[at]
    if ('({['.includes(char)) depth += 1
    else if (')}]'.includes(char)) depth -= 1
    else if ((char === ';' || char === '\n') && depth === 0 && at > text.indexOf('(', start)) { end = at; break }
    end = at + 1
  }
  const body = text.slice(text.indexOf('=', start) + 1, end).replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim()
  return body.length > BODY_MAX ? `${body.slice(0, BODY_MAX)}…` : body
}

export function sourceRoutes(apiDir) {
  const routesDir = join(apiDir, 'src/routes/v2')
  const index = join(routesDir, 'index.ts')
  if (!existsSync(index)) return null
  const indexText = readFileSync(index, 'utf8')
  // import { chatsRoutes } from './chats'  +  v2Routes.route('/chats', chatsRoutes)
  const files = new Map([...indexText.matchAll(/import \{([^}]+)\} from '\.\/([\w-]+)'/g)].flatMap(([, names, file]) => names.split(',').map(name => [name.trim().split(/\s+as\s+/).pop(), file])))
  const mounts = [...indexText.matchAll(/v2Routes\.route\('([^']*)',\s*(\w+)\)/g)].map(([, prefix, name]) => ({ prefix, name, file: files.get(name) }))
  const routes = []
  const seen = new Set()
  for (const { prefix, name, file } of mounts) {
    if (!file || !existsSync(join(routesDir, `${file}.ts`))) continue
    const text = readFileSync(join(routesDir, `${file}.ts`), 'utf8')
    // The doc comment right above a route, never one that closed earlier.
    const pattern = new RegExp(`(?:/\\*\\*((?:(?!\\*/)[^])*)\\*/\\s*)?\\b${name}\\.(${METHODS.join('|')})\\(\\s*'([^']*)'([^\\n]*)`, 'g')
    const found = [...text.matchAll(pattern)]
    for (const [at, [, doc, method, sub, rest]] of found.entries()) {
      // The handler runs to the next route; a body it validates by hand names its schema there.
      const handler = text.slice(found[at].index, found[at + 1]?.index ?? text.length).slice(0, 4000)
      // A router mounted at the root declares full paths: "/" + "/events/consumers" is one path.
      const path = `${prefix === '/' ? '' : prefix}${sub === '/' ? '' : sub}`.replace(/:(\w+)/g, '{$1}').replace(/\/+$/, '') || '/'
      // A router mounted at the root for a few extra paths also yields catch-alls there
      // ("/", "/{id}"), which are not routes anyone calls.
      if (prefix === '/' && (path === '/' || /^\/\{\w+\}(\/|$)/.test(path))) continue
      const key = `${method.toUpperCase()} ${path}`
      if (seen.has(key)) continue
      seen.add(key)
      const summary = (doc ?? '').split('\n').map(line => line.replace(/^\s*\*\s?/, '').trim()).find(line => / - /.test(line))?.split(' - ').slice(1).join(' - ').trim() ?? ''
      const bodySchema = /zValidator\('json',\s*(\w+)/.exec(rest)?.[1] ?? (method === 'get' ? undefined : /\b(\w+Schema)\.(?:safeParse|parse)\(/.exec(handler)?.[1])
      const querySchema = /zValidator\('query',\s*(\w+)/.exec(rest)?.[1]
      routes.push({ method: method.toUpperCase(), path, summary, tag: file, ...(querySchema ? { query: schemaText(text, querySchema) } : {}), ...(bodySchema ? { body: schemaText(text, bodySchema) } : {}) })
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}
