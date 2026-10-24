import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ConnectOmni, OMNI_CONNECT_CSS } from './omni-connect.js'
import { CONNECT_STEP, gateConnect, isConnected, noteStepShown, skipConnect } from './onboarding.js'
import { call, CHARACTERS, t } from './core.js'

// Onboarding step omni-connect (order -250), between omni-ai's welcome (-300) and its
// Connect AI (-200): the Channels page's connect card on the octopus stage those steps
// stand on. The settings shell paints no chrome for a step, so the stage is the step's
// own modal, portaled to <body> with #root inert. Every class is prefixed oxs- and the
// card's theme tokens are set on the overlay, so the stage restyles nothing of DSH's.

// The rail names only the onboarding steps this DSH has. Each plugin that brings one
// announces it on a registry shared through globalThis (the same contract as
// @automagik/welcome-dsh's stage.js): this one brings omni-connect.
const RAIL = [['omni-welcome', 'Welcome'], ['omni-connect', 'Connect Omni'], ['omni-connect-ai', 'Connect AI']]
const ANNOUNCED = Symbol.for('automagik.omni.onboarding-steps')

export function announceStep(id, scope = globalThis) {
  const steps = (scope[ANNOUNCED] ??= new Set())
  steps.add(id)
  return () => steps.delete(id)
}

export function railSteps(scope = globalThis) {
  const steps = scope[ANNOUNCED]
  return RAIL.filter(([id]) => id === CONNECT_STEP.id || steps?.has(id) === true)
}

// The footer's Continue: off until an Omni is linked, then naming the step it goes on to.
// Opened on demand (wizard.js), the wizard has no next step: it ends with Done.
export function continueButton(linked, scope = globalThis, { onDemand = false } = {}) {
  if (onDemand) return linked ? { label: t('Done'), disabled: false, title: undefined } : { label: t('Done'), disabled: true, title: t('Connect an Omni first, or close this') }
  if (!linked) return { label: t('Continue'), disabled: true, title: t('Connect an Omni first, or skip for now') }
  const next = railSteps(scope).some(([id]) => id === 'omni-connect-ai')
  return { label: next ? t('Continue to Connect AI →') : t('Continue'), disabled: false, title: undefined }
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const OCTOPUS = CHARACTERS.octopus
const OCTOPUS_SVG = `<svg class="oxs-octo" viewBox="0 0 100 100" aria-hidden="true">
<defs><linearGradient id="oxs-octo-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ff4ff"/><stop offset=".5" stop-color="#22d3ee"/><stop offset="1" stop-color="#0e7490"/></linearGradient></defs>
<path class="oxs-ghost oxs-cyan" d="${OCTOPUS.body}"/><path class="oxs-ghost oxs-magenta" d="${OCTOPUS.body}"/>
<path d="${OCTOPUS.body}" fill="url(#oxs-octo-skin)"/><path d="${OCTOPUS.shade}" fill="#0b4f6c" opacity=".55"/>
<path d="${OCTOPUS.light}" fill="#fff" opacity=".45"/>
<g class="oxs-eyes">${OCTOPUS.eyes.map(([cx, cy, width, height]) => `<ellipse cx="${cx}" cy="${cy}" rx="${width}" ry="${height}" fill="#06121f"/><circle cx="${cx + 2}" cy="${cy - 5}" r="2.4" fill="#fff"/>`).join('')}</g>
<path d="M44 54Q50 59 56 54" stroke="#06121f" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<ellipse cx="31" cy="50" rx="5" ry="2.8" fill="#ff5fb8" opacity=".5"/><ellipse cx="69" cy="50" rx="5" ry="2.8" fill="#ff5fb8" opacity=".5"/>
</svg>`

function useGlitch() {
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

function Stage({ title, speech, glitching, rail = true, children }) {
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
  return createPortal(h('div', { className: 'oxs-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'oxs-title' },
    h('div', { className: `oxs-stage${glitching ? ' oxs-glitch' : ''}` },
      h('div', { dangerouslySetInnerHTML: { __html: OCTOPUS_SVG } }),
      h('div', { className: 'oxs-bubble' },
        h('span', { className: 'oxs-hidden', role: 'status' }, speech),
        h('span', { 'aria-hidden': 'true' }, shown, shown.length < speech.length ? h('span', { className: 'oxs-caret' }) : null)),
      rail ? h('ol', { className: 'oxs-rail', 'aria-label': t('Setup steps') }, railSteps().map(([id, label], index, steps) => {
        const at = steps.findIndex(([step]) => step === CONNECT_STEP.id)
        return h('li', {
          key: id,
          className: index < at ? 'oxs-done' : index === at ? 'oxs-on' : '',
          'aria-current': index === at ? 'step' : undefined,
        }, t(label))
      })) : null,
      h('main', { className: 'oxs-card' },
        h('div', { className: 'oxs-mark', 'aria-hidden': 'true' }, 'OMNI'),
        h('h1', { id: 'oxs-title', ref: titleRef, tabIndex: -1 }, title),
        children))), document.body)
}

// undefined while deciding, null when the step completed itself, else { link }.
function useGate(props) {
  const first = useRef(props)
  const [state, setState] = useState(undefined)
  useEffect(() => {
    let alive = true
    gateConnect(first.current, { request: call }).then((next) => { if (alive) setState(next) })
    return () => { alive = false }
  }, [])
  return state
}

// `onDemand`: opened by this plugin (wizard.js) rather than DSH's first-run onboarding. It
// shows the choices even when an Omni is linked (to change it), has no rail of steps, and
// closes without keeping a skip.
export function ConnectOmniStep(props) {
  const state = useGate(props)
  const [glitching, glitch] = useGlitch()
  const [paired, setPaired] = useState(null)
  const finished = useRef(false)
  const onDemand = props.onDemand === true
  useEffect(() => { if (state) glitch() }, [state, glitch])
  // While DSH's own onboarding shows this step, the wizard does not open by itself.
  useEffect(() => (state && !onDemand ? noteStepShown() : undefined), [state, onDemand])

  // One completion per step, however it ends.
  const complete = useCallback(() => {
    if (finished.current) return
    finished.current = true
    props.complete()
  }, [props])
  const skip = useCallback(() => {
    if (finished.current) return
    finished.current = true
    if (onDemand) props.complete()
    else void skipConnect({ complete: props.complete })
  }, [props, onDemand])
  // The link shows on its row, and Continue lights up: the person moves on when they like.
  const onPaired = useCallback((origin) => {
    setPaired(origin)
    glitch()
  }, [glitch])

  if (!state) return null
  if (isConnected(state.link) && !onDemand) {
    const origin = state.link.origin ?? ''
    return h(Stage, { title: t('Omni connected'), speech: origin ? t('Connected to {origin}! Now I can see your channels.', { origin }) : t('Your Omni is connected. Now I can see your channels.'), glitching },
      h('button', { type: 'button', className: 'oxs-primary', onClick: complete }, t('Continue')))
  }
  const next = continueButton(paired !== null, globalThis, { onDemand })
  return h(Stage, { title: t('Connect your Omni'), speech: paired !== null ? t('Connected to {origin}! Now I can see your channels.', { origin: paired }) : t('Show me your Omni, so I can see your channels.'), glitching, rail: !onDemand },
    h(ConnectOmni, { onPaired, embedded: true }),
    h('div', { className: 'oxs-actions' },
      h('button', { type: 'button', className: 'oxs-quiet', onClick: skip }, onDemand ? t('Close') : t('Skip for now')),
      h('button', { type: 'button', className: 'oxs-primary', disabled: next.disabled, title: next.title, onClick: complete }, next.label)))
}

const STAGE_CSS = `
.oxs-overlay{--oxs-bg:#05070f;--oxs-card:rgba(13,20,36,.8);--oxs-ink:#eef3ff;--oxs-ink2:#9fb0cc;--oxs-line:rgba(120,160,220,.22);--oxs-accent:#22d3ee;--oxs-accent-2:#ff3bd4;
  --bt-line:var(--oxs-line);--bt-line-2:rgba(120,160,220,.32);--bt-accent:var(--oxs-accent);--bt-accent-ink:#03141a;--bt-ink:var(--oxs-ink);--bt-ink-2:var(--oxs-ink2);--bt-surface:transparent;--bt-bg:rgba(0,0,0,.25);--bt-hover:rgba(255,255,255,.06);--oc-bad:#ff6b6b;
  position:fixed;inset:0;z-index:2000;overflow:auto;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box;color-scheme:dark;color:var(--oxs-ink);
  font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  background:radial-gradient(1200px 600px at 50% -10%,rgba(34,211,238,.18),transparent 60%),radial-gradient(900px 500px at 100% 110%,rgba(255,59,212,.16),transparent 60%),var(--oxs-bg)}
.oxs-overlay *{box-sizing:border-box}
.oxs-overlay::before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.55;
  background-image:radial-gradient(1px 1px at 12% 18%,#fff,transparent),radial-gradient(1px 1px at 72% 12%,#cde,transparent),radial-gradient(1.5px 1.5px at 38% 72%,#fff,transparent),radial-gradient(1px 1px at 86% 64%,#bcd,transparent),radial-gradient(1px 1px at 22% 88%,#fff,transparent),radial-gradient(1.5px 1.5px at 58% 40%,#def,transparent);
  animation:oxs-twinkle 6s ease-in-out infinite alternate}
.oxs-overlay::after{content:"";position:fixed;left:-50%;right:-50%;bottom:-30vh;height:60vh;pointer-events:none;opacity:.35;
  background-image:linear-gradient(rgba(34,211,238,.35) 1px,transparent 1px),linear-gradient(90deg,rgba(255,59,212,.22) 1px,transparent 1px);background-size:56px 56px;
  transform:perspective(420px) rotateX(62deg);mask-image:linear-gradient(to top,#000,transparent);animation:oxs-grid 9s linear infinite}
@keyframes oxs-twinkle{from{opacity:.35}to{opacity:.7}}
@keyframes oxs-grid{from{background-position:0 0}to{background-position:0 56px}}
.oxs-stage{position:relative;z-index:1;width:min(640px,100%);display:flex;flex-direction:column;align-items:center}
.oxs-octo{width:124px;height:124px;filter:drop-shadow(0 12px 30px rgba(34,211,238,.35));animation:oxs-float 4.5s ease-in-out infinite}
.oxs-ghost{opacity:0}.oxs-cyan{fill:#00f0ff}.oxs-magenta{fill:#ff2bd6}
.oxs-octo:hover .oxs-cyan,.oxs-glitch .oxs-cyan{opacity:.55;transform:translate(-2.5px,0);animation:oxs-glitch 2.4s steps(1) infinite}
.oxs-octo:hover .oxs-magenta,.oxs-glitch .oxs-magenta{opacity:.55;transform:translate(2.5px,0);animation:oxs-glitch 2.4s steps(1) infinite reverse}
.oxs-eyes{transform-origin:50px 36px;animation:oxs-blink 5s infinite}
@keyframes oxs-float{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-10px) rotate(2deg)}}
@keyframes oxs-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes oxs-glitch{0%{clip-path:inset(0 0 70% 0)}25%{clip-path:inset(40% 0 30% 0)}50%{clip-path:inset(75% 0 0 0)}75%{clip-path:inset(10% 0 60% 0)}}
.oxs-bubble{position:relative;margin:6px 0 18px;padding:10px 16px;border-radius:14px;background:rgba(34,211,238,.12);border:1px solid rgba(34,211,238,.35);color:#d6f8ff;font:500 15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;min-height:44px;max-width:100%}
.oxs-bubble::before{content:"";position:absolute;top:-7px;left:50%;width:12px;height:12px;border-left:inherit;border-top:inherit;transform:translateX(-50%) rotate(45deg);background:#0d2232}
.oxs-caret{display:inline-block;width:.55em;height:1.05em;margin-left:2px;vertical-align:-2px;background:var(--oxs-accent-2);animation:oxs-caret 1s steps(1) infinite}
@keyframes oxs-caret{50%{opacity:0}}
.oxs-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.oxs-rail{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:0 0 14px;padding:0;list-style:none;font:600 11px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--oxs-ink2)}
.oxs-rail li{padding:6px 10px;border-radius:999px;border:1px solid var(--oxs-line)}.oxs-rail li.oxs-on{color:#05070f;background:var(--oxs-accent);border-color:var(--oxs-accent)}.oxs-rail li.oxs-done{color:var(--oxs-accent);border-color:rgba(34,211,238,.5)}
.oxs-card{width:100%;background:var(--oxs-card);border:1px solid var(--oxs-line);border-radius:20px;padding:24px;backdrop-filter:blur(14px);box-shadow:0 30px 80px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.04)}
.oxs-card h1{font-size:21px;margin:0 0 10px;letter-spacing:-.01em;outline:none}
.oxs-mark{font:700 12px/1 ui-monospace,monospace;letter-spacing:.32em;color:var(--oxs-accent);margin-bottom:14px}
.oxs-card .ox-card{margin:4px 0 8px;background:rgba(0,0,0,.2)}
.oxs-card .oc-primary,.oxs-card .oc-ghost{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 16px;border-radius:999px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;text-decoration:none}
.oxs-card .oc-primary{border:0;background:linear-gradient(135deg,var(--oxs-accent),var(--oxs-accent-2));color:#06060f}.oxs-card .oc-primary:disabled{opacity:.45;cursor:default}
.oxs-card .oc-ghost{border:1px solid var(--oxs-line);background:none;color:var(--oxs-ink2)}
.oxs-card .oc-spinner{width:14px;height:14px;border-radius:50%;border:2px solid rgba(34,211,238,.25);border-top-color:var(--oxs-accent);animation:oxs-spin .8s linear infinite;flex:none}
@keyframes oxs-spin{to{transform:rotate(360deg)}}
.oxs-card button.oxs-primary,.oxs-card button.oxs-quiet{display:block;width:100%;padding:12px 14px;margin:8px 0 0;border-radius:13px;font:inherit;font-weight:600;cursor:pointer;text-align:center}
.oxs-card button.oxs-primary{border:1px solid transparent;background:linear-gradient(135deg,var(--oxs-accent),var(--oxs-accent-2));color:#06060f}
.oxs-card button.oxs-quiet{border:1px solid transparent;background:none;color:var(--oxs-ink2);font-weight:500}
.oxs-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;padding-top:16px;border-top:1px solid var(--oxs-line)}
.oxs-card .oxs-actions button.oxs-primary,.oxs-card .oxs-actions button.oxs-quiet{display:inline-flex;width:auto;margin:0;padding:11px 18px}
.oxs-card .oxs-actions button.oxs-quiet{padding-left:0}
.oxs-card button.oxs-primary:disabled{opacity:.38;cursor:not-allowed;filter:grayscale(.6)}
.oxs-card button.oxs-primary:not(:disabled){box-shadow:0 6px 24px -8px rgba(255,59,212,.6)}
.oxs-card .ox-card{display:block}
.oxs-card button:focus-visible,.oxs-card a:focus-visible,.oxs-card input:focus-visible{outline:2px solid var(--oxs-accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.oxs-overlay *,.oxs-overlay::before,.oxs-overlay::after{animation:none!important;transition:none!important}}
`

function installStageStyles() {
  const style = document.createElement('style')
  style.dataset.omniConnectStep = ''
  // The card's own rules too: the Channels page installs them only with the Omni surface.
  style.textContent = OMNI_CONNECT_CSS + STAGE_CSS
  document.head.append(style)
  return () => style.remove()
}

// Registers the step on DSH's settings.onboarding slot, which ui-settings declares in its
// own apply, possibly after this one.
export function registerConnectStep(ctx) {
  ctx.effect(installStageStyles, 'omni-ui: onboarding stage styles')
  ctx.effect(() => announceStep(CONNECT_STEP.id), 'omni-channels: omni-connect on the rail')
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({ name: 'settings.onboarding', id: CONNECT_STEP.id, order: CONNECT_STEP.order }, ConnectOmniStep))
}
