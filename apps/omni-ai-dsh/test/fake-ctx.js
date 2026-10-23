// A stand-in for the host plugin context: DSH's settings forms (describe/update with a
// revision and the same deep merge), the credential store, and the connection's fetch
// routes, all in memory. Nothing here starts a service.

// dsh-settings' mergeLayers: plain objects merge key by key, anything else replaces.
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export function mergeLayers(under, over) {
  if (!isPlain(under) || !isPlain(over)) return over
  const merged = { ...under }
  for (const [key, value] of Object.entries(over)) merged[key] = Object.hasOwn(merged, key) ? mergeLayers(merged[key], value) : value
  return merged
}

// `env` holds references DSH would read from the environment rather than its own store.
// `recordValues` are the stored records a plugin reads whole (a sign-in's grant), by key.
export function fakeContext({ entries = {}, credentials = {}, records = [], recordValues = {}, services = {}, env = {} } = {}) {
  const forms = new Map(Object.entries(entries).map(([ns, value]) => [ns, { value: structuredClone(value), revision: 3 }]))
  const secrets = new Map(Object.entries(credentials))
  const stored = new Set(records)
  const updates = []
  const routes = []
  const effects = []
  const logs = []
  const presentations = []
  const ctx = {
    fiber: { uid: 'omni-ai' },
    // Services looked up rather than injected (ctx.get), such as authorization.
    get: name => services[name],
    logger: { warn: (...args) => logs.push(args), info: (...args) => logs.push(args) },
    effect(execute, label) {
      effects.push(label)
      execute()
    },
    settings: {
      configure(presentation) {
        presentations.push(presentation)
        return () => {}
      },
      describe: () => [...forms].map(([ns, form]) => ({ ns, value: structuredClone(form.value), revision: form.revision, applies: 'live' })),
      async update(ns, patch, expectedRevision) {
        const form = forms.get(ns)
        if (form === undefined) throw new Error(`No configurable plugin entry "${ns}"`)
        if (expectedRevision !== undefined && expectedRevision !== form.revision) {
          throw Object.assign(new Error(`Settings for "${ns}" changed`), { code: 'SETTINGS_CONFLICT' })
        }
        updates.push({ ns, patch: structuredClone(patch), expectedRevision })
        form.value = mergeLayers(form.value, structuredClone(patch))
        form.revision += 1
      },
      // `set` and `unset` at a path, which is all the plugin writes.
      async mutate(ns, ops, expectedRevision) {
        const form = forms.get(ns)
        if (form === undefined) throw new Error(`No configurable plugin entry "${ns}"`)
        if (expectedRevision !== undefined && expectedRevision !== form.revision) {
          throw Object.assign(new Error(`Settings for "${ns}" changed`), { code: 'SETTINGS_CONFLICT' })
        }
        for (const op of ops) {
          if (op.op !== 'set' && op.op !== 'unset') throw new Error(`unsupported op ${op.op}`)
          let node = form.value
          for (const key of op.path.slice(0, -1)) node = node[key] ??= {}
          if (op.op === 'unset') delete node[op.path.at(-1)]
          else node[op.path.at(-1)] = structuredClone(op.value)
        }
        updates.push({ ns, ops: structuredClone(ops), expectedRevision })
        form.revision += 1
      },
    },
    credentials: {
      async set(ref, value) {
        if (typeof value !== 'string' || value === '') throw new Error('empty credential')
        secrets.set(ref, value)
      },
      async unset(ref) {
        secrets.delete(ref)
      },
      resolve: async ref => (secrets.has(ref) ? { value: secrets.get(ref), source: 'file' } : undefined),
      describe: async ref => (secrets.has(ref) ? { configured: true, source: 'file', writable: true } : Object.hasOwn(env, ref) ? { configured: true, source: 'env', writable: true } : { configured: false, writable: true }),
      describeRecord: async key => ({ configured: stored.has(key) || Object.hasOwn(recordValues, key), writable: true }),
      readRecord: async key => (Object.hasOwn(recordValues, key) ? structuredClone(recordValues[key]) : undefined),
    },
    connection: {
      fetch: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
    },
  }
  const valueOf = ns => structuredClone(forms.get(ns)?.value)
  return { ctx, secrets, updates, routes, effects, logs, presentations, valueOf }
}

// A gateway's GET /models, recording what it was asked.
export function fakeGateway({ status = 200, body = { data: [] } } = {}) {
  const requests = []
  const fetch = async (url, init) => {
    requests.push({ url: String(url), init })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
  return { fetch, requests }
}
