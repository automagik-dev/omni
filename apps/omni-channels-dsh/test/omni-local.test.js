import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { BUN_VERSION, downloadBun, findBun, install, installArgs, runInstall, sandboxKey, unzipEntry } from '../src/host/omni-local.js'
import { install as installLink, LINK_FILE } from '../src/host/omni-link.js'
import { PLUGIN_VERSION } from '../src/host/version.js'
import { install as installHooks } from '@automagik/bots-dsh/src/host/extend.js'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const SANDBOX_KEY = 'omni_sk_sandbox_secret'

function tempDir(t, name) {
  const dir = mkdtempSync(join(tmpdir(), name))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// A zip archive with deflated entries, laid out the way Bun's release zips are.
function zipOf(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of Object.entries(entries)) {
    const data = deflateRawSync(content)
    const nameBytes = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

test('Bun is looked for in BUN_INSTALL, then ~/.bun, then PATH, then the one this plugin downloaded', () => {
  const env = { BUN_INSTALL: '/opt/bun', PATH: ['relative/bin', '/usr/one', '/usr/two'].join(':') }
  const all = ['/opt/bun/bin/bun', '/h/.bun/bin/bun', '/usr/two/bun', '/h/.omni/runtime/bun/bun']
  const pick = present => findBun({ env, home: '/h', isExecutable: path => present.includes(path) })
  assert.equal(pick(all), '/opt/bun/bin/bun')
  assert.equal(pick(all.slice(1)), '/h/.bun/bin/bun')
  assert.equal(pick(all.slice(2)), '/usr/two/bun')
  assert.equal(pick(all.slice(3)), '/h/.omni/runtime/bun/bun')
  assert.equal(pick(['relative/bin/bun']), null, 'a relative PATH entry is never used')
  assert.equal(pick([]), null)
  assert.equal(findBun({ env: { OMNI_HOME: '/h/.omni/desktop' }, home: '/h', isExecutable: path => path === '/h/.omni/desktop/runtime/bun/bun' }), '/h/.omni/desktop/runtime/bun/bun')
})

function bunRelease({ zip, sums }) {
  const asked = []
  const fetchImpl = async (url) => {
    asked.push(String(url))
    if (String(url).endsWith('/SHASUMS256.txt')) return new Response(sums)
    if (String(url).endsWith('/bun-linux-x64.zip')) return new Response(zip)
    return new Response('', { status: 404 })
  }
  return { asked, fetchImpl }
}

test('a downloaded Bun is unpacked only when it matches the release\'s checksum', async (t) => {
  const binary = Buffer.from('#!bun binary\n')
  const zip = zipOf({ 'bun-linux-x64/': Buffer.alloc(0), 'bun-linux-x64/bun': binary })
  const sha = createHash('sha256').update(zip).digest('hex')
  const home = tempDir(t, 'omni-local-bun-')

  const wrong = bunRelease({ zip, sums: `${'0'.repeat(64)}  bun-linux-x64.zip\n${sha}  bun-linux-x64-baseline.zip\n` })
  await assert.rejects(downloadBun({ env: {}, home, platform: 'linux', arch: 'x64', fetchImpl: wrong.fetchImpl }), /does not match its published checksum/)
  assert.equal(existsSync(join(home, '.omni', 'runtime', 'bun', 'bun')), false, 'nothing is unpacked')

  const right = bunRelease({ zip, sums: `${sha}  bun-linux-x64.zip\n` })
  const path = await downloadBun({ env: {}, home, platform: 'linux', arch: 'x64', fetchImpl: right.fetchImpl })
  assert.equal(path, join(home, '.omni', 'runtime', 'bun', 'bun'))
  assert.deepEqual(readFileSync(path), binary)
  assert.equal(statSync(path).mode & 0o777, 0o755)
  assert.ok(right.asked.every(url => url.startsWith(`https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/`)))
  await assert.rejects(downloadBun({ env: {}, home, platform: 'win32', arch: 'x64', fetchImpl: right.fetchImpl }), /no release for win32/)
})

test('a zip entry is read whole, and an archive that is not one is refused', () => {
  const zip = zipOf({ 'a/readme': Buffer.from('hi'), 'a/bun': Buffer.from('binary bytes') })
  assert.equal(unzipEntry(zip, name => name.endsWith('/bun')).toString(), 'binary bytes')
  assert.equal(unzipEntry(zip, name => name === 'nope'), null)
  assert.throws(() => unzipEntry(Buffer.from('not a zip at all, just text bytes'), () => true), /not a zip/)
})

// A child process that prints `stdout` and exits with `code`.
function fakeSpawn({ stdout = '', stderr = '', code = 0 } = {}) {
  const calls = []
  const spawn = (command, args, options) => {
    calls.push({ command, args, options })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    setImmediate(() => {
      if (stderr) child.stderr.emit('data', Buffer.from(stderr))
      if (stdout) child.stdout.emit('data', Buffer.from(stdout))
      child.emit('close', code, null)
    })
    return child
  }
  return { spawn, calls }
}

test('Omni\'s CLI runs from Bun as plain arguments, with no shell and none of this host\'s Omni keys', async () => {
  const { spawn, calls } = fakeSpawn({ stdout: 'installing…\n{"ok":true,"home":"/s","apiUrl":"http://127.0.0.1:18882"}\n' })
  const report = await runInstall({ bun: '/h/.bun/bin/bun', version: '2.261023.8', env: { PATH: '/usr/bin', OMNI_API_KEY: 'host-key', OMNI_CONFIG_DIR: '/x', OMNI_HOME: '/h/.omni/desktop' }, spawn })
  assert.equal(report.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, '/h/.bun/bin/bun')
  assert.deepEqual(calls[0].args, ['x', '--bun', '@automagik/omni@2.261023.8', 'install', '--sandbox', '--at-login', '--json'])
  assert.deepEqual(installArgs('1.2.3'), ['x', '--bun', '@automagik/omni@1.2.3', 'install', '--sandbox', '--at-login', '--json'])
  assert.equal(calls[0].options.shell, false)
  assert.equal(calls[0].options.env.PATH, '/h/.bun/bin:/usr/bin')
  assert.equal(calls[0].options.env.OMNI_HOME, '/h/.omni/desktop')
  assert.equal(calls[0].options.env.OMNI_API_KEY, undefined)
  assert.equal(calls[0].options.env.OMNI_CONFIG_DIR, undefined)
})

test('the CLI\'s report reads as done, its own error, no sandbox (exit 3), or a failure in its words', async () => {
  const run = answer => runInstall({ bun: '/b/bun', spawn: fakeSpawn(answer).spawn, env: {} })
  assert.equal((await run({ stdout: '{"ok":true,"apiUrl":"http://127.0.0.1:18882"}' })).ok, true)
  assert.deepEqual(await run({ stdout: '{"ok":false,"error":"The API did not answer within 180 s","logsDir":"/s/logs"}', code: 1 }), { ok: false, error: 'The API did not answer within 180 s', logsDir: '/s/logs' })
  const missing = await run({ stdout: '{"ok":false,"installed":false,"home":"/s"}', code: 3 })
  assert.equal(missing.ok, false)
  assert.equal(missing.error, 'There is no sandboxed Omni there.')
  const garbage = await run({ stdout: 'oops', stderr: 'error: package not found\n', code: 1 })
  assert.equal(garbage.ok, false)
  assert.match(garbage.error, /without a report: error: package not found \(exit 1\)/)
  const lying = await run({ stdout: '{"ok":true}', code: 1 })
  assert.equal(lying.ok, false, 'a failing exit is a failure whatever the report says')
})

test('the sandbox key is read only from a config file inside the sandbox home', (t) => {
  const home = tempDir(t, 'omni-local-key-')
  mkdirSync(join(home, 'config'))
  writeFileSync(join(home, 'config', 'config.json'), JSON.stringify({ apiUrl: 'http://127.0.0.1:18882', apiKey: SANDBOX_KEY }))
  assert.equal(sandboxKey({ home, configPath: join(home, 'config', 'config.json') }), SANDBOX_KEY)
  assert.equal(sandboxKey({ home, configPath: join(home, '..', 'elsewhere.json') }), null)
  assert.equal(sandboxKey({ home, configPath: join(home, 'config', 'missing.json') }), null)
  assert.equal(sandboxKey({ home }), null)
})

// A host whose computer has a Bun in ~/.bun and whose install prints `report(home)`.
function host(t, { report, code = 0, validate = 200 }) {
  const home = tempDir(t, 'omni-local-home-')
  const bun = join(home, '.bun', 'bin', 'bun')
  mkdirSync(dirname(bun), { recursive: true })
  writeFileSync(bun, '')
  chmodSync(bun, 0o755)
  const sandbox = join(home, '.omni', 'sandbox')
  mkdirSync(join(sandbox, 'config'), { recursive: true })
  writeFileSync(join(sandbox, 'config', 'config.json'), JSON.stringify({ apiUrl: 'http://127.0.0.1:18882', apiKey: SANDBOX_KEY }), { mode: 0o600 })
  const fake = fakeSpawn({ stdout: `${JSON.stringify(report(sandbox))}\n`, code })
  const checked = []
  globalThis.fetch = async (address, init = {}) => {
    checked.push({ url: String(address), key: init.headers?.['x-api-key'] })
    return new Response(JSON.stringify(validate === 200 ? { data: { valid: true, scopes: ['instances:*', 'chats:*'] } } : { error: { code: 'UNAUTHORIZED' } }), { status: validate })
  }
  const rt = { home: join(home, 'plugin'), config: {}, ctx: { effect: run => run() }, syncOmniEvents: () => {} }
  installHooks(rt)
  installLink(rt)
  install(rt, { env: { PATH: '' }, home, spawn: fake.spawn })
  return { rt, sandbox, calls: fake.calls, checked }
}

const okReport = sandbox => ({ ok: true, installed: true, home: sandbox, version: PLUGIN_VERSION, apiUrl: 'http://127.0.0.1:18882', configPath: join(sandbox, 'config', 'config.json'), running: true, healthy: true, logsDir: join(sandbox, 'logs') })

test('running Omni here asks first, then installs, links it, and the key never reaches the page', async (t) => {
  const { rt, sandbox, calls, checked } = host(t, { report: okReport })
  const asked = await rt.omniLocalEndpoint('omni-local-install', {})
  assert.deepEqual(asked, { status: 'confirm', home: sandbox, version: PLUGIN_VERSION, update: false })
  assert.equal(calls.length, 0, 'nothing runs before the person says yes')
  assert.equal((await rt.omniLocalEndpoint('omni-local-progress')).status, 'idle')

  const started = await rt.omniLocalEndpoint('omni-local-install', { confirm: true })
  assert.equal(started.status, 'installing')
  await rt.omniLocalJob()
  const done = await rt.omniLocalEndpoint('omni-local-progress')
  assert.deepEqual({ status: done.status, origin: done.origin }, { status: 'paired', origin: '127.0.0.1:18882' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args[2], `@automagik/omni@${PLUGIN_VERSION}`)
  assert.deepEqual(checked, [{ url: 'http://127.0.0.1:18882/api/v2/auth/validate', key: SANDBOX_KEY }])
  const link = JSON.parse(readFileSync(join(rt.home, LINK_FILE), 'utf8'))
  assert.deepEqual({ url: link.url, key: link.key }, { url: 'http://127.0.0.1:18882', key: SANDBOX_KEY })
  const shown = JSON.stringify([asked, started, done, await rt.omniLinkEndpoint('omni-link')])
  assert.equal(shown.includes(SANDBOX_KEY), false)
  await assert.rejects(rt.omniLocalEndpoint('omni-local-install', { confirm: 'yes' }), { code: 'bot/invalid' })
})

test('a failed install says why and where its logs are, and links nothing', async (t) => {
  const { rt, sandbox } = host(t, { code: 1, report: home => ({ ok: false, home, error: 'The API did not answer within 180 s', logsDir: join(home, 'logs') }) })
  await rt.omniLocalEndpoint('omni-local-install', { confirm: true })
  await rt.omniLocalJob()
  const progress = await rt.omniLocalEndpoint('omni-local-progress')
  assert.deepEqual(progress, { status: 'failed', step: 'install', update: false, error: 'The API did not answer within 180 s', logsDir: join(sandbox, 'logs') })
  assert.equal(existsSync(join(rt.home, LINK_FILE)), false)
})

test('a sandbox that refuses its own key is a failure, not a link', async (t) => {
  const { rt } = host(t, { report: okReport, validate: 401 })
  await rt.omniLocalEndpoint('omni-local-install', { confirm: true, update: true })
  await rt.omniLocalJob()
  const progress = await rt.omniLocalEndpoint('omni-local-progress')
  assert.equal(progress.status, 'failed')
  assert.equal(progress.update, true)
  assert.equal(existsSync(join(rt.home, LINK_FILE)), false)
})

test('a sandboxed Omni from an earlier release is offered this plugin\'s version, a current or newer one is not', async (t) => {
  const { discover } = await import('../src/host/omni-discover.js')
  const { newer } = await import('../src/host/version.js')
  const home = tempDir(t, 'omni-local-behind-')
  mkdirSync(join(home, '.omni', 'sandbox', 'config'), { recursive: true })
  writeFileSync(join(home, '.omni', 'sandbox', 'config', 'config.json'), JSON.stringify({ apiUrl: 'http://127.0.0.1:18882', apiKey: SANDBOX_KEY }))
  const answering = version => async (address) => {
    const path = new URL(String(address)).pathname
    if (new URL(String(address)).port !== '18882') throw new TypeError('fetch failed')
    if (path === '/api/v2/health') return new Response(JSON.stringify({ version }))
    return new Response(JSON.stringify({ data: { claimed: true } }))
  }
  const [behind] = await discover({ env: {}, home, fetchImpl: answering('2.261001.1') })
  assert.equal(behind.updateTo, PLUGIN_VERSION)
  const [current] = await discover({ env: {}, home, fetchImpl: answering(PLUGIN_VERSION) })
  assert.equal(current.updateTo, null)
  assert.equal(newer('2.261023.10', '2.261023.9'), true)
  assert.equal(newer('2.261023.6-labs.2', '2.261023.6'), false)
  assert.equal(newer('3.0.0', null), false)
})
