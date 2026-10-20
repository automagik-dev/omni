import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { call } from './api.js'
import { OCTOPUS_SVG } from './octopus.js'

// What every Omni onboarding step shares: the done-flag gate, the finish, and the stage
// (octopus, speech bubble, step rail, card). The settings shell paints no chrome for a
// step, so the stage is the step's own modal, portaled to <body> with #root inert.

export const RAIL = ['Welcome', 'Connect Omni', 'Connect AI']
export const FLAG_OF = { 'omni-welcome': 'welcomeDone', 'omni-connect-ai': 'connectAiDone' }

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Reads the host state once. A step whose flag is set completes at once and renders
// nothing (null); one the user reopened on purpose (`explicit`) shows anyway. A host that
// cannot answer leaves the step showing: finishing it writes the flag.
export async function gate({ stepId, explicit, complete }, request = call) {
  let state = {}
  try {
    state = (await request('state')) ?? {}
  } catch {}
  if (explicit !== true && state[FLAG_OF[stepId]] === true) {
    complete()
    return null
  }
  return state
}

// Keeps the step finished, then hands the shell to the next step.
export async function finish({ stepId, complete }, request = call) {
  try {
    await request('done', { stepId })
  } catch {}
  complete()
}

// A tile that leads to a settings section completes the step first, so the modal never
// covers the section it opens.
export async function finishInto(props, section, request = call) {
  await finish(props, request)
  props.openSection(section)
}

// undefined while deciding, null when the step completed itself, else the host state.
export function useGate(props) {
  const first = useRef(props)
  const [state, setState] = useState(undefined)
  useEffect(() => {
    let alive = true
    gate(first.current).then((next) => { if (alive) setState(next) })
    return () => { alive = false }
  }, [])
  return state
}

// One finish per step, however many clicks.
export function useFinish(props) {
  const done = useRef(false)
  return useCallback((section) => {
    if (done.current) return
    done.current = true
    if (section) void finishInto(props, section)
    else void finish(props)
  }, [props])
}

export function useGlitch() {
  const [on, setOn] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const glitch = useCallback(() => {
    if (reducedMotion()) return
    setOn(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOn(false), 900)
  }, [])
  return [on, glitch]
}

function useTypewriter(text) {
  const [shown, setShown] = useState(() => (reducedMotion() ? text : ''))
  useEffect(() => {
    if (reducedMotion()) {
      setShown(text)
      return undefined
    }
    let at = 0
    let timer = 0
    const tick = () => {
      at += 1
      setShown(text.slice(0, at))
      if (at < text.length) timer = setTimeout(tick, 22)
    }
    setShown('')
    timer = setTimeout(tick, 120)
    return () => clearTimeout(timer)
  }, [text])
  return shown
}

function Rail({ at }) {
  return h('ol', { className: 'oai-rail', 'aria-label': 'Setup steps' },
    RAIL.map((label, index) => h('li', {
      key: label,
      className: index < at ? 'oai-done' : index === at ? 'oai-on' : '',
      'aria-current': index === at ? 'step' : undefined,
    }, label)))
}

export function Stage({ title, speech, at, glitching, children }) {
  const titleRef = useRef(null)
  useEffect(() => {
    const root = document.getElementById('root')
    if (root === null) return undefined
    const previous = root.inert
    root.inert = true
    return () => { root.inert = previous }
  }, [])
  useEffect(() => { titleRef.current?.focus() }, [title])
  const shown = useTypewriter(speech)
  return createPortal(h('div', { className: 'oai-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'oai-title' },
    h('div', { className: `oai-stage${glitching ? ' oai-glitch' : ''}` },
      h('div', { dangerouslySetInnerHTML: { __html: OCTOPUS_SVG } }),
      h('div', { className: 'oai-bubble' },
        h('span', { className: 'oai-hidden', role: 'status' }, speech),
        h('span', { 'aria-hidden': 'true' }, shown, shown.length < speech.length ? h('span', { className: 'oai-caret' }) : null)),
      h(Rail, { at }),
      h('main', { className: 'oai-card' },
        h('div', { className: 'oai-mark', 'aria-hidden': 'true' }, 'OMNI'),
        h('h1', { id: 'oai-title', ref: titleRef, tabIndex: -1 }, title),
        children))), document.body)
}
