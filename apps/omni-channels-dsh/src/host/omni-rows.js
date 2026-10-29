// Session rows under the Omni Bot's row (wish omni-chat-threads, design rows 16 and 17): the
// plain Sessions this plugin once made for work that was not a chat thread, kept in
// state.omniRows and drawn under the Omni Bot beside the threads. This plugin makes none any
// more: automations run in their chats' threads, and Omni has no hand-offs. A row left from
// before (`run`, `ongoing`, `handoff`) is archived and dropped at start (retire), and so are
// the DSH-bot hand-offs kept in state.omniHandoffs, whose Sessions stay their bots'.
//
// While a row is still there its Session follows the Omni Bot's model and keeps every DSH tool
// but the Bot team's (TEAM_TOOLS) and the chat threads' (THREAD_TOOLS), each denied one name
// at a time; its menu removes it, which archives its Session with its work stopped.
//
// A restart that cuts a row's turn is the Bot team's to resume, once, its own way: the row
// reaches the team's pass through the restart hook only while a turn of it could have been cut
// (turnOpenAt within the team's window), so an idle row costs the pass nothing.
import { z } from 'zod'
import { denyEach } from './omni-api.js'
import { isStandingRun } from './standing-runs.js'
import { archivedIds, CUT_WINDOW_MS, followOmniModel, THREAD_TOOLS } from './threads.js'

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
// What a row's Session never runs: the team's tools and the chat threads' own.
export const ROW_DENIED = Object.freeze([...new Set([...TEAM_TOOLS, ...LATER_TEAM_TOOLS, ...THREAD_TOOLS])])
// A Bot's own browser is the team's too (3.33.0 and later name its tools in
// rt.browserToolNames, and deny them in its own DSH bot Sessions): a row never runs it.
const rowDenied = rt => [...ROW_DENIED, ...(Array.isArray(rt.browserToolNames) ? rt.browserToolNames : [])]
export const ROW_REFUSAL = 'A session under Omni has DSH\'s own tools, not the Bot team\'s or a chat thread\'s.'
// A row the tree still draws, until retire archives it (or its menu removes it, when the archive
// failed at start).
export const ROW_KINDS = Object.freeze(['handoff'])
// The kinds of row this plugin made before (the retired automation workers' "a new session
// each time" and "one ongoing session", Omni's hand-offs): archived and dropped at start.
const RETIRED_KINDS = new Set(['run', 'ongoing', 'handoff'])
// A run still working in a retired row's Session when it goes.
export const ROW_RETIRED = 'Stopped: automations now run in their chats\' threads, so its session was archived.'
// DSH's read-only preset: no file changes, and a wider retry waits for the user.
export const READ_PRESET = 'read-only'

const RemovePayload = z.object({ sessionId: z.string().min(1).max(200) }).strict()

const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })
const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })

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
  const follow = (sessionId) => {
    if (!unfollows.has(sessionId)) unfollows.set(sessionId, followOmniModel(rt, sessionId, { select: false }))
  }

  // A Session archived with its work stopped; one DSH no longer has needs no archive. Throws
  // when it could not be archived.
  async function archive(sessionId) {
    try {
      await ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: true })
    } catch (error) {
      if (error?.name !== 'WorkspaceUnknownSessionError') throw error
    }
  }

  // Removing a row: its Session archived with its work stopped, then the row goes. One that
  // cannot be archived stays, so a retry finishes it.
  const removing = new Map()
  async function removeOnce(row) {
    const readOnly = rt.readOnly?.()
    if (readOnly !== undefined) throw refused(readOnly)
    try {
      await archive(row.sessionId)
    } catch (error) {
      throw refused(`The session could not be removed: ${error?.message ?? error}`)
    }
    unfollows.get(row.sessionId)?.()
    unfollows.delete(row.sessionId)
    delete rows()[row.sessionId]
    await rt.save()
  }
  function remove(sessionId) {
    const row = get(sessionId)
    if (row === undefined) return Promise.resolve()
    if (!removing.has(sessionId)) removing.set(sessionId, removeOnce(row).finally(() => removing.delete(sessionId)))
    return removing.get(sessionId)
  }

  // A row's open turn, as for threads: set on a turn's start and cleared on its end, unless a
  // restart cut it (the team's own predicate), so a cut turn stays open for the team's pass.
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
  })

  // The restart hook's Sessions: a row whose turn opened in the team's cut window and did not
  // end cleanly. An idle row, or one DSH archived, is never listed.
  // A row of a kind retire() archives is never listed, even before it runs or when its archive
  // failed: the team's pass must not resume a Session that is going.
  rt.teamResume?.addSessions(() => {
    const now = Date.now()
    const gone = archivedIds(ctx)
    return list().filter(row => !RETIRED_KINDS.has(row.kind) && Number.isFinite(row.turnOpenAt) && now - row.turnOpenAt < CUT_WINDOW_MS && !gone.has(row.sessionId)).map(row => row.sessionId)
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

  // A row left from before: its Session archived with its work stopped (its files and log stay
  // on disk), then the row dropped, and a run still working there ends as failed, saying why.
  // One that cannot be archived stays for the next start. The DSH-bot hand-offs that had not
  // reported are dropped: their Sessions are their bots', the owner's own.
  async function retire() {
    const handoffs = Object.hasOwn(state, 'omniHandoffs')
    delete state.omniHandoffs
    const left = Object.entries(rows()).filter(([, row]) => RETIRED_KINDS.has(row?.kind))
    for (const [key, row] of left) {
      const sessionId = typeof row.sessionId === 'string' ? row.sessionId : key
      try {
        await archive(sessionId)
      } catch (error) {
        warn(`the retired session ${sessionId} was not archived, it waits for the next start`, error)
        continue
      }
      delete rows()[key]
      for (const run of runs().filter(other => other.status === 'working' && other.sessionId === sessionId && isStandingRun(other))) {
        rt.standingRuns.finish(run.id, 'failed', ROW_RETIRED)
      }
    }
    if (left.length > 0 || handoffs) await persist()
  }

  // At start: every saved row follows the Omni Bot's model again (they are on it already, so
  // none is opened for it), and the rows left from before go.
  ctx.effect(() => {
    void Promise.resolve(rt.load()).then(() => {
      for (const row of list()) follow(row.sessionId)
      if (rt.readOnly?.() !== undefined) return
      return retire()
    }).catch(error => warn('following the session rows failed', error))
  }, 'omni-channels: session rows')

  rt.omniRows = { remove, get, list }

  // For the tree: each row with its title and whether its turn runs now (a turn this start
  // has not seen is not running).
  rt.omniRowsView = () => ({
    omniRows: list().map(row => ({
      sessionId: row.sessionId, kind: row.kind, title: row.title, at: row.at,
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
