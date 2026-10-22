// What each Bot may do on Omni. A Main Bot operates all of it; any other Bot starts with
// nothing and is granted, per chat, group or whole channel, the actions it asks for: read
// messages, open media, send, react, delete. Nothing is set up front. The first time a Bot
// needs something, its tool call puts a card in front of the user, in the Bot's own chat:
// "Digest wants to read 🦞BuildWithFriends · Once · Always · No". The turn ends there (like
// ask_user), and the answer comes back to the Bot as a note. Once and Always run the exact
// call the card showed; Always also keeps a grant, which the Bot's settings list and revoke.
//
// Some acts ask every time, grant or not, Main Bot included: sending as the user to a person,
// deleting, disconnecting a channel. Their card shows the destination and the exact text, and
// confirming runs that call, nothing else.
import { randomUUID } from 'node:crypto'

export const ACTIONS = ['read', 'media', 'send', 'react', 'delete']
const ANSWERS = new Set(['once', 'always', 'deny'])
const KEPT = 20
const TOLD_MAX = 6000

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })

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

// What the Bot asked for, in words for the Bot.
export function askText({ action, resource, preview = {} }) {
  const where = `"${resource.name}"`
  if (action === 'read') return `read the messages of ${where}`
  if (action === 'media') return `open a media file in ${where}`
  if (action === 'send') return `send ${JSON.stringify(preview.text ?? '')} to ${where}`
  if (action === 'react') return `react ${preview.emoji ?? ''} to a message in ${where}`
  if (action === 'delete') return `delete a message in ${where}${preview.text ? ` (${JSON.stringify(preview.text)})` : ''}`
  return `${preview.method ?? ''} ${preview.path ?? resource.name}${preview.text ? ` with ${JSON.stringify(preview.text)}` : ''}${preview.to ? ` to ${preview.to}` : ''}`.trim()
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

  function addGrant(botId, resource, action) {
    const now = Date.now()
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
    const main = rt.isMain(botId)
    const eventRun = (state.subscriptionRuns ?? []).some(run => run.sessionId === sessionId)
    if (main && eventRun && action !== 'read' && action !== 'media') {
      return 'This Session handles an automation event, so it only reads omni. Tell the user what you would change instead.'
    }
    const verdict = force ?? decide({ main, grants: grants(), botId, resource, action })
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
    if (entry.kind === 'confirm' && choice === 'always') throw invalid('This one asks every time')
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
    if (choice === 'always') addGrant(botId, entry.resource, entry.action)
    await rt.save()
    let result
    try {
      result = await run(entry.call.args ?? {})
    } catch (error) {
      result = JSON.stringify({ status: 0, error: error?.message ?? String(error) })
    }
    Object.assign(entry, { status: choice === 'always' ? 'always' : entry.kind === 'confirm' ? 'confirmed' : 'once', settledAt: Date.now() })
    await rt.save()
    const how = entry.kind === 'confirm' ? 'The user confirmed' : choice === 'always' ? 'The user allowed, from now on, that you' : 'The user allowed, this once, that you'
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
  for (const name of Object.keys(endpoints)) ctx.effect(() => rt.hooks.endpoint(name, body => rt.grantEndpoint(name, body)), `ds-bot: ${name}`)
  ctx.effect(() => rt.hooks.view(() => ({ omniGrants: state.omniGrants ?? [], omniConsents: state.omniConsents ?? {} })), 'ds-bot: Omni permissions view')
}
