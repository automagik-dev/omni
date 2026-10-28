// Session rows under the Omni Bot's row (wish omni-chat-threads, design rows 16 and 17): the
// plain Sessions this plugin makes for work that is not a chat thread. An automation whose
// worker is "a new session each time" makes one per run (`run`), one whose worker is "one
// ongoing session" keeps one on its record (`ongoing`, sub.ongoingSessionId), and Omni's
// computer hand-off makes one per piece of work (`handoff`, Group 15). None is a Bot, a Tasks
// Session or a DSH bot's: each is rt.createSession in the team's workspace, kept in
// state.omniRows and drawn under the Omni Bot beside the threads, never in state.agents.
//
// A row is never capped and never dropped with its automation or its run: only its own menu
// removes it, which archives its Session with its work stopped. Its Session runs on the Omni
// Bot's model and follows it, keeps every DSH tool but the Bot team's (TEAM_TOOLS), the chat
// threads' (THREAD_TOOLS) and the hand-off, each denied one name at a time, and while a "new session" run
// that asks first works there it is on DSH's read-only preset, set back to the preset it was
// made with when the run ends.
//
// A restart that cuts a row's turn is the Bot team's to resume, once, its own way: the row
// reaches the team's pass through the restart hook only while a turn of it could have been cut
// (turnOpenAt within the team's window), so an idle row costs the pass nothing.
import { z } from 'zod'
import { denyEach } from './omni-api.js'
import { HANDOFF_TOOL } from './omni-rules.js'
import { isStandingRun, ongoingSessions } from './standing-runs.js'
import { archivedIds, CUT_WINDOW_MS, followOmniModel, selectOmniModel, THREAD_TOOLS } from './threads.js'

// Every tool the Bot team registers for Bots, which its own DSH bot and task Sessions never
// get (copied from @automagik/bots-dsh 3.32.1, src/host/constants.js TEAM_TOOLS; its agents.js
// denies them there). This plugin's own tools are on it too: a row's Session operates no Omni.
export const TEAM_TOOLS = Object.freeze([
  'list_bots', 'message_bot', 'stop_bot', 'create_bot', 'update_bot', 'list_models',
  'create_group', 'update_group', 'delete_group', 'post_to_group', 'ask_user', 'show_view',
  'request_secret', 'list_secrets', 'group_relay', 'read_own_chat',
  'read_group_chat', 'remember', 'forget', 'recall', 'read_browser',
  'list_capabilities', 'save_capability', 'delete_capability',
  'attach_capability', 'detach_capability',
  'find_chats', 'list_automations', 'save_automation', 'pause_automation', 'delete_automation',
  'generate_image',
  'omni_endpoints', 'omni_call', 'omni_channels', 'omni_chats', 'omni_messages', 'omni_send', 'omni_react', 'omni_media', 'omni_delete', 'omni_connect', 'show_canvas', 'start_task',
])
// The team's tools under the names later Bot teams give them (3.33.0 renamed list_models).
export const LATER_TEAM_TOOLS = Object.freeze(['list_bot_models'])
// What a row's Session never runs: the team's tools, the chat threads' own and the hand-off,
// which is the Omni Bot's.
export const ROW_DENIED = Object.freeze([...new Set([...TEAM_TOOLS, ...LATER_TEAM_TOOLS, ...THREAD_TOOLS, HANDOFF_TOOL])])
// A Bot's own browser is the team's too (3.33.0 and later name its tools in
// rt.browserToolNames, and deny them in its own DSH bot Sessions): a row never runs it.
const rowDenied = rt => [...ROW_DENIED, ...(Array.isArray(rt.browserToolNames) ? rt.browserToolNames : [])]
export const ROW_REFUSAL = 'A session under Omni has DSH\'s own tools, not the Bot team\'s or a chat thread\'s.'
export const ROW_KINDS = Object.freeze(['run', 'ongoing', 'handoff'])
// A run that worked in a Session whose row the owner removed.
export const ROW_REMOVED = 'Stopped: its session was removed.'
// DSH's read-only preset: no file changes, and a wider retry waits for the user.
export const READ_PRESET = 'read-only'
const TITLE_MAX = 80

export const OmniRow = z.object({
  sessionId: z.string().min(1).max(200),
  kind: z.enum(ROW_KINDS),
  title: z.string().max(TITLE_MAX),
  subId: z.string().min(1).max(200).optional(),
  reportTo: z.string().min(1).max(200).optional(),
  reported: z.boolean().optional(),
  turnOpenAt: z.number().finite().nullable(),
  at: z.number().finite(),
  // While a "new session" run that asks first may still act there: on DSH's read-only preset,
  // `preset` the one it was made with (contain).
  contained: z.literal(true).optional(),
  preset: z.string().min(1).max(200).optional(),
}).strict()
const RemovePayload = z.object({ sessionId: z.string().min(1).max(200) }).strict()

const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })
const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })
const titleOf = title => String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) || 'Session'

// The agents whose list was trimmed: a restriction belongs to one live agent.
const trimmed = new WeakSet()
/** A row's live agent loses the team's and the threads' tools, one name at a time. */
function trimRow(rt, agent) {
  if (agent === undefined || agent === null || trimmed.has(agent) || typeof agent.ctx?.tools?.restrict !== 'function') return
  try {
    // Nothing denied can mean DSH's list is not up yet: the next agent/created tries again,
    // and the guard below refuses them meanwhile.
    if (denyEach(rt.ctx, agent, rowDenied(rt)) > 0) trimmed.add(agent)
  } catch (error) {
    rt.warn('omni-channels: the Session %s keeps the team\'s tools in its list (its guard still refuses them): %s', agent.session?.id ?? agent.id, error?.message ?? error)
  }
}

/**
 * A plain Session for a row under the Omni Bot: rt.createSession (never createTaskSession), on
 * the Omni Bot's model before its first turn, its live agent without the team's and the
 * threads' tools. The caller keeps it as a row (rt.omniRows.add), which follows the Omni Bot's
 * model from then on; a Session never kept follows nothing.
 */
export async function createPlainSession(rt, title) {
  const sessionId = await rt.createSession(titleOf(title))
  await selectOmniModel(rt, sessionId).catch(error => rt.warn('omni-channels: the Session %s keeps DSH\'s model, the Omni Bot\'s was not applied: %s', sessionId, error?.message ?? error))
  // agent/created came before the Session was a row, so its list is trimmed here.
  try {
    trimRow(rt, await rt.resolveAgent(sessionId))
  } catch (error) {
    rt.warn('omni-channels: the Session %s was not trimmed: %s', sessionId, error?.message ?? error)
  }
  return sessionId
}

/**
 * The Session put on DSH's read-only preset; resolves with the preset it was on. Throws when
 * that cannot be set, so the work it was for does not start rather than start with more.
 */
export async function setReadOnly(rt, sessionId) {
  const presets = rt.ctx.get?.('permissionPresets')
  if (presets === undefined) throw new Error('this DeepSeek Harness has no permission presets')
  if (!presets.catalog().options.some(option => option.value === READ_PRESET)) throw new Error(`this DeepSeek Harness offers no ${READ_PRESET} preset`)
  const { session } = await rt.resolveAgent(sessionId)
  const before = typeof presets.current === 'function' ? presets.current(session) : presets.catalog().defaultPreset
  presets.set(session, READ_PRESET)
  if (typeof presets.current === 'function' && presets.current(session) !== READ_PRESET) throw new Error(`the Session is on ${presets.current(session)}, not ${READ_PRESET}`)
  return before
}

export function install(rt) {
  const { ctx, state } = rt
  const rows = () => (state.omniRows ??= {})
  const subs = () => (state.subscriptions ??= {})
  const runs = () => (state.subscriptionRuns ??= [])
  const warn = (what, error) => rt.warn(`omni-channels: ${what}: %s`, error?.message ?? error)
  const persist = () => Promise.resolve(rt.save()).catch(error => warn('saving a session row failed', error))
  const valid = row => typeof row?.sessionId === 'string' && ROW_KINDS.includes(row.kind)
  // Looked up on every Session event and tool call, so it never sorts.
  const get = (sessionId) => {
    const row = typeof sessionId === 'string' && Object.hasOwn(rows(), sessionId) ? rows()[sessionId] : undefined
    return valid(row) && row.sessionId === sessionId ? row : undefined
  }
  const list = () => Object.values(rows()).filter(valid).sort((a, b) => a.at - b.at)
  const unfollows = new Map()
  // Rows being removed: from before their archive starts (DSH may end their turn inside it),
  // their Session takes no more events, and an ongoing automation's next one gets a new one.
  const going = new Set()
  const takes = sessionId => get(sessionId) !== undefined && !going.has(sessionId)
  const follow = (sessionId) => {
    if (!unfollows.has(sessionId)) unfollows.set(sessionId, followOmniModel(rt, sessionId, { select: false }))
  }

  async function add(row) {
    const parsed = OmniRow.parse({ ...row, title: titleOf(row?.title) })
    rows()[parsed.sessionId] = parsed
    follow(parsed.sessionId)
    await rt.save()
    return parsed
  }

  // An "ongoing session" automation's Session (ongoingSessions): a row of its own, gone once its
  // row is removed or being removed, or DSH archived it; made again as a new row.
  const { of: ongoingOf, ensure: ensureOngoing } = ongoingSessions({
    subs,
    fits: sub => sub?.worker?.kind === 'session' && sub.worker.mode === 'ongoing',
    stateOf: sessionId => (!takes(sessionId) ? 'removed' : archivedIds(ctx).has(sessionId) ? 'archived' : 'live'),
    make: sub => createPlainSession(rt, sub.name),
    keep: (sessionId, sub) => add({ sessionId, kind: 'ongoing', title: sub.name, subId: sub.id, turnOpenAt: null, at: Date.now() }),
  })

  // A "new session" run that asks first: its Session on the read-only preset while it works,
  // the preset it was made with kept on its row to go back to.
  async function contain(sessionId) {
    const row = get(sessionId)
    if (row === undefined) throw new Error('its session is not under Omni')
    const before = await setReadOnly(rt, sessionId)
    Object.assign(row, { contained: true, ...(typeof before === 'string' ? { preset: before } : {}) })
    await rt.save()
  }
  // Back on the preset it was made with, once no run works or waits there.
  const live = sessionId => runs().some(run => (run.status === 'working' || run.status === 'queued') && isStandingRun(run)
    && (run.sessionId === sessionId || (run.target?.kind === 'session' && run.target.id === sessionId)))
  // Taken off at once, so a run's end and its turn's end set it back once between them. Never
  // while its turn is open: a turn a restart cut (its run ended or not, picked up or not) may
  // still be resumed by the team, untagged, so nothing else would gate it; its clean end sets
  // the preset back (the turn/end handler clears turnOpenAt first).
  async function settle(sessionId) {
    const row = get(sessionId)
    if (row?.contained !== true || live(sessionId) || Number.isFinite(row.turnOpenAt)) return
    delete row.contained
    const presets = ctx.get?.('permissionPresets')
    try {
      if (typeof row.preset !== 'string' || presets === undefined) throw new Error('the preset it was made with is not known')
      const { session } = await rt.resolveAgent(sessionId)
      presets.set(session, row.preset)
    } catch (error) {
      row.contained = true
      warn(`the Session ${sessionId} stays read-only after its run`, error)
      return
    }
    await persist()
  }
  // An ongoing automation's events that waited for a row being removed go to a new Session
  // (a run's end hands them on itself, standing-runs.js).
  const waitingFor = subId => runs().some(run => run.status === 'queued' && run.target?.kind === 'ongoing' && run.target.id === subId)
  const renewFor = (subId) => {
    void rt.standingRuns.renew({ kind: 'ongoing', id: subId }).catch(error => warn('handing waiting events to a new ongoing session failed', error))
  }
  ctx.effect(() => rt.standingRuns.onEnded((run) => {
    if (get(run.sessionId)?.contained === true) void settle(run.sessionId)
  }), 'omni-channels: session rows back on their preset')

  // Removing a row: its Session archived with its work stopped, then the row goes. One that
  // cannot be archived stays, so a retry finishes it. Its working run ends as failed (an
  // archive may end no turn), a "new session" event still waiting for it ends, and an ongoing
  // automation's waiting events get a new Session, the board told why.
  const removing = new Map()
  async function removeOnce(row) {
    const readOnly = rt.readOnly?.()
    if (readOnly !== undefined) throw refused(readOnly)
    going.add(row.sessionId)
    try {
      await ctx.workspaceRegistry.archiveSession(row.sessionId, { stopActivity: true })
    } catch (error) {
      // A Session DSH no longer has needs no archive.
      if (error?.name !== 'WorkspaceUnknownSessionError') {
        going.delete(row.sessionId)
        throw refused(`The session could not be removed: ${error?.message ?? error}`)
      }
    }
    unfollows.get(row.sessionId)?.()
    unfollows.delete(row.sessionId)
    delete rows()[row.sessionId]
    going.delete(row.sessionId)
    for (const run of runs().filter(other => other.status === 'working' && other.sessionId === row.sessionId && isStandingRun(other))) {
      rt.standingRuns.finish(run.id, 'failed', ROW_REMOVED)
    }
    rt.standingRuns.failQueued(run => run.target?.kind === 'session' && run.target.id === row.sessionId, 'Not handed over: its session was removed.')
    await rt.save()
    if (row.kind === 'ongoing' && typeof row.subId === 'string' && waitingFor(row.subId)) renewFor(row.subId)
  }
  function remove(sessionId) {
    const row = get(sessionId)
    if (row === undefined) return Promise.resolve()
    if (!removing.has(sessionId)) removing.set(sessionId, removeOnce(row).finally(() => removing.delete(sessionId)))
    return removing.get(sessionId)
  }

  // A row's open turn, as for threads: set on a turn's start and cleared on its end, unless a
  // restart cut it (the team's own predicate), so a cut turn stays open for the team's pass.
  // A turn's end also sets a contained Session whose run is gone back on its preset.
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/start' && event?.type !== 'turn/end') return
    const row = get(session?.id)
    if (row === undefined) return
    if (event.type === 'turn/start') {
      row.turnOpenAt = Number.isFinite(event.time) ? event.time : Date.now()
      void persist()
      return
    }
    if (rt.cutByRestart?.(event.data?.reason)) return
    row.turnOpenAt = null
    void persist()
    if (row.contained === true) void settle(row.sessionId)
  })

  // The restart hook's Sessions: a row whose turn opened in the team's cut window and did not
  // end cleanly. An idle row, or one DSH archived, is never listed.
  rt.teamResume?.addSessions(() => {
    const now = Date.now()
    const gone = archivedIds(ctx)
    return list().filter(row => Number.isFinite(row.turnOpenAt) && now - row.turnOpenAt < CUT_WINDOW_MS && !gone.has(row.sessionId)).map(row => row.sessionId)
  })

  // A later agent of a row's Session (a resume, a clear, a compaction) is trimmed again; the
  // guard refuses the denied tools whatever DSH lists.
  ctx.on('agent/created', ({ agent } = {}) => {
    void Promise.resolve(rt.load()).then(() => {
      if (get(agent?.id ?? agent?.session?.id) !== undefined) trimRow(rt, agent)
    }).catch(error => warn('a session row\'s tool list was not trimmed', error))
  })
  ctx.tools.guard((exec) => {
    if (!rowDenied(rt).includes(exec.name) || get(exec.agent?.id ?? exec.agent?.session?.id) === undefined) return undefined
    // A refused call trims the list too, in case DSH's list was not up when the agent began.
    trimRow(rt, exec.agent)
    return ROW_REFUSAL
  })

  // At start: every saved row follows the Omni Bot's model again (they are on it already, so
  // none is opened for it), and a Session whose run ended while this host was away goes back
  // on its preset (settle: never while a turn a restart cut is still open).
  ctx.effect(() => {
    void Promise.resolve(rt.load()).then(() => {
      for (const row of list()) follow(row.sessionId)
      if (rt.readOnly?.() !== undefined) return
      for (const row of list()) if (row.contained === true) void settle(row.sessionId)
    }).catch(error => warn('following the session rows failed', error))
  }, 'omni-channels: session rows')

  rt.omniRows = { add, remove, get, takes, list, ongoingOf, ensureOngoing, contain, settle }

  // For the tree: each row with its title and whether its turn runs now (a turn this start
  // has not seen is not running).
  rt.omniRowsView = () => ({
    omniRows: list().map(row => ({
      sessionId: row.sessionId, kind: row.kind, title: row.title, ...(row.subId ? { subId: row.subId } : {}), at: row.at,
      status: rt.teamResume?.running?.(row.sessionId) === true ? 'working' : 'idle',
    })),
  })
  ctx.effect(() => rt.hooks.view(() => rt.omniRowsView()), 'omni-channels: session rows view')
  // Only the row's menu removes it; a host that only reads the team does not serve it.
  ctx.effect(() => rt.hooks.endpoint('omni-row-remove', async (body) => {
    const parsed = RemovePayload.safeParse(body ?? {})
    if (!parsed.success) throw invalid('Pick a session')
    await rt.load()
    await remove(parsed.data.sessionId)
    return { ok: true }
  }), 'omni-channels: omni-row-remove')
}
