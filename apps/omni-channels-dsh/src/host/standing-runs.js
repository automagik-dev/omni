// Standing-Session runs (wish omni-chat-threads, design row 15): an automation that hands its
// events to a Session that stays, an added chat's thread first ("ongoing" and DSH-bot
// Sessions come through the same targets later), where the owner's own turns go on too.
//
// An event is a `queued` record in the run log, `{ id, subId, target, status, event, at }`,
// written before fireSubscription returns, so before the events stream acks it to Omni. Each
// standing Session takes one run at a time, the oldest queued event first, once the run
// before it ended, done or failed. The record becomes the run, `{ id, subId, sessionId,
// status, turnId, at }` and what the board shows, never with `botId` or `task`: the Bot team
// maps a record with both to that Bot (its taskOwners), and a thread would speak as the Omni
// Bot. A hand-over posts a follow-up tagged `{ kind: 'omni-run', runId }` and wakes the
// Session; the run is bound to the turn whose user/message carries its own tag, and only that
// turn's end finishes it, with its last words.
//
// Every record here carries `standing: true`, the one way the log tells a standing Session's
// record from another run's; a record saved before the marker is recognised by its shape and
// marked as it is read (isStandingRun).
//
// The ask gate holds every turn that carries a tag, whatever its run's status, so a tagged
// follow-up that runs after its run ended is still gated (and finishes nothing). A thread's
// send and reaction are thread-tools.js's to gate, with asksFirst from here. The host never
// sets a standing Session's preset: the owner's own turns there keep the thread's usual
// rules.
import { z } from 'zod'
import { closeRun, followupAndFlush, isAskRun, pruneRuns, readsOnly, runId } from './asks.js'

/** The run a message was posted for: its `omni-run` tag's id, else null. */
export const runTagOf = message => (message?.source?.kind === 'omni-run' ? message.source.runId : null)
// A record saved before the marker: an event waiting its turn (with its target), or a run
// bound by its turn (a `turnId` key), never an ask's.
const unmarkedStanding = run => run.standing === undefined && !isAskRun(run)
  && (run.status === 'queued' ? typeof run.target === 'object' && run.target !== null : Object.hasOwn(run, 'turnId'))
/**
 * Whether a run log record is a standing Session's: marked `standing: true`. One saved before
 * the marker is recognised by its shape and marked now, so the next save keeps the marker.
 */
export function isStandingRun(run) {
  if (typeof run !== 'object' || run === null) return false
  if (run.standing === true) return true
  if (!unmarkedStanding(run)) return false
  run.standing = true
  return true
}
// The tools whose card thread-tools.js decides, tagged turn or not.
const THREAD_CARDED = new Set(['thread_say', 'thread_react'])
/** The card a tagged turn's call raises when its run asks first. */
export const automationAsk = name => `An automation event is being handled here, and its text was written by other people. Allow ${name} this once?`
// How many events wait for one standing Session at most; one more is not queued, and the
// board says so. A run that waits on a card nobody answers must not grow the log forever.
export const QUEUED_MAX = 20
const notHandedOver = count => `Not handed over${count > 1 ? ` (×${count})` : ''}: ${QUEUED_MAX} events already wait for this thread.`

const Target = z.object({ kind: z.enum(['thread', 'ongoing', 'dshbot']), id: z.string().min(1) }).strict()
const sameTarget = (a, b) => a?.kind === b?.kind && a?.id === b?.id

export function install(rt) {
  const { ctx, state } = rt
  const runs = () => (state.subscriptionRuns ??= [])
  const subs = () => (state.subscriptions ??= {})
  const warn = (what, error) => rt.warn(`omni-channels: ${what}: %s`, error?.message ?? error)
  const persist = () => Promise.resolve(rt.save()).catch(error => warn('saving a standing run failed', error))

  const record = id => runs().find(run => run.id === id && isStandingRun(run))
  const working = sessionId => runs().find(run => run.sessionId === sessionId && run.status === 'working' && isStandingRun(run))
  // Where a target's events go now; null when it has no Session. Read without waiting, so no
  // reload of the log comes between finding a record and changing it.
  const sessionNow = target => (target?.kind === 'thread' ? rt.threads?.byId(target.id)?.sessionId ?? null : null)
  const sessionOf = async target => sessionNow(target)

  // The turn each Session runs now, as its events say: its id, the runs whose tags reached
  // it, and their last words.
  const turns = new Map()
  const turnOf = (sessionId) => {
    if (!turns.has(sessionId)) turns.set(sessionId, { turnId: `unseen-${Date.now().toString(36)}`, runIds: [], words: undefined })
    return turns.get(sessionId)
  }
  // A turn this start never saw begin (the plugin reloaded while DSH went on): it is taken for
  // the bound run's own turn, so its gate holds and its end finishes the run. A turn that
  // begins after this start has its own entry.
  const adopted = (sessionId) => {
    if (turns.has(sessionId)) return turns.get(sessionId)
    const run = working(sessionId)
    if (typeof run?.turnId !== 'string') return undefined
    const turn = { turnId: run.turnId, runIds: [run.id], words: undefined, adopted: true }
    turns.set(sessionId, turn)
    return turn
  }

  function bind(id, turnId) {
    const run = record(id)
    if (run?.status !== 'working' || run.turnId !== null) return
    run.turnId = turnId
    void persist()
  }

  // A queued event that will never be handed over: a failed record on the board, saying why,
  // without the event.
  function dropQueued(run, summary) {
    const { event = {} } = run
    delete run.event
    delete run.target
    Object.assign(run, { sessionId: run.sessionId ?? null, turnId: null, from: event.chat ?? '', excerpt: event.text ? String(event.text).slice(0, 160) : '' })
    closeRun(run, 'failed', summary)
  }
  // Every queued event `which` picks ends so; the caller saves.
  function failQueued(which, summary) {
    for (const run of runs()) if (run.status === 'queued' && which(run)) dropQueued(run, typeof summary === 'function' ? summary(run) : summary)
    state.subscriptionRuns = pruneRuns(runs())
  }

  // A run ends; its Session then takes the next queued event.
  function finish(id, status, summary) {
    const run = record(id)
    if (run?.status !== 'working') return
    closeRun(run, status, summary)
    state.subscriptionRuns = pruneRuns(runs())
    void persist()
    void handOver(run.sessionId)
  }

  // One hand-over at a time per Session; a call while one runs follows it.
  const handing = new Map()
  function handOver(sessionId) {
    const next = (handing.get(sessionId) ?? Promise.resolve()).then(() => handOverOnce(sessionId)).catch(error => warn(`handing an event to ${sessionId} failed`, error))
    handing.set(sessionId, next)
    void next.finally(() => { if (handing.get(sessionId) === next) handing.delete(sessionId) })
    return next
  }
  async function handOverOnce(sessionId) {
    if (typeof sessionId !== 'string' || working(sessionId) !== undefined) return
    // The log is newest first: the oldest queued event for this Session is the last one.
    // An automation that is off hands over nothing; turned on again, it goes on (setOn).
    const pick = runs().findLast(run => run.status === 'queued' && subs()[run.subId]?.on === true && sessionNow(run.target) === sessionId)
    if (pick === undefined) return
    const sub = subs()[pick.subId]
    const queued = { ...pick }
    const { event = {}, target: _target, ...rest } = pick
    const become = (fields) => {
      for (const key of Object.keys(pick)) delete pick[key]
      Object.assign(pick, fields)
    }
    // The same record, now the run: it keeps its id, so the tag finds it.
    become({
      ...rest, standing: true, sessionId, status: 'working', turnId: null,
      from: event.chat ?? sub.sources[0]?.name ?? '', excerpt: event.text ? String(event.text).slice(0, 160) : '',
      summary: 'Handed to the thread.', askFirst: sub.askFirst !== false, ...(event.test ? { test: true } : {}),
    })
    // Not posted unless the run is saved: a restart would find the event still queued and hand
    // it over a second time. It waits queued for the next hand-over instead.
    try {
      await rt.save()
    } catch (error) {
      become(queued)
      warn(`the run ${pick.id} was not saved, its event waits`, error)
      return
    }
    try {
      await followupAndFlush(rt, sessionId, rt.automationText(sub, event), { kind: 'omni-run', runId: pick.id })
    } catch (error) {
      finish(pick.id, 'failed', `Could not start: ${error?.message ?? error}`)
    }
  }

  // The event, kept before this returns; its Session is then asked to take it, without waiting.
  // The count and the write share one step with no wait between, so events arriving together
  // never queue past QUEUED_MAX.
  async function enqueue(target, sub, event) {
    const where = Target.parse(target)
    const waiting = runs().filter(run => run.status === 'queued' && sameTarget(run.target, where)).length
    const base = { id: runId('run'), subId: sub.id, standing: true, at: Date.now() }
    if (waiting >= QUEUED_MAX) {
      // Omni has the event acked once this returns: the board says it was dropped. While the
      // newest record for this target is already this automation's drop, it counts one more
      // there instead of filling the log with copies.
      const sessionId = sessionNow(where)
      const newest = runs().find(run => isStandingRun(run) && (sameTarget(run.target, where) || (sessionId !== null && run.sessionId === sessionId)))
      const excerpt = event?.text ? String(event.text).slice(0, 160) : ''
      if (newest?.status === 'failed' && newest.subId === sub.id && Number.isInteger(newest.count)) {
        newest.count += 1
        Object.assign(newest, { endedAt: Date.now(), from: event?.chat ?? '', excerpt, summary: notHandedOver(newest.count) })
        await rt.save()
        return newest
      }
      const dropped = {
        ...base, sessionId, status: 'failed', turnId: null, endedAt: Date.now(),
        from: event?.chat ?? '', excerpt, summary: notHandedOver(1), count: 1,
      }
      state.subscriptionRuns = pruneRuns([dropped, ...runs()])
      await rt.save()
      return dropped
    }
    const queued = { ...base, target: { kind: where.kind, id: where.id }, status: 'queued', event: { ...event }, at: base.at }
    state.subscriptionRuns = pruneRuns([queued, ...runs()])
    await rt.save()
    const sessionId = sessionNow(where)
    if (sessionId !== null) void handOver(sessionId)
    return queued
  }

  ctx.on('session/event', (session, event) => {
    const id = session?.id
    if (id === undefined) return
    if (event?.type === 'turn/start') {
      turns.set(id, { turnId: String(event.data?.turn ?? event.seq ?? Date.now()), runIds: [], words: undefined })
    } else if (event?.type === 'user/message') {
      const tag = runTagOf(event.data)
      if (tag === null) return
      // Gated whatever its run's status; bound only to a run of this Session.
      const turn = turnOf(id)
      if (!turn.runIds.includes(tag)) turn.runIds.push(tag)
      if (record(tag)?.sessionId === id) bind(tag, turn.turnId)
    } else if (event?.type === 'assistant/message') {
      const turn = adopted(id)
      if (turn === undefined || turn.runIds.length === 0) return
      const content = event.data?.message?.content
      const text = Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text).join('\n').trim() : ''
      if (text) turn.words = text
    } else if (event?.type === 'turn/end') {
      const turn = adopted(id)
      turns.delete(id)
      if (turn === undefined || turn.runIds.length === 0) return
      // An adopted turn is the run's only when DSH says it is that turn.
      if (turn.adopted && String(event.data?.turn) !== turn.turnId) return
      // A restart cut the run's turn: it is not done (the Bot team resumes it).
      if (rt.cutByRestart?.(event.data?.reason)) return
      const reason = event.data?.reason
      const failed = reason?.kind === 'error' || reason?.kind === 'aborted'
      const summary = reason?.kind === 'error' ? reason.error?.message : reason?.kind === 'aborted' ? `Stopped before it finished.${turn.words ? ` Its last words: ${turn.words}` : ''}` : turn.words
      for (const tag of turn.runIds) {
        const run = record(tag)
        // Only the run's own turn finishes it; a late follow-up of an ended run finishes nothing.
        if (run?.status !== 'working' || run.sessionId !== id || run.turnId !== turn.turnId) continue
        finish(tag, failed ? 'failed' : 'done', summary)
      }
    }
  })

  // DSH dropped a tagged follow-up before any turn took it (the user stopped the Session, or a
  // clean shutdown cleared its inbox): its run ends as failed and the next event goes in.
  ctx.on('agent/inbox/discarded', ({ message } = {}) => {
    const tag = runTagOf(message)
    if (tag === null) return
    const run = record(tag)
    if (run?.status !== 'working' || run.turnId !== null) return
    finish(tag, 'failed', 'DSH dropped this event before its turn started (the Session was stopped). Nothing ran.')
  })

  // Whether the turn a Session runs now carries an automation's tag whose run asks first; a
  // run whose record is gone asks too. A turn this start never saw begin is the bound run's
  // (adopted), so a plugin reload keeps it gated.
  const asksFirst = (sessionId) => {
    const turn = adopted(sessionId)
    return turn !== undefined && turn.runIds.length > 0 && turn.runIds.some(tag => record(tag)?.askFirst !== false)
  }

  // A tagged turn asks before anything but a read when its run asks first. A thread's send and
  // reaction are left to thread-tools.js, which asks for them with what goes out. Ahead of
  // DSH's own gates, so their answer is the one this tightens.
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision?.kind !== 'allow' || readsOnly(exec) || THREAD_CARDED.has(exec.name)) return decision
    const sessionId = exec.agent?.id ?? exec.agent?.session?.id
    if (turns.get(sessionId)?.runIds.length === 0) return decision
    try { await rt.load() } catch { /* the runs in memory still count */ }
    return asksFirst(sessionId) ? { kind: 'ask', reason: automationAsk(exec.name) } : decision
  }, { prepend: true })

  // A removed chat's thread takes no more events: its automations pause, its queued events and
  // its working run end as failed, saying why.
  ctx.effect(() => rt.threads.onRemoved(async (thread) => {
    const target = { kind: 'thread', id: thread.id }
    const reason = 'Its chat was removed, so the thread it hands events to is gone. Add the chat again and save the automation with the new thread.'
    failQueued(run => sameTarget(run.target, target), 'Not handed over: the chat was removed.')
    for (const run of runs()) if (run.status === 'working' && run.sessionId === thread.sessionId && isStandingRun(run)) closeRun(run, 'failed', 'Stopped: the chat was removed.')
    state.subscriptionRuns = pruneRuns(runs())
    await rt.pauseAutomations(sub => sub.worker?.kind === 'thread' && sub.worker.threadId === thread.id, reason)
    await persist()
  }), 'omni-channels: automations of removed threads')

  // At start, a thread automation that cannot take events (a team without the hook, a chat
  // removed meanwhile) pauses with why.
  ctx.effect(() => {
    void Promise.resolve(rt.load()).then(() => rt.pauseStrandedThreads()).catch(error => warn('pausing the thread automations that cannot run failed', error))
  }, 'omni-channels: stranded thread automations')

  rt.standingRuns = {
    enqueue,
    handOver,
    sessionOf,
    working,
    bind,
    finish,
    failQueued,
    asksFirst,
  }
}
