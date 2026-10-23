import { createElement as h, useEffect, useRef, useState } from 'react'
import XTERM_CSS from '@xterm/xterm/css/xterm.css'
import { call } from './api.js'

// The terminal the Claude row opens to sign Claude Code in (src/host/terminal.js runs it).
// `claude auth login` waits typed at the prompt: nothing runs until the person presses Enter,
// and they may edit it first. Orca's onboarding terminal (stablyai/orca,
// OnboardingInlineCommandTerminal.tsx, MIT) is the model, as in the Omni channels plugin's
// Connect step. `onEnded` gets how it ended: `{state:'done', result}` once Claude Code says it
// is signed in, else the state it stopped in, with the output left on screen.

const READ_MS = 150
const ROWS = 10
const FONT = '13px ui-monospace, SFMono-Regular, Menlo, monospace'
const THEME = {
  background: '#05080e', foreground: '#cfe3ee', cursor: '#22d3ee', cursorAccent: '#05080e', selectionBackground: '#1f4b5c',
  black: '#0b111d', red: '#ff6b6b', green: '#4fe0a8', yellow: '#f0c86a', blue: '#5fa8f0', magenta: '#ff3bd4', cyan: '#22d3ee', white: '#cfe3ee',
  brightBlack: '#5d6b82', brightRed: '#ff8f8f', brightGreen: '#7ef0c2', brightYellow: '#ffd98a', brightBlue: '#8cc3ff', brightMagenta: '#ff7fe3', brightCyan: '#8ff4ff', brightWhite: '#ffffff',
}
const ENDED = new Set(['done', 'failed', 'cancelled'])

// Columns that fit the terminal's box, from the width of one character of its font.
export function columnsFor(width, charWidth) {
  if (!(width > 0) || !(charWidth > 0)) return 80
  return Math.max(30, Math.min(400, Math.floor((width - 24) / charWidth)))
}
let measured = 0
function charWidth() {
  if (measured > 0) return measured
  const context = document.createElement('canvas').getContext?.('2d')
  if (!context) return 7.8
  context.font = FONT
  measured = context.measureText('W').width || 7.8
  return measured
}

// What the line under the terminal says.
export function footFor({ state, entered, exitCode, error }) {
  if (state === 'preparing') return 'Opening a terminal…'
  if (state === 'ready') return entered ? 'Signing in… Finish in the browser page Claude Code opens.' : 'The command is ready. Press Enter to run it, or edit it first.'
  if (state === 'checking') return 'Finished. Checking that Claude Code is signed in…'
  if (state === 'done') return 'Signed in. Closing the terminal…'
  if (state === 'cancelled') return 'Nothing ran. Open it again when you are ready.'
  if (error) return error
  return `It stopped with exit code ${exitCode ?? '?'}. Read what it printed above, then try again.`
}

export function ClaudeLoginTerminal({ onEnded, onClose }) {
  const box = useRef(null)
  const [status, setStatus] = useState({ state: 'preparing', entered: false })
  const ended = useRef(onEnded)
  ended.current = onEnded

  useEffect(() => {
    let alive = true
    let timer = 0
    let terminal = null
    let offset = 0
    let entered = false
    let writing = Promise.resolve()
    let term = null
    let typed = null
    let observer = null

    const fit = () => {
      const cols = columnsFor(box.current?.clientWidth, charWidth())
      if (term === null || cols === term.cols) return
      term.resize(cols, ROWS)
      if (terminal !== null) void call('ai-terminal-resize', { terminal, cols, rows: ROWS }).catch(() => {})
    }

    const read = async () => {
      try {
        const reply = await call('ai-terminal-read', { terminal, from: offset })
        if (!alive) return
        if (reply.data) term.write(reply.data)
        offset = reply.next ?? offset
        setStatus({ state: reply.state, entered, exitCode: reply.exitCode, error: reply.error })
        if (ENDED.has(reply.state)) {
          ended.current?.(reply)
          return
        }
      } catch (error) {
        if (!alive) return
        setStatus({ state: 'failed', error: error.message, entered })
        return
      }
      timer = setTimeout(read, READ_MS)
    }

    // xterm loads with the first terminal: it reads the browser as it loads.
    const start = async () => {
      const { Terminal } = await import('@xterm/xterm')
      if (!alive) return
      term = new Terminal({ rows: ROWS, cols: columnsFor(box.current?.clientWidth, charWidth()), fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.2, cursorBlink: true, scrollback: 2000, theme: THEME })
      term.open(box.current)
      // Keys go to the host one after another, in the order typed.
      typed = term.onData((data) => {
        if (terminal === null) return
        if (/[\r\n]/.test(data) && !entered) {
          entered = true
          setStatus(previous => ({ ...previous, entered: true }))
        }
        writing = writing.then(() => call('ai-terminal-write', { terminal, data })).catch(() => {})
      })
      observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
      observer?.observe(box.current)
      const reply = await call('ai-terminal-open', { kind: 'claude-login', cols: term.cols, rows: ROWS })
      if (!alive) {
        void call('ai-terminal-close', { terminal: reply.terminal }).catch(() => {})
        return
      }
      terminal = reply.terminal
      setStatus(previous => ({ ...previous, state: reply.state }))
      term.focus()
      void read()
    }
    start().catch((error) => {
      if (alive) setStatus({ state: 'failed', error: error.message, entered: false })
    })

    return () => {
      alive = false
      clearTimeout(timer)
      observer?.disconnect()
      typed?.dispose()
      term?.dispose()
      if (terminal !== null) void call('ai-terminal-close', { terminal }).catch(() => {})
    }
  }, [])

  const stopped = status.state === 'failed' || status.state === 'cancelled'
  return h('div', { className: `oai-term${stopped ? ' oai-term-stopped' : ''}` },
    h('div', { className: 'oai-term-bar' },
      h('span', { className: 'oai-term-dots', 'aria-hidden': true }, h('i'), h('i'), h('i')),
      h('span', { className: 'oai-term-title' }, 'Sign in to Claude Code'),
      onClose ? h('button', { type: 'button', className: 'oai-term-close', onClick: onClose, 'aria-label': 'Close the terminal' }, '×') : h('span')),
    h('div', { className: 'oai-term-screen', ref: box, role: 'application', 'aria-label': 'Claude Code sign-in terminal' }),
    h('div', { className: 'oai-term-foot', role: 'status' }, footFor(status)))
}

export const TERMINAL_CSS = XTERM_CSS + `
.oai-term{margin-top:10px;border:1px solid var(--oai-line);border-radius:12px;overflow:hidden;background:#05080e}
.oai-term.oai-term-stopped{border-color:color-mix(in srgb,var(--oai-bad) 55%,transparent)}
.oai-term-bar{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;padding:7px 12px;border-bottom:1px solid var(--oai-line);color:var(--oai-ink2);font-size:12px}
.oai-term-dots{display:inline-flex;gap:6px}.oai-term-dots i{width:9px;height:9px;border-radius:50%;background:#253247}
.oai-term-title{text-align:center}
.oai-card button.oai-term-close{justify-self:end;width:auto;margin:0;padding:0 2px;background:none;border:0;color:var(--oai-ink2);font-size:16px;line-height:1}
.oai-term-screen{padding:10px 12px;min-height:150px}
.oai-term-screen .xterm-viewport{background:#05080e!important}
.oai-term-foot{padding:8px 14px;border-top:1px solid var(--oai-line);color:var(--oai-ink2);font-size:12.5px}
`
