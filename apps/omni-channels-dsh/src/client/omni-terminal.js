import { createElement as h, useEffect, useRef, useState } from 'react'
import XTERM_CSS from '@xterm/xterm/css/xterm.css'
import { call, t } from './core.js'

// The terminal a Connect row opens to update an Omni or set one up here (src/host/
// omni-terminal.js runs it). The command waits typed at the prompt: nothing runs until the
// person presses Enter, and they may edit it first. Orca's onboarding terminal (stablyai/orca,
// OnboardingInlineCommandTerminal.tsx, MIT) is the model. The terminal reports how it ended
// to `onEnded`: `{state:'done', result}` once the host linked to that Omni, else the state
// it stopped in, and its output stays on screen.

const READ_MS = 150
const ROWS = 12
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

// What the line under the terminal says while it runs.
export function footFor({ state, step, entered, exitCode, error }) {
  if (state === 'preparing') return step === 'download-bun' ? t('Getting Bun (checked against its published checksum)…') : t('Opening a terminal…')
  if (state === 'ready') return entered ? t('Running… This closes on its own when it finishes.') : t('The command is ready. Press Enter to run it, or edit it first.')
  if (state === 'linking') return t('Finished. Connecting…')
  if (state === 'done') return t('Finished. Closing the terminal…')
  if (state === 'cancelled') return t('Nothing ran. Open it again when you are ready.')
  if (error) return error
  return t('It stopped with exit code {code}. Read what it printed above, then try again.', { code: exitCode ?? '?' })
}

export function InlineTerminal({ kind, id, title, onEnded, onClose }) {
  const box = useRef(null)
  const [status, setStatus] = useState({ state: 'preparing', step: null, entered: false })
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
      if (terminal !== null) void call('omni-terminal-resize', { terminal, cols, rows: ROWS }).catch(() => {})
    }

    const read = async () => {
      try {
        const reply = await call('omni-terminal-read', { terminal, from: offset })
        if (!alive) return
        if (reply.data) term.write(reply.data)
        offset = reply.next ?? offset
        setStatus({ state: reply.state, step: reply.step ?? null, entered, exitCode: reply.exitCode, error: reply.error })
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
        writing = writing.then(() => call('omni-terminal-write', { terminal, data })).catch(() => {})
      })
      observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
      observer?.observe(box.current)
      const reply = await call('omni-terminal-open', { kind, ...(id ? { id } : {}), cols: term.cols, rows: ROWS })
      if (!alive) {
        void call('omni-terminal-close', { terminal: reply.terminal }).catch(() => {})
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
      if (terminal !== null) void call('omni-terminal-close', { terminal }).catch(() => {})
    }
  }, [kind, id])

  const stopped = status.state === 'failed' || status.state === 'cancelled'
  return h('div', { className: `ot-term${stopped ? ' ot-stopped' : ''}` },
    h('div', { className: 'ot-bar' },
      h('span', { className: 'ot-dots', 'aria-hidden': true }, h('i'), h('i'), h('i')),
      h('span', { className: 'ot-title' }, title),
      onClose ? h('button', { type: 'button', className: 'ot-close', onClick: onClose, 'aria-label': t('Close the terminal') }, '×') : h('span')),
    h('div', { className: 'ot-screen', ref: box, role: 'application', 'aria-label': t('{title} terminal', { title }) }),
    h('div', { className: 'ot-foot', role: 'status' }, footFor(status)))
}

export const OMNI_TERMINAL_CSS = XTERM_CSS + `
.ot-term{margin-top:12px;border:1px solid var(--bt-line-2);border-radius:12px;overflow:hidden;background:#05080e}
.ot-term.ot-stopped{border-color:color-mix(in srgb,var(--oc-bad,#ff6b6b) 55%,transparent)}
.ot-bar{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;padding:7px 12px;border-bottom:1px solid var(--bt-line);color:var(--bt-ink-2);font-size:12px}
.ot-dots{display:inline-flex;gap:6px}.ot-dots i{width:9px;height:9px;border-radius:50%;background:#253247}
.ot-title{text-align:center}
.ot-close{justify-self:end;background:none;border:0;color:var(--bt-ink-2);font-size:16px;line-height:1;cursor:pointer;padding:0 2px}
.ot-screen{padding:10px 12px;min-height:180px}
.ot-screen .xterm-viewport{background:#05080e!important}
.ot-foot{padding:8px 14px;border-top:1px solid var(--bt-line);color:var(--bt-ink-2);font-size:12.5px}
`
