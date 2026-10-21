import { createElement as h } from 'react'
import { t } from './i18n.js'
import { onShell, toolCards } from './extend.js'
import { setCanvasRenderer } from './canvas-slot.js'
import { OMNI_UI_CSS, OmniCanvas } from './omni-ui.js'

// Omni's canvases: openui-lang programs, drawn as live UI wherever the chat has one (a
// ```openui-lang block in a reply, or a show_canvas call). The chat cells find them and
// hand each to CanvasSlot (canvas-slot.js), which renders with the renderer set here.

// A refused canvas goes back to the Bot, which sends a fixed one; the user sees only the
// canvas that passed.
const canvasCard = ({ arg, argValue, done, content, sessionId, actions }) => {
  if (done && !content.startsWith('Shown')) return null
  return h('div', { className: 'bt-canvas-line' }, h(OmniCanvas, { program: argValue('program') ?? arg('program') ?? '', complete: done, onAsk: message => message && actions.send(sessionId, message) }))
}

export function installCanvas(ctx) {
  ctx.effect(() => setCanvasRenderer(OmniCanvas), 'ds-bot: canvases')
  ctx.effect(() => toolCards.register('show_canvas', canvasCard, { phrase: () => ({ label: t('Drawing it'), state: 'working' }) }), 'ds-bot: canvas card')
  ctx.effect(() => onShell(({ installCompiledStyles }) => [() => installCompiledStyles(OMNI_UI_CSS, 'canvases')]), 'ds-bot: canvas styles')
}
