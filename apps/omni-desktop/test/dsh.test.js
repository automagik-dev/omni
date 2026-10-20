import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { appHome, dshEnv, freePort, installProfile, launchUrlOf, navigationOf, resourcesOf, startDsh, stopDsh } from '../src/dsh.js'

test('the app keeps everything in one folder under ~/.omni, apart from a dsh you already run', () => {
  assert.equal(appHome({}), join(homedir(), '.omni', 'desktop'))
  assert.equal(appHome({ OMNI_HOME: '/srv/omni' }), '/srv/omni/desktop')
  assert.equal(appHome({ OMNI_HOME: '/srv/omni', OMNI_DESKTOP_HOME: '~/apps/omni' }), join(homedir(), 'apps', 'omni'))
  const env = dshEnv({ base: { PATH: '/bin', DSH_HOME: '/home/me/.dsh', OMNI_HOME: '/home/me/.omni' }, home: '/a/desktop', electronAsNode: true })
  assert.equal(env.DSH_HOME, '/a/desktop/dsh')
  assert.equal(env.OMNI_HOME, '/a/desktop')
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(env.DO_NOT_TRACK, '1')
  assert.equal(env.PATH, '/bin')
  assert.equal(dshEnv({ base: {}, home: '/a' }).ELECTRON_RUN_AS_NODE, undefined)
})

test('resources come from the app when packaged and from build/ in a checkout', () => {
  assert.deepEqual(resourcesOf({ packaged: true, resourcesPath: '/opt/Omni/resources', appPath: '/x' }), {
    bin: '/opt/Omni/resources/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
    profile: '/opt/Omni/resources/profile',
  })
  assert.equal(resourcesOf({ packaged: false, resourcesPath: '/x', appPath: '/src/apps/omni-desktop' }).profile, '/src/apps/omni-desktop/build/profile')
})

test('the shipped profile is copied in once per build and replaced whole by another build', (t) => {
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
  assert.equal(installProfile({ dshHome, source }).installed, false)
  assert.equal(existsSync(join(first.target, 'cordis.yml')), true)

  writeFileSync(join(source, 'package.json'), '{"dependencies":{"@automagik/omni-dsh":"0.1.8"}}')
  writeFileSync(join(source, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'v2')
  assert.equal(installProfile({ dshHome, source }).installed, true)
  assert.equal(readFileSync(join(first.target, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'utf8'), 'v2')
  assert.equal(existsSync(join(first.target, 'cordis.yml')), false)

  // A build id, when the build stamped one, decides even with the same package.json.
  writeFileSync(join(source, '.build-id'), '0.1.8+one')
  assert.equal(installProfile({ dshHome, source }).installed, true)
  assert.equal(installProfile({ dshHome, source }).installed, false)
  writeFileSync(join(source, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'v3')
  writeFileSync(join(source, '.build-id'), '0.1.8+two')
  assert.equal(installProfile({ dshHome, source }).installed, true)
  assert.equal(readFileSync(join(first.target, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'utf8'), 'v3')
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
