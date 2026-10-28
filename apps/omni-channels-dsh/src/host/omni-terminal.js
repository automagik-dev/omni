// One-shot terminals for the Connect step: updating an Omni found on this computer, and
// setting one up here. Orca's onboarding terminal (stablyai/orca,
// OnboardingInlineCommandTerminal.tsx, MIT) is the model: the command waits typed at a
// prompt, the person reads it, edits it if they like and runs it with Enter, and the
// terminal ends with it. Its exit code decides what happens next: 0 links this host to that
// Omni, anything else leaves the output on screen.
//
// The host picks every command; the page only says which job (`update` a found Omni the
// Omni CLI runs, or `install` the sandboxed one) and types keys into it. The terminal is a
// real one from DSH's process service (ctx.subprocess.spawnTerminal): zsh's vared or bash's
// readline hold the command for editing. Where DSH has no terminal to give, the command runs
// on pipes once Enter arrives, without line editing. Keys are read the same way either way.
import { spawn as spawnProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { z } from 'zod'
import { candidates, foundOmni, linkWithKey, managerOf, probe, UNFOLD_RUNS_OMNI, unfoldHost } from './omni-discover.js'
import { downloadBun, findBun } from './omni-local.js'
import { installRelease } from './omni-release.js'

const MAX_OUTPUT = 256 * 1024
const MAX_TERMINALS = 2
const IDLE_MS = 30 * 60_000
const GRACE_MS = 2000
// What the shell exits with when the person backs out of the prompt (Ctrl-C, Ctrl-D).
export const CANCELLED = 130
// zsh's vared dies with the terminal's SIGINT on Ctrl-C, leaving no exit code: a cancel too.
export const codeOf = outcome => outcome.exitCode ?? (outcome.signal === 'SIGINT' ? CANCELLED : 128)

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })
const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })

const Size = { cols: z.number().int().min(20).max(400).optional(), rows: z.number().int().min(4).max(120).optional() }
const OpenPayload = z.object({ kind: z.enum(['update', 'install']), id: z.string().regex(/^[a-f0-9]{16}$/).optional(), ...Size }).strict()
const TerminalId = z.string().uuid()
const ReadPayload = z.object({ terminal: TerminalId, from: z.number().int().min(0).optional() })
const WritePayload = z.object({ terminal: TerminalId, data: z.string().min(1).max(4096) })
const ResizePayload = z.object({ terminal: TerminalId, cols: Size.cols.unwrap(), rows: Size.rows.unwrap() })
const ClosePayload = z.object({ terminal: TerminalId })

function parse(schema, body, message) {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw invalid(message)
  return parsed.data
}

// The shell scripts that hold OMNI_TERMINAL_COMMAND at an editable prompt, then run what the
// person sends. The command arrives in the environment, so nothing is interpolated into them.
const ZSH_PROMPT = 'line=$OMNI_TERMINAL_COMMAND; vared -p "%F{cyan}~ \\$%f " line || exit 130; eval "$line"'
const BASH_PROMPT = [
  'if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ]; then',
  "  IFS= read -e -r -i \"$OMNI_TERMINAL_COMMAND\" -p $'\\001\\e[36m\\002~ $\\001\\e[0m\\002 ' line || exit 130",
  'else',
  "  printf '\\033[36m~ $\\033[0m %s' \"$OMNI_TERMINAL_COMMAND\"; IFS= read -r _ || exit 130; line=$OMNI_TERMINAL_COMMAND",
  'fi',
  'eval "$line"',
].join('\n')
const SH_PROMPT = "printf '\\033[36m~ $\\033[0m %s' \"$OMNI_TERMINAL_COMMAND\"; IFS= read -r _ || exit 130; eval \"$OMNI_TERMINAL_COMMAND\""

// macOS's bash is 3.2, without `read -i`, so zsh comes first there; Linux has bash 4+.
export function shellOrder(platform = process.platform) {
  return platform === 'darwin' ? ['zsh', 'bash', 'sh'] : ['bash', 'zsh', 'sh']
}
export function promptArgv(shell, path) {
  if (shell === 'zsh') return [path, '-f', '-c', ZSH_PROMPT]
  if (shell === 'bash') return [path, '--noprofile', '--norc', '-c', BASH_PROMPT]
  return [path, '-c', SH_PROMPT]
}

async function pickShell(subprocess, env, platform) {
  for (const shell of shellOrder(platform)) {
    try {
      return promptArgv(shell, await subprocess.resolveExecutable(shell, env))
    } catch {}
  }
  throw new Error('This computer has no shell to run the command in.')
}

// Bun's and Omni's global bin folders first on PATH: the CLI the person installed with bun
// lives there, and the Bun this plugin runs Omni with.
function withPath(env, folders) {
  return [...new Set([...folders.filter(Boolean), ...String(env.PATH ?? '').split(delimiter).filter(Boolean)])].join(delimiter)
}

function subprocessOf(ctx) {
  try {
    return ctx.subprocess ?? null
  } catch {
    return null
  }
}

export function install(rt, deps = {}) {
  const env = deps.env ?? process.env
  const home = deps.home ?? homedir()
  const platform = deps.platform ?? process.platform
  const fetchImpl = deps.fetch ?? ((...args) => fetch(...args))
  // The Omni the install command names: one exact release (omni-release.js).
  const release = deps.version !== undefined ? async () => deps.version : async () => (await installRelease({ fetchImpl, env })).version
  const spawnPipe = deps.spawn ?? spawnProcess
  // DSH's process service, while it is there: this plugin does not require it, so it reads it
  // from a fiber of its own, as the team reads its optional services (schedules.js there).
  let service = null
  if (deps.subprocess === undefined) {
    const attach = (sub) => {
      const own = sub.subprocess
      service = own
      sub.effect(() => () => { if (service === own) service = null }, 'omni-channels: terminal service')
    }
    if (typeof rt.ctx.inject === 'function') rt.ctx.inject(['subprocess'], attach)
    else service = subprocessOf(rt.ctx)
  }
  const subprocess = () => (deps.subprocess !== undefined ? deps.subprocess : service)
  const findFound = deps.foundOmni ?? (id => foundOmni(id))
  const managerFor = deps.managerOf ?? (url => managerOf(url, { env, home }))
  const link = deps.linkWithKey ?? ((url, key) => linkWithKey(rt, url, key))
  const terminals = new Map()

  // The job behind a terminal: the command it shows and runs, the environment it runs in, and
  // how to link this host once it ends well.
  async function planFor(entry) {
    const bunFolders = [env.BUN_INSTALL ? join(env.BUN_INSTALL, 'bin') : null, join(home, '.bun', 'bin')]
    if (entry.kind === 'install') {
      let bun = (deps.findBun ?? findBun)({ env, home })
      if (bun === null) {
        entry.step = 'download-bun'
        bun = await (deps.downloadBun ?? downloadBun)({ env, home, fetchImpl })
      }
      const version = await release()
      entry.step = null
      return {
        title: 'Install Omni on this computer',
        command: `bun x --bun @automagik/omni@${version} install --sandbox --at-login`,
        env: { PATH: withPath(env, [dirname(bun), ...bunFolders]) },
        after: () => linkSandbox(version),
      }
    }
    const omni = findFound(entry.foundId)
    if (!omni) throw refused('That Omni is not there any more. Look again.')
    if (managerFor(omni.url) !== 'cli') throw refused('The Omni CLI does not run this Omni, so it cannot update it from here.')
    return {
      title: 'Update Omni',
      command: 'omni update --yes',
      env: { PATH: withPath(env, bunFolders) },
      after: () => linkFound(omni.id),
    }
  }

  // After the install: the sandbox's own config holds its address and key (omni-discover.js).
  async function linkSandbox(version) {
    const sandbox = candidates({ env, home }).find(found => found.source === 'sandbox' && found.key)
    if (!sandbox) throw new Error('Omni is set up, but its key could not be read.')
    const linked = await link(sandbox.url, sandbox.key)
    if (linked.status !== 'paired') throw new Error('The new Omni did not take its own key.')
    const answer = await probe(sandbox.url, fetchImpl).catch(() => null)
    return { ...linked, version: answer?.version ?? version }
  }

  // After an update: link with the key this computer has for it, else sign this device in.
  async function linkFound(id) {
    const omni = findFound(id)
    if (!omni) throw new Error('The Omni was updated, but it is not answering where it was.')
    const answer = await probe(omni.url, fetchImpl).catch(() => null)
    if (omni.key) {
      const linked = await link(omni.url, omni.key)
      if (linked.status === 'paired') return { ...linked, version: answer?.version ?? null }
    }
    return { status: 'pairing', ...(await rt.startOmniPairing({ url: omni.url })) }
  }

  const append = (entry, text) => {
    entry.output += text
    entry.touched = Date.now()
    if (entry.output.length > MAX_OUTPUT) {
      const drop = entry.output.length - MAX_OUTPUT
      entry.output = entry.output.slice(drop)
      entry.base += drop
    }
  }

  async function finish(entry, code) {
    entry.exitCode = code
    if (code === CANCELLED) {
      entry.state = 'cancelled'
      return
    }
    if (code !== 0) {
      entry.state = 'failed'
      return
    }
    entry.state = 'linking'
    try {
      entry.result = await entry.plan.after()
      entry.state = 'done'
    } catch (error) {
      entry.state = 'failed'
      entry.error = error?.message ?? String(error)
    }
  }

  async function startTerminal(entry, size) {
    const shellEnv = { ...entry.plan.env, OMNI_TERMINAL_COMMAND: entry.plan.command }
    const service = subprocess()
    if (service?.spawnTerminal) {
      try {
        const argv = await pickShell(service, { ...env, ...entry.plan.env }, platform)
        entry.handle = await service.spawnTerminal({ argv, cwd: home, env: shellEnv, cols: size.cols, rows: size.rows, terminalType: 'xterm-256color', graceMs: GRACE_MS })
        entry.handle.output.setEncoding?.('utf8')
        entry.handle.output.on('data', chunk => append(entry, String(chunk)))
        entry.state = 'ready'
        entry.handle.done.then(outcome => finish(entry, codeOf(outcome)), () => finish(entry, 1))
        return
      } catch (error) {
        rt.warn?.('omni-channels: no terminal for %s, running on pipes: %s', entry.kind, error?.message ?? error)
      }
    }
    // No terminal: show the prompt here, and run the command on pipes once Enter arrives.
    entry.pipe = { env: shellEnv, started: false }
    append(entry, `\x1b[36m~ $\x1b[0m ${entry.plan.command}`)
    entry.state = 'ready'
  }

  function runPiped(entry) {
    entry.pipe.started = true
    append(entry, '\r\n')
    let child
    try {
      child = spawnPipe('/bin/sh', ['-c', 'eval "$OMNI_TERMINAL_COMMAND"'], { cwd: home, env: { ...env, ...entry.pipe.env }, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    } catch (error) {
      append(entry, `${error.message}\r\n`)
      void finish(entry, 127)
      return
    }
    const forward = chunk => append(entry, String(chunk).replace(/\r?\n/g, '\r\n'))
    child.stdout?.on('data', forward)
    child.stderr?.on('data', forward)
    child.on('error', (error) => { append(entry, `${error.message}\r\n`) })
    child.on('close', code => finish(entry, code ?? 1))
    entry.child = child
  }

  const view = entry => ({ terminal: entry.id, state: entry.state, title: entry.plan?.title ?? null, command: entry.plan?.command ?? null })

  function sweep() {
    const now = Date.now()
    for (const entry of terminals.values()) {
      if (now - entry.touched > IDLE_MS) void close(entry)
    }
  }

  async function close(entry) {
    terminals.delete(entry.id)
    await entry.handle?.terminate?.().catch(() => {})
    entry.child?.kill?.('SIGTERM')
  }

  async function open(body) {
    // Under Unfold this host neither installs nor updates an Omni (omni-local.js says the same).
    if (unfoldHost(env)) throw refused(UNFOLD_RUNS_OMNI)
    const payload = parse(OpenPayload, body, 'Pick what the terminal is for')
    if (payload.kind === 'update' && !payload.id) throw invalid('Pick the Omni to update')
    sweep()
    const ended = state => !['preparing', 'ready', 'linking'].includes(state)
    for (const entry of [...terminals.values()].filter(other => ended(other.state))) await close(entry)
    if (terminals.size >= MAX_TERMINALS) throw refused('A terminal is already running. Finish it first.')
    const entry = { id: randomUUID(), kind: payload.kind, foundId: payload.id ?? null, state: 'preparing', step: null, output: '', base: 0, exitCode: null, result: null, error: null, plan: null, handle: null, pipe: null, child: null, touched: Date.now() }
    terminals.set(entry.id, entry)
    entry.ready = (async () => {
      try {
        entry.plan = await planFor(entry)
        await startTerminal(entry, { cols: payload.cols ?? 100, rows: payload.rows ?? 14 })
      } catch (error) {
        entry.state = 'failed'
        entry.error = error?.message ?? String(error)
      }
    })()
    if (payload.kind === 'update') await entry.ready
    if (entry.state === 'failed' && entry.plan === null) {
      terminals.delete(entry.id)
      throw refused(entry.error)
    }
    return view(entry)
  }

  const entryOf = (terminal) => {
    const entry = terminals.get(terminal)
    if (!entry) throw refused('That terminal has closed.')
    entry.touched = Date.now()
    return entry
  }

  // What arrived since `from`, and how the job stands. The key a link used never shows here:
  // a result carries only where it linked and that Omni's version.
  async function read(body) {
    const { terminal, from = 0 } = parse(ReadPayload, body, 'Name the terminal to read')
    const entry = entryOf(terminal)
    const start = Math.max(from, entry.base)
    const result = entry.result === null ? undefined
      : entry.result.status === 'paired' ? { status: 'paired', origin: entry.result.origin, version: entry.result.version ?? null }
        : { status: 'pairing', pairing: entry.result.pairing }
    return {
      ...view(entry),
      step: entry.step,
      data: entry.output.slice(start - entry.base),
      next: entry.base + entry.output.length,
      ...(entry.exitCode === null ? {} : { exitCode: entry.exitCode }),
      ...(result ? { result } : {}),
      ...(entry.error ? { error: entry.error } : {}),
    }
  }

  async function write(body) {
    const { terminal, data } = parse(WritePayload, body, 'Name the terminal and what to type')
    const entry = entryOf(terminal)
    if (entry.state !== 'ready') return { ok: false }
    if (entry.handle) {
      await entry.handle.write(data)
      return { ok: true }
    }
    // On pipes only Enter (run) and Ctrl-C or Ctrl-D (back out) mean anything at the prompt.
    if (entry.pipe && !entry.pipe.started) {
      if (data.includes('\u0003') || data.includes('\u0004')) {
        append(entry, '\r\n')
        void finish(entry, CANCELLED)
      } else if (/[\r\n]/.test(data)) runPiped(entry)
    }
    return { ok: true }
  }

  async function resize(body) {
    const { terminal, cols, rows } = parse(ResizePayload, body, 'Name the terminal and its size')
    await entryOf(terminal).handle?.resize(cols, rows).catch(() => {})
    return { ok: true }
  }

  async function closeEndpoint(body) {
    const { terminal } = parse(ClosePayload, body, 'Name the terminal to close')
    const entry = terminals.get(terminal)
    if (entry) await close(entry)
    return { ok: true }
  }

  const endpoints = { 'omni-terminal-open': open, 'omni-terminal-read': read, 'omni-terminal-write': write, 'omni-terminal-resize': resize, 'omni-terminal-close': closeEndpoint }
  rt.omniTerminalEndpoint = (endpoint, body) => endpoints[endpoint](body)
  rt.omniTerminalReady = terminal => terminals.get(terminal)?.ready
  // Opening runs commands on this computer, so only a host that may change things answers
  // it, and the keys typed into it; reading what it printed is a read.
  for (const [name, run] of Object.entries(endpoints)) {
    const register = name === 'omni-terminal-read' ? () => rt.hooks.endpoint(name, run, { read: true }) : () => rt.hooks.endpoint(name, run)
    rt.ctx.effect(register, `omni-channels: ${name}`)
  }
  rt.ctx.effect(() => () => { for (const entry of terminals.values()) void close(entry) }, 'omni-channels: close terminals')
}
