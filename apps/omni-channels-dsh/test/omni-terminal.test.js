import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { managerOf } from '../src/host/omni-discover.js'
import { CANCELLED, codeOf, install, promptArgv, shellOrder } from '../src/host/omni-terminal.js'

const SANDBOX_KEY = 'omni_sk_sandbox_secret'
const FOUND_KEY = 'omni_sk_cli_secret'
const FOUND_ID = 'a1b2c3d4e5f60718'
const settle = () => new Promise(resolve => setTimeout(resolve, 10))

function tempHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'omni-terminal-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}

// DSH's process service, with terminals the test ends by hand.
function fakeSubprocess({ shells = ['bash', 'zsh', 'sh'] } = {}) {
  const spawned = []
  return {
    spawned,
    resolveExecutable: async (name) => {
      if (!shells.includes(name)) throw new Error(`no ${name}`)
      return `/bin/${name}`
    },
    spawnTerminal: async (spec) => {
      let exit
      const handle = {
        spec,
        output: new PassThrough(),
        done: new Promise((resolve) => { exit = resolve }),
        writes: [],
        resizes: [],
        terminated: false,
        write: async (data) => { handle.writes.push(data) },
        resize: async (cols, rows) => { handle.resizes.push([cols, rows]) },
        terminate: async () => { handle.terminated = true },
        exit: code => exit({ exitCode: code, signal: null }),
      }
      spawned.push(handle)
      return handle
    },
  }
}

function start(t, deps = {}) {
  const home = tempHome(t)
  const links = []
  const pairings = []
  const rt = {
    ctx: { effect: (run) => { run() } },
    hooks: { endpoint: () => () => {} },
    startOmniPairing: async ({ url }) => { pairings.push(url); return { pairing: { code: 'ABCD-1234', origin: new URL(url).host } } },
    warn: () => {},
  }
  install(rt, {
    env: { PATH: '/usr/bin:/bin' },
    home,
    platform: 'linux',
    version: '9.9.9',
    findBun: () => '/opt/bun/bin/bun',
    fetch: async () => new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 }),
    linkWithKey: async (url, key) => { links.push([url, key]); return { status: 'paired', origin: new URL(url).host } },
    foundOmni: id => (id === FOUND_ID ? { id, url: 'http://localhost:8882', key: FOUND_KEY } : undefined),
    managerOf: () => 'cli',
    ...deps,
  })
  const call = (endpoint, body) => rt.omniTerminalEndpoint(endpoint, body)
  return { rt, home, links, pairings, call }
}

function writeSandbox(home) {
  const dir = join(home, '.omni', 'sandbox', 'config')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ apiUrl: 'http://127.0.0.1:18882', apiKey: SANDBOX_KEY }))
}

test('the install terminal waits at a prompt with the command typed, and runs nothing until Enter', async (t) => {
  const subprocess = fakeSubprocess()
  const { call, rt } = start(t, { subprocess })
  const opened = await call('omni-terminal-open', { kind: 'install', cols: 90, rows: 12 })
  await rt.omniTerminalReady(opened.terminal)
  const [handle] = subprocess.spawned
  const command = 'bun x --bun @automagik/omni@9.9.9 install --sandbox --at-login'
  // The command reaches the shell only in its environment; the prompt script holds it for
  // editing and evaluates what the person sends.
  assert.equal(handle.spec.env.OMNI_TERMINAL_COMMAND, command)
  assert.equal(handle.spec.argv[0], '/bin/bash')
  assert.ok(!handle.spec.argv.some(arg => arg.includes('@automagik/omni')), 'the command is not in the shell arguments')
  assert.match(handle.spec.argv.at(-1), /read -e -r -i "\$OMNI_TERMINAL_COMMAND"/)
  assert.match(handle.spec.argv.at(-1), /eval "\$line"/)
  assert.deepEqual([handle.spec.cols, handle.spec.rows, handle.spec.terminalType], [90, 12, 'xterm-256color'])
  // Bun's folder comes first on PATH, so `bun` in the command is that Bun.
  assert.equal(handle.spec.env.PATH.split(':')[0], '/opt/bun/bin')
  assert.deepEqual(handle.writes, [])

  const before = await call('omni-terminal-read', { terminal: opened.terminal })
  assert.equal(before.state, 'ready')
  assert.equal(before.command, command)
  await call('omni-terminal-write', { terminal: opened.terminal, data: '\r' })
  assert.deepEqual(handle.writes, ['\r'])
})

test('exit 0 links this host with the new Omni\'s own key, and the key never reaches the page', async (t) => {
  const subprocess = fakeSubprocess()
  const { call, rt, home, links } = start(t, { subprocess })
  writeSandbox(home)
  const opened = await call('omni-terminal-open', { kind: 'install' })
  await rt.omniTerminalReady(opened.terminal)
  const [handle] = subprocess.spawned
  handle.output.write('Omni is running at 127.0.0.1:18882\r\n')
  handle.exit(0)
  await settle()
  const reply = await call('omni-terminal-read', { terminal: opened.terminal, from: 0 })
  assert.equal(reply.state, 'done')
  assert.equal(reply.exitCode, 0)
  assert.deepEqual(reply.result, { status: 'paired', origin: '127.0.0.1:18882', version: '9.9.9' })
  assert.match(reply.data, /Omni is running/)
  assert.deepEqual(links, [['http://127.0.0.1:18882', SANDBOX_KEY]])
  assert.ok(!JSON.stringify(reply).includes(SANDBOX_KEY))
  // Output already read is not sent again.
  assert.equal((await call('omni-terminal-read', { terminal: opened.terminal, from: reply.next })).data, '')
})

test('a non-zero exit stays open with its output and links nothing; backing out of the prompt is a cancel', async (t) => {
  const subprocess = fakeSubprocess()
  const { call, rt, home, links } = start(t, { subprocess })
  // A sandbox it could link to is there: only the exit code keeps it from linking.
  writeSandbox(home)
  const failed = await call('omni-terminal-open', { kind: 'install' })
  await rt.omniTerminalReady(failed.terminal)
  subprocess.spawned[0].output.write('error: network is unreachable\r\n')
  subprocess.spawned[0].exit(1)
  await settle()
  const reply = await call('omni-terminal-read', { terminal: failed.terminal })
  assert.equal(reply.state, 'failed')
  assert.equal(reply.exitCode, 1)
  assert.match(reply.data, /network is unreachable/)
  assert.equal(reply.result, undefined)
  assert.deepEqual(links, [])

  const backedOut = await call('omni-terminal-open', { kind: 'install' })
  await rt.omniTerminalReady(backedOut.terminal)
  subprocess.spawned[1].exit(CANCELLED)
  await settle()
  assert.equal((await call('omni-terminal-read', { terminal: backedOut.terminal })).state, 'cancelled')
  assert.deepEqual(links, [])
})

test('updating runs omni update for an Omni the Omni CLI runs, then links with the key this computer has', async (t) => {
  const subprocess = fakeSubprocess()
  const { call, links } = start(t, { subprocess })
  const opened = await call('omni-terminal-open', { kind: 'update', id: FOUND_ID })
  assert.equal(opened.command, 'omni update --yes')
  assert.equal(opened.title, 'Update Omni')
  subprocess.spawned[0].exit(0)
  await settle()
  const reply = await call('omni-terminal-read', { terminal: opened.terminal })
  assert.equal(reply.state, 'done')
  assert.equal(reply.result.status, 'paired')
  assert.deepEqual(links, [['http://localhost:8882', FOUND_KEY]])
  assert.ok(!JSON.stringify(reply).includes(FOUND_KEY))
})

test('an Omni another app runs, or one no longer there, gets no update terminal', async (t) => {
  const subprocess = fakeSubprocess()
  const other = start(t, { subprocess, managerOf: () => 'other' })
  await assert.rejects(other.call('omni-terminal-open', { kind: 'update', id: FOUND_ID }), { code: 'bot/refused' })
  await assert.rejects(other.call('omni-terminal-open', { kind: 'update', id: 'ffffffffffffffff' }), { code: 'bot/refused' })
  assert.equal(subprocess.spawned.length, 0)
})

test('the page names a job, never a command, and every payload is checked', async (t) => {
  const { call } = start(t, { subprocess: fakeSubprocess() })
  for (const body of [{ kind: 'shell' }, { kind: 'install', command: 'rm -rf /' }, { kind: 'update' }, { kind: 'update', id: 'not-hex' }, { kind: 'install', cols: 9999 }, null]) {
    await assert.rejects(call('omni-terminal-open', body), { code: /bot\/(invalid|refused)/ }, JSON.stringify(body))
  }
  await assert.rejects(call('omni-terminal-read', { terminal: 'nope' }), { code: 'bot/invalid' })
  await assert.rejects(call('omni-terminal-write', { terminal: '00000000-0000-4000-8000-000000000000', data: 'x' }), { code: 'bot/refused' })
})

test('without a terminal from DSH, the command waits shown and runs on pipes only after Enter', async (t) => {
  const piped = []
  const spawn = (file, args, options) => {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => {}
    piped.push({ file, args, options, child })
    return child
  }
  const { call, rt, home, links } = start(t, { subprocess: null, spawn })
  writeSandbox(home)
  const opened = await call('omni-terminal-open', { kind: 'install' })
  await rt.omniTerminalReady(opened.terminal)
  const shown = await call('omni-terminal-read', { terminal: opened.terminal })
  assert.equal(shown.state, 'ready')
  assert.match(shown.data, /bun x --bun @automagik\/omni@9\.9\.9 install --sandbox --at-login/)
  await call('omni-terminal-write', { terminal: opened.terminal, data: 'x' })
  assert.equal(piped.length, 0, 'a key that is not Enter runs nothing')
  await call('omni-terminal-write', { terminal: opened.terminal, data: '\r' })
  assert.equal(piped.length, 1)
  assert.deepEqual([piped[0].file, piped[0].args], ['/bin/sh', ['-c', 'eval "$OMNI_TERMINAL_COMMAND"']])
  assert.equal(piped[0].options.shell, false)
  assert.equal(piped[0].options.env.OMNI_TERMINAL_COMMAND, 'bun x --bun @automagik/omni@9.9.9 install --sandbox --at-login')
  piped[0].child.stdout.write('done\n')
  piped[0].child.emit('close', 0)
  await settle()
  const reply = await call('omni-terminal-read', { terminal: opened.terminal })
  assert.equal(reply.state, 'done')
  assert.match(reply.data, /done\r\n/)
  assert.deepEqual(links, [['http://127.0.0.1:18882', SANDBOX_KEY]])
})

test('Ctrl-C at zsh\'s prompt ends the shell by SIGINT, which reads as a cancel', () => {
  assert.equal(codeOf({ exitCode: null, signal: 'SIGINT' }), CANCELLED)
  assert.equal(codeOf({ exitCode: null, signal: 'SIGKILL' }), 128)
  assert.equal(codeOf({ exitCode: 0, signal: null }), 0)
})

test('macOS holds the command in zsh (its bash has no read -i), Linux in bash', () => {
  assert.deepEqual(shellOrder('darwin'), ['zsh', 'bash', 'sh'])
  assert.deepEqual(shellOrder('linux'), ['bash', 'zsh', 'sh'])
  const zsh = promptArgv('zsh', '/bin/zsh')
  assert.deepEqual(zsh.slice(0, 3), ['/bin/zsh', '-f', '-c'])
  assert.match(zsh[3], /vared/)
  assert.match(promptArgv('sh', '/bin/sh')[2], /read -r _/)
})

// Who runs a found Omni decides whether this app may update it.
function fsWith(files = {}, pids = {}) {
  return {
    exists: path => Object.hasOwn(files, path),
    list: (dir) => {
      const names = Object.keys(pids).filter(path => path.startsWith(`${dir}/`)).map(path => path.slice(dir.length + 1))
      if (names.length === 0) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return names
    },
    readText: path => pids[path] ?? '',
  }
}

test('the Omni CLI runs an Omni when its config names that port and its PM2 omni-api is alive', (t) => {
  const home = tempHome(t)
  mkdirSync(join(home, '.omni'), { recursive: true })
  writeFileSync(join(home, '.omni', 'config.json'), JSON.stringify({ apiUrl: 'http://localhost:8882', apiKey: FOUND_KEY }))
  const pidFile = join(home, '.pm2', 'pids', 'omni-api-0.pid')
  const alive = managerOf('http://127.0.0.1:8882', { env: {}, home, ...fsWith({}, { [pidFile]: '4242' }), isAlive: pid => pid === 4242 })
  assert.equal(alive, 'cli')
  const dead = managerOf('http://127.0.0.1:8882', { env: {}, home, ...fsWith({}, { [pidFile]: '4242' }), isAlive: () => false })
  assert.equal(dead, 'other')
  const systemd = managerOf('http://127.0.0.1:8882', { env: {}, home, ...fsWith({ '/etc/systemd/system/omni-api.service': true }), isAlive: () => false })
  assert.equal(systemd, 'cli')
  // Another port than the CLI's is not the CLI's Omni.
  assert.equal(managerOf('http://127.0.0.1:9999', { env: {}, home, ...fsWith({ '/etc/systemd/system/omni-api.service': true }) }), 'other')
})

test('an Omni with no CLI config is another app\'s; the sandbox is ours; one elsewhere has none', (t) => {
  const home = tempHome(t)
  // The owner's Mac: an Omni on 8882 that the Yours project runs under its own launchd agent.
  assert.equal(managerOf('http://127.0.0.1:8882', { env: {}, home, ...fsWith() }), 'other')
  writeSandbox(home)
  assert.equal(managerOf('http://localhost:18882', { env: {}, home, ...fsWith() }), 'sandbox')
  assert.equal(managerOf('https://omni.example.com', { env: {}, home, ...fsWith() }), null)
})

test('the install terminal names the newest Omni npm has that meets the minimum, not the plugin\'s own version', async (t) => {
  const { forgetReleases } = await import('../src/host/omni-release.js')
  forgetReleases()
  t.after(forgetReleases)
  const subprocess = fakeSubprocess()
  const fetch = async (url) => (String(url).endsWith('/-/package/@automagik%2fomni/dist-tags')
    ? new Response(JSON.stringify({ latest: '2.999999.1', next: '2.999999.3' }))
    : new Response(JSON.stringify({ version: '2.999999.1' })))
  const { call, rt } = start(t, { subprocess, version: undefined, fetch })
  const opened = await call('omni-terminal-open', { kind: 'install' })
  await rt.omniTerminalReady(opened.terminal)
  assert.equal(subprocess.spawned[0].spec.env.OMNI_TERMINAL_COMMAND, 'bun x --bun @automagik/omni@2.999999.1 install --sandbox --at-login')
})

test('under Unfold no terminal installs or updates an Omni, and nothing is spawned', async (t) => {
  const subprocess = fakeSubprocess()
  const { call } = start(t, { subprocess, env: { PATH: '/usr/bin:/bin', AUTOMAGIK_HOST: 'unfold', OMNI_HOME: '/instance/omni' } })
  await assert.rejects(call('omni-terminal-open', { kind: 'install' }), { code: 'bot/refused' })
  await assert.rejects(call('omni-terminal-open', { kind: 'update', id: FOUND_ID }), { code: 'bot/refused' })
  assert.equal(subprocess.spawned.length, 0)
})
