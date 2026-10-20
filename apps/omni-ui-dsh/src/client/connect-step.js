import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { call } from './api.js'
import { CHARACTERS } from './characters.js'
import { ConnectOmni, OMNI_CONNECT_CSS } from './omni-connect.js'
import { CONNECT_STEP, gateConnect, isConnected, skipConnect } from './onboarding.js'
import { t } from './i18n.js'

// Onboarding step omni-connect (order -250), between omni-ai's welcome (-300) and its
// Connect AI (-200): the Channels page's connect card on the octopus stage those steps
// stand on. The settings shell paints no chrome for a step, so the stage is the step's
// own modal, portaled to <body> with #root inert. Every class is prefixed oxs- and the
// card's theme tokens are set on the overlay, so the stage restyles nothing of DSH's.

const RAIL = ['Welcome', 'Connect Omni', 'Connect AI']
const AT = 1
// How long the stage shows the new link before handing on to the next step.
const PAIRED_BEAT_MS = 1600

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const OCTOPUS = CHARACTERS.octopus
const OCTOPUS_SVG = `<svg class="oxs-octo" viewBox="0 0 100 100" aria-hidden="true">
<defs><linearGradient id="oxs-octo-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3ee6d0"/><stop offset="1" stop-color="#0b8f8a"/></linearGradient></defs>
<path class="oxs-ghost oxs-cyan" d="${OCTOPUS.body}"/><path class="oxs-ghost oxs-magenta" d="${OCTOPUS.body}"/>
<path d="${OCTOPUS.body}" fill="url(#oxs-octo-skin)"/><path d="${OCTOPUS.shade}" fill="#06706d" opacity=".55"/>
<path d="${OCTOPUS.light}" fill="#fff" opacity=".45"/>
<g class="oxs-eyes">${OCTOPUS.eyes.map(([cx, cy, width, height]) => `<ellipse cx="${cx}" cy="${cy}" rx="${width}" ry="${height}" fill="#06121f"/><circle cx="${cx + 2}" cy="${cy - 5}" r="2.4" fill="#fff"/>`).join('')}</g>
<path d="M44 54Q50 59 56 54" stroke="#06121f" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<ellipse cx="31" cy="50" rx="5" ry="2.8" fill="#ff7ab8" opacity=".5"/><ellipse cx="69" cy="50" rx="5" ry="2.8" fill="#ff7ab8" opacity=".5"/>
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

function Stage({ title, speech, glitching, children }) {
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
      h('ol', { className: 'oxs-rail', 'aria-label': t('Setup steps') }, RAIL.map((label, index) => h('li', {
        key: label,
        className: index < AT ? 'oxs-done' : index === AT ? 'oxs-on' : '',
        'aria-current': index === AT ? 'step' : undefined,
      }, t(label)))),
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

export function ConnectOmniStep(props) {
  const state = useGate(props)
  const [glitching, glitch] = useGlitch()
  const [paired, setPaired] = useState(null)
  const finished = useRef(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { if (state) glitch() }, [state, glitch])

  // One completion per step, however it ends.
  const complete = useCallback(() => {
    if (finished.current) return
    finished.current = true
    clearTimeout(timer.current)
    props.complete()
  }, [props])
  const skip = useCallback(() => {
    if (finished.current) return
    finished.current = true
    void skipConnect({ complete: props.complete })
  }, [props])
  const onPaired = useCallback((origin) => {
    setPaired(origin)
    glitch()
    timer.current = setTimeout(complete, reducedMotion() ? 0 : PAIRED_BEAT_MS)
  }, [complete, glitch])

  if (!state) return null
  if (paired !== null) {
    return h(Stage, { title: t('Omni connected'), speech: t('Connected to {origin}! Now I can see your channels.', { origin: paired }), glitching },
      h('button', { type: 'button', className: 'oxs-primary', onClick: complete }, t('Continue')))
  }
  if (isConnected(state.link)) {
    const origin = state.link.origin ?? ''
    return h(Stage, { title: t('Omni connected'), speech: origin ? t('Connected to {origin}! Now I can see your channels.', { origin }) : t('Your Omni is connected. Now I can see your channels.'), glitching },
      h('button', { type: 'button', className: 'oxs-primary', onClick: complete }, t('Continue')))
  }
  return h(Stage, { title: t('Connect your Omni'), speech: t('Show me your Omni, so I can see your channels. Approve this device from your phone.'), glitching },
    h(ConnectOmni, { onPaired, embedded: true }),
    h('button', { type: 'button', className: 'oxs-quiet', onClick: skip }, t('Skip for now')))
}

const STAGE_CSS = `
.oxs-overlay{--oxs-bg:#05070f;--oxs-card:rgba(13,20,36,.8);--oxs-ink:#eef3ff;--oxs-ink2:#9fb0cc;--oxs-line:rgba(120,160,220,.22);--oxs-accent:#22d3c5;
  --bt-line:var(--oxs-line);--bt-line-2:rgba(120,160,220,.32);--bt-accent:var(--oxs-accent);--bt-accent-ink:#03141a;--bt-ink:var(--oxs-ink);--bt-ink-2:var(--oxs-ink2);--bt-surface:transparent;--bt-bg:rgba(0,0,0,.25);--bt-hover:rgba(255,255,255,.06);--oc-bad:#ff6b6b;
  position:fixed;inset:0;z-index:2000;overflow:auto;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box;color-scheme:dark;color:var(--oxs-ink);
  font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  background:radial-gradient(1200px 600px at 50% -10%,rgba(34,211,197,.18),transparent 60%),radial-gradient(900px 500px at 100% 110%,rgba(124,92,255,.18),transparent 60%),var(--oxs-bg)}
.oxs-overlay *{box-sizing:border-box}
.oxs-overlay::before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.55;
  background-image:radial-gradient(1px 1px at 12% 18%,#fff,transparent),radial-gradient(1px 1px at 72% 12%,#cde,transparent),radial-gradient(1.5px 1.5px at 38% 72%,#fff,transparent),radial-gradient(1px 1px at 86% 64%,#bcd,transparent),radial-gradient(1px 1px at 22% 88%,#fff,transparent),radial-gradient(1.5px 1.5px at 58% 40%,#def,transparent);
  animation:oxs-twinkle 6s ease-in-out infinite alternate}
.oxs-overlay::after{content:"";position:fixed;left:-50%;right:-50%;bottom:-30vh;height:60vh;pointer-events:none;opacity:.35;
  background-image:linear-gradient(rgba(34,211,197,.35) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,197,.35) 1px,transparent 1px);background-size:56px 56px;
  transform:perspective(420px) rotateX(62deg);mask-image:linear-gradient(to top,#000,transparent);animation:oxs-grid 9s linear infinite}
@keyframes oxs-twinkle{from{opacity:.35}to{opacity:.7}}
@keyframes oxs-grid{from{background-position:0 0}to{background-position:0 56px}}
.oxs-stage{position:relative;z-index:1;width:min(640px,100%);display:flex;flex-direction:column;align-items:center}
.oxs-octo{width:124px;height:124px;filter:drop-shadow(0 12px 30px rgba(34,211,197,.35));animation:oxs-float 4.5s ease-in-out infinite}
.oxs-ghost{opacity:0}.oxs-cyan{fill:#00f0ff}.oxs-magenta{fill:#ff2bd6}
.oxs-octo:hover .oxs-cyan,.oxs-glitch .oxs-cyan{opacity:.55;transform:translate(-2.5px,0);animation:oxs-glitch 2.4s steps(1) infinite}
.oxs-octo:hover .oxs-magenta,.oxs-glitch .oxs-magenta{opacity:.55;transform:translate(2.5px,0);animation:oxs-glitch 2.4s steps(1) infinite reverse}
.oxs-eyes{transform-origin:50px 36px;animation:oxs-blink 5s infinite}
@keyframes oxs-float{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-10px) rotate(2deg)}}
@keyframes oxs-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes oxs-glitch{0%{clip-path:inset(0 0 70% 0)}25%{clip-path:inset(40% 0 30% 0)}50%{clip-path:inset(75% 0 0 0)}75%{clip-path:inset(10% 0 60% 0)}}
.oxs-bubble{position:relative;margin:6px 0 18px;padding:10px 16px;border-radius:14px;background:rgba(34,211,197,.12);border:1px solid rgba(34,211,197,.35);color:#c9fff8;font:500 15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;min-height:44px;max-width:100%}
.oxs-bubble::before{content:"";position:absolute;top:-7px;left:50%;width:12px;height:12px;border-left:inherit;border-top:inherit;transform:translateX(-50%) rotate(45deg);background:#0e2a33}
.oxs-caret{display:inline-block;width:.55em;height:1.05em;margin-left:2px;vertical-align:-2px;background:#7ff7ea;animation:oxs-caret 1s steps(1) infinite}
@keyframes oxs-caret{50%{opacity:0}}
.oxs-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.oxs-rail{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:0 0 14px;padding:0;list-style:none;font:600 11px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--oxs-ink2)}
.oxs-rail li{padding:6px 10px;border-radius:999px;border:1px solid var(--oxs-line)}.oxs-rail li.oxs-on{color:#05070f;background:var(--oxs-accent);border-color:var(--oxs-accent)}.oxs-rail li.oxs-done{color:var(--oxs-accent);border-color:rgba(34,211,197,.5)}
.oxs-card{width:100%;background:var(--oxs-card);border:1px solid var(--oxs-line);border-radius:20px;padding:24px;backdrop-filter:blur(14px);box-shadow:0 30px 80px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.04)}
.oxs-card h1{font-size:21px;margin:0 0 10px;letter-spacing:-.01em;outline:none}
.oxs-mark{font:700 12px/1 ui-monospace,monospace;letter-spacing:.32em;color:var(--oxs-accent);margin-bottom:14px}
.oxs-card .ox-card{margin:4px 0 8px;background:rgba(0,0,0,.2)}
.oxs-card .oc-primary,.oxs-card .oc-ghost{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 16px;border-radius:999px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;text-decoration:none}
.oxs-card .oc-primary{border:0;background:linear-gradient(135deg,var(--oxs-accent),#14a8c7);color:#03141a}.oxs-card .oc-primary:disabled{opacity:.45;cursor:default}
.oxs-card .oc-ghost{border:1px solid var(--oxs-line);background:none;color:var(--oxs-ink2)}
.oxs-card .oc-spinner{width:14px;height:14px;border-radius:50%;border:2px solid rgba(34,211,197,.25);border-top-color:var(--oxs-accent);animation:oxs-spin .8s linear infinite;flex:none}
@keyframes oxs-spin{to{transform:rotate(360deg)}}
.oxs-card button.oxs-primary,.oxs-card button.oxs-quiet{display:block;width:100%;padding:12px 14px;margin:8px 0 0;border-radius:13px;font:inherit;font-weight:600;cursor:pointer;text-align:center}
.oxs-card button.oxs-primary{border:1px solid transparent;background:linear-gradient(135deg,var(--oxs-accent),#14a8c7);color:#03141a}
.oxs-card button.oxs-quiet{border:1px solid transparent;background:none;color:var(--oxs-ink2);font-weight:500}
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
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({ name: 'settings.onboarding', id: CONNECT_STEP.id, order: CONNECT_STEP.order }, ConnectOmniStep))
}
