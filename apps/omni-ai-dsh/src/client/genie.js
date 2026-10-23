// Chibi Genie, drawn by hand like Omni's octopus, after the neon reference: thin even neon
// lines over an almost-black head; tapered cyan crescents for the closed eyes (with a smaller
// crescent under each) and the smile; tall elf ears with a fold, hoops hanging from the
// lobes; a little cylinder cap and a hollow magenta wisp that ends in a curl. Tilted a touch.
export const WISPS = {
  right: 'M50 35.5C50 27 53 21.5 61 20C70 18.5 74 24 81.5 19.5C87 16 86 9 81 8.8C77.8 8.7 76.8 11.5 78.6 13.2',
  left: 'M50 35.5C50 27 47 21.5 39 20C30 18.5 26 24 18.5 19.5C13 16 14 9 19 8.8C22.2 8.7 23.2 11.5 21.4 13.2',
  question: 'M50 35.5C50 30 54.5 27 57 22.5C59.5 18 57.5 12 52 11.5C47 11 44.5 15 46 18.5',
  flame: 'M50 35.5C47.5 30 52.5 27 51.2 22C50.2 18 48 16 50.4 10.5',
}
export function genieSvg(size, { wisp = 'right', uid = 'g', tilt = -8 } = {}) {
  const CY = '#64f4ff', MG = '#ff4fd8', INK = '#0b0718'
  // Closed eye: a crescent, thick in the middle and pointed at the ends; a smaller one under it.
  const eye = (x, y, w) => `<path d="M${x - w} ${y}Q${x} ${y - w * 1.35} ${x + w} ${y}Q${x} ${y - w * 0.62} ${x - w} ${y}Z"/>`
    + `<path d="M${x - w * 0.78} ${y + w * 0.95}Q${x} ${y + w * 0.1} ${x + w * 0.78} ${y + w * 0.95}Q${x} ${y + w * 0.5} ${x - w * 0.78} ${y + w * 0.95}Z"/>`
  const ear = 'M32.4 63C25.5 60.5 19 53.5 15.2 41.5C22.8 45 28.8 48.8 33.6 53Z'
  const fold = 'M30.2 58C26.2 54.6 22 50.2 18.8 45.4'
  return `<svg viewBox="6 2 90 90" width="${size}" height="${size}" aria-hidden="true">
  <defs>
    <radialGradient id="${uid}s" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="#22143f"/><stop offset=".6" stop-color="#110a24"/><stop offset="1" stop-color="${INK}"/></radialGradient>
    <filter id="${uid}gm" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation=".8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="${uid}gc" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation=".7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <g transform="rotate(${tilt} 50 60)">
    <g filter="url(#${uid}gm)" stroke-linecap="round" stroke-linejoin="round">
      <path d="${WISPS[wisp]}" fill="none" stroke="${MG}" stroke-width="4.4"/>
      <path d="${WISPS[wisp]}" fill="none" stroke="${INK}" stroke-width="2.3"/>
      <g fill="url(#${uid}s)" stroke="${MG}" stroke-width="1.25">
        <path d="${ear}"/><path d="${ear}" transform="matrix(-1 0 0 1 100 0)"/>
        <ellipse cx="50" cy="61" rx="21" ry="20.2"/>
      </g>
      <g fill="none" stroke="${MG}" stroke-width="1"><path d="${fold}"/><path d="${fold}" transform="matrix(-1 0 0 1 100 0)"/></g>
    </g>
    <g filter="url(#${uid}gc)" stroke-linecap="round" stroke-linejoin="round">
      <g fill="none" stroke="${CY}" stroke-width="1.2">
        <path d="M45.6 41V37.2M54.4 41V37.2"/><ellipse cx="50" cy="37.2" rx="4.4" ry="1.3" fill="${INK}"/>
        <circle cx="29.6" cy="68.2" r="2.3"/><circle cx="70.4" cy="68.2" r="2.3"/>
      </g>
      <g fill="${CY}" stroke="${CY}" stroke-width=".35">
        ${eye(42.3, 58, 4.6)}${eye(57.7, 58, 4.6)}
        <path d="M42.5 67.2Q51 75.6 59.4 66.4Q51.4 71.2 42.5 67.2Z"/>
      </g>
    </g>
  </g>
  </svg>`
}
