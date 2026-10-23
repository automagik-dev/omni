import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// Composer packs (src/client/composer-packs.js): the AI a Bot runs on decides what its
// composer offers. Bundled with a stand-in React whose elements are plain objects.
const { outputFiles } = await build({
  stdin: {
    contents: [
      "export * from './src/client/composer-packs.js'",
      "export { packModelCell } from './src/client/composer-pack-cells.js'",
      "export { composerPacks, registerComposerPack } from './src/client/extend.js'",
      "export { ModelMenu } from './src/client/model-menu.js'",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent', external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const element = (type, props, ...children) => ({ type, props: props ?? {}, children })
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports, console, setTimeout, clearTimeout,
  require: (name) => {
    if (name === 'react') {
      return {
        createElement: element, Fragment: 'Fragment',
        useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
        useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
        useEffect: () => {}, useRef: () => ({ current: null }), useMemo: fn => fn(), useCallback: fn => fn,
      }
    }
    if (name === 'react-dom') return { createPortal: node => node }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error(`Unexpected platform module ${name}`)
  },
})
const {
  BUILTIN_PACKS, CLAUDE_CODE_PACK, DEFAULT_PACK, THINKING_PACK, ModelMenu,
  cellChoice, composerPacks, hasOhMyClaude, packCellSync, packFor, packModelCell, registerComposerPack, stepsAside, targetOf,
} = module.exports

const EFFORTS = { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' }
function rosterWith(bot, models = []) {
  return { ready: true, bots: [bot], byId: { [bot.id]: bot, [bot.sessionId]: bot }, roomsById: {}, models }
}
const claudeBot = (extra = {}) => ({ id: 'bot-1', sessionId: 'session-1', name: 'Omni', model: 'claude-code/claude-opus-5-5', ...extra })
const deepseekBot = (extra = {}) => ({ id: 'bot-1', sessionId: 'session-1', name: 'Omni', model: 'deepseek-official/deepseek-v4', ...extra })
// What the composer cells hold, by key: the fiber names of their registrants.
const envWith = registrants => ({ registrants: key => registrants[key] ?? [] })
const OMC = envWith({ 'conversation.input.permission': ['dsh-oh-my-claude'], 'conversation.input.left': ['dsh-oh-my-claude'] })
const NONE = envWith({})
const packs = BUILTIN_PACKS.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
// The surface registers Omni's own packs (index.js); the cells read the registry.
for (const pack of BUILTIN_PACKS) registerComposerPack(pack)

test('a Bot on Claude Code gets the Claude Code pack while dsh-oh-my-claude is there', () => {
  const roster = rosterWith(claudeBot())
  assert.equal(packFor(targetOf(roster, 'session-1'), { packs, env: OMC }).id, 'claude-code')
  assert.equal(packFor(targetOf(rosterWith(claudeBot({ model: 'claude-code-box/claude-sonnet-5-5' })), 'bot-1'), { packs, env: OMC }).id, 'claude-code')
  assert.equal(hasOhMyClaude(OMC), true)
  // A fork published under our scope keeps the name in its registrant.
  assert.equal(hasOhMyClaude(envWith({ 'conversation.composer.dock': ['@automagik/dsh-oh-my-claude'] })), true)
})

test('pack selection: thinking levels, then Omni\'s own composer; a broken pack never wins', () => {
  const thinking = rosterWith(deepseekBot(), [{ ref: 'deepseek-official/deepseek-v4', reasoning: EFFORTS }])
  assert.equal(packFor(targetOf(thinking, 'session-1'), { packs, env: NONE }).id, 'thinking')
  assert.equal(packFor(targetOf(rosterWith(deepseekBot()), 'session-1'), { packs, env: NONE }), DEFAULT_PACK)
  assert.equal(packFor(undefined, { packs, env: OMC }), DEFAULT_PACK)
  assert.equal(packFor(targetOf(rosterWith(deepseekBot({ model: undefined })), 'session-1'), { packs, env: OMC }), DEFAULT_PACK)
  const broken = { id: 'broken', order: -999, match: () => { throw new Error('boom') }, cells: { permission: 'host' } }
  assert.equal(packFor(targetOf(rosterWith(claudeBot()), 'session-1'), { packs: [broken, ...packs], env: OMC }).id, 'claude-code')
})

test('a registered pack joins the selection in order and leaves with its disposer', () => {
  const before = composerPacks.entries().length
  const codex = { id: 'codex', order: -300, match: provider => provider === 'openai-codex', cells: { model: 'model' } }
  const off = registerComposerPack(codex)
  const target = targetOf(rosterWith(deepseekBot({ model: 'openai-codex/gpt-6' })), 'session-1')
  assert.equal(packFor(target, { env: NONE }).id, 'codex')
  off()
  assert.equal(composerPacks.entries().length, before)
  assert.equal(packFor(target, { env: NONE }), DEFAULT_PACK)
})

test('the Claude Code pack un-blanks its permission and model cells, and only those', () => {
  const target = targetOf(rosterWith(claudeBot()), 'session-1')
  assert.equal(cellChoice(CLAUDE_CODE_PACK, 'permission', target), 'host')
  assert.equal(cellChoice(CLAUDE_CODE_PACK, 'model', target), 'model')
  // The plan cell and the docks are not pack cells: they stay Omni's.
  assert.equal(cellChoice(CLAUDE_CODE_PACK, 'plan', target), 'hidden')
  assert.equal(cellChoice(CLAUDE_CODE_PACK, 'usage', target), 'hidden')
  assert.equal(stepsAside({ roster: rosterWith(claudeBot()), sessionId: 'session-1', cell: 'permission', key: 'conversation.input.permission', env: OMC, packs }), true)
})

test('a Bot with its own permissions keeps Omni\'s empty permission cell under Claude Code', () => {
  const roster = rosterWith(claudeBot({ permission: 'read-only' }))
  assert.equal(cellChoice(CLAUDE_CODE_PACK, 'permission', targetOf(roster, 'session-1')), 'hidden')
  assert.equal(stepsAside({ roster, sessionId: 'session-1', cell: 'permission', key: 'conversation.input.permission', env: OMC, packs }), false)
})

test('without dsh-oh-my-claude, or without its permission control, nothing steps aside', () => {
  const roster = rosterWith(claudeBot())
  assert.equal(stepsAside({ roster, sessionId: 'session-1', cell: 'permission', key: 'conversation.input.permission', env: NONE, packs }), false)
  // Only its left button is there (an older DSH): DSH's own permission control would show.
  const leftOnly = envWith({ 'conversation.input.left': ['dsh-oh-my-claude'] })
  assert.equal(stepsAside({ roster, sessionId: 'session-1', cell: 'permission', key: 'conversation.input.permission', env: leftOnly, packs }), false)
  assert.equal(packModelCell(NONE)({ sessionId: 'session-1', useRoster: pick => pick(roster), actions: {} }), null)
})

test('Omni\'s own composer is today\'s: every pack cell hidden, the permission shadow kept', () => {
  assert.deepEqual({ ...DEFAULT_PACK.cells }, { permission: 'hidden', model: 'hidden' })
  const roster = rosterWith(deepseekBot())
  assert.equal(stepsAside({ roster, sessionId: 'session-1', cell: 'permission', key: 'conversation.input.permission', env: OMC, packs }), false)
  assert.equal(packModelCell(OMC)({ sessionId: 'session-1', useRoster: pick => pick(roster), actions: {} }), null)
  let registered = 0
  const sync = packCellSync({ register: () => { registered += 1; return () => { registered -= 1 } }, wantHost: () => false })
  sync.sync()
  sync.sync()
  assert.equal(registered, 1)
  sync.dispose()
  assert.equal(registered, 0)
})

test('swapping the Bot\'s model swaps the composer live', () => {
  let roster = rosterWith(deepseekBot())
  let registered = 0
  const sync = packCellSync({
    register: () => { registered += 1; return () => { registered -= 1 } },
    wantHost: () => stepsAside({ roster, sessionId: 'session-1', cell: 'permission', key: 'conversation.input.permission', env: OMC, packs }),
  })
  const cell = packModelCell(OMC)
  const draw = () => cell({ sessionId: 'session-1', useRoster: pick => pick(roster), actions: {} })
  sync.sync()
  assert.equal(registered, 1)
  assert.equal(draw(), null)
  roster = rosterWith(claudeBot())
  sync.sync()
  assert.equal(registered, 0, 'Omni stepped aside for Claude Code\'s permission modes')
  const drawn = draw()
  assert.equal(drawn.props['data-pack'], 'claude-code')
  assert.equal(drawn.children[0].type, ModelMenu)
  assert.equal(drawn.children[0].props.bot.model, 'claude-code/claude-opus-5-5')
  roster = rosterWith(deepseekBot(), [{ ref: 'deepseek-official/deepseek-v4', reasoning: EFFORTS }])
  sync.sync()
  assert.equal(registered, 1, 'back on DeepSeek, Omni holds the permission cell again')
  assert.equal(draw().props['data-pack'], 'thinking')
  sync.dispose()
})

test('the model menu a pack draws saves to the Bot and reports a failed save', async () => {
  const reported = []
  const roster = rosterWith(claudeBot())
  const drawn = packModelCell(OMC)({ sessionId: 'session-1', useRoster: pick => pick(roster), actions: { reportError: (error, where) => reported.push([error.message, where]) } })
  const { run } = drawn.children[0].props
  assert.equal(await run(Promise.resolve()), true)
  assert.equal(await run(Promise.reject(new Error('not served'))), false)
  assert.deepEqual(reported, [['not served', 'composer-model']])
})

test('the thinking pack matches only models that serve levels', () => {
  assert.equal(THINKING_PACK.match('deepseek-official', { reasoning: EFFORTS }), true)
  assert.equal(THINKING_PACK.match('deepseek-official', { reasoning: { efforts: [] } }), false)
  assert.equal(THINKING_PACK.match('deepseek-official', {}), false)
})
