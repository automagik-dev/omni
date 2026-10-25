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
<defs><radialGradient id="oxs-octo-skin" cx=".35" cy=".25" r=".9"><stop offset="0" style="stop-color:color-mix(in srgb,var(--oxs-skin) 55%,#fff)"/><stop offset=".55" style="stop-color:var(--oxs-skin)"/><stop offset="1" style="stop-color:var(--oxs-skin-shade)"/></radialGradient></defs>
<path class="oxs-ghost oxs-cyan" d="${OCTOPUS.body}"/><path class="oxs-ghost oxs-magenta" d="${OCTOPUS.body}"/>
<path d="${OCTOPUS.body}" fill="url(#oxs-octo-skin)"/><path d="${OCTOPUS.shade}" style="fill:var(--oxs-skin-shade)" opacity=".45"/>
<path d="${OCTOPUS.light}" fill="#fff" opacity=".4"/>
<g class="oxs-eyes">${OCTOPUS.eyes.map(([cx, cy, width, height]) => `<ellipse cx="${cx}" cy="${cy}" rx="${width}" ry="${height}" fill="#2a2233"/><circle cx="${cx + 2}" cy="${cy - 5}" r="2.4" fill="#fff"/>`).join('')}</g>
<path d="M44 54Q50 59 56 54" stroke="#2a2233" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<ellipse cx="31" cy="50" rx="5" ry="2.8" fill="#e98bbf" opacity=".55"/><ellipse cx="69" cy="50" rx="5" ry="2.8" fill="#e98bbf" opacity=".55"/>
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

// The stage is the welcome's clay (@automagik/welcome-dsh src/client/clay.js and octopus.js in
// automagik-dev/automagik), restated because this plugin installs on its own: every surface a
// piece of modelling clay lit from the upper left, light first, and the same clay at night
// under DSH's dark palette (body[data-ds-dark-theme]). The colours are the welcome's proposed
// values, not brand standards.
const raised = (fill, depth = 4) => `background:${fill};box-shadow:inset 2px 3px 4px color-mix(in srgb,${fill} var(--oxs-hi),var(--oxs-shine)),inset -3px -4px 6px color-mix(in srgb,${fill} var(--oxs-lo),var(--oxs-umber)),0 ${depth}px 0 color-mix(in srgb,${fill} var(--oxs-ledge),var(--oxs-umber)),0 ${depth + 3}px ${depth + 5}px var(--oxs-cast),0 ${depth * 3 + 4}px ${depth * 5 + 8}px var(--oxs-cast-far)`
const pressed = (fill, depth = 4) => `transform:translateY(${depth - 1}px);box-shadow:inset 3px 4px 6px color-mix(in srgb,${fill} var(--oxs-lo),var(--oxs-umber)),inset -1px -2px 3px color-mix(in srgb,${fill} var(--oxs-hi),var(--oxs-shine)),0 1px 0 color-mix(in srgb,${fill} var(--oxs-ledge),var(--oxs-umber)),0 2px 3px var(--oxs-cast)`
const recessed = fill => `background:${fill};box-shadow:inset 3px 4px 6px color-mix(in srgb,${fill} var(--oxs-lo),var(--oxs-umber)),inset -2px -2px 3px color-mix(in srgb,${fill} var(--oxs-hi),var(--oxs-shine)),0 1px 0 color-mix(in srgb,var(--oxs-bg) var(--oxs-hi),var(--oxs-shine))`

const STAGE_CSS = `
.oxs-overlay{
  --oxs-bg:#f6eee2;--oxs-card:#fbf5ec;--oxs-clay:#f2e6d5;--oxs-niche:#ebdecb;
  --oxs-ink:#3c3049;--oxs-ink2:#6c5f71;--oxs-line:#e0d0bd;
  --oxs-accent:#1b7f96;--oxs-accent-2:#b4498f;--oxs-bad:#b93a32;--oxs-ok:#2f8a63;--oxs-warn:#a8700f;
  --oxs-cyan:#8fdcec;--oxs-cyan-ink:#1d4753;--oxs-pink:#f0bddf;--oxs-lilac:#e0cff3;--oxs-lilac-ink:#45305e;
  --oxs-skin:#2bc3b6;--oxs-skin-shade:#16867d;
  --oxs-shine:#fff;--oxs-umber:#5b3b22;--oxs-hi:42%;--oxs-lo:80%;--oxs-ledge:72%;
  --oxs-cast:rgba(111,81,53,.2);--oxs-cast-far:rgba(121,91,53,.1);--oxs-ring:#b4498f;
  --oxs-r:19px 22px 18px 21px;--oxs-r-sm:12px 14px 12px 13px;
  --oxs-font:"DM Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --oxs-head:Manrope,"DM Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --bt-line:var(--oxs-line);--bt-line-2:color-mix(in srgb,var(--oxs-line) 70%,var(--oxs-ink2));--bt-accent:var(--oxs-accent);--bt-accent-ink:#fff;
  --bt-ink:var(--oxs-ink);--bt-ink-2:var(--oxs-ink2);--bt-ink-3:var(--oxs-ink2);--bt-surface:transparent;--bt-bg:var(--oxs-niche);--bt-card:var(--oxs-card);
  --bt-hover:color-mix(in srgb,var(--oxs-clay) 70%,var(--oxs-niche));--oc-bad:var(--oxs-bad);
  position:fixed;inset:0;z-index:2000;overflow:auto;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box;color-scheme:light;color:var(--oxs-ink);
  font:15px/1.55 var(--oxs-font);background:var(--oxs-bg)}
body[data-ds-dark-theme] .oxs-overlay{
  --oxs-bg:#1e1923;--oxs-card:#2a2330;--oxs-clay:#322a39;--oxs-niche:#16121a;
  --oxs-ink:#f3e9dd;--oxs-ink2:#bcadb8;--oxs-line:#40364a;
  --oxs-accent:#7fd8ea;--oxs-accent-2:#f2a6dc;--oxs-bad:#ff9a8f;--oxs-ok:#7ad9a8;--oxs-warn:#f2c25b;
  --oxs-cyan:#5cbdd1;--oxs-cyan-ink:#0d262c;--oxs-pink:#b76aa1;--oxs-lilac:#55456b;--oxs-lilac-ink:#f4ecff;
  --oxs-skin:#3fd3c5;--oxs-skin-shade:#1c8f86;
  --oxs-shine:#fff;--oxs-umber:#000;--oxs-hi:84%;--oxs-lo:62%;--oxs-ledge:50%;
  --oxs-cast:rgba(0,0,0,.42);--oxs-cast-far:rgba(0,0,0,.28);--oxs-ring:#f2a6dc;--bt-accent-ink:#0d262c;
  color-scheme:dark}
.oxs-overlay *{box-sizing:border-box}
.oxs-overlay ::selection{background:var(--oxs-lilac);color:var(--oxs-lilac-ink)}
.oxs-overlay::before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(1100px 620px at 30% -12%,color-mix(in srgb,var(--oxs-bg) 55%,var(--oxs-shine)),transparent 70%)}
body[data-ds-dark-theme] .oxs-overlay::before{background:radial-gradient(1100px 620px at 30% -12%,color-mix(in srgb,var(--oxs-bg) 88%,var(--oxs-cyan)),transparent 70%)}
.oxs-stage{position:relative;z-index:1;width:min(600px,100%);display:flex;flex-direction:column;align-items:center}
.oxs-octo{width:124px;height:124px;filter:drop-shadow(0 10px 8px var(--oxs-cast)) drop-shadow(0 22px 22px var(--oxs-cast-far));animation:oxs-float 4.5s ease-in-out infinite}
.oxs-ghost{opacity:0}.oxs-cyan{fill:var(--oxs-cyan)}.oxs-magenta{fill:var(--oxs-pink)}
.oxs-glitch .oxs-cyan{opacity:.7;transform:translate(-2px,0);animation:oxs-wobble .9s ease-out}
.oxs-glitch .oxs-magenta{opacity:.7;transform:translate(2px,0);animation:oxs-wobble .9s ease-out reverse}
.oxs-eyes{transform-origin:50px 36px;animation:oxs-blink 5s infinite}
@keyframes oxs-float{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-10px) rotate(2deg)}}
@keyframes oxs-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes oxs-wobble{from{opacity:.7}to{opacity:0}}
.oxs-bubble{position:relative;margin:10px 0 20px;padding:11px 18px;border-radius:var(--oxs-r);${raised('var(--oxs-cyan)', 4)};color:var(--oxs-cyan-ink);font:500 15px/1.45 var(--oxs-font);min-height:46px;max-width:100%}
.oxs-bubble::before{content:"";position:absolute;top:-7px;left:50%;width:14px;height:14px;border-radius:3px 0 0 0;transform:translateX(-50%) rotate(45deg);background:var(--oxs-cyan);box-shadow:inset 2px 2px 3px color-mix(in srgb,var(--oxs-cyan) var(--oxs-hi),var(--oxs-shine))}
.oxs-caret{display:inline-block;width:.5em;height:1.05em;margin-left:2px;vertical-align:-2px;border-radius:2px;background:var(--oxs-accent-2);animation:oxs-caret 1s steps(1) infinite}
@keyframes oxs-caret{50%{opacity:0}}
.oxs-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.oxs-rail{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin:0 0 18px;padding:0;list-style:none;font:600 12.5px/1 var(--oxs-font);color:var(--oxs-ink2)}
.oxs-rail li{padding:8px 12px;border-radius:var(--oxs-r-sm);${recessed('var(--oxs-niche)')}}
.oxs-rail li.oxs-on{color:var(--oxs-lilac-ink);${raised('var(--oxs-lilac)', 3)};transform:translateY(-2px)}
.oxs-rail li.oxs-done{color:var(--oxs-cyan-ink);${raised('color-mix(in srgb,var(--oxs-cyan) 55%,var(--oxs-clay))', 2)}}
.oxs-card{width:100%;border-radius:26px 30px 25px 29px;padding:26px;${raised('var(--oxs-card)', 6)}}
.oxs-card h1{font:800 24px/1.2 var(--oxs-head);letter-spacing:-.02em;margin:0 0 12px;outline:none}
/* The connect card inside (omni-connect.js), in the same clay: choices are pieces, fields are hollows. */
.oxs-card .ox-card{display:block;margin:4px 0 8px;padding:0;border:0;background:none}
.oxs-card .ox-mark,.oxs-card .ox-icon{${raised('var(--oxs-clay)', 2)};border-radius:11px 12px 10px 12px;color:var(--oxs-ink)}
.oxs-card .ox-icon.ox-accent{${raised('var(--oxs-pink)', 2)};color:var(--oxs-ink)}
.oxs-card .ox-choice{border:0;border-radius:var(--oxs-r);${raised('var(--oxs-clay)', 3)};transition:transform .16s cubic-bezier(.3,1.4,.5,1)}
.oxs-card .ox-choice.ox-open{${raised('var(--oxs-card)', 3)}}
.oxs-card .ox-choice:not(.ox-open):hover{transform:translateY(-2px)}
.oxs-card .ox-head{border-radius:var(--oxs-r)}
.oxs-card .ox-head:focus-visible{outline:3px solid var(--oxs-ring);outline-offset:2px}
.oxs-card .ox-badge{border:0;${recessed('var(--oxs-niche)')};color:var(--oxs-ink2)}
.oxs-card .ox-badge.ox-ok{background:color-mix(in srgb,var(--oxs-ok) 22%,var(--oxs-card));box-shadow:none;color:var(--oxs-ok)}
.oxs-card .ox-badge.ox-warn{background:color-mix(in srgb,var(--oxs-warn) 22%,var(--oxs-card));box-shadow:none;color:var(--oxs-warn)}
.oxs-card .ox-linked{color:var(--oxs-ok)}
.oxs-card .ox-input{height:44px;padding:0 14px;border:0;border-radius:var(--oxs-r-sm);${recessed('var(--oxs-niche)')};color:var(--oxs-ink);font:15px/1.3 var(--oxs-font)}
.oxs-card .ox-input::placeholder{color:color-mix(in srgb,var(--oxs-ink2) 80%,transparent)}
.oxs-card .ox-input:focus{outline:3px solid var(--oxs-ring);outline-offset:2px}
.oxs-card .ox-code{font-weight:700;color:var(--oxs-ink)}
.oxs-card .ox-qr{${raised('#fff', 3)}}
.oxs-card .oc-primary,.oxs-card .oc-ghost{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:0 16px;border:0;border-radius:var(--oxs-r-sm);font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;text-decoration:none;transition:transform .16s cubic-bezier(.3,1.4,.5,1)}
.oxs-card .oc-primary{${raised('var(--oxs-cyan)', 4)};color:var(--oxs-cyan-ink)}
.oxs-card .oc-primary:active:not(:disabled){${pressed('var(--oxs-cyan)', 4)}}
.oxs-card .oc-ghost{${raised('var(--oxs-clay)', 3)};color:var(--oxs-ink)}
.oxs-card .oc-ghost:active:not(:disabled){${pressed('var(--oxs-clay)', 3)}}
.oxs-card .oc-primary:hover:not(:disabled),.oxs-card .oc-ghost:hover:not(:disabled){transform:translateY(-2px)}
.oxs-card .oc-primary:disabled,.oxs-card .oc-ghost:disabled{${recessed('var(--oxs-niche)')};color:var(--oxs-ink2);cursor:default;transform:none}
.oxs-card .oc-spinner{width:14px;height:14px;border-radius:50%;border:2px solid color-mix(in srgb,var(--oxs-accent) 25%,transparent);border-top-color:var(--oxs-accent);animation:oxs-spin .8s linear infinite;flex:none}
@keyframes oxs-spin{to{transform:rotate(360deg)}}
.oxs-card .ox-link{color:var(--oxs-accent)}
.oxs-card button.oxs-primary,.oxs-card button.oxs-quiet{display:block;width:100%;min-height:44px;padding:12px 16px;margin:10px 0 0;border:0;border-radius:var(--oxs-r-sm);font:inherit;font-weight:600;cursor:pointer;text-align:center;transition:transform .16s cubic-bezier(.3,1.4,.5,1),box-shadow .16s ease}
.oxs-card button.oxs-primary{${raised('var(--oxs-cyan)', 5)};color:var(--oxs-cyan-ink)}
.oxs-card button.oxs-primary:hover:not(:disabled){transform:translateY(-2px)}
.oxs-card button.oxs-primary:active:not(:disabled){${pressed('var(--oxs-cyan)', 5)}}
/* Off until an Omni is linked: a flat hollow, not a piece, so it never reads as pressable. */
.oxs-card button.oxs-primary:disabled{${recessed('var(--oxs-niche)')};color:var(--oxs-ink2);cursor:not-allowed;transform:none}
.oxs-card button.oxs-quiet{background:none;box-shadow:none;color:var(--oxs-ink2);font-weight:500}
.oxs-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:20px;padding-top:16px;border-top:2px solid color-mix(in srgb,var(--oxs-line) 70%,transparent)}
.oxs-card .oxs-actions button.oxs-primary,.oxs-card .oxs-actions button.oxs-quiet{display:inline-flex;width:auto;margin:0;padding:11px 18px}
.oxs-card .oxs-actions button.oxs-quiet{padding-left:0}
.oxs-card button:focus-visible,.oxs-card a:focus-visible{outline:3px solid var(--oxs-ring);outline-offset:3px}
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
