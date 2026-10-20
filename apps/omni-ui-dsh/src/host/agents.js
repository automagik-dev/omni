// The DSH Agent, shown as Tasks: a team's one plain dsh entry, listed under the Bots but
// not one of them. Its Sessions are ordinary root Sessions in the DS Bot workspace, so
// they get the whole dsh conversation surface and none of the team tools. A Main Bot hands
// one-off work there (start_task); when a task's first turn ends, its last words go back
// to the Bot that started it.
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { AGENT_NAME, AGENT_SESSION_TITLE_MAX, TEAM_TOOLS } from './constants.js'
import { output } from './tools.js'

const TASK_REPORT_MAX = 1500
const TASKS_KEPT = 60
const TASK_LINE_MAX = 160
const TASK_SUMMARY_MAX = 600

export function install(rt) {
  const { ctx, state } = rt

  /** @type {Map<string, string>} Session id -> DSH Agent record id. */
  const sessionIndex = new Map()
  // store.js calls this from indexSessions after every adopt and save.
  rt.indexAgents = () => {
    sessionIndex.clear()
    for (const agent of Object.values(state.agents)) {
      for (const sessionId of agent.sessions ?? []) sessionIndex.set(sessionId, agent.id)
    }
  }
  // The DSH Agent a Session belongs to; Bot and group Sessions get undefined.
  const agentOf = sessionId => state.agents[sessionIndex.get(sessionId)]

  // A DSH Agent Session must not offer the team tools: its agent sees only the
  // global dsh surface minus this plugin's registrations. A Session whose deny
  // has not landed yet (schemas not up, restrict hook missing, a transient
  // throw) stays on the retry list until it sticks or the Session leaves.
  const restricted = new WeakSet()
  const RETRY_MS = 5_000
  const pendingRestrict = new Set()
  let retryTimer
  const stopRetry = () => {
    if (retryTimer !== undefined) clearInterval(retryTimer)
    retryTimer = undefined
  }
  ctx.effect(() => stopRetry, 'ds-bot: agent tool restrict retry')
  const scheduleRetry = (agent) => {
    pendingRestrict.add(agent)
    if (retryTimer === undefined) {
      retryTimer = setInterval(() => {
        for (const waiting of [...pendingRestrict]) void restrictTeamTools(waiting)
        if (pendingRestrict.size === 0) stopRetry()
      }, RETRY_MS)
      retryTimer.unref?.()
    }
  }
  const restrictTeamTools = async (agent) => {
    if (agent === undefined || restricted.has(agent)) return
    if (agentOf(agent.session?.id) === undefined) {
      pendingRestrict.delete(agent)
      return
    }
    // Unknown names make restrict() throw, so only deny what this profile serves.
    const known = new Set(ctx.tools.schemas(agent).map(schema => schema.name))
    const deny = TEAM_TOOLS.filter(name => known.has(name))
    // An empty list can mean the schemas are not up yet, and a missing restrict
    // hook means the Agent is still being put together; both retry.
    if (deny.length === 0 || typeof agent.ctx?.tools?.restrict !== 'function') {
      scheduleRetry(agent)
      return
    }
    try {
      agent.ctx.tools.restrict({ deny })
      restricted.add(agent)
      pendingRestrict.delete(agent)
    } catch (error) {
      rt.warn('ds-bot: team tools stay visible to DSH Agent %s: %s', agent.session?.id, error)
      scheduleRetry(agent)
    }
  }
  // Fires when a root Session resolves its agent, including sessions saved earlier.
  ctx.on('agent/created', ({ agent }) => {
    void rt.load()
      .then(() => restrictTeamTools(agent))
      .catch(error => rt.warn('ds-bot: tool restrict on agent/created failed: %s', error))
  })

  const writeCheck = () => {
    const readOnly = rt.readOnly()
    if (readOnly !== undefined) throw new Error(readOnly)
  }
  const record = (agentId) => {
    const agent = state.agents[agentId]
    if (agent === undefined) throw new Error('Unknown DSH Agent')
    return agent
  }

  async function createAgentSession(agentId, workspaceId) {
    writeCheck()
    const agent = record(agentId)
    // A known workspace id wins (the Agent's latest Session may live outside the
    // team workspace after a workspace switch); anything else gets the team's own.
    const target = typeof workspaceId === 'string' && ctx.workspaceRegistry.get(workspaceId)
      ? workspaceId
      : await rt.ensureWorkspace()
    const { sessionId } = await ctx.sessionController.create({ workspaceId: target })
    agent.sessions.push(sessionId)
    await rt.save()
    // agent/created fired before the session joined the index, so restrict again now.
    await restrictTeamTools(await rt.resolveAgent(sessionId))
    return sessionId
  }

  // A root Session the user opened from a DSH Agent page (the hero's workspace
  // picker or a fork) is adopted into the same Agent: it keeps dsh's surface and
  // the team tools stay hidden.
  async function adoptAgentSession(agentId, sessionId) {
    writeCheck()
    const agent = record(agentId)
    if (agent.sessions.includes(sessionId)) return sessionId
    await rt.resolveAgent(sessionId)
    const owned = rt.selfOf(sessionId) !== undefined || rt.botOf(sessionId) !== undefined
      || rt.roomOf(sessionId) !== undefined || agentOf(sessionId) !== undefined
    if (owned) throw new Error('Session already belongs to the team')
    agent.sessions.push(sessionId)
    await rt.save()
    await restrictTeamTools(await rt.resolveAgent(sessionId))
    return sessionId
  }

  async function addAgent() {
    writeCheck()
    if (Object.keys(state.agents).length > 0) throw new Error('The team already has a DSH Agent')
    const agent = { id: randomUUID(), name: AGENT_NAME, sessions: [], createdAt: Date.now() }
    state.agents[agent.id] = agent
    try {
      await createAgentSession(agent.id)
    } catch (error) {
      // The first Session may already be created and saved: archive it and
      // persist the rollback, or the Agent returns on restart with its team
      // tools never denied.
      const createdSessions = [...agent.sessions]
      delete state.agents[agent.id]
      for (const sessionId of createdSessions) await ctx.workspaceRegistry.archiveSession(sessionId).catch(() => {})
      await rt.save().catch(() => {})
      throw error
    }
    return agent
  }

  async function archiveAgentSession(agentId, sessionId) {
    writeCheck()
    const agent = record(agentId)
    if (!agent.sessions.includes(sessionId)) throw new Error('Session does not belong to the DSH Agent')
    // Archive first: the Session leaves the Agent only once it is actually gone,
    // so a failed archive stays retryable and keeps its tool restriction.
    await ctx.workspaceRegistry.archiveSession(sessionId)
    agent.sessions = agent.sessions.filter(id => id !== sessionId)
    await rt.save()
  }

  async function renameAgentSession(agentId, sessionId, title) {
    writeCheck()
    const agent = record(agentId)
    if (!agent.sessions.includes(sessionId)) throw new Error('Session does not belong to the DSH Agent')
    const clean = String(title ?? '').trim()
    if (clean === '') throw new Error('A session needs a title')
    const agent_ = await rt.resolveAgent(sessionId)
    await ctx.sessionTitle.rename(agent_.session, clean.slice(0, AGENT_SESSION_TITLE_MAX))
  }

  async function removeAgent(agentId) {
    writeCheck()
    const agent = record(agentId)
    const sessions = [...agent.sessions]
    const kept = []
    let failure
    for (const sessionId of sessions) {
      try {
        await ctx.workspaceRegistry.archiveSession(sessionId)
      } catch (error) {
        failure ??= error
        kept.push(sessionId)
      }
    }
    // What could not be archived stays with the Agent, so it keeps its tool
    // restriction and the removal can be retried from the same place.
    if (kept.length > 0) {
      agent.sessions = kept
      await rt.save()
      throw failure
    }
    delete state.agents[agentId]
    await rt.save()
  }

  // The team's Tasks entry, made without a first Session when work arrives before it exists.
  async function ensureTasks() {
    const existing = Object.values(state.agents)[0]
    if (existing !== undefined) return existing
    writeCheck()
    const agent = { id: randomUUID(), name: AGENT_NAME, sessions: [], createdAt: Date.now() }
    state.agents[agent.id] = agent
    await rt.save()
    return agent
  }

  // A fresh Tasks Session with a title; automations that run "a new DSH session" use it too.
  async function createTaskSession(title) {
    const agent = await ensureTasks()
    const sessionId = await createAgentSession(agent.id)
    const clean = String(title ?? '').trim().slice(0, AGENT_SESSION_TITLE_MAX)
    if (clean !== '') await renameAgentSession(agent.id, sessionId, clean).catch(error => rt.warn('ds-bot: task title not set: %s', error?.message ?? error))
    return sessionId
  }

  const tasks = () => (state.tasks ??= {})
  async function startTask({ title, text, from }) {
    const sessionId = await createTaskSession(title)
    tasks()[sessionId] = { title: String(title).slice(0, AGENT_SESSION_TITLE_MAX), from, at: Date.now(), status: 'working' }
    // Only the newest tasks are remembered for their reports.
    const kept = Object.entries(tasks()).sort(([, a], [, b]) => b.at - a.at)
    for (const [id] of kept.slice(TASKS_KEPT)) delete tasks()[id]
    await rt.save()
    const live = await rt.resolveAgent(sessionId)
    // DSH's turn loop reads every input's source: the instructions arrive as the user's.
    live.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await ctx.sessions.flush(live.session)
    return sessionId
  }

  // A task's first turn ends: its last words go to the Bot that asked, once.
  const lastWords = new Map()
  ctx.on('session/event', (session, event) => {
    const id = session?.id
    const task = id === undefined ? undefined : state.tasks?.[id]
    if (task === undefined || task.status !== 'working') return
    if (event?.type === 'assistant/message') {
      const content = event.data?.message?.content
      const text = Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text).join('\n').trim() : ''
      // What the task is on, for its card in the chat: its latest words and how far it got.
      task.steps = (task.steps ?? 0) + 1
      const calls = Array.isArray(content) ? content.filter(block => block?.type === 'tool-call' || block?.type === 'tool_use').map(block => block.name ?? block.toolName).filter(Boolean) : []
      if (calls.length > 0) task.tool = String(calls.at(-1)).slice(0, 40)
      if (text) {
        lastWords.set(id, text)
        task.said = text.replace(/\s+/g, ' ').slice(0, TASK_LINE_MAX)
      }
      void rt.save().catch(error => rt.warn('ds-bot: saving a task failed: %s', error))
    } else if (event?.type === 'turn/end') {
      // A restart cut the turn: the task is not done, and resume.js sets it going again.
      if (rt.cutByRestart?.(event.data?.reason)) return
      const failed = event.data?.reason?.kind === 'error'
      task.status = failed ? 'failed' : 'done'
      task.endedAt = Date.now()
      const words = lastWords.get(id) ?? ''
      lastWords.delete(id)
      task.summary = (failed ? event.data.reason.error?.message ?? 'It stopped with an error.' : words).slice(0, TASK_SUMMARY_MAX)
      void rt.save().catch(error => rt.warn('ds-bot: saving a task failed: %s', error))
      if (rt.botOf(task.from) === undefined) return
      const said = failed ? `It stopped with an error: ${event.data.reason.error?.message ?? 'unknown'}` : words || 'It ended without a reply.'
      void rt.deliver({ toId: task.from, text: said.slice(0, TASK_REPORT_MAX), role: 'task-done', note: task.title, taskSessionId: id })
        .catch(error => rt.warn('ds-bot: the report of task %s did not reach its Bot: %s', task.title, error?.message ?? error))
    }
  })

  ctx.tools.register(defineTool({
    name: 'start_task',
    description: 'Main Bot only. Hands one-off work (code, files, a repo, research, a long investigation) to a new session under Tasks, which has a full computer. Write instructions that stand on their own: it cannot see this chat. Its result comes back to you as a message when its first turn ends.',
    parameters: {
      title: { type: 'string', required: true, description: 'A few words the user will see in the Tasks list' },
      instructions: { type: 'string', required: true, description: 'Everything the task needs: the goal, where to work, what to return' },
    },
    output,
    async execute(args, exec) {
      await rt.load()
      const self = rt.selfOf(exec.agent?.id)
      if (self === undefined || !rt.isMain(self)) return 'Only a Main Bot starts tasks. Ask it in its chat.'
      const title = String(args.title ?? '').trim()
      const text = String(args.instructions ?? '').trim()
      if (title === '' || text === '') return 'A task needs a title and instructions.'
      try {
        const sessionId = await startTask({ title, text, from: self })
        return `Started task "${title.slice(0, AGENT_SESSION_TITLE_MAX)}" (${sessionId}) under Tasks. Its result comes back to you as a message; do not wait or poll.`
      } catch (error) {
        return `The task did not start: ${error?.message ?? error}`
      }
    },
  }))

  Object.assign(rt, { agentOf, addAgent, createAgentSession, adoptAgentSession, archiveAgentSession, renameAgentSession, removeAgent, createTaskSession, startTask })
}
