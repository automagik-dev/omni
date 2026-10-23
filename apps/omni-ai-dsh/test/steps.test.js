import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The client modules, with a React that records elements instead of rendering them.
async function load(file) {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL(`../src/client/${file}`, import.meta.url))],
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', 'react-dom'],
    loader: { '.css': 'text' },
  })
  const module = { exports: {} }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {}, useRef: current => ({ current }), useCallback: fn => fn,
  }
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, URL, setTimeout, clearTimeout, require: name => ({ react, 'react-dom': { createPortal: node => node } })[name] })
  return module.exports
}
// Values made inside the vm compare by shape, not by realm.
const plain = value => JSON.parse(JSON.stringify(value))

const { gate, finish, finishInto, FLAG_OF, announceStep, railSteps } = await load('stage.js')

function recorder(state = {}) {
  const log = []
  const request = async (endpoint, payload) => {
    log.push(payload === undefined ? endpoint : `${endpoint} ${JSON.stringify(payload)}`)
    return endpoint === 'state' ? state : { ok: true }
  }
  const props = stepId => ({ stepId, complete: () => log.push('complete'), openSection: id => log.push(`open ${id}`) })
  return { log, request, props }
}

test('a step whose done flag is set completes at once and shows nothing', async () => {
  for (const [stepId, flag] of Object.entries(FLAG_OF)) {
    const { log, request, props } = recorder({ [flag]: true })
    assert.equal(await gate(props(stepId), request), null)
    assert.deepEqual(log, ['state', 'complete'])
  }
})

test('a step shows when its flag is unset, or when the user reopened it', async () => {
  const fresh = recorder({ companionDone: false, aiConnected: true })
  assert.deepEqual(plain(await gate(fresh.props('omni-companion'), fresh.request)), { companionDone: false, aiConnected: true })
  assert.deepEqual(fresh.log, ['state'])

  const reopened = recorder({ companionDone: true })
  assert.deepEqual(plain(await gate({ ...reopened.props('omni-companion'), explicit: true }, reopened.request)), { companionDone: true })
  assert.deepEqual(reopened.log, ['state'])

  const offline = recorder()
  assert.deepEqual(plain(await gate(offline.props('omni-connect-ai'), async () => { throw new Error('down') })), {})
})

test('finishing writes the flag, then completes; a tile completes before it opens a section', async () => {
  const done = recorder()
  await finish(done.props('omni-team'), done.request)
  assert.deepEqual(done.log, ['done {"stepId":"omni-team"}', 'complete'])

  const tile = recorder()
  await finishInto(tile.props('omni-connect-ai'), 'models', tile.request)
  assert.deepEqual(tile.log, ['done {"stepId":"omni-connect-ai"}', 'complete', 'open models'])

  const failing = recorder()
  await finish(failing.props('omni-companion'), async () => { throw new Error('down') })
  assert.deepEqual(failing.log, ['complete'])
})

test('Connect AI is a list of switches: found first, then 4 more and the rest on demand', async () => {
  const { sections, onCount, flipAction, FIRST_OTHERS } = await load('connect-ai.js')
  const rows = [
    { id: 'claude', found: 'Signed in to Claude Code', ready: true, on: true },
    { id: 'chatgpt', found: null, ready: false, on: false },
    { id: 'deepseek', found: 'DEEPSEEK_API_KEY found', ready: true, on: true },
    { id: 'openai', found: null, ready: true, on: true },
    { id: 'kimi', found: null, ready: true, on: false },
  ]
  const { found, others } = plain(sections(rows))
  // On rows count as found: they are what this computer already uses.
  assert.deepEqual(found.map(row => row.id), ['claude', 'deepseek', 'openai'])
  assert.deepEqual(others.map(row => row.id), ['chatgpt', 'kimi'])
  assert.equal(FIRST_OTHERS, 4)
  assert.equal(onCount(rows), 3)
  // Flipping: off when on, on when set up, else open its setup in place.
  assert.deepEqual(rows.map(flipAction), ['off', 'setup', 'off', 'off', 'on'])
})

test('Continue needs one AI really on; Skip always finishes', async () => {
  const { onCount } = await load('connect-ai.js')
  assert.equal(onCount([{ on: false }, { on: false }]), 0)
  assert.equal(onCount([]), 0)
  assert.equal(onCount([{ on: false }, { on: true }]), 1)
})

test('every row that signs in names its own provider; Claude never signs in, keys say where to get one', async () => {
  const { PROVIDER_OF, LOGOS } = await load('connect-ai.js')
  const providers = plain(PROVIDER_OF)
  assert.equal(providers.claude, undefined)
  assert.deepEqual([providers.chatgpt, providers.kimi, providers.copilot, providers.grok], ['openai-codex', 'kimi-coding', 'github-copilot', 'xai'])
  assert.ok(!Object.values(providers).includes('claude'))
  assert.equal(typeof plain(LOGOS).claude, 'string')
})

test('the rail names only the steps this DSH has: Connect Omni only with the plugin that brings it', () => {
  const scope = {}
  const labels = current => plain(railSteps(current, scope).map(([, label]) => label))
  for (const id of ['omni-companion', 'omni-team', 'omni-connect-ai']) announceStep(id, scope)
  assert.deepEqual(labels('omni-companion'), ['Your companion', 'Your team', 'Connect AI'])
  const leave = announceStep('omni-connect', scope)
  assert.deepEqual(labels('omni-connect-ai'), ['Your companion', 'Your team', 'Connect Omni', 'Connect AI'])
  leave()
  assert.deepEqual(labels('omni-connect-ai'), ['Your companion', 'Your team', 'Connect AI'])
  // A step that never announced itself still shows where it is.
  assert.deepEqual(plain(railSteps('omni-connect', {}).map(([id]) => id)), ['omni-connect'])
})

test('a subscription takes the next free account slot; only vendors nothing else covers are offered', async () => {
  const { nextIndex, signedInCount, SUBSCRIPTION_TILES } = await load('subscriptions.js')
  const { subscriptionRows } = await load('connect-ai.js')
  const accounts = [
    { provider: 'kiro', index: 1, configured: true },
    { provider: 'kiro', index: 2, configured: false },
    { provider: 'cursor', index: 1, configured: true },
    { provider: 'cursor', index: 3, configured: true },
  ]
  assert.equal(nextIndex(accounts, 'kiro'), 2)
  assert.equal(nextIndex(accounts, 'cursor'), 4)
  assert.equal(nextIndex(accounts, 'glm'), 1)
  assert.equal(nextIndex(null, 'glm'), 1)
  assert.equal(signedInCount(accounts, 'cursor'), 2)
  // Claude, ChatGPT, Kimi, Copilot and Grok each have their own row: never offered twice.
  const ids = plain(SUBSCRIPTION_TILES).map(tile => tile.provider)
  for (const id of ['claude', 'codex', 'kimi', 'copilot', 'grok', 'ollama', 'openai-codex', 'kimi-coding', 'anthropic']) assert.ok(!ids.includes(id), id)
  // A row per vendor, on when signed in and not hidden.
  const rows = plain(subscriptionRows({ accounts: [{ provider: 'cursor', index: 1 }, { provider: 'cursor', index: 3 }, { provider: 'kiro', index: 1 }], hidden: ['kiro'] }))
  const by = Object.fromEntries(rows.map(row => [row.tile.provider, row]))
  assert.deepEqual([by.cursor.on, by.cursor.found], [true, '2 accounts'])
  assert.deepEqual([by.kiro.on, by.kiro.ready], [false, true])
  assert.deepEqual([by.glm.on, by.glm.ready, by.glm.found], [false, false, null])
  assert.deepEqual(plain(subscriptionRows(null)), [])
})

// Expands function components, so a test reads the elements a card really draws.
function render(node) {
  if (Array.isArray(node)) return node.map(render)
  if (node === null || typeof node !== 'object') return node
  if (typeof node.type === 'function') return render(node.type({ ...node.props, children: node.children }))
  return { ...node, children: node.children.map(render) }
}
function findAll(node, match, out = []) {
  if (Array.isArray(node)) node.forEach(child => findAll(child, match, out))
  else if (node && typeof node === 'object') {
    if (match(node)) out.push(node)
    node.children.forEach(child => findAll(child, match, out))
  }
  return out
}
const textOf = node => (Array.isArray(node) ? node.map(textOf).join('') : node && typeof node === 'object' ? textOf(node.children) : node === null || node === undefined || node === false ? '' : String(node))
const byClass = name => node => String(node?.props?.className ?? '').split(' ').includes(name)

const team = await load('team.js')

// The host as the card calls it: omni-ai (plugins) and the Omni plugins' endpoint (omni-ui).
function powerHost({ plugins = { ready: true }, polls = [], install, link = { linked: false }, omnis = [] } = {}) {
  const calls = []
  const omniAi = async (endpoint) => {
    calls.push(endpoint)
    if (endpoint === 'omni-plugins-install') {
      if (install instanceof Error) throw install
      return install
    }
    return polls.length > 0 ? polls.shift() : plugins
  }
  const omniUi = async (endpoint) => {
    calls.push(endpoint)
    return endpoint === 'omni-link' ? link : { omnis, sandbox: { home: '/home/someone/.omni/sandbox' } }
  }
  const shown = []
  const waits = []
  const show = (phase, detail) => shown.push(detail === undefined ? phase : [phase, plain(detail)])
  const wait = async (ms) => { waits.push(ms) }
  return { calls, shown, waits, run: (options = {}) => team.powerOn({ show, omniAi, omniUi, wait, quick: false, ...options }) }
}
const phases = shown => shown.map(entry => (Array.isArray(entry) ? entry[0] : entry))

test('power on, with the Omni plugins here: Omni wakes and looks, and offers what it found', async () => {
  const omni = { id: 'cli:default', url: 'http://127.0.0.1:8882', local: true, hasKey: true, version: '2.261023.28' }
  const fake = powerHost({ omnis: [omni] })
  assert.equal(await fake.run(), 'found')
  assert.deepEqual(phases(fake.shown), ['waking', 'looking', 'found'])
  assert.deepEqual(fake.calls, ['omni-plugins', 'omni-link', 'omni-discover'])
  assert.deepEqual(fake.shown.at(-1)[1].omnis, [omni])
  assert.equal(fake.waits[0], team.WAKE_MS)
})

test('power on, in a plain DSH: the Omni plugins install first, with their progress, then Omni looks', async () => {
  const rows = [{ name: '@automagik/omni-dsh', title: 'Omni team', installed: false }]
  const installing = { ready: false, plugins: rows, install: { phase: 'installing', current: '@automagik/omni-dsh', done: [] } }
  const fake = powerHost({
    plugins: { ready: false, plugins: rows, install: null },
    install: installing,
    polls: [{ ready: false, plugins: rows, install: null }, installing, { ready: false, plugins: rows, install: { phase: 'done', done: ['@automagik/omni-dsh'] } }, { ready: true, plugins: rows, install: { phase: 'done', done: ['@automagik/omni-dsh'] } }],
  })
  assert.equal(await fake.run(), 'none')
  assert.deepEqual(phases(fake.shown), ['waking', 'installing', 'installing', 'installing', 'installing', 'looking', 'none'])
  assert.deepEqual(fake.calls, ['omni-plugins', 'omni-plugins-install', 'omni-plugins', 'omni-plugins', 'omni-plugins', 'omni-link', 'omni-discover'])
  assert.equal(fake.shown.at(-1)[1].sandbox.home, '/home/someone/.omni/sandbox')
})

test('power on ends at linked, restart or failed when that is where it stands', async () => {
  const linked = powerHost({ link: { linked: true, origin: 'omni.example.com' } })
  assert.equal(await linked.run(), 'linked')
  assert.deepEqual(linked.shown.at(-1), ['linked', { origin: 'omni.example.com' }])
  assert.ok(!linked.calls.includes('omni-discover'))

  const refused = powerHost({ plugins: { ready: false }, install: new Error('This DSH has no plugin manager to install Omni with.') })
  assert.equal(await refused.run(), 'failed')
  assert.match(refused.shown.at(-1)[1].message, /no plugin manager/)

  const failed = powerHost({ plugins: { ready: false }, install: { ready: false, install: { phase: 'failed', error: 'Omni team: offline' } } })
  assert.equal(await failed.run(), 'failed')
  assert.equal(failed.shown.at(-1)[1].message, 'Omni team: offline')

  // Installed and ready, yet the channels' route is not served yet.
  const omniUi = async () => { throw Object.assign(new Error('DSH answered HTTP 404'), { code: 'HTTP_404' }) }
  assert.equal(await team.powerOn({ show: () => {}, omniAi: async () => ({ ready: true }), omniUi, wait: async () => {}, quick: true }), 'restart')

  const restart = powerHost({ plugins: { ready: false }, install: { ready: false, install: { phase: 'restart', done: [] } } })
  assert.equal(await restart.run(), 'restart')

  // Installed, yet the plugins never came up: a restart is asked, not an endless wait.
  const stuck = powerHost({ plugins: { ready: false, install: { phase: 'done', done: [] } }, install: { ready: false, install: { phase: 'done', done: [] } } })
  assert.equal(await stuck.run(), 'restart')
  assert.equal(stuck.calls.filter(call => call === 'omni-plugins').length, 1 + team.READY_POLLS)
})

test('power off mid-way stops the run: nothing after it is shown', async () => {
  const controller = new AbortController()
  const fake = powerHost()
  const wait = async () => { controller.abort() }
  await assert.rejects(fake.run({ signal: controller.signal, wait }), { name: 'AbortError' })
  assert.deepEqual(phases(fake.shown), ['waking'])
  assert.deepEqual(fake.calls, [])
})

test('reduced motion skips the waking and looking pauses', async () => {
  const fake = powerHost({ omnis: [] })
  await fake.run({ quick: true })
  assert.ok(fake.waits.every(ms => ms === 0), JSON.stringify(fake.waits))
  const css = (await load('onboard-css.js')).ONBOARD_CSS
  const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
  for (const name of ['.oai-zzz i', '.oai-scan i', '.oai-power', '.oai-eyes', '.oai-octo-wrap .oai-octo']) assert.ok(reduced.includes(name), `${name} keeps moving under reduced motion`)
})

const omniType = {
  type: 'omni',
  groups: [
    { id: 'model', label: 'Model', rows: [{ id: 'model', label: 'GPT-5.5', detail: 'juice/gpt-5.5' }, { id: 'thinking', label: 'Thinking', detail: 'Medium' }] },
    { id: 'plugins', label: 'Plugins', rows: [{ id: '@automagik/omni-dsh', label: 'Omni team', version: '2.261023.28', installed: true }, { id: '@automagik/omni-canvas-dsh', label: 'Omni canvases', version: '2.261023.28', installed: false }] },
    { id: 'tools', label: 'Tools', rows: [{ id: 'read', label: 'Read channels and chats', tools: ['omni_channels'], on: true, locked: true }, { id: 'send', label: 'Send, react and delete', tools: ['omni_send'], on: true }, { id: 'computer', label: 'Shell and files', tools: ['bash'], on: false }] },
    { id: 'skills', label: 'Skills', rows: [], empty: 'None preloaded.' },
    { id: 'setup', label: 'Setup', rows: [{ id: 'folder', label: 'Folder', detail: '~/.omni/team/omni' }] },
  ],
}

test('the capability list is the Bot type\'s groups, with a switch only where it is tunable', () => {
  const toggles = []
  const tree = render(team.Capabilities({ type: omniType, abilities: { send: false }, onToggle: (id, on) => toggles.push([id, on]) }))
  assert.deepEqual(findAll(tree, node => node.type === 'h3').map(textOf), ['Model', 'Plugins', 'Tools', 'Skills', 'Setup'])
  const cap = id => findAll(tree, node => node.props['data-cap'] === id)[0]
  assert.match(textOf(cap('model')), /GPT-5\.5/)
  assert.match(textOf(cap('@automagik/omni-dsh')), /v2\.261023\.28/)
  assert.match(textOf(cap('@automagik/omni-canvas-dsh')), /Installs when Omni powers on/)
  assert.match(textOf(cap('read')), /Always on/)
  const switches = findAll(tree, node => node.props.role === 'switch')
  assert.deepEqual(switches.map(node => node.props['aria-label']), ['Send, react and delete for this Bot', 'Shell and files for this Bot'])
  assert.deepEqual(switches.map(node => node.props['aria-checked']), [false, false])
  switches[0].props.onClick()
  assert.deepEqual(toggles, [['send', true]])
  assert.match(textOf(findAll(tree, byClass('oai-cap-group'))[3]), /None preloaded/)
  // No stat bars: nothing drawn is a 0-5 meter.
  assert.equal(findAll(tree, node => /oai-(bar|pip|stat)/.test(String(node.props.className ?? ''))).length, 0)
  assert.deepEqual(plain(team.abilitiesOf(omniType)), { read: true, send: true, computer: false })
  assert.equal(textOf(render(team.Capabilities({ type: null }))), 'Reading what it starts with…')
})

const card = (phase, detail = null, extra = {}, live = null) => render(team.OmniCard({ power: { phase, detail, busy: null, problem: null, use: () => {}, remote: () => {}, local: () => {}, cancelPairing: () => {}, ...extra }, onPower: () => {}, type: omniType, abilities: {}, onToggle: () => {}, live }))

test('the menu preview lists the linked Omni\'s real channels with their live dots', () => {
  const live = { configured: true, channels: [{ id: 'a', type: 'whatsapp-baileys', name: 'pessoal', status: 'connected' }, { id: 'b', type: 'telegram', name: 'bot', status: 'disconnected' }] }
  const tree = card('linked', { origin: 'omni.example.com' }, {}, live)
  const rows = findAll(tree, node => node.type === 'li' && node.children.some(child => byClass('oai-dot')(child)))
  assert.deepEqual(rows.map(textOf), ['WhatsApp · pessoal', 'Telegram · bot'])
  assert.deepEqual(rows.map(row => row.children[0].props.className), ['oai-dot ok', 'oai-dot warn'])
  // Its host only: no counts the overview cannot vouch for.
  assert.equal(textOf(findAll(tree, byClass('oai-linked'))[0]), 'Connected to omni.example.com')
  const reading = render(team.OmniCard({ power: { phase: 'asleep', detail: null }, onPower: () => {}, type: omniType, abilities: {}, live: undefined }))
  assert.match(textOf(reading), /Reading your Omni/)
})

test('a long folder is shortened in the middle', () => {
  assert.equal(team.shortPath('~/.omni/ui/workspace/omni'), '~/…/workspace/omni')
  assert.equal(team.shortPath('~/team/omni'), '~/team/omni')
  assert.equal(team.shortPath('/srv/omni/ui/workspace/omni'), '/…/workspace/omni')
})

test('Omni\'s card starts asleep: closed eyes, z z, dimmed, with a clear power button', () => {
  const asleep = card('asleep')
  assert.ok(byClass('oai-is-asleep')(asleep))
  assert.ok(!byClass('oai-chosen')(asleep))
  assert.equal(findAll(asleep, byClass('oai-zzz')).length, 1)
  assert.match(findAll(asleep, byClass('oai-octo-wrap'))[0].props.dangerouslySetInnerHTML.__html, /class="oai-closed"/)
  const [button] = findAll(asleep, byClass('oai-power'))
  assert.deepEqual([button.props['aria-pressed'], button.props['aria-label']], [false, 'Power Omni on'])
  assert.match(textOf(findAll(asleep, byClass('oai-status'))[0]), /Asleep/)
  assert.ok(findAll(asleep, node => node.props.role === 'switch').every(node => node.props.disabled === true))

  // No class title on the card, and no team line while it sleeps.
  assert.equal(findAll(asleep, byClass('oai-class')).length, 0)
  assert.equal(findAll(asleep, byClass('oai-team-line')).length, 0)
  const removed = card('asleep', { removed: true })
  assert.match(textOf(findAll(removed, byClass('oai-status'))[0]), /Not on your team/)

  const waking = card('waking')
  const [line] = findAll(waking, byClass('oai-team-line'))
  assert.match(textOf(line), /On your team/)
  assert.equal(textOf(findAll(line, byClass('oai-remove'))[0]), 'Remove')
  assert.ok(byClass('oai-chosen')(waking))
  assert.equal(findAll(waking, byClass('oai-zzz')).length, 0)
  assert.equal(findAll(waking, byClass('oai-power'))[0].props['aria-pressed'], true)
})

test('each phase draws its own body: installing, looking, found, none, linked, pairing', () => {
  const installing = card('installing', { plugins: { plugins: [{ name: 'a', title: 'Omni team' }, { name: 'b', title: 'Omni channels' }], install: { current: 'b', done: ['a'] } } })
  assert.deepEqual(findAll(installing, node => node.type === 'li' && /oai-install-/.test(node.props.className)).map(node => node.props.className), ['oai-install-done', 'oai-install-now'])
  assert.equal(findAll(installing, byClass('oai-power'))[0].props.disabled, true)

  const looking = card('looking')
  assert.equal(findAll(looking, byClass('oai-scan')).length, 1)
  assert.match(textOf(findAll(looking, byClass('oai-status'))[0]), /Looking for a connection/)

  const used = []
  const omnis = [
    { id: 'sandbox', source: 'sandbox', url: 'http://127.0.0.1:18882', local: true, hasKey: true, version: '2.261023.28' },
    { id: 'cli:work', url: 'https://omni.example.com', local: false, pairing: 'on' },
    { id: 'cli:old', url: 'http://127.0.0.1:8882', local: true, reachable: false },
  ]
  const found = card('found', { omnis }, { use: omni => used.push(omni.id) })
  const buttons = findAll(found, byClass('oai-pill-primary')).filter(node => node.type === 'button' && node.props.type === 'button')
  assert.deepEqual(buttons.map(textOf), ['Use it', 'Connect'])
  buttons[1].props.onClick()
  assert.deepEqual(used, ['cli:work'])
  assert.match(textOf(found), /Not answering right now/)

  const none = card('none', { sandbox: null })
  assert.ok(findAll(none, node => node.type === 'input' && node.props['aria-label'] === 'Omni address or link').length === 1)
  assert.match(textOf(none), /Run Omni on this computer/)

  assert.match(textOf(card('linked', { origin: 'omni.example.com' })), /Connected to omni\.example\.com/)
  assert.match(textOf(card('pairing', { pairing: { code: 'K7Q2-9M', origin: 'omni.example.com', waLink: 'https://wa.me/x' } })), /K7Q2-9M/)
})

test('a typed address or a link Omni sent reads the way the Connect Omni step reads it', () => {
  assert.deepEqual(plain(team.readRemote('https://omni.example.com/api/login/app?grant=abcdefghijklmnopqrstuvwx')), { kind: 'grant', url: 'https://omni.example.com', grant: 'abcdefghijklmnopqrstuvwx' })
  assert.deepEqual(plain(team.readRemote('omni://connect?url=https://omni.example.com&grant=abcdefghijklmnopqrstuvwx')), { kind: 'grant', url: 'https://omni.example.com', grant: 'abcdefghijklmnopqrstuvwx' })
  assert.deepEqual(plain(team.readRemote(' omni.example.com ')), { kind: 'address', url: 'omni.example.com' })
  assert.equal(team.readRemote('https://omni.example.com/?grant=short').kind, 'bad-link')
  assert.equal(team.readRemote('  '), null)
  assert.equal(team.channelLabel({ type: 'whatsapp-baileys' }), 'WhatsApp')
  assert.equal(team.foundChoice({ id: 'x', url: 'http://127.0.0.1:1', local: true, updateTo: '2.3.0' }).action, null)
})
