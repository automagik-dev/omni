import { createElement as h } from 'react'
import { OMNI_UI_CSS, OmniCanvas } from './omni-ui.js'
import { addStrings, onShell, setCanvasRenderer, t, toolCards } from './core.js'
import { STRINGS } from './strings.js'

// Omni's canvases: openui-lang programs, drawn as live UI wherever the chat has one (a
// ```openui-lang block in a reply, or a show_canvas call). The chat cells find them and
// hand each to the team's CanvasSlot, which renders with the renderer set here.

// A refused canvas goes back to the Bot, which sends a fixed one; the user sees only the
// canvas that passed.
const canvasCard = ({ arg, argValue, done, content, sessionId, actions }) => {
  if (done && !content.startsWith('Shown')) return null
  return h('div', { className: 'bt-canvas-line' }, h(OmniCanvas, { program: argValue('program') ?? arg('program') ?? '', complete: done, onAsk: message => message && actions.send(sessionId, message) }))
}

export function apply(ctx) {
  ctx.effect(() => addStrings(STRINGS), 'ds-bot: canvas copy')
  ctx.effect(() => setCanvasRenderer(OmniCanvas), 'ds-bot: canvases')
  ctx.effect(() => toolCards.register('show_canvas', canvasCard, { phrase: () => ({ label: t('Drawing it'), state: 'working' }) }), 'ds-bot: canvas card')
  ctx.effect(() => onShell(({ installCompiledStyles }) => [() => installCompiledStyles(OMNI_UI_CSS, 'canvases')]), 'ds-bot: canvas styles')
}
