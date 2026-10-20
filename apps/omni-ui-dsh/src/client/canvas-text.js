// Where a reply's canvases are, without OpenUI or React: the chat finds ```openui-lang blocks
// here and hands each to CanvasSlot (canvas-slot.js); the build reads FENCE too.
export const FENCE = 'openui-lang'

// Text and canvases in the order they were written; a canvas still streaming is incomplete.
const FENCED = new RegExp(`\`\`\`${FENCE}[^\\n]*\\n([\\s\\S]*?)(\`\`\`|$)`, 'g')
export function splitCanvases(text) {
  const source = String(text ?? '')
  const parts = []
  let last = 0
  for (const match of source.matchAll(FENCED)) {
    if (match.index > last) parts.push({ kind: 'text', text: source.slice(last, match.index) })
    parts.push({ kind: 'canvas', program: match[1], complete: match[2] === '```' })
    last = match.index + match[0].length
  }
  if (last < source.length) parts.push({ kind: 'text', text: source.slice(last) })
  return parts.filter(part => part.kind === 'canvas' || part.text.trim() !== '')
}
export const hasCanvas = text => String(text ?? '').includes(`\`\`\`${FENCE}`)
