// Whether a canvas program can render, decided once for both sides: the browser checks a
// canvas before mounting it, and the host checks the one show_canvas receives, so a broken
// canvas goes back to the Bot that wrote it instead of reaching the user. No React and no
// i18n here: a refusal is { text, params }, translated by the browser and filled in by the
// host. The build bundles this file for the host (src/host/omni-ui-check.bundle.js).
import { BUILTIN_NAMES, createLibrary, createParser, defineComponent, markReactive, parseExpression, split, tokenize, walkAST } from '@openuidev/lang-core'
import { QUERY_TOOLS, SPECS, libraryOf } from './omni-ui-spec.js'

const PROGRAM_MAX = 32_768
const TOKENS_MAX = 6000
const STATEMENTS_MAX = 128
const NODES_MAX = 4000
const DEPTH_MAX = 48

const library = libraryOf({ createLibrary, defineComponent, reactive: (schema) => { markReactive(schema); return schema } })
const parser = createParser(library.toJSONSchema(), library.root)
const ALLOWED = new Set([...SPECS.map(([name]) => name), ...BUILTIN_NAMES, 'Query'])
const say = (text, params) => (params ? { text, params } : { text })

// The first line whose brackets or quotes do not close, for an incomplete program.
export function unclosedLine(program) {
  const lines = program.split('\n')
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    const stack = []
    let quoted = false
    for (let at = 0; at < line.length; at += 1) {
      const char = line[at]
      if (quoted) {
        if (char === '\\') at += 1
        else if (char === '"') quoted = false
        continue
      }
      if (char === '"') quoted = true
      else if ('([{'.includes(char)) stack.push(char)
      else if (')]}'.includes(char)) {
        const open = stack.pop()
        if (open !== { ')': '(', ']': '[', '}': '{' }[char]) return { line: index + 1, text: line.trim().slice(0, 60) }
      }
    }
    if (quoted || stack.length > 0) return { line: index + 1, text: line.trim().slice(0, 60) }
  }
  return null
}

export function checkProgram(program) {
  const source = String(program ?? '')
  if (!source.trim()) return say('The canvas is empty.')
  if (source.length > PROGRAM_MAX) return say('The canvas is too long.')
  try {
    const tokens = tokenize(source)
    if (tokens.length > TOKENS_MAX) return say('The canvas is too complex.')
    const statements = split(tokens)
    if (statements.length > STATEMENTS_MAX) return say('The canvas is too complex.')
    let nodes = 0
    for (const statement of statements) {
      const expression = parseExpression(statement.tokens)
      const pending = [[expression, 0]]
      while (pending.length) {
        const [value, depth] = pending.pop()
        if (depth > DEPTH_MAX) return say('The canvas is nested too deeply.')
        if (value && typeof value === 'object') for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push([child, depth + 1])
      }
      let refusal = null
      walkAST(expression, (node) => {
        if (++nodes > NODES_MAX) refusal ??= say('The canvas is too complex.')
        if (node.k === 'Comp' && node.name === 'Mutation') refusal ??= say('A canvas cannot change omni; ask Omni instead.')
        else if (node.k === 'Comp' && !ALLOWED.has(node.name)) refusal ??= say('Unknown component {name}.', { name: node.name })
      })
      if (refusal) return refusal
    }
    const result = parser.parse(source)
    if (result.meta.incomplete) {
      const open = unclosedLine(source)
      return open ? say('Line {line} does not close its brackets or quotes: {text}', open) : say('The canvas is incomplete.')
    }
    if (result.mutationStatements.length > 0) return say('A canvas cannot change omni; ask Omni instead.')
    if (result.queryStatements.some(query => query.toolAST?.k !== 'Str' || !QUERY_TOOLS.includes(query.toolAST.v))) return say('A canvas can only read omni.')
    if (!result.root || result.root.typeName !== library.root) return say('The canvas must start with root = Stack(...).')
    // A line that does not parse leaves its name undefined: its own error says why. Extra
    // arguments are only dropped, so they do not stop the canvas.
    const errors = result.meta.errors.filter(error => error.code !== 'excess-args')
    if (errors.length > 0) return say(errors.slice(0, 3).map(error => error.message).join(' '))
    if (result.meta.unresolved.length > 0) return say('The canvas names something it never defines: {names}.', { names: result.meta.unresolved.slice(0, 3).join(', ') })
    const open = unclosedLine(source)
    if (open) return say('Line {line} does not close its brackets or quotes: {text}', open)
    return null
  } catch (error) {
    return say(error instanceof Error ? error.message : 'The canvas could not be read.')
  }
}

// A refusal as English text, for the host.
export const refusalText = refusal => refusal.text.replace(/\{(\w+)\}/g, (whole, key) => String(refusal.params?.[key] ?? whole))
