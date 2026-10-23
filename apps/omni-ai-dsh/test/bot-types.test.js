import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { install } from '../src/host/endpoint.js'
import { OMNI_PLUGINS, OMNI_TOOLS, installTargetOf } from '../src/host/bot-types.js'
import { fakeContext } from './fake-ctx.js'

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const noClaude = async () => ({ plugin: false, installed: false, loggedIn: false })
const OWN_LINK = 'link:/home/someone/omni/apps/omni-ai-dsh'

// DSH's plugin manager, as far as the team step uses it: a profile's bundles, and installs
// that add one (after `settle`, so a test sees the install while it runs).
function fakeManager({ bundles = [{ name: PKG.name, availability: 'profile', enabled: true, source: OWN_LINK, version: PKG.version }], answer = () => ({ application: 'applied', changed: true }) } = {}) {
  const calls = []
  let release = () => {}
  const gate = { held: false }
  const manager = {
    calls,
    bundles,
    hold() {
      gate.held = true
      return () => { gate.held = false; release() }
    },
    async listBundles() { return structuredClone(bundles) },
    async installBundle(spec, options) {
      calls.push(['install', spec, options])
      if (gate.held) await new Promise((resolve) => { release = resolve })
      const plugin = OMNI_PLUGINS.find(row => spec.includes(row.dir) || spec.startsWith(row.name))
      const result = answer(plugin)
      if (result.application === 'applied' || result.application === 'restart-required') bundles.push({ name: plugin.name, availability: 'profile', enabled: true, version: PKG.version })
      return result
    },
    async setBundleEnabled(name, enabled) {
      calls.push(['enable', name, enabled])
      bundles.find(row => row.name === name).enabled = enabled
      return { application: 'applied', changed: true }
    },
  }
  return manager
}

function host({ manager, team, services = {} } = {}) {
  const fake = fakeContext({ entries: { 'omni-ai': {} }, services: { ...(manager ? { pluginManager: manager } : {}), ...(team ? { omniTeam: team } : {}), ...services } })
  const { handle } = install(fake.ctx, { checkClaude: noClaude })
  return { ...fake, handle }
}
const value = async (fake, endpoint, payload) => {
  const reply = await fake.handle(endpoint, payload)
  assert.equal(reply.ok, true, JSON.stringify(reply.error))
  return reply.value
}
const settle = async (fake) => {
  for (let i = 0; i < 50; i++) {
    const status = await value(fake, 'omni-plugins')
    if (status.install?.phase !== 'installing') return status
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('the install never finished')
}

test('each Omni plugin installs from the source this plugin came from, else its release', () => {
  const [team, channels] = OMNI_PLUGINS
  assert.deepEqual(installTargetOf(channels, OWN_LINK), { spec: 'link:/home/someone/omni/apps/omni-channels-dsh', options: {} })
  const git = 'git+https://github.com/automagik-dev/omni.git#21bcd8f&path:/apps/omni-ai-dsh'
  assert.equal(installTargetOf(team, git).spec, 'git+https://github.com/automagik-dev/omni.git#21bcd8f&path:/apps/omni-ui-dsh')
  assert.deepEqual(installTargetOf(team, '2.261023.28', '2.261023.28'), { spec: '@automagik/omni-dsh@2.261023.28', options: { saveExact: true } })
  assert.deepEqual(installTargetOf(team, undefined, '2.1.0'), { spec: '@automagik/omni-dsh@2.1.0', options: { saveExact: true } })
})

test('a plain DSH reports the Omni plugins missing, and installs them in order through its plugin manager', async () => {
  const manager = fakeManager()
  const fake = host({ manager })
  const before = await value(fake, 'omni-plugins')
  assert.equal(before.ready, false)
  assert.equal(before.installed, false)
  assert.equal(before.canInstall, true)
  assert.deepEqual(before.plugins.map(row => [row.name, row.installed]), OMNI_PLUGINS.map(plugin => [plugin.name, false]))

  const release = manager.hold()
  const started = await value(fake, 'omni-plugins-install')
  assert.equal(started.install.phase, 'installing')
  // A second press while it runs starts nothing new, and shows which one installs now.
  assert.equal((await value(fake, 'omni-plugins-install')).install.current, '@automagik/omni-dsh')
  release()
  const after = await settle(fake)
  assert.equal(after.install.phase, 'done')
  assert.deepEqual(after.install.done, OMNI_PLUGINS.map(plugin => plugin.name))
  assert.deepEqual(manager.calls, OMNI_PLUGINS.map(plugin => ['install', `link:/home/someone/omni/apps/${plugin.dir}`, { enabled: true }]))
  assert.equal(after.installed, true)
})

test('installed but switched-off plugins are switched on, installed ones are left alone', async () => {
  const bundles = [
    { name: PKG.name, availability: 'profile', enabled: true, source: OWN_LINK },
    { name: '@automagik/omni-dsh', availability: 'installation', enabled: true, version: '2.0.0' },
    { name: '@automagik/omni-channels-dsh', availability: 'installation', enabled: false, version: '2.0.0' },
  ]
  const manager = fakeManager({ bundles })
  const fake = host({ manager })
  await value(fake, 'omni-plugins-install')
  await settle(fake)
  assert.deepEqual(manager.calls, [['enable', '@automagik/omni-channels-dsh', true], ['install', 'link:/home/someone/omni/apps/omni-canvas-dsh', { enabled: true }]])
})

test('an install the manager refuses fails with its reason; one that needs a restart says so', async () => {
  const refused = host({ manager: fakeManager({ answer: () => ({ application: 'failed', error: { code: 'operation-error', diagnostic: 'pnpm could not reach the registry' } }) }) })
  await value(refused, 'omni-plugins-install')
  const failed = await settle(refused)
  assert.equal(failed.install.phase, 'failed')
  assert.match(failed.install.error, /Omni team: pnpm could not reach the registry/)

  const restart = host({ manager: fakeManager({ answer: () => ({ application: 'restart-required', restartReason: 'no-hmr' }) }) })
  await value(restart, 'omni-plugins-install')
  assert.equal((await settle(restart)).install.phase, 'restart')

  const none = host()
  assert.equal((await none.handle('omni-plugins-install')).error.code, 'omni-ai/refused')
})

test('the desktop app, which runs the Omni plugins, is ready at once', async () => {
  const team = { omniDiscoverEndpoint: () => {}, teamFolder: () => '/home/someone/.omni/team', async load() {} }
  const bundles = [{ name: PKG.name, availability: 'installation', enabled: true }, ...OMNI_PLUGINS.map(plugin => ({ name: plugin.name, availability: 'installation', enabled: true, version: '2.261023.28' }))]
  const status = await value(host({ manager: fakeManager({ bundles }), team }), 'omni-plugins')
  assert.equal(status.ready, true)
  assert.equal(status.installed, true)
  assert.deepEqual(status.plugins.map(row => row.version), ['2.261023.28', '2.261023.28', '2.261023.28'])
})

test('Omni\'s Bot type lists its model, plugins, tools, skills and setup from this DSH', async () => {
  const team = { omniDiscoverEndpoint: () => {}, teamFolder: () => '/home/someone/.omni/team', async load() {} }
  const bundles = [{ name: PKG.name, availability: 'profile', enabled: true }, { name: '@automagik/omni-dsh', availability: 'profile', enabled: true, version: '2.261023.28' }]
  const services = {
    agentDefaultModel: { currentSelection: () => ({ provider: 'juice', model: 'gpt-5.5' }) },
    llm: { resolveModelInfo: async () => ({ name: 'GPT-5.5', reasoning: { defaultEffort: 'medium', efforts: [{ id: 'medium', name: 'Medium' }] } }) },
    tools: { schemas: () => [{ name: 'omni_channels' }, { name: 'omni_chats' }, { name: 'show_canvas' }] },
    skills: { list: async ({ cwd }) => (cwd === '/home/someone/.omni/team/omni' ? [{ name: 'channel-triage', description: 'Sort a busy chat' }] : []) },
    permissionPresets: { catalog: () => ({ options: [{ value: 'ask', name: 'Ask first' }], defaultPreset: 'ask' }) },
  }
  const type = await value(host({ manager: fakeManager({ bundles }), team, services }), 'bot-type', { type: 'omni' })
  const group = id => type.groups.find(row => row.id === id)
  assert.deepEqual(type.groups.map(row => row.id), ['model', 'plugins', 'tools', 'skills', 'setup'])
  assert.equal(group('model').rows[0].label, 'GPT-5.5')
  assert.match(group('model').rows[0].detail, /^juice\/gpt-5\.5/)
  assert.equal(group('model').rows[1].detail, 'Medium')
  assert.deepEqual(group('plugins').rows.map(row => [row.label, row.version]), [['Omni team', '2.261023.28'], ['Omni channels', PKG.version], ['Omni canvases', PKG.version]])
  const tools = Object.fromEntries(group('tools').rows.map(row => [row.id, row]))
  assert.equal(tools.read.locked, true)
  assert.equal(tools.read.served, true)
  assert.equal(tools.send.served, false)
  assert.equal(tools.canvases.served, true)
  assert.equal(tools.computer.on, false)
  assert.deepEqual(group('skills').rows, [{ id: 'channel-triage', label: 'channel-triage', detail: 'Sort a busy chat' }])
  assert.deepEqual(group('setup').rows.map(row => row.detail), ['~/.omni/team/omni', 'Ask first (DSH\'s default)'])
  assert.equal(group('setup').rows[0].path, true)
})

test('without the Omni plugins the Bot type still lists what Omni brings', async () => {
  const type = await value(host(), 'bot-type', { type: 'omni' })
  const tools = type.groups.find(row => row.id === 'tools').rows
  assert.deepEqual(tools.map(row => row.id), OMNI_TOOLS.map(row => row.id))
  assert.ok(tools.every(row => row.served === undefined))
  assert.equal(type.groups.find(row => row.id === 'model').rows[0].label, 'Your DSH default')
  assert.equal(type.groups.find(row => row.id === 'skills').rows.length, 0)
  assert.equal((await host().handle('bot-type', { type: 'robot' })).error.code, 'omni-ai/invalid')
})

test('the tools Omni lists are the ones its plugins register', () => {
  const sources = ['../../omni-channels-dsh/src/host/omni-api.js', '../../omni-canvas-dsh/src/host/canvas.js']
    .map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n')
  const registered = new Set([...sources.matchAll(/^\s+name: '([a-z_]+)',$/gm)].map(match => match[1]))
  const listed = OMNI_TOOLS.filter(row => row.id !== 'computer').flatMap(row => row.tools)
  assert.deepEqual([...registered].filter(name => !listed.includes(name)), [], 'a tool the Omni plugins register is missing from OMNI_TOOLS')
  assert.deepEqual(listed.filter(name => !registered.has(name)), [], 'OMNI_TOOLS names a tool no Omni plugin registers')
  const names = OMNI_PLUGINS.map(plugin => JSON.parse(readFileSync(new URL(`../../${plugin.dir}/package.json`, import.meta.url), 'utf8')).name)
  assert.deepEqual(names, OMNI_PLUGINS.map(plugin => plugin.name))
})
