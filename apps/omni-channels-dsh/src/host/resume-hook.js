// What a DSH restart cut, picked up by the Bot team (@automagik/bots-dsh, its resume.js): its
// one restart pass resumes every cut Session once, its own way, so this plugin has no resume
// pass of its own. The plugin hands the team the Sessions it owns (sessions()), binds each
// resumed turn before the team posts it (onResume), and does its start-time recovery only
// when the team says its resumes are done (resumesDone), never after a delay. The team's names
// are in one table, TEAM_CONTRACT: a release that spells them differently changes only this
// file, and the other modules reach the hook only through rt.teamResume.
//
// A team without the hook still loads this plugin: rt.teamResume is not ready, with the reason
// to show, nothing registers with the team and no recovery runs.
import { z } from 'zod'

// The Bot team release that ships the hook, and its names, as dotted paths on the team's
// runtime. `resentField`: the outcome's list of Sessions sent again what a shutdown dropped.
// `resumeMarker`: whether a message's source is a resume the team posted, a delivery's or the
// plain follow-up `{ kind: 'user', resumed: true }`. `dshBotsChanged`: the roster signal,
// `onChange(fn)` → disposer, `fn(list)`. `rowProps`: what each botChildren entry is drawn with.
export const TEAM_CONTRACT = Object.freeze({
  release: '3.N pending — automagik#94 0f9873ad9',
  register: 'resumable.register',
  resumesDone: 'resumesDone',
  resentField: 'resent',
  resumeMarker: source => source?.resumed === true,
  dshBotsList: 'dshBots.list',
  dshBotsCreate: 'dshBots.createSession',
  dshBotsChanged: 'dshBots.onChange',
  rowProps: Object.freeze(['bot', 'roster', 'actions', 'wide', 'useSessions', 'useUi', 'useSessionStatus', 'useSessionRetainInfo', 'useActivity', 'useWork']),
})

export const NEEDS_NEWER_TEAM = 'Adding a chat needs a newer Bot team.'

export const isResumeMessage = message => TEAM_CONTRACT.resumeMarker(message?.source)

// The hook's id on the team: one registration per plugin.
const HOOK_ID = 'omni-channels'

// A member of the team's runtime by its TEAM_CONTRACT name; a function comes bound to the
// object that holds it.
export function fromTeam(rt, path) {
  let owner
  let value = rt
  for (const key of path.split('.')) {
    owner = value
    value = value?.[key]
  }
  return typeof value === 'function' ? value.bind(owner) : value
}

// The team's answer: { resumed, resent } after its pass, { readOnly } when this host only
// reads the team, { failed } with what was done before the pass threw or stopped.
const ids = z.array(z.string()).catch([])
const Outcome = z.object({ readOnly: z.string().optional(), failed: z.string().optional(), resumed: ids, [TEAM_CONTRACT.resentField]: ids })

const outcomeOf = (answer) => {
  const parsed = Outcome.safeParse(answer ?? {})
  if (!parsed.success) return { readOnly: null, failed: 'the Bot team\'s restart outcome could not be read', resumed: new Set(), resent: new Set(), late: false }
  const { readOnly, failed, resumed } = parsed.data
  return { readOnly: readOnly ?? null, failed: failed ?? null, resumed: new Set(resumed), resent: new Set(parsed.data[TEAM_CONTRACT.resentField]), late: false }
}

export function install(rt) {
  const { ctx } = rt
  const register = fromTeam(rt, TEAM_CONTRACT.register)
  const done = fromTeam(rt, TEAM_CONTRACT.resumesDone)
  // Checked as the client checks chatSuggestions?.register: a team before the hook lacks both.
  const ready = typeof register === 'function' && typeof done?.then === 'function'
  const hook = { ready, reason: ready ? null : NEEDS_NEWER_TEAM }

  const sources = []
  const binders = []
  const recoveries = []
  // Sessions whose turn runs now: one started since this start and not ended.
  const turning = new Set()
  ctx.on('session/event', (session, event) => {
    const id = session?.id
    if (id === undefined) return
    if (event?.type === 'turn/start') turning.add(id)
    else if (event?.type === 'turn/end') turning.delete(id)
  })

  // Every source's Sessions now, once each. A source lists only the live Sessions it owns.
  // `read`: the team's pass asked, so its outcome speaks for this plugin's Sessions.
  let read = false
  const sessions = () => {
    read = true
    const listed = new Set()
    for (const source of sources) {
      try {
        const list = source()
        for (const id of Array.isArray(list) ? list : []) if (typeof id === 'string' && id !== '') listed.add(id)
      } catch (error) {
        rt.warn('ds-bot: a source of restart resumes failed: %s', error?.message ?? error)
      }
    }
    return [...listed]
  }
  // Called by the team right before it posts a resume, so each binder binds the turn first.
  const onResume = ({ sessionId } = {}) => {
    for (const bind of binders) {
      try {
        bind(sessionId)
      } catch (error) {
        rt.warn('ds-bot: binding the resumed turn of %s failed: %s', sessionId, error?.message ?? error)
      }
    }
  }

  // The team's outcome once its pass is over; each recovery runs once, in the order added,
  // one after another. Read-only runs none: this host changes nothing, whatever the outcome says.
  let outcome
  let stopped = false
  let queue = Promise.resolve()
  const readsOnly = () => (outcome !== undefined && outcome.readOnly !== null) || (typeof rt.readOnly === 'function' && rt.readOnly() !== undefined)
  const recover = (fn, given) => {
    queue = queue.then(async () => {
      if (stopped || readsOnly()) return
      try {
        await fn(given)
      } catch (error) {
        rt.warn('ds-bot: a restart recovery failed: %s', error?.message ?? error)
      }
    })
  }

  ctx.effect(() => {
    if (!hook.ready) return () => { stopped = true }
    let unregister
    try {
      unregister = register({ id: HOOK_ID, sessions, onResume })
    } catch (error) {
      Object.assign(hook, { ready: false, reason: `The Bot team did not take this plugin's restart resumes: ${error?.message ?? error}` })
      rt.warn('ds-bot: %s', hook.reason)
      return () => { stopped = true }
    }
    // A pass that never asked for this plugin's Sessions (it was over, or past that point, when
    // the plugin registered) reads every one of them as not resumed. The team's promise never
    // rejects; were it to, that is a failed pass.
    void Promise.resolve(done)
      .then(answer => answer, error => ({ failed: String(error?.message ?? error) }))
      .then((answer) => {
        if (stopped) return
        outcome = outcomeOf(answer)
        if (!read) Object.assign(outcome, { resumed: new Set(), resent: new Set(), late: true })
        if (readsOnly()) return
        for (const fn of recoveries) recover(fn, outcome)
      })
    return () => {
      stopped = true
      unregister?.()
    }
  }, 'ds-bot: restart resumes')

  rt.teamResume = {
    get ready() { return hook.ready },
    get reason() { return hook.reason },
    addSessions(fn) { sources.push(fn) },
    addResumeBinder(fn) { binders.push(fn) },
    // Added after the pass is over, a recovery reads every Session as not resumed.
    addRecovery(fn) {
      recoveries.push(fn)
      if (!hook.ready || outcome === undefined || readsOnly()) return
      recover(fn, { ...outcome, resumed: new Set(), resent: new Set(), late: true })
    },
    pickedUp: (given, sessionId) => given.resumed.has(sessionId) || given.resent.has(sessionId),
    running: sessionId => turning.has(sessionId),
  }
}
