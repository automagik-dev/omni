import { createElement as h } from 'react'
import { CHARACTERS } from './characters.js'

// The Omni mark: the octopus from the character table, in the current text color. It takes the
// place of the fish logo the DeepSeek Harness primitives used, so Omni needs no harness import.
export function OctopusLogo({ size = 16 }) {
  return h('svg', { width: size, height: size, viewBox: '0 0 100 100', 'aria-hidden': true, focusable: 'false' },
    h('path', { d: CHARACTERS.octopus.body, fill: 'currentColor' }))
}
