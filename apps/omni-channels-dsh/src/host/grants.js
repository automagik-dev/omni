// What each Bot may do on Omni. A Main Bot or the team's Omni Bot (kind 'omni') operates all
// of it (operatesOmni); any other Bot starts with
// nothing and is granted, per chat, group or whole channel, the actions it asks for: read
// messages, open media, send, react, delete. Nothing is set up front. The first time a Bot
// needs something, its tool call puts a card in front of the user, in the Bot's own chat:
// "Digest wants to read 🦞BuildWithFriends · Once · Always · No". The turn ends there (like
// ask_user), and the answer comes back to the Bot as a note. Once and Always run the exact
// call the card showed; Always also keeps a grant, which the Bot's settings list and revoke.
//
// Some acts ask every time, grant or not, Omni and Main Bots included: sending as the user to a person,
// deleting, disconnecting a channel. Their card shows the destination and the exact text, and
// confirming runs that call, nothing else.
import { randomUUID } from 'node:crypto'
import { HANDOFF_TOOL } from './omni-rules.js'

export const ACTIONS = ['read', 'media', 'send', 'react', 'delete']
// Always for the whole channel ('channel') grants what was asked on every chat of that channel.
const ANSWERS = new Set(['once', 'always', 'channel', 'deny'])
const KEPT = 20
const TOLD_MAX = 6000

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })

// The Bot team's start_task is refused to a Bot that operates the Omni named here, which has
// no computer: that work goes to its own hand-off (handoff.js), which reports back once, after
// a restart too. Every other Bot, and every Bot while no Omni is named, keeps the team's tool.
export const START_TASK_REFUSAL = `Work that needs a computer goes to ${HANDOFF_TOOL}: it runs in a session under your row, and its result comes back to you as a message.`

/**
 * Whether `botId` operates Omni: a Main Bot, or an Omni Bot (kind 'omni') whether it is a Main
 * Bot or not. The owner wants an Omni Bot to have full control of Omni without being the Main Bot.
 */
export const operatesOmni = (rt, botId) => botId !== undefined && (rt.isMain(botId) || rt.botOf(botId)?.kind === 'omni')

/**
 * Whether a Session is a Bot that operates the Omni named here: such a Bot has lost DSH's
 * computer tools (omni-api.js), and hands that work to a session under its row.
 */
export const operatesHere = (rt, sessionId) => (rt.omniNamed?.() ?? Boolean(rt.config?.omni?.url)) && operatesOmni(rt, rt.selfOf(sessionId))

/** Whether `grant` lets `botId` do `action` on `resource` at `now`. */
export function covers(grant, { botId, resource, action, now = Date.now() }) {
  if (!grant || grant.botId !== botId || !Array.isArray(grant.actions) || !grant.actions.includes(action)) return false
  if (typeof grant.expiresAt === 'number' && grant.expiresAt <= now) return false
  if (grant.resource?.type === 'channel') return Boolean(resource.channelId) && resource.channelId === grant.resource.id
  return grant.resource?.type === resource.type && grant.resource?.id === resource.id
}

/** Acts that ask every time: deleting, and sending as the user to a person (not a group, not the user's own chat). */
export const sensitive = (action, resource) => action === 'delete' || (action === 'send' && resource.type === 'chat')

/** 'allow' runs the call; 'consent' asks for a grant; 'confirm' asks to run this one call. */
export function decide({ main, grants, botId, resource, action, now = Date.now() }) {
  const asks = sensitive(action, resource)
  if (main) return asks ? 'confirm' : 'allow'
  const grant = grants.find(entry => covers(entry, { botId, resource, action, now }))
  if (grant === undefined) return 'consent'
  return asks || grant.approval === 'confirm' ? 'confirm' : 'allow'
}

// What the Bot asked for, in words for the Bot. Only what the Bot itself wrote comes back to
// it: a message it wants to react to or delete stays on the user's card, since the Bot may not
// be allowed to read that chat.
export function askText({ action, resource, preview = {} }) {
  const where = `"${resource.name}"`
  if (action === 'read') return `read the messages of ${where}`
  if (action === 'media') return `open a media file in ${where}`
  if (resource.type === 'call') return `${preview.method ?? ''} ${preview.path ?? resource.name}`.trim()
  if (action === 'send') return `send ${JSON.stringify(preview.text ?? '')} to ${where}`
  if (action === 'react') return `react ${preview.emoji ?? ''} to a message in ${where}`
  if (action === 'delete') return `delete a message in ${where}`
  return `${action} in ${where}`
}

export function install(rt) {
  const { ctx, state } = rt
  const grants = () => (state.omniGrants ??= [])
  const consentsOf = botId => ((state.omniConsents ??= {})[botId] ??= [])
  // How each tool runs once allowed, without asking again: the tools register theirs.
  const executors = new Map()
  rt.omniExecutor = (name, run) => executors.set(name, run)

  const sameAsk = (entry, ask) => entry.status === 'pending' && entry.action === ask.action && entry.resource.id === ask.resource.id
    && JSON.stringify(entry.call) === JSON.stringify(ask.call)

  function addGrant(botId, wanted, action, wholeChannel = false) {
    const now = Date.now()
    const resource = wholeChannel ? { type: 'channel', id: wanted.channelId, name: wanted.channelName ?? wanted.name } : wanted
    const existing = grants().find(grant => grant.botId === botId && grant.resource.type === resource.type && grant.resource.id === resource.id
      && !(typeof grant.expiresAt === 'number' && grant.expiresAt <= now))
    if (existing) {
      if (!existing.actions.includes(action)) existing.actions = ACTIONS.filter(name => name === action || existing.actions.includes(name))
      return existing
    }
    const grant = {
      id: randomUUID(), botId,
      resource: { type: resource.type, id: resource.id, name: resource.name, ...(resource.channelId ? { channelId: resource.channelId } : {}) },
      actions: [action], approval: 'auto', grantedBy: 'user', createdAt: now,
    }
    grants().push(grant)
    return grant
  }

  /**
   * The check every Omni tool makes before it acts. Null: go ahead. Otherwise the text the
   * tool returns: a card is on screen (consent_required / confirmation_required) and the
   * turn ends, or a refusal. `force: 'confirm'` asks to run this one call whatever the grants.
   */
  rt.omniPermit = async (exec, { action, resource, call, preview = {}, force }) => {
    await rt.load()
    const sessionId = exec.agent?.id
    const botId = rt.selfOf(sessionId)
    if (rt.botOf(botId) === undefined) return 'Only Bots on the team use Omni.'
    const main = operatesOmni(rt, botId)
    // A run for an automation's event reads text other people wrote. A Bot's own chat is not
    // one, even when an automation once ran there.
    const eventRun = rt.chatOwners?.has(sessionId) !== true && (state.subscriptionRuns ?? []).some(run => run.sessionId === sessionId)
    const reads = action === 'read' || action === 'media'
    if (main && eventRun && !reads) {
      return 'This Session handles an automation event, so it only reads omni. Tell the user what you would change instead.'
    }
    let verdict = force ?? decide({ main, grants: grants(), botId, resource, action })
    // Any other Bot's run asks before anything that is not a read, grant or not.
    if (eventRun && !reads && verdict === 'allow') verdict = 'confirm'
    if (verdict === 'allow') return null
    const readOnly = rt.readOnly?.()
    if (readOnly !== undefined) return `Nothing can be asked now. ${readOnly}`
    const own = rt.chatOwners?.has(sessionId) === true
    const ask = { action, resource, call, preview }
    const list = consentsOf(botId)
    const now = Date.now()
    for (const entry of list) {
      if (sameAsk(entry, ask)) Object.assign(entry, { status: 'replaced', settledAt: now })
    }
    list.push({
      id: randomUUID(),
      ...(own && exec.callId ? { callId: exec.callId } : {}),
      sessionId, botId, kind: verdict === 'consent' ? 'grant' : 'confirm', ...ask, status: 'pending', askedAt: now,
    })
    list.splice(0, Math.max(0, list.length - KEPT))
    await rt.save()
    exec.concludeTurn?.()
    const what = askText(ask)
    const where = own ? 'on a card in this chat' : 'on a card in your own chat'
    return verdict === 'consent'
      ? `consent_required: you have no permission to ${what}. The user was asked ${where}. Your turn ends here; when the user answers, a note says so and, if allowed, carries the result. Do not call it again meanwhile.`
      : `confirmation_required: ${what} needs the user's confirmation, asked ${where}. Your turn ends here; if the user confirms, exactly this runs and its result comes back to you as a note.`
  }

  async function tell(botId, text) {
    if (rt.botOf(botId) === undefined) return
    await rt.deliver({ toId: botId, role: 'permission', text: text.length > TOLD_MAX ? `${text.slice(0, TOLD_MAX)}…` : text })
      .catch(error => rt.warn('ds-bot: permission note to %s failed: %s', botId, error))
  }

  function pending(id) {
    for (const [botId, list] of Object.entries(state.omniConsents ?? {})) {
      const entry = list.find(item => item.id === id)
      if (entry) {
        if (entry.status !== 'pending') throw invalid('That request was already answered')
        return { botId, entry }
      }
    }
    throw invalid('No such request')
  }

  async function answer(body = {}) {
    const choice = String(body.answer ?? '')
    if (!ANSWERS.has(choice)) throw invalid('Answer once, always or deny')
    const { botId, entry } = pending(String(body.id ?? ''))
    if (entry.kind === 'confirm' && (choice === 'always' || choice === 'channel')) throw invalid('This one asks every time')
    if (choice === 'channel' && !entry.resource?.channelId) throw invalid('This is not on a channel')
    const what = askText(entry)
    if (choice === 'deny') {
      Object.assign(entry, { status: 'denied', settledAt: Date.now() })
      await rt.save()
      await tell(botId, `The user said no: you may not ${what}. Do not ask again unless the user brings it up; carry on without it, or say what you cannot do.`)
      return entry
    }
    const run = executors.get(entry.call?.tool)
    if (run === undefined) throw invalid('This request can no longer run')
    // Running first, so a second click finds it answered.
    entry.status = 'running'
    if (choice === 'always' || choice === 'channel') addGrant(botId, entry.resource, entry.action, choice === 'channel')
    await rt.save()
    let result
    try {
      result = await run(entry.call.args ?? {})
    } catch (error) {
      result = JSON.stringify({ status: 0, error: error?.message ?? String(error) })
    }
    const status = { always: 'always', channel: 'channel' }[choice] ?? (entry.kind === 'confirm' ? 'confirmed' : 'once')
    Object.assign(entry, { status, settledAt: Date.now() })
    // It ran: the Bot hears so even when the card's state cannot be saved.
    await rt.save().catch(error => rt.warn('ds-bot: saving an answered Omni permission failed: %s', error))
    const how = entry.kind === 'confirm' ? 'The user confirmed'
      : choice === 'channel' ? `The user allowed, from now on on the whole channel${entry.resource.channelName ? ` "${entry.resource.channelName}"` : ''}, that you`
        : choice === 'always' ? 'The user allowed, from now on, that you' : 'The user allowed, this once, that you'
    await tell(botId, `${how} ${what}. It ran; the result: ${result}`)
    return entry
  }

  function grantOf(id) {
    const grant = grants().find(entry => entry.id === id)
    if (grant === undefined) throw invalid('No such permission')
    return grant
  }
  const endpoints = {
    'omni-consent-answer': answer,
    async 'omni-grant-revoke'(body = {}) {
      const grant = grantOf(String(body.id ?? ''))
      state.omniGrants = grants().filter(entry => entry !== grant)
      await rt.save()
      return { id: grant.id }
    },
    async 'omni-grant-approval'(body = {}) {
      const grant = grantOf(String(body.id ?? ''))
      if (body.approval !== 'auto' && body.approval !== 'confirm') throw invalid('approval is auto or confirm')
      grant.approval = body.approval
      await rt.save()
      return grant
    },
  }
  rt.grantEndpoint = async (name, body) => {
    await rt.load()
    return endpoints[name](body)
  }
  // A card answered just before DSH stopped may or may not have run: its Bot is told so, and
  // the card leaves the dock.
  async function recover() {
    await rt.load()
    // A window that only reads, beside the one that holds the team, sees that one's live cards.
    if (rt.readOnly?.() !== undefined) return
    const notes = []
    for (const [botId, list] of Object.entries(state.omniConsents ?? {})) {
      for (const entry of list) {
        if (entry.status !== 'running') continue
        Object.assign(entry, { status: 'interrupted', settledAt: Date.now() })
        notes.push([botId, `DeepSeek Harness restarted while it ran what the user allowed: ${askText(entry)}. It may or may not have happened; check before doing it again.`])
      }
    }
    if (notes.length === 0) return
    await rt.save()
    for (const [botId, text] of notes) await tell(botId, text)
  }
  ctx.effect(() => {
    void recover().catch(error => rt.warn('ds-bot: checking interrupted Omni permissions failed: %s', error))
  }, 'ds-bot: interrupted Omni permissions')
  for (const name of Object.keys(endpoints)) ctx.effect(() => rt.hooks.endpoint(name, body => rt.grantEndpoint(name, body)), `ds-bot: ${name}`)
  ctx.effect(() => rt.hooks.view(() => ({ omniGrants: state.omniGrants ?? [], omniConsents: state.omniConsents ?? {} })), 'ds-bot: Omni permissions view')

  // A Bot that operates the Omni named here hands work off with its own tool, never the team's
  // start_task: denied before any card asks for it (DSH's gates run before its guards), and
  // refused by the guard whatever a gate said.
  const refusesStartTask = exec => exec.name === 'start_task' && operatesHere(rt, exec.agent?.id ?? exec.agent?.session?.id)
  ctx.on('tools/pre-execute', (exec, next) => (refusesStartTask(exec) ? { kind: 'deny', reason: START_TASK_REFUSAL } : next()), { prepend: true })
  ctx.tools.guard(exec => (refusesStartTask(exec) ? START_TASK_REFUSAL : undefined))
}
