import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { call } from './api.js'
import { Hero, useCompanion } from './companion-art.js'

// What every Omni onboarding step shares: the done-flag gate, the finish, and the stage
// (octopus, speech bubble, step rail, card). The settings shell paints no chrome for a
// step, so the stage is the step's own modal, portaled to <body> with #root inert.

// Every Omni onboarding step, in order. Each plugin that brings one announces it as it
// applies (this one: Welcome and Connect AI; @automagik/omni-dsh's channels: Connect Omni),
// so the rail names only the steps this DSH will show.
export const RAIL = [['omni-companion', 'Your companion'], ['omni-team', 'Your team'], ['omni-connect', 'Connect Omni'], ['omni-connect-ai', 'Connect AI']]
const ANNOUNCED = Symbol.for('automagik.omni.onboarding-steps')

/** Marks step `id` as present until the returned function runs. */
export function announceStep(id, scope = globalThis) {
  const steps = (scope[ANNOUNCED] ??= new Set())
  steps.add(id)
  return () => steps.delete(id)
}

/** The rail's steps: the announced ones, in order; one never announced still shows itself. */
export function railSteps(current, scope = globalThis) {
  const steps = scope[ANNOUNCED]
  return RAIL.filter(([id]) => id === current || steps?.has(id) === true)
}
export const FLAG_OF = { 'omni-companion': 'companionDone', 'omni-team': 'teamDone', 'omni-connect-ai': 'connectAiDone' }

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
  const steps = railSteps(at)
  const here = steps.findIndex(([id]) => id === at)
  return h('ol', { className: 'oai-rail', 'aria-label': 'Setup steps' },
    steps.map(([id, label], index) => h('li', {
      key: id,
      className: index < here ? 'oai-done' : index === here ? 'oai-on' : '',
      'aria-current': index === here ? 'step' : undefined,
    }, label)))
}

// `hero` replaces the companion (or, before there is one, the octopus) at the top.
export function Stage({ title, speech, at, glitching, hero, mark = 'AUTOMAGIK', wide = false, children }) {
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
  const [look] = useCompanion()
  return createPortal(h('div', { className: 'oai-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'oai-title' },
    h('div', { className: `oai-stage${glitching ? ' oai-glitch' : ''}${wide ? ' oai-wide' : ''}` },
      hero ?? h(Hero, { look }),
      h('div', { className: 'oai-bubble' },
        h('span', { className: 'oai-hidden', role: 'status' }, speech),
        h('span', { 'aria-hidden': 'true' }, shown, shown.length < speech.length ? h('span', { className: 'oai-caret' }) : null)),
      h(Rail, { at }),
      h('main', { className: 'oai-card' },
        h('div', { className: 'oai-mark', 'aria-hidden': 'true' }, mark),
        h('h1', { id: 'oai-title', ref: titleRef, tabIndex: -1 }, title),
        children))), document.body)
}
