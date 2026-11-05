import { createElement as h } from 'react'

// A drawn iPhone around the phone pane's chat (omni-phone.js). Its look is copied from the
// `device` frame (真机框) of dsh-ios (https://github.com/automagik-genie/dsh-ios, MIT; see
// NOTICE), src/client/sim-frame-style.ts and the frame styles in src/client/sim-panel.tsx at
// commit d9a9731ccd73b38858fcfbf2f35d7120a861654c: a 16 px dark metallic shell with a 1 px
// edge, a lighter inner highlight, side-button nubs, and corners that stay concentric at
// every width (the screen's radius follows its width, the shell's is that plus the shell).
// Only the look: no simulator, no stream, nothing of the package loads here.

// The shell's thickness and its border on every side, and Simulator.app's corner ratio: an
// iPhone-17-Pro-class screen rounds at 55 pt on a 390 pt-wide screen.
export const FRAME_SHELL = 16
export const FRAME_BORDER = 1
export const SCREEN_RADIUS_RATIO = 55 / 390
export const FRAME_MAX_WIDTH = 300

// For a frame `width` px wide: the screen inside it, and the two radii (rounded to 0.1 px,
// as dsh-ios rounds them). The documented formula the CSS radii follow, pinned by the tests.
export function frameMetrics(width) {
  const screen = Math.max(0, width - 2 * (FRAME_SHELL + FRAME_BORDER))
  const screenRadius = Math.round(screen * SCREEN_RADIUS_RATIO * 10) / 10
  return { screen, screenRadius, shellRadius: Math.round((screenRadius + FRAME_SHELL) * 10) / 10 }
}

// The side buttons, along the frame's height: mute and the two volume buttons on the left,
// power on the right, each 2 px past the shell.
export const SIDE_BUTTONS = Object.freeze([
  { id: 'mute', side: 'left', top: '21%', height: 16 },
  { id: 'volume-up', side: 'left', top: '34%', height: 36 },
  { id: 'volume-down', side: 'left', top: '47%', height: 36 },
  { id: 'power', side: 'right', top: '36%', height: 52 },
])

/** The frame, with `children` on its screen. `label` names what the screen shows. */
export function PhoneFrame({ label, children }) {
  return h('div', { className: 'op-device' },
    h('div', { className: 'op-frame' },
      SIDE_BUTTONS.map(button => h('span', { key: button.id, className: 'op-button', 'data-side': button.side, 'aria-hidden': true, style: { [button.side]: -2, top: button.top, height: button.height } })),
      h('div', { className: 'op-screen', role: 'region', 'aria-label': label }, children)))
}

// The pane's mark on the buttons that open it: a phone, outlined.
export const PhoneGlyph = () => h('svg', { width: 14, height: 14, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' },
  h('path', { d: 'M7 2.75h6A1.75 1.75 0 0 1 14.75 4.5v11A1.75 1.75 0 0 1 13 17.25H7a1.75 1.75 0 0 1-1.75-1.75v-11A1.75 1.75 0 0 1 7 2.75z' }),
  h('path', { d: 'M8.75 4.75h2.5' }))

// The radii in CSS, from the frame's own width (the .op-device container): the screen is the
// frame less its shell and border on both sides.
const SCREEN_WIDTH = `(100cqi - ${2 * (FRAME_SHELL + FRAME_BORDER)}px)`
const SCREEN_RADIUS = `calc(${SCREEN_WIDTH} * 55 / 390)`
const SHELL_RADIUS = `calc(${SCREEN_WIDTH} * 55 / 390 + ${FRAME_SHELL}px)`

export const PHONE_FRAME_CSS = `
.op-device{container-type:inline-size;width:100%;max-width:${FRAME_MAX_WIDTH}px;margin:0 auto}
.op-frame{position:relative;box-sizing:border-box;width:100%;padding:${FRAME_SHELL}px;border:${FRAME_BORDER}px solid rgba(0,0,0,.6);border-radius:${SHELL_RADIUS};background:linear-gradient(145deg,#2b2e35 0%,#101116 45%,#1c1e25 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),0 18px 50px rgba(0,0,0,.55)}
.op-button{position:absolute;width:3px;border-radius:2px;background:#3a3d44;box-shadow:0 1px 2px rgba(0,0,0,.5)}
.op-screen{position:relative;box-sizing:border-box;width:100%;aspect-ratio:390/844;display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,.06);border-radius:${SCREEN_RADIUS};background:var(--bt-main, #fff);color:var(--bt-ink)}
`
