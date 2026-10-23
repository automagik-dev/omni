// The terminal Connect AI opens to sign Claude Code in: `claude auth login`, Anthropic's own
// login, typed at a prompt and run when the person presses Enter. Omni never handles the
// Claude account: the CLI signs itself in, and the row turns on once `claude auth status` says
// so. Orca's onboarding terminal (stablyai/orca, OnboardingInlineCommandTerminal.tsx, MIT) is
// the model, as in the Omni channels plugin's Connect step (apps/omni-channels-dsh/src/host/
// omni-terminal.js), which this follows for the same contract.
//
// The terminal is a real one from DSH's process service (ctx.subprocess.spawnTerminal): zsh's
// vared or bash's readline hold the command for editing. Without one, the command runs on
// pipes once Enter arrives. The host picks the command; the page only types keys into it.
import { spawn as spawnProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { delimiter, dirname } from 'node:path'
import { z } from 'zod'

const MAX_OUTPUT = 256 * 1024
const IDLE_MS = 30 * 60_000
const GRACE_MS = 2000
// What the shell exits with when the person backs out of the prompt (Ctrl-C, Ctrl-D).
export const CANCELLED = 130
// zsh's vared dies with the terminal's SIGINT on Ctrl-C, leaving no exit code: a cancel too.
export const codeOf = outcome => outcome.exitCode ?? (outcome.signal === 'SIGINT' ? CANCELLED : 128)

const failure = (code, message) => Object.assign(new Error(message), { code })
const invalid = message => failure('omni-ai/invalid', message)
const refused = message => failure('omni-ai/refused', message)

const Size = { cols: z.number().int().min(20).max(400).optional(), rows: z.number().int().min(4).max(120).optional() }
const OpenPayload = z.object({ kind: z.literal('claude-login'), ...Size }).strict()
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

// The command arrives in the environment, so nothing is interpolated into these scripts.
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

// The command the terminal shows: the CLI by name when DSH's PATH reaches it, else by path.
export function loginCommand(path, env = process.env) {
  const onPath = path && String(env.PATH ?? '').split(delimiter).includes(dirname(path))
  if (!path || onPath) return 'claude auth login'
  return `'${path.replace(/'/g, "'\\''")}' auth login`
}

async function pickShell(subprocess, env, platform) {
  for (const shell of shellOrder(platform)) {
    try {
      return promptArgv(shell, await subprocess.resolveExecutable(shell, env))
    } catch {}
  }
  throw new Error('This computer has no shell to run the command in.')
}

// `checkClaude` says where Claude Code is and whether it is signed in (providers.js).
export function createTerminalActions(ctx, { checkClaude, subprocess: given, env = process.env, home = homedir(), platform = process.platform, spawn = spawnProcess } = {}) {
  // DSH's process service, while it is there: this plugin does not require it.
  let service = null
  if (given === undefined) {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['subprocess'], (sub) => {
        const own = sub.subprocess
        service = own
        sub.effect(() => () => { if (service === own) service = null }, 'omni-ai: terminal service')
      })
    } else {
      try { service = ctx.subprocess ?? null } catch {}
    }
  }
  const subprocessNow = () => (given !== undefined ? given : service)
  const terminals = new Map()

  const append = (entry, text) => {
    entry.output += text
    entry.touched = Date.now()
    if (entry.output.length > MAX_OUTPUT) {
      const drop = entry.output.length - MAX_OUTPUT
      entry.output = entry.output.slice(drop)
      entry.base += drop
    }
  }

  // After the command: signed in is done, anything else leaves the output on screen.
  async function finish(entry, code) {
    entry.exitCode = code
    if (code === CANCELLED) {
      entry.state = 'cancelled'
      return
    }
    entry.state = 'checking'
    const check = await checkClaude().catch(() => null)
    if (check?.loggedIn) {
      entry.state = 'done'
      entry.result = { loggedIn: true, ...(check.email ? { email: check.email } : {}) }
      return
    }
    entry.state = 'failed'
    entry.error = code === 0 ? 'Claude Code still says it is not signed in. Try again.' : null
  }

  async function startTerminal(entry, size) {
    const shellEnv = { OMNI_TERMINAL_COMMAND: entry.command }
    const sub = subprocessNow()
    if (sub?.spawnTerminal) {
      try {
        const argv = await pickShell(sub, env, platform)
        entry.handle = await sub.spawnTerminal({ argv, cwd: home, env: shellEnv, cols: size.cols, rows: size.rows, terminalType: 'xterm-256color', graceMs: GRACE_MS })
        entry.handle.output.setEncoding?.('utf8')
        entry.handle.output.on('data', chunk => append(entry, String(chunk)))
        entry.state = 'ready'
        entry.handle.done.then(outcome => finish(entry, codeOf(outcome)), () => finish(entry, 1))
        return
      } catch (error) {
        ctx.logger?.warn?.('omni-ai: no terminal for the Claude Code login, running on pipes: %s', error?.message ?? error)
      }
    }
    entry.pipe = { env: shellEnv, started: false }
    append(entry, `\x1b[36m~ $\x1b[0m ${entry.command}`)
    entry.state = 'ready'
  }

  function runPiped(entry) {
    entry.pipe.started = true
    append(entry, '\r\n')
    let child
    try {
      child = spawn('/bin/sh', ['-c', 'eval "$OMNI_TERMINAL_COMMAND"'], { cwd: home, env: { ...env, ...entry.pipe.env }, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
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

  async function close(entry) {
    terminals.delete(entry.id)
    await entry.handle?.terminate?.().catch(() => {})
    entry.child?.kill?.('SIGTERM')
  }

  const entryOf = (terminal) => {
    const entry = terminals.get(terminal)
    if (!entry) throw refused('That terminal has closed.')
    entry.touched = Date.now()
    return entry
  }

  return {
    async 'ai-terminal-open'(body) {
      const payload = parse(OpenPayload, body, 'Say what the terminal is for')
      const now = Date.now()
      for (const entry of terminals.values()) {
        if (now - entry.touched > IDLE_MS || !['ready', 'checking'].includes(entry.state)) await close(entry)
      }
      if (terminals.size > 0) throw refused('A terminal is already open. Finish it first.')
      const check = await checkClaude().catch(() => null)
      if (!check?.installed) throw refused('Claude Code is not installed on this computer.')
      if (check.loggedIn) throw refused('Claude Code is signed in already.')
      const entry = { id: randomUUID(), state: 'preparing', command: loginCommand(check.path, env), output: '', base: 0, exitCode: null, result: null, error: null, handle: null, pipe: null, child: null, touched: Date.now() }
      terminals.set(entry.id, entry)
      await startTerminal(entry, { cols: payload.cols ?? 100, rows: payload.rows ?? 12 })
      return { terminal: entry.id, state: entry.state, command: entry.command }
    },

    async 'ai-terminal-read'(body) {
      const { terminal, from = 0 } = parse(ReadPayload, body, 'Name the terminal to read')
      const entry = entryOf(terminal)
      const start = Math.max(from, entry.base)
      return {
        terminal: entry.id,
        state: entry.state,
        data: entry.output.slice(start - entry.base),
        next: entry.base + entry.output.length,
        ...(entry.exitCode === null ? {} : { exitCode: entry.exitCode }),
        ...(entry.result ? { result: entry.result } : {}),
        ...(entry.error ? { error: entry.error } : {}),
      }
    },

    async 'ai-terminal-write'(body) {
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
    },

    async 'ai-terminal-resize'(body) {
      const { terminal, cols, rows } = parse(ResizePayload, body, 'Name the terminal and its size')
      await entryOf(terminal).handle?.resize(cols, rows).catch(() => {})
      return { ok: true }
    },

    async 'ai-terminal-close'(body) {
      const { terminal } = parse(ClosePayload, body, 'Name the terminal to close')
      const entry = terminals.get(terminal)
      if (entry) await close(entry)
      return { ok: true }
    },

    closeAll() {
      for (const entry of terminals.values()) void close(entry)
    },
  }
}
