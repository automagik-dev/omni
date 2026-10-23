import { createElement as h } from 'react'

// The renderer index.js registers for canvases (omni-ui.js), so the chat cells load without
// the OpenUI runtime.
let renderer = null
export const setCanvasRenderer = (component) => {
  renderer = component
  return () => { if (renderer === component) renderer = null }
}
// Without a renderer (tests, or before the client is installed) a canvas stays its source.
export function CanvasSlot(props) {
  return renderer ? h(renderer, props) : h('pre', { className: 'ou-source' }, props.program)
}
