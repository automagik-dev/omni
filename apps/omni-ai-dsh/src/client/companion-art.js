import { createElement as h, useEffect, useState } from 'react'
import { characterMarkup, PICKER_SHAPES, CHARACTER_COLORS } from './vendor/characters.js'
import { INKS, GRADIENTS } from './vendor/inks.js'
import { OCTOPUS_SVG } from './octopus.js'
import { call } from './api.js'

// The companion's picture: one of Omni's characters (shape and color, drawn the way the app
// draws Bots), or the image generated for it. It stands where the octopus used to, on every
// onboarding step after it exists.
export const SHAPES = PICKER_SHAPES
export const COLORS = CHARACTER_COLORS

let serial = 0
/** SVG markup for one character, with mask ids of its own. */
export function characterSvg(shape, color, size = 120) {
  serial += 1
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">${characterMarkup(shape, color).replaceAll('%MASK%', `oaic${serial}`)}</svg>`
}

// The app paints characters from CSS variables; the overlay is dark, so the dark inks.
export const INK_CSS = `.oai-overlay{${Object.entries(INKS).map(([name, [, dark]]) => `--bt-ink-${name}:${dark}`).join(';')}}`
export const swatchOf = color => (GRADIENTS[color] ? `linear-gradient(135deg,${GRADIENTS[color].map(([at, value]) => `${value} ${at * 100}%`).join(',')})` : INKS[color]?.[1] ?? color)

// What the stage shows: the companion once made, the octopus before.
let cached
export function companionLook(state) {
  if (!state) return undefined
  if (state.companionImage) return { image: true, name: state.companionName }
  if (state.companionShape) return { shape: state.companionShape, color: state.companionColor ?? 'cyan', name: state.companionName }
  return undefined
}

export function useCompanion() {
  const [look, setLook] = useState(cached)
  useEffect(() => {
    let alive = true
    call('state').then(async (state) => {
      let next = companionLook(state)
      if (next?.image) {
        const { image } = await call('companion-image').catch(() => ({ image: null }))
        next = image ? { ...next, src: image } : undefined
      }
      cached = next
      if (alive) setLook(next)
    }).catch(() => {})
    return () => { alive = false }
  }, [])
  return [look, (next) => { cached = next; setLook(next) }]
}

export function Hero({ look, hatching }) {
  const cls = `oai-hero${hatching ? ' oai-hatch' : ''}`
  if (look?.src) return h('div', { className: cls }, h('img', { className: 'oai-hero-img', src: look.src, alt: look.name ? `${look.name}, your companion` : 'Your companion' }))
  if (look?.shape) return h('div', { className: cls, dangerouslySetInnerHTML: { __html: characterSvg(look.shape, look.color, 132) } })
  return h('div', { className: cls, dangerouslySetInnerHTML: { __html: OCTOPUS_SVG } })
}

// Before a look is chosen: a glowing egg with sparks around it.
export function Egg() {
  return h('div', { className: 'oai-hero oai-egg', 'aria-hidden': 'true' },
    h('span', { className: 'oai-egg-shell' }),
    [0, 1, 2, 3, 4].map(index => h('i', { key: index, className: `oai-spark oai-spark-${index}` })))
}
