// Composer packs: the composer of a Bot's chat changes with the AI the Bot runs on. Swap
// the Bot to Claude Code and the composer offers Claude Code's own controls (the ones
// the dsh-oh-my-claude plugin brings); swap it to a model with thinking levels and the
// composer offers those. Omni's own Bot pieces (+, voice, members, questions, @) stay in
// every pack.
//
// A pack, registered with registerComposerPack (extend.js):
//
//   {
//     id: string,
//     order?: number,                       // lower wins when several match
//     match(provider, target): boolean,     // target: ComposerTarget below
//     available?(env): boolean,             // env: { registrants(key) }; default true
//     cells?: { permission?, model? },      // CellChoice per composer cell
//     hostFor?: { permission?: RegExp },    // 'host' steps aside only while a control
//                                           // from a registrant matching it is there
//     commands?(command, target): boolean,  // reserved: DSH 0.2.1 has no per-Session
//                                           // filter for host commands, so Omni does
//                                           // not apply it yet
//   }
//
// ComposerTarget: { provider, model, ref, bot, reasoning } for the Bot the Session
// belongs to; `reasoning` is `{ efforts, defaultEffort? }` when the model serves levels.
//
// CellChoice, or a function `(target) => CellChoice`:
//   'hidden'  Omni keeps the cell empty (its default for every cell);
//   'host'    Omni steps aside, so the control DSH or another plugin put there shows;
//   'model'   Omni's own model and thinking menu, which saves to the Bot.
//
// The plan cell and the activity and usage docks are not pack cells: they stay Omni's in
// every pack (Claude Code's plan mode is one of its permission modes).
import { composerPacks } from './extend.js'

export const PACK_CELLS = ['permission', 'model']

// The pack every Bot gets when none matches: today's composer, cell for cell.
export const DEFAULT_PACK = Object.freeze({ id: 'omni', cells: Object.freeze({ permission: 'hidden', model: 'hidden' }) })

// The provider a model ref names (`claude-code/claude-opus-5-5` → `claude-code`).
export const providerOfRef = ref => (typeof ref === 'string' && ref.includes('/') ? ref.split('/')[0] : undefined)

// The AI a Session's composer is for: the Bot it belongs to and the model that Bot runs
// on. A group Session (a room) has no single AI, so it gets the default pack.
export function targetOf(roster, sessionId) {
  const bot = sessionId === undefined ? undefined : roster?.byId?.[sessionId]
  if (bot === undefined) return undefined
  const ref = bot.model ?? bot.appliedModel
  const provider = providerOfRef(ref)
  if (provider === undefined) return undefined
  const served = (roster.models ?? []).find(model => model.ref === ref)
  return { provider, model: ref.slice(provider.length + 1), ref, bot, reasoning: served?.reasoning }
}

// The winning pack for a target, from the registered packs (lowest order first).
export function packFor(target, { packs = composerPacks.entries(), env = {} } = {}) {
  if (target === undefined) return DEFAULT_PACK
  for (const pack of packs) {
    let matches = false
    try { matches = pack.match?.(target.provider, target) === true && (pack.available === undefined || pack.available(env) === true) } catch { matches = false }
    if (matches) return pack
  }
  return DEFAULT_PACK
}

// What a pack puts in one cell for a target; anything unknown reads as 'hidden'.
export function cellChoice(pack, cell, target) {
  let choice = pack?.cells?.[cell] ?? 'hidden'
  if (typeof choice === 'function') {
    try { choice = choice(target) } catch { choice = 'hidden' }
  }
  return choice === 'host' || choice === 'model' ? choice : 'hidden'
}

// -------------------------------------------------------------------------
// The packs Omni brings.

const isClaudeCode = provider => provider === 'claude-code' || String(provider).startsWith('claude-code-')
// dsh-oh-my-claude (upstream or a fork of it) registers composer pieces under its own
// fiber, so its name shows in the registrant of what it put in the composer.
const OH_MY_CLAUDE = /oh-my-claude/i
const CLAUDE_KEYS = ['conversation.input.permission', 'conversation.input.left', 'conversation.input.dock', 'conversation.composer.dock']
export const hasOhMyClaude = env => CLAUDE_KEYS.some(key => (env.registrants?.(key) ?? []).some(name => OH_MY_CLAUDE.test(name ?? '')))

// Claude Code: its permission modes, model and thinking. A Bot or group with its own
// permission preset keeps it: dsh-oh-my-claude's mode picker writes the Session's DSH
// preset (plan is read-only, bypassPermissions is full access), so letting it show would
// let a mode go past the Bot's own permissions. Those Bots keep Omni's empty cell, and
// their preset decides Claude Code's mode, as the plugin's 'dsh' mode does. A group
// Session has no single AI, so it never gets a pack.
export const CLAUDE_CODE_PACK = Object.freeze({
  id: 'claude-code',
  order: -200,
  match: isClaudeCode,
  available: hasOhMyClaude,
  cells: Object.freeze({
    permission: target => (target?.bot?.permission ? 'hidden' : 'host'),
    model: 'model',
  }),
  // Without its permission control (an older DSH puts it elsewhere), DSH's own would show.
  hostFor: Object.freeze({ permission: OH_MY_CLAUDE }),
})

// Any model that serves thinking levels: its model and thinking menu in the composer.
export const THINKING_PACK = Object.freeze({
  id: 'thinking',
  order: -100,
  match: (_provider, target) => (target?.reasoning?.efforts?.length ?? 0) > 0,
  cells: Object.freeze({ model: 'model' }),
})

export const BUILTIN_PACKS = [CLAUDE_CODE_PACK, THINKING_PACK]

// Whether Omni steps aside from a cell of the Session in the main view: its pack says
// 'host', and the control the pack steps aside for is registered there.
export function stepsAside({ roster, sessionId, cell, key, env, packs }) {
  const target = targetOf(roster, sessionId)
  const pack = packFor(target, { env, ...(packs ? { packs } : {}) })
  if (cellChoice(pack, cell, target) !== 'host') return false
  const wanted = pack.hostFor?.[cell]
  return wanted === undefined || (env.registrants?.(key) ?? []).some(name => wanted.test(name ?? ''))
}

// -------------------------------------------------------------------------
// A cell Omni may step aside from ('host'). A single-kind slot always shows its
// highest-priority entry, even one that draws nothing, so stepping aside means
// withdrawing Omni's registration while the shown Session's pack says 'host', and
// putting it back when it no longer does. `register()` returns its disposer;
// `wantHost()` reads the pack of the Session in the main view.
export function packCellSync({ register, wantHost }) {
  let off = null
  const sync = () => {
    let host = false
    try { host = wantHost() === true } catch { host = false }
    if (!host && off === null) off = register()
    else if (host && off !== null) {
      const dispose = off
      off = null
      dispose()
    }
  }
  return {
    sync,
    registered: () => off !== null,
    dispose() {
      const dispose = off
      off = null
      dispose?.()
    },
  }
}
