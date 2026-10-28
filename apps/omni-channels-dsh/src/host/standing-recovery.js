// Standing-Session runs across a DSH restart (wish omni-chat-threads, design rows 15 and 20,
// Decisions 6-8). The Bot team's one restart pass resumes each Session a restart cut; this
// module hands it the Session of every working standing run, binds the turn the team's resume
// opens to the run whose turn the restart cut, and, once the team says its resumes are done,
// decides each run the last start left working. Only then does the queue move on
// (rt.standingRuns.release); nothing here runs before that signal, and a read-only host runs
// none of it.
//
// "Picked up" is the team's word for a Session it resumed or sent again what a shutdown
// dropped (Decision 7). A bound run (its turn began) whose Session is neither picked up nor
// running ends as failed. An unbound run (its tagged follow-up never reached a turn) is decided
// by its Session's inbox, as the team's resendQueued reads it (decideUnbound). One still
// pending in a Session nothing will run is woken: DSH reopens a Session idle and never runs
// its waiting inbox, and ctx.sessions.flush only writes the Session to storage; only a
// waking send starts a turn. So the same message moves to the back of the inbox, which wakes
// the Session, as DSH's own queue actions move a pending item, then the Session is flushed as
// startRun flushes it. No message is posted, nothing goes through rt.deliver, and the turn
// that starts carries the run's own tag.
import { isResumeMessage } from './resume-hook.js'
import { isStandingRun, runTagOf, turnOutcome, wordsOf } from './standing-runs.js'

export const NOT_PICKED_UP = 'Stopped by a DSH restart and not picked up'
const DROPPED = 'Stopped by a DSH restart before its turn started: DSH dropped its event, so nothing ran.'
const ARCHIVED = 'Stopped by a DSH restart before its turn started: its Session was archived, so nothing ran.'
const unreadable = error => `Stopped by a DSH restart before its turn started: its Session could not be opened (${error?.message ?? error}), so nothing ran.`
const unwoken = error => `Stopped by a DSH restart before its turn started: its event could not be started again (${error?.message ?? error}).`
// How far back a Session's log is read, as the team reads it.
const EVENTS_SCANNED = 400

/**
 * What becomes of a working run whose tagged follow-up no turn took when the last start
 * ended: `taken` by a turn of this start, it waits for that turn; neither pending nor taken,
 * it fails; pending while its Session is picked up or running, it waits; pending in a Session
 * nothing will run, it is woken.
 */
export function decideUnbound({ pending, taken, pickedUp, running }) {
  if (taken) return 'wait'
  if (!pending) return 'fail'
  return pickedUp || running ? 'wait' : 'wake'
}

// A Session's log, newest first, as far back as EVENTS_SCANNED; nothing when it cannot be read.
function* newestFirst(session) {
  if (typeof session?.eventAt !== 'function') return
  const last = (session.seq ?? 0) - 1
  for (let seq = last; seq >= 0 && seq > last - EVENTS_SCANNED; seq -= 1) {
    const event = session.eventAt(seq)
    if (event !== undefined) yield event
  }
}
const turnNumber = event => (event.data?.turn === undefined ? null : String(event.data.turn))
// The turn whose user/message carried the run's tag, by its number; null when the log shows none.
function turnThatTook(session, runId) {
  let took = false
  for (const event of newestFirst(session)) {
    if (event.type === 'user/message' && runTagOf(event.data) === runId) took = true
    else if (took && event.type === 'turn/start') return turnNumber(event)
  }
  return null
}
// The turns a restart cut last, from the log: the newest cut turn, and, while a cut turn was
// itself a resume the team posted (its rebind lost to a second restart), the cut turn before
// it; their numbers and the runs whose tags they took. Null when the log cannot be read.
function lastCut(session, cutByRestart) {
  let read = false
  const cut = { turnIds: new Set(), tags: new Set() }
  // 'seek': the next older cut turn's end; 'in': inside that turn; `resumed`: it was a resume.
  let at = 'seek'
  let resumed = false
  for (const event of newestFirst(session)) {
    read = true
    if (at === 'seek') {
      if (event.type !== 'turn/end' || !cutByRestart(event.data?.reason)) continue
      const turnId = turnNumber(event)
      if (turnId !== null) cut.turnIds.add(turnId)
      at = 'in'
      resumed = false
    } else if (event.type === 'user/message') {
      const tag = runTagOf(event.data)
      if (tag !== null) cut.tags.add(tag)
      if (isResumeMessage(event.data)) resumed = true
    } else if (event.type === 'turn/start') {
      if (!resumed) break
      at = 'seek'
    }
  }
  return read ? cut : null
}
// How the run's own turn ended, from the log, when it ended there other than by a restart: its
// outcome with its last words; null otherwise.
function endedIn(session, turnId, cutByRestart) {
  let end
  let words = ''
  for (const event of newestFirst(session)) {
    if (end === undefined) {
      if (event.type === 'turn/end' && turnNumber(event) === turnId) {
        if (cutByRestart(event.data?.reason)) return null
        end = event
      }
    } else if (event.type === 'assistant/message' && words === '') {
      words = wordsOf(event)
    } else if (event.type === 'turn/start') {
      break
    }
  }
  return end === undefined ? null : turnOutcome(end.data?.reason, words || undefined)
}

export function install(rt) {
  const { ctx, state } = rt
  const standing = rt.standingRuns
  const runs = () => (state.subscriptionRuns ??= [])
  const warn = (what, error) => rt.warn(`omni-channels: ${what}: %s`, error?.message ?? error)
  const persist = () => Promise.resolve(rt.save()).catch(error => warn('saving a standing run failed', error))
  const cutByRestart = reason => rt.cutByRestart?.(reason) === true
  const workingIn = sessionId => runs().filter(run => run.sessionId === sessionId && run.status === 'working' && isStandingRun(run))
  const archived = () => {
    try {
      return new Set(ctx.workspaceRegistry?.archivedSessionIds ?? [])
    } catch {
      return new Set()
    }
  }

  // The hook's Sessions: every working standing run's.
  rt.teamResume.addSessions(() => {
    const gone = archived()
    return runs().filter(run => run.status === 'working' && isStandingRun(run) && typeof run.sessionId === 'string' && !gone.has(run.sessionId)).map(run => run.sessionId)
  })

  // Right before the team posts a resume to a Session: its working run is marked resuming, to
  // be bound to the turn that carries the team's resume marker, never simply the next one.
  rt.teamResume.addResumeBinder((sessionId) => {
    const marked = workingIn(sessionId)
    for (const run of marked) run.resuming = true
    if (marked.length > 0) void persist()
  })

  // The turn that carries the resume marker takes the resuming run whose turn is the one the
  // restart cut (also one whose tag that turn took, its bind lost to the restart). A cut owner
  // turn is never the run's: its resume stays the owner's. A Session whose log cannot be read
  // keeps a bound run's gate on its resumed turn.
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'user/message' || !isResumeMessage(event.data)) return
    const id = session?.id
    const run = workingIn(id).find(other => other.resuming === true)
    if (run === undefined) return
    const cut = lastCut(session, cutByRestart)
    const owned = cut === null ? run.turnId !== null
      : cut.turnIds.has(run.turnId) || (run.turnId === null && cut.tags.has(run.id))
    if (owned) standing.rebind(run.id, id)
  })

  // Once the team's resumes are done: each working run the last start left, one after another,
  // then the queue moves on, whatever a decision threw.
  rt.teamResume.addRecovery(async (given) => {
    try {
      await rt.load()
      for (const run of runs().filter(other => other.status === 'working' && isStandingRun(other))) {
        await decide(run, given).catch(error => warn(`deciding the run ${run.id} after a restart failed`, error))
      }
    } finally {
      standing.release()
    }
  })

  async function decide(run, given) {
    const { sessionId } = run
    const pickedUp = rt.teamResume.pickedUp(given, sessionId)
    let agent
    let failure
    try {
      agent = await rt.resolveAgent(sessionId)
    } catch (error) {
      failure = error
    }
    if (run.status !== 'working') return
    // A turn began before this start (the plugin reloaded while DSH went on) is known only to
    // the live agent.
    const running = rt.teamResume.running(sessionId) || agent?.status === 'running'
    // A turn of the last start took its follow-up and the bind was lost: bound to that turn now.
    if (run.turnId === null && !standing.taken(run.id) && agent !== undefined) {
      const turnId = turnThatTook(agent.session, run.id)
      if (turnId !== null) standing.bind(run.id, turnId)
    }
    if (run.turnId !== null) {
      // Its turn ended unseen (the plugin reloaded at its end, or a crash came before the
      // finish was saved): it ends as that turn did.
      const ended = agent === undefined ? null : endedIn(agent.session, run.turnId, cutByRestart)
      if (ended !== null) standing.finish(run.id, ended.status, ended.summary)
      else if (!pickedUp && !running) standing.finish(run.id, 'failed', NOT_PICKED_UP)
      return
    }
    if (archived().has(sessionId)) return standing.finish(run.id, 'failed', ARCHIVED)
    if (agent === undefined) return standing.finish(run.id, 'failed', unreadable(failure))
    const message = [...(agent.inbox?.nextStep ?? []), ...(agent.inbox?.nextTurn ?? [])].find(item => runTagOf(item) === run.id)
    const choice = decideUnbound({ pending: message !== undefined, taken: standing.taken(run.id), pickedUp, running })
    if (choice === 'fail') standing.finish(run.id, 'failed', DROPPED)
    else if (choice === 'wake') await wake(run, agent, message)
  }

  // Woken once: its follow-up moved to the back of the inbox, which starts the Session's turn
  // (the move is the wake), then the Session flushed, which only writes it to storage. A
  // follow-up a turn took meanwhile waits for that turn; a move that throws ends the run.
  async function wake(run, agent, message) {
    try {
      if (!standing.requeue(agent, message)) return
    } catch (error) {
      standing.finish(run.id, 'failed', unwoken(error))
      return
    }
    await (async () => ctx.sessions.flush(agent.session))().catch(error => warn(`flushing the Session ${run.sessionId} after its wake failed`, error))
  }
}
