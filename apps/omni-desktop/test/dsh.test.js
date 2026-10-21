import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { appHome, dshEnv, freePort, installProfile, launchUrlOf, mergeProfilePatch, navigationOf, resourcesOf, startDsh, stopDsh, writeTools } from '../src/dsh.js'

test('the app keeps everything in one folder under ~/.omni, apart from a dsh you already run', () => {
  assert.equal(appHome({}), join(homedir(), '.omni', 'desktop'))
  assert.equal(appHome({ OMNI_HOME: '/srv/omni' }), '/srv/omni/desktop')
  assert.equal(appHome({ OMNI_HOME: '/srv/omni', OMNI_DESKTOP_HOME: '~/apps/omni' }), join(homedir(), 'apps', 'omni'))
  const env = dshEnv({ base: { PATH: '/bin', DSH_HOME: '/home/me/.dsh', OMNI_HOME: '/home/me/.omni' }, home: '/a/desktop', electronAsNode: true })
  assert.equal(env.DSH_HOME, '/a/desktop/dsh')
  assert.equal(env.OMNI_HOME, '/a/desktop')
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(env.DO_NOT_TRACK, '1')
  assert.equal(env.OMNI_CLIENT_ID, 'omni-desktop')
  assert.equal(env.PATH, '/bin')
  assert.equal(dshEnv({ base: {}, home: '/a' }).ELECTRON_RUN_AS_NODE, undefined)
})

test('resources come from the app when packaged and from build/ in a checkout', () => {
  assert.deepEqual(resourcesOf({ packaged: true, resourcesPath: '/opt/Omni/resources', appPath: '/x' }), {
    bin: '/opt/Omni/resources/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
    pnpm: '/opt/Omni/resources/runtime/node_modules/pnpm/bin/pnpm.cjs',
    profile: '/opt/Omni/resources/profile',
  })
  assert.equal(resourcesOf({ packaged: false, resourcesPath: '/x', appPath: '/src/apps/omni-desktop' }).profile, '/src/apps/omni-desktop/build/profile')
})

test('the shipped profile seeds a new home, and a new build replaces only its packages', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-profile-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'shipped')
  mkdirSync(join(source, 'node_modules', '@automagik', 'omni-dsh'), { recursive: true })
  writeFileSync(join(source, 'package.json'), '{"dependencies":{"@automagik/omni-dsh":"0.1.7"}}')
  writeFileSync(join(source, 'cordis.patch.yml'), '[]')
  writeFileSync(join(source, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'v1')
  const dshHome = join(root, 'dsh')

  const first = installProfile({ dshHome, source })
  assert.equal(first.installed, true)
  assert.equal(first.target, join(dshHome, 'profiles', 'omni'))
  assert.equal(readFileSync(join(first.target, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'utf8'), 'v1')

  // dsh writes its own files into the profile; the same build leaves them be.
  writeFileSync(join(first.target, 'cordis.yml'), '[]')
  writeFileSync(join(first.target, 'cordis.patch.yml'), '- id: llm-pi-ai  # the user\'s models')
  mkdirSync(join(first.target, '.plugin-manager'))
  writeFileSync(join(first.target, '.plugin-manager', 'state.json'), '{}')
  assert.equal(installProfile({ dshHome, source }).installed, false)
  assert.equal(existsSync(join(first.target, 'cordis.yml')), true)

  writeFileSync(join(source, 'package.json'), '{"dependencies":{"@automagik/omni-dsh":"0.1.8"}}')
  writeFileSync(join(source, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'v2')
  assert.equal(installProfile({ dshHome, source }).installed, true)
  assert.equal(readFileSync(join(first.target, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'utf8'), 'v2')
  assert.equal(readFileSync(join(first.target, 'package.json'), 'utf8'), '{"dependencies":{"@automagik/omni-dsh":"0.1.8"}}')
  // What dsh and the user put there survives the update.
  assert.equal(readFileSync(join(first.target, 'cordis.yml'), 'utf8'), '[]')

  // A build id, when the build stamped one, decides even with the same package.json.
  writeFileSync(join(source, '.build-id'), '0.1.8+one')
  assert.equal(installProfile({ dshHome, source }).installed, true)
  assert.equal(installProfile({ dshHome, source }).installed, false)
  writeFileSync(join(source, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'v3')
  writeFileSync(join(source, '.build-id'), '0.1.8+two')
  assert.equal(installProfile({ dshHome, source }).installed, true)
  assert.equal(readFileSync(join(first.target, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'utf8'), 'v3')
  assert.equal(readFileSync(join(first.target, 'cordis.patch.yml'), 'utf8'), '- id: llm-pi-ai  # the user\'s models')
  assert.equal(readFileSync(join(first.target, '.plugin-manager', 'state.json'), 'utf8'), '{}')
})

// The app opens on the Omni octopus (@automagik/omni-ai-dsh), not on DSH's own welcome
// notice and credential step.
test('the shipped profile bundles Omni\'s plugins, core first, and the plugin market, and switches DSH\'s own onboarding off', () => {
  const profile = JSON.parse(readFileSync(new URL('../profile/package.json', import.meta.url), 'utf8'))
  const omni = ['@automagik/omni-dsh', '@automagik/omni-channels-dsh', '@automagik/omni-canvas-dsh', '@automagik/omni-ai-dsh']
  assert.deepEqual(Object.keys(profile.dependencies), omni)
  assert.deepEqual(profile.dsh.profile.bundles.filter(name => name.startsWith('@automagik/')), omni)
  assert.ok(profile.dsh.profile.bundles.includes('@deepseek-ai/dsh-experimental-plugin-market-bundle'))
  const patch = readFileSync(new URL('../profile/cordis.patch.yml', import.meta.url), 'utf8')
  // DSH compares the notice version exactly, as a string.
  assert.match(patch, /^- id: ui-settings-general\n {2}config:\n {4}welcomeNoticeVersion: '2026-09-28\.1'$/m)
  assert.match(patch, /^- id: ui-settings-models\n {2}config:\n {4}credentialOnboarding: false$/m)
  // Pairing adds the Omni's market here (apps/omni-channels-dsh omni-link.js).
  assert.match(patch, /^- id: plugin-market\n {2}config:\n {4}indexes: \[\]$/m)
})

test('the launch URL is read from dsh\'s output, only for the port it was given', () => {
  const line = 'starting…\ndsh web: http://127.0.0.1:41149/?token=abc123\n'
  assert.equal(launchUrlOf(line, 41149), 'http://127.0.0.1:41149/?token=abc123')
  assert.equal(launchUrlOf(line, 5000), null)
  assert.equal(launchUrlOf('dsh web: http://0.0.0.0:41149/?token=x', 41149), null)
  assert.equal(launchUrlOf('no url here'), null)
})

test('the window stays on dsh\'s origin; web links go to the system browser; the rest is refused', () => {
  const origin = 'http://127.0.0.1:41149'
  assert.equal(navigationOf('http://127.0.0.1:41149/session/1', origin), 'allow')
  assert.equal(navigationOf('http://127.0.0.1:9999/', origin), 'external')
  assert.equal(navigationOf('https://wa.me/5511999990000?text=Omni%207KQ4-9XZP', origin), 'external')
  assert.equal(navigationOf('mailto:dev@namastex.ai', origin), 'external')
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'whatsapp://send?text=x', 'not a url']) assert.equal(navigationOf(url, origin), 'deny', url)
})

test('dsh starts on the given loopback port, its URL resolves, and stopping ends it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-start-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  // A stand-in dsh: prints its launch line for the port and the profile it was given, then waits.
  const bin = join(root, 'fake-dsh.mjs')
  writeFileSync(bin, `
const args = process.argv.slice(2)
const port = args[args.indexOf('--port') + 1]
const profile = args[args.indexOf('--profile') + 1]
const host = args[args.indexOf('--host') + 1]
console.log('booting ' + profile + ' on ' + host)
setTimeout(() => console.log('dsh web: http://127.0.0.1:' + port + '/?token=t0k3n'), 50)
setInterval(() => {}, 1000)
`)
  const port = await freePort()
  const lines = []
  const { child, url } = await startDsh({ node: process.execPath, bin, env: process.env, port, cwd: root, log: { write: chunk => lines.push(String(chunk)) } })
  assert.equal(url, `http://127.0.0.1:${port}/?token=t0k3n`)
  assert.match(lines.join(''), /booting omni on 127\.0\.0\.1/)
  await stopDsh(child)
  assert.notEqual(child.exitCode ?? child.signalCode, null)
})

test('a dsh that exits before it is ready is reported, and one that never says so times out', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-fail-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dies = join(root, 'dies.mjs')
  writeFileSync(dies, 'process.exit(3)')
  await assert.rejects(startDsh({ node: process.execPath, bin: dies, env: process.env, port: await freePort(), cwd: root }), /exited before it was ready \(3\)/)
  const silent = join(root, 'silent.mjs')
  writeFileSync(silent, 'setInterval(() => {}, 1000)')
  await assert.rejects(startDsh({ node: process.execPath, bin: silent, env: process.env, port: await freePort(), cwd: root, timeoutMs: 300 }), /did not start within/)
})

test('dsh gets node and pnpm on its PATH, both on the app\'s own Node', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-tools-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const script = join(root, "it's pnpm.cjs")
  writeFileSync(script, 'console.log(JSON.stringify([process.env.ELECTRON_RUN_AS_NODE, ...process.argv.slice(2)]))')
  const dir = writeTools({ dir: join(root, 'bin'), node: process.execPath, pnpm: script })
  assert.deepEqual(JSON.parse(execFileSync(join(dir, 'pnpm'), ['add', 'a b'], { encoding: 'utf8' })), ['1', 'add', 'a b'])
  assert.equal(execFileSync(join(dir, 'node'), ['-p', '6*7'], { encoding: 'utf8' }).trim(), '42')
  assert.equal(dshEnv({ base: { PATH: '/bin' }, home: '/a', binDir: dir }).PATH, `${dir}:/bin`)
  assert.equal(dshEnv({ base: { PATH: '/bin' }, home: '/a' }).PATH, '/bin')
})

test('an update adds the settings a newer build ships and keeps every one the user has', () => {
  const shipped = `# Omni's own search.
- insert:
    - id: web-search-auto
      name: x
- id: web
  config:
    searchProvider: auto
# The octopus opens the app.
- id: ui-settings-models
  config:
    credentialOnboarding: false
`
  // DSH's empty template takes every shipped entry, comments and all.
  assert.equal(mergeProfilePatch('[]\n', shipped), shipped)
  // An entry the user has, changed or not, stays theirs; only the missing one is added.
  const user = `- id: web\n  config:\n    searchProvider: brave\n- insert:\n    - id: web-search-auto\n      name: x\n`
  assert.equal(
    mergeProfilePatch(user, shipped),
    `${user}# The octopus opens the app.\n- id: ui-settings-models\n  config:\n    credentialOnboarding: false\n`,
  )
  assert.equal(mergeProfilePatch(shipped, shipped), null)
})

test('an existing profile gets pnpm settings and the newer build\'s settings on update', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'omni-desktop-migrate-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'shipped')
  mkdirSync(join(source, 'node_modules'), { recursive: true })
  writeFileSync(join(source, 'package.json'), '{}')
  writeFileSync(join(source, '.build-id'), 'one')
  writeFileSync(join(source, 'cordis.patch.yml'), '- id: web\n  config:\n    searchProvider: auto\n')
  const dshHome = join(root, 'dsh')
  const { target } = installProfile({ dshHome, source })
  // An install from before pnpm-workspace.yaml shipped, with the user's own search.
  rmSync(join(target, 'pnpm-workspace.yaml'), { force: true })
  writeFileSync(join(target, 'cordis.patch.yml'), '- id: web\n  config:\n    searchProvider: brave\n')
  writeFileSync(join(source, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n')
  writeFileSync(join(source, 'cordis.patch.yml'), '- id: web\n  config:\n    searchProvider: auto\n- id: plugin-market\n  config:\n    indexes: []\n')
  writeFileSync(join(source, '.build-id'), 'two')
  installProfile({ dshHome, source })
  assert.equal(readFileSync(join(target, 'pnpm-workspace.yaml'), 'utf8'), 'nodeLinker: hoisted\n')
  assert.equal(
    readFileSync(join(target, 'cordis.patch.yml'), 'utf8'),
    '- id: web\n  config:\n    searchProvider: brave\n- id: plugin-market\n  config:\n    indexes: []\n',
  )
})
