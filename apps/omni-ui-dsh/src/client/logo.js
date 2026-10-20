import { createElement as h } from 'react'

// The Omni logo, redrawn from the brand file as vectors: three chevrons and the OMNI wordmark.
// Each is drawn three times, cyan nudged left and magenta nudged right under the shape itself,
// which takes the current text color: white on a dark theme, ink on a light one.
const MARK = 'M61.6 6.7L118.4 103.6L98.6 103.6L61.6 41.8L24.6 103.6L4.4 103.6ZM137.9 55.1L188.2 145.3L84.9 145.3L94.8 127.8L158.1 127.8L127.6 72.7ZM65 93.6L75 111.9L43.7 167.8L107.7 167.8L117.7 185.5L13.6 185.5Z'
const MARK_BOX = 192.6
const WORD = 'M69.2 60.5C69.2 63.6 68.2 66.3 66 68.5C63.8 70.7 61.2 71.8 58 71.8C54.8 71.8 52.2 70.7 50 68.5C47.8 66.3 46.7 63.6 46.7 60.5C46.7 57.3 47.8 54.6 50 52.4C52.2 50.2 54.8 49.1 58 49.1C61.2 49.1 63.8 50.2 66 52.4C68.2 54.6 69.2 57.3 69.2 60.5ZM115.9 60C115.9 67.6 114.7 74.9 112.3 82.1C109.9 89.3 106.3 95.7 101.4 101.5C96.6 107.3 90.6 111.9 83.4 115.3C76.2 118.7 67.7 120.4 58.1 120.4C48.4 120.4 39.9 118.7 32.6 115.3C25.3 111.9 19.3 107.3 14.4 101.5C9.6 95.7 6 89.3 3.6 82.1C1.2 74.9 0 67.6 0 60C0 52.5 1.2 45.2 3.6 38.1C6 31 9.6 24.5 14.4 18.8C19.3 13.1 25.3 8.5 32.6 5.1C39.9 1.7 48.4 0 58.1 0C67.7 0 76.2 1.7 83.4 5.1C90.6 8.5 96.6 13.1 101.4 18.8C106.3 24.5 109.9 31 112.3 38.1C114.7 45.2 115.9 52.5 115.9 60ZM93.3 60.5C93.3 55.6 92.6 50.8 91 46.1C89.5 41.5 87.3 37.2 84.4 33.5C81.5 29.7 77.9 26.7 73.5 24.5C69 22.3 63.9 21.2 58.1 21.2C52.2 21.2 47 22.3 42.6 24.5C38.2 26.7 34.5 29.7 31.5 33.5C28.6 37.2 26.4 41.5 24.9 46.1C23.5 50.8 22.7 55.6 22.7 60.5C22.7 65.3 23.5 70 24.9 74.7C26.4 79.3 28.6 83.4 31.5 87.2C34.5 90.9 38.2 93.8 42.6 96C47 98.2 52.2 99.3 58.1 99.3C63.9 99.3 69 98.2 73.5 96C77.9 93.8 81.5 90.9 84.4 87.2C87.3 83.4 89.5 79.3 91 74.7C92.6 70 93.3 65.3 93.3 60.5ZM93.3 60.5M229.4 91.4L229.4 53.1L198.7 114.7C198.5 115.3 198 115.6 197.3 115.6L178.8 115.6C178 115.6 177.5 115.3 177.3 114.7L144.6 51.5L144.6 119C144.6 120 144.1 120.4 143 120.4L123.1 120.4C122.1 120.4 121.6 120 121.6 119L121.6 1.3C121.6 0.4 122.1 0 123.1 0L143.3 0C144.1 0 144.6 0.3 144.8 0.9L188 89.1L229.1 0.9C229.5 0.3 230 0 230.7 0L250.6 0C251.7 0 252.2 0.4 252.2 1.3L252.2 91.4ZM229.4 91.4M358.5 0C359.6 0 360.2 0.4 360.2 1.3L360.2 119C360.2 120 359.6 120.4 358.5 120.4L338.6 120.4C338.5 120.4 338.3 120.4 338 120.3C337.6 120.2 337.4 120.1 337.3 120L281.9 40.6L281.9 91.5L258.9 91.5L258.9 1.3C258.9 0.4 259.4 0 260.4 0L280.4 0C280.6 0 280.8 0 281.1 0.1C281.4 0.1 281.6 0.2 281.7 0.5L337.3 79.8L337.3 1.3C337.3 0.4 337.9 0 339.1 0ZM358.5 0M414.3 99.8C415.4 99.8 416 100.2 416 101.1L416 119C416 120 415.4 120.4 414.3 120.4L366.9 120.4C365.8 120.4 365.3 120 365.3 119L365.3 101.1C365.3 100.2 365.8 99.8 366.9 99.8L379.3 99.8L379.3 0L402.3 0L402.3 99.8ZM414.3 99.8'
const WORD_BOX = [416, 120.4]
const SHIFT = 4.3
const CYAN = '#00ffff'
const MAGENTA = '#ff00ff'

// Below this size the colored layers only smear the edges, so the shape is drawn alone.
const GLITCH_MIN = 16

const layers = (d, glitch) => [
  glitch ? h('path', { key: 'c', d, fill: CYAN, transform: `translate(-${SHIFT} 0)` }) : null,
  glitch ? h('path', { key: 'm', d, fill: MAGENTA, transform: `translate(${SHIFT} 0)` }) : null,
  h('path', { key: 'top', d, fill: 'currentColor' }),
]

export function OmniMark({ size = 16 }) {
  return h('svg', { className: 'omni-logo', width: size, height: size, viewBox: `0 0 ${MARK_BOX} ${MARK_BOX}`, 'aria-hidden': true, focusable: 'false' }, layers(MARK, size >= GLITCH_MIN))
}

export function OmniWordmark({ height = 14 }) {
  const [w, hgt] = WORD_BOX
  return h('svg', { className: 'omni-logo', height, width: Math.round(height * (w + 2 * SHIFT) / hgt), viewBox: `${-SHIFT} 0 ${w + 2 * SHIFT} ${hgt}`, role: 'img', 'aria-label': 'Omni', focusable: 'false' }, layers(WORD, true))
}

// The browser tab's icon: DSH sets one per color scheme; Omni swaps in its mark for each and
// puts DSH's back when the plugin goes away.
const markSvg = top => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_BOX} ${MARK_BOX}"><path d="${MARK}" fill="${CYAN}" transform="translate(-${SHIFT} 0)"/><path d="${MARK}" fill="${MAGENTA}" transform="translate(${SHIFT} 0)"/><path d="${MARK}" fill="${top}"/></svg>`
const iconHref = top => `data:image/svg+xml,${encodeURIComponent(markSvg(top))}`

export function installFavicon() {
  const links = [...document.querySelectorAll('link[rel~="icon"]')]
  const saved = links.map(link => [link, link.getAttribute('href')])
  for (const link of links) link.setAttribute('href', iconHref(/dark/.test(link.media ?? '') ? '#ffffff' : '#141414'))
  if (links.length === 0) {
    const link = Object.assign(document.createElement('link'), { rel: 'icon', type: 'image/svg+xml', href: iconHref('#141414') })
    document.head.append(link)
    return () => link.remove()
  }
  return () => { for (const [link, href] of saved) if (href === null) link.removeAttribute('href'); else link.setAttribute('href', href) }
}
