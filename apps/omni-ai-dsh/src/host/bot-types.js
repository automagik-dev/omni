// The Bot types the team step offers, as this DSH has them. Omni comes as three DSH
// plugins: the desktop app ships them, a plain DSH installs them when Omni is switched on,
// through DSH's own plugin manager (the same installBundle its Plugins page runs). What a
// type starts with (its model, plugins, tools, skills, folder and permissions) is read
// from the live services where they run, and from this list where they do not yet.
import { readFileSync } from 'node:fs'
import { BotTypePayload, parse } from './payloads.js'

const PKG = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

// The Omni plugins, in install order: each one after the first needs the ones before it.
// `dir` is each one's folder beside this plugin's own in the Omni repository.
export const OMNI_PLUGINS = Object.freeze([
  { name: '@automagik/omni-dsh', dir: 'omni-ui-dsh', title: 'Omni team', what: 'Bots, their chats, memory and settings' },
  { name: '@automagik/omni-channels-dsh', dir: 'omni-channels-dsh', title: 'Omni channels', what: 'Your channels and the chats on them' },
  { name: '@automagik/omni-canvas-dsh', dir: 'omni-canvas-dsh', title: 'Omni canvases', what: 'Live views drawn in the chat' },
])

// The tools the Omni plugins register (omni-channels-dsh src/host/omni-api.js, omni-canvas-dsh
// src/host/canvas.js), grouped by what the person can switch. `read` is what Omni is for,
// so it stays on; `computer` is DSH's own shell and file tools, which Omni starts without.
export const OMNI_TOOLS = Object.freeze([
  { id: 'read', label: 'Read channels and chats', tools: ['omni_channels', 'omni_chats', 'omni_messages'], on: true, locked: true },
  { id: 'send', label: 'Send, react and delete', detail: 'Asks you before it writes to a person', tools: ['omni_send', 'omni_react', 'omni_media', 'omni_delete'], on: true },
  { id: 'connect', label: 'Connect a channel', detail: 'Shows the QR code to scan', tools: ['omni_connect'], on: true },
  { id: 'api', label: 'Any Omni operation', detail: 'Finds and runs the rest of Omni\'s API', tools: ['omni_endpoints', 'omni_call'], on: true },
  { id: 'canvases', label: 'Live canvases', tools: ['show_canvas'], on: true },
  { id: 'computer', label: 'Shell and files', detail: 'DSH\'s own tools; one-off work goes to Tasks', tools: ['bash', 'read', 'write', 'edit'], on: false },
])

const failure = (code, message) => Object.assign(new Error(message), { code })
const refused = message => failure('omni-ai/refused', message)
const invalid = message => failure('omni-ai/invalid', message)

const service = (ctx, name) => {
  try {
    return ctx.get?.(name) ?? undefined
  } catch {
    return undefined
  }
}
const quietly = async (read, fallback) => {
  try {
    return (await read()) ?? fallback
  } catch {
    return fallback
  }
}
const tilde = path => path.replace(/^\/(?:home|Users)\/[^/]+(?=\/)/, '~')

// What installs one Omni plugin: the source this plugin came from, pointed at its sibling
// (a git commit's path, or a linked checkout), so all of them are one release; else that
// release from the registry.
export function installTargetOf(plugin, ownSource, version = PKG.version) {
  const own = 'apps/omni-ai-dsh'
  if (typeof ownSource === 'string' && ownSource.includes(own)) return { spec: ownSource.replace(own, `apps/${plugin.dir}`), options: {} }
  return { spec: `${plugin.name}@${version}`, options: { saveExact: true } }
}

const resultProblem = (result) => {
  if (result?.error) return result.error.diagnostic ?? result.error.code
  if (!['applied', 'restart-required'].includes(result?.application)) return `install ${result?.application ?? 'failed'}`
  return null
}

export function createBotTypeActions(ctx, { team, omniProjectOf }) {
  const manager = () => service(ctx, 'pluginManager')
  // `{ phase, current, done, error, restart }` once an install started.
  let job = null

  async function bundles() {
    const rows = await quietly(() => manager()?.listBundles?.(), null)
    return Array.isArray(rows) ? rows : null
  }

  async function plugins() {
    const rows = await bundles()
    return OMNI_PLUGINS.map((plugin) => {
      const row = rows?.find(bundle => bundle.name === plugin.name)
      return {
        name: plugin.name,
        title: plugin.title,
        what: plugin.what,
        version: row?.version ?? null,
        installed: rows === null ? null : row !== undefined && row.availability !== 'missing',
        enabled: row?.enabled ?? null,
      }
    })
  }

  // Ready: the Omni team service runs here (the page then finds the channels' endpoints on
  // its own route). A DSH without a plugin manager reports what runs.
  async function status() {
    // The install as it was before the listing, so a finished one never shows stale rows.
    const install = job === null ? null : { ...job, done: [...job.done] }
    const rt = team()
    const list = await plugins()
    const running = rt !== undefined
    const installed = list.every(row => row.installed === true && row.enabled !== false)
    return {
      plugins: list,
      ready: running && (installed || list.some(row => row.installed === null)),
      installed: list.some(row => row.installed === null) ? running : installed,
      canInstall: typeof manager()?.installBundle === 'function',
      version: PKG.version,
      install,
    }
  }

  async function runInstall() {
    const service = manager()
    const rows = await bundles() ?? []
    const ownSource = rows.find(bundle => bundle.name === PKG.name)?.source
    for (const plugin of OMNI_PLUGINS) {
      const row = rows.find(bundle => bundle.name === plugin.name)
      const present = row !== undefined && row.availability !== 'missing'
      if (present && row.enabled !== false) {
        job.done.push(plugin.name)
        continue
      }
      job.current = plugin.name
      let result
      if (present) result = await service.setBundleEnabled(plugin.name, true)
      else {
        const target = installTargetOf(plugin, ownSource)
        result = await service.installBundle(target.spec, { enabled: true, ...target.options })
      }
      const problem = resultProblem(result)
      if (problem !== null) throw new Error(`${plugin.title}: ${problem}`)
      if (result.application === 'restart-required') job.restart = true
      job.done.push(plugin.name)
    }
    job.current = null
    job.phase = job.restart ? 'restart' : 'done'
  }

  function startInstall() {
    if (job?.phase === 'installing') return
    if (typeof manager()?.installBundle !== 'function') throw refused('This DSH has no plugin manager to install Omni with. Add the Omni plugins on its Plugins page, then come back.')
    job = { phase: 'installing', current: null, done: [], error: null, restart: false }
    const running = job
    void runInstall().catch((error) => {
      ctx.logger?.warn?.('omni-ai: installing the Omni plugins failed: %s', error?.message ?? error)
      Object.assign(running, { phase: 'failed', current: null, error: String(error?.message ?? error) })
    })
  }

  // The DSH default model, and its thinking level, which a new Bot is offered first.
  async function model() {
    const chosen = await quietly(() => service(ctx, 'agentDefaultModel')?.currentSelection?.(), undefined)
    if (!chosen?.provider || !chosen?.model) return { ref: null, thinking: null }
    const info = await quietly(() => service(ctx, 'llm')?.resolveModelInfo?.(chosen.provider, chosen.model), undefined)
    const effortId = info?.reasoning?.defaultEffort
    const effort = (info?.reasoning?.efforts ?? []).find(row => row.id === effortId)
    return { ref: `${chosen.provider}/${chosen.model}`, name: info?.name ?? chosen.model, thinking: effort?.name ?? effortId ?? null }
  }

  // The tools served in this DSH now, by name, or null before the Omni plugins run.
  function servedTools() {
    const tools = service(ctx, 'tools')
    try {
      const schemas = tools?.schemas?.()
      return Array.isArray(schemas) ? new Set(schemas.map(schema => schema?.name)) : null
    } catch {
      return null
    }
  }

  async function skills(cwd) {
    const rows = await quietly(() => service(ctx, 'skills')?.list?.(cwd ? { cwd } : {}), [])
    return (Array.isArray(rows) ? rows : []).slice(0, 12).map(skill => ({ id: skill.name, label: skill.name, detail: typeof skill.description === 'string' ? skill.description.slice(0, 120) : undefined }))
  }

  async function permission() {
    const catalog = await quietly(() => service(ctx, 'permissionPresets')?.catalog?.(), null)
    if (!catalog) return null
    const option = (catalog.options ?? []).find(row => row.value === catalog.defaultPreset)
    return option?.name ?? catalog.defaultPreset ?? null
  }

  // Omni's preloaded setup, group by group, with a switch where it is the person's to set.
  async function omniType() {
    const rt = team()
    const [pluginRows, modelInfo, preset] = await Promise.all([plugins(), model(), permission()])
    const project = rt === undefined ? undefined : await quietly(() => omniProjectOf(rt), undefined)
    const served = servedTools()
    const skillRows = await skills(project)
    return {
      type: 'omni',
      groups: [
        { id: 'model', label: 'Model', rows: [
          { id: 'model', label: modelInfo.ref ? modelInfo.name : 'Your DSH default', detail: modelInfo.ref ? `${modelInfo.ref} · you confirm it in Omni's first chat` : 'You pick it in Omni\'s first chat' },
          { id: 'thinking', label: 'Thinking', detail: modelInfo.thinking ?? 'The model\'s default' },
        ] },
        { id: 'plugins', label: 'Plugins', rows: pluginRows.map(row => ({
          id: row.name, label: row.title, detail: row.what,
          version: row.version ?? (row.installed === false ? PKG.version : null),
          installed: row.installed,
        })) },
        { id: 'tools', label: 'Tools', rows: OMNI_TOOLS.map(group => ({
          id: group.id, label: group.label, detail: group.detail, tools: group.tools,
          on: group.on, locked: group.locked === true,
          ...(served && group.id !== 'computer' ? { served: group.tools.some(name => served.has(name)) } : {}),
        })) },
        { id: 'skills', label: 'Skills', rows: skillRows, empty: 'None preloaded. Skills you add to DSH, or teach Omni later, show here.' },
        { id: 'setup', label: 'Setup', rows: [
          { id: 'folder', label: 'Folder', ...(project ? { detail: tilde(project), path: true } : { detail: 'Its own, in your team workspace' }) },
          { id: 'permission', label: 'Permissions', detail: preset ? `${preset} (DSH's default)` : 'DSH\'s default' },
        ] },
      ],
    }
  }

  return {
    'omni-plugins': () => status(),
    async 'omni-plugins-install'() {
      startInstall()
      return status()
    },
    async 'bot-type'(payload) {
      const fields = parse(BotTypePayload, payload)
      if (fields === undefined) throw invalid('Name a Bot type.')
      return omniType()
    },
  }
}
