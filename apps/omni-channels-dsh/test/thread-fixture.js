// The chat threads' test bench (wish omni-chat-threads, Groups 7 and 9): the real Bot team
// (the release apps/automagik.json pins) runs under this plugin on a fake DSH, whose Sessions
// are stand-ins, and a fake Omni answers the chat, message, media and chat-key routes. Sends
// reach only this fake Omni.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntime as createTeam } from '@automagik/bots-dsh'
import { createRuntime } from '../index.js'
import { LINK_FILE } from '../src/host/omni-link.js'
import { KEYS_FILE } from '../src/host/thread-keys.js'
import { fakeContext } from './team.js'

const realFetch = globalThis.fetch
// Each test file puts the real fetch back after each test (afterEach(resetFetch)).
export const resetFetch = () => { globalThis.fetch = realFetch }

export const flush = async () => {
  for (let round = 0; round < 20; round += 1) await new Promise(resolve => setImmediate(resolve))
}

export const OMNI = 'https://omni.example.com'
export const INSTANCE = '0b5f1c1e-6a51-4d5e-9a41-0c0d9b6f1a01'
export const OTHER_INSTANCE = '3e8b4f40-9d84-4a8b-8d74-3f3a2e9b4d04'
export const CHAT = '1c6f2d2e-7b62-4e6f-8b52-1d1e0c7f2b02'
export const GROUP = '2d7a3e3f-8c73-4f7a-9c63-2e2f1d8a3c03'
export const ELSEWHERE = '4f9c5a51-ae95-4b9c-9e85-4a4b3fac5e05'
export const OWNER = '5511999990000'
export const CHATS = {
  [CHAT]: { id: CHAT, instanceId: INSTANCE, externalId: '5511988887777@s.whatsapp.net', chatType: 'dm', name: 'Marina' },
  [GROUP]: { id: GROUP, instanceId: INSTANCE, externalId: '120363000000000000@g.us', chatType: 'group', name: 'Obra' },
  [ELSEWHERE]: { id: ELSEWHERE, instanceId: OTHER_INSTANCE, externalId: '5511977776666@s.whatsapp.net', chatType: 'dm', name: 'Other line' },
}
// The smallest PNG there is (1×1), the bytes a picture message serves.
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
// Messages Omni holds, by id: a picture and a text in CHAT, a voice note, a picture whose
// description failed, and a picture in another chat.
export const MESSAGE_IDS = {
  picture: '6a1b2c3d-1111-4a5b-8c6d-7e8f9a0b1c01',
  text: '6a1b2c3d-2222-4a5b-8c6d-7e8f9a0b1c02',
  voice: '6a1b2c3d-3333-4a5b-8c6d-7e8f9a0b1c03',
  failed: '6a1b2c3d-4444-4a5b-8c6d-7e8f9a0b1c04',
  elsewhere: '6a1b2c3d-5555-4a5b-8c6d-7e8f9a0b1c05',
}
export const MESSAGES = {
  [MESSAGE_IDS.picture]: { id: MESSAGE_IDS.picture, chatId: CHAT, isFromMe: false, senderDisplayName: 'Marina', messageType: 'image', hasMedia: true, mediaMimeType: 'image/png', textContent: 'a obra hoje', imageDescription: 'A brick wall half built, with a cement mixer beside it.', platformTimestamp: '2026-10-27T10:00:00.000Z', mediaPath: 'pic.png' },
  [MESSAGE_IDS.text]: { id: MESSAGE_IDS.text, chatId: CHAT, isFromMe: true, source: 'phone', messageType: 'text', hasMedia: false, textContent: 'Ficou ótimo!', platformTimestamp: '2026-10-27T10:01:00.000Z' },
  [MESSAGE_IDS.voice]: { id: MESSAGE_IDS.voice, chatId: CHAT, isFromMe: false, senderDisplayName: 'Marina', messageType: 'audio', hasMedia: true, mediaMimeType: 'audio/ogg', transcription: 'Amanhã chega o cimento.', platformTimestamp: '2026-10-27T10:02:00.000Z', mediaPath: 'voice.ogg' },
  [MESSAGE_IDS.failed]: { id: MESSAGE_IDS.failed, chatId: CHAT, isFromMe: false, senderDisplayName: 'Marina', messageType: 'image', hasMedia: true, mediaMimeType: 'image/png', imageDescription: '[error: vision provider failed]', platformTimestamp: '2026-10-27T10:03:00.000Z', mediaPath: 'failed.png' },
  [MESSAGE_IDS.elsewhere]: { id: MESSAGE_IDS.elsewhere, chatId: ELSEWHERE, isFromMe: false, messageType: 'image', hasMedia: true, mediaMimeType: 'image/png', imageDescription: 'Someone else\'s picture.', platformTimestamp: '2026-10-27T10:04:00.000Z', mediaPath: 'elsewhere.png' },
}

// Omni with one link key and the chat keys it mints, held in memory; a revoked or unknown key
// gets 401 everywhere, as the auth middleware does. A chat key is held as Omni's lock holds a
// `cs` child: its chat (UUID or JID), its instance, its recipient (the JID, compared with the
// raw `to`), and its two scopes (messages:send, chats:read). `mint` makes POST
// /keys/children answer otherwise: 'missing' (an Omni without the route), 'refused', 'down'.
// `sent`: every send and reaction that went through, with the key that made it.
export function fakeOmni() {
  const keys = new Map()
  const asked = []
  const sent = []
  const omni = { asked, keys, sent, mint: null, files: { 'pic.png': PNG, 'failed.png': PNG, 'elsewhere.png': PNG, 'voice.ogg': Buffer.from('OggS') } }
  const link = { id: randomUUID(), text: `omni_sk_link_${randomUUID().slice(0, 8)}`, kind: 'link', revoked: false }
  keys.set(link.text, link)
  omni.link = link
  omni.children = () => [...keys.values()].filter(key => key.kind === 'child')
  omni.askedWith = []
  globalThis.fetch = async (address, init = {}) => {
    const url = new URL(String(address))
    const method = init.method ?? 'GET'
    const path = url.pathname.replace(/^\/api\/v2/, '')
    const caller = keys.get(init.headers?.['x-api-key'])
    asked.push(`${method} ${path}`)
    omni.askedWith.push({ route: `${method} ${path}`, query: url.search, key: init.headers?.['x-api-key'] })
    const json = (status, body) => new Response(JSON.stringify(body), { status })
    const locked = () => json(403, { error: { code: 'FORBIDDEN', message: 'chat lock' } })
    if (path === '/keys/children' && omni.mint === 'down') throw new TypeError('fetch failed')
    if (!caller || caller.revoked) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } })
    const child = caller.kind === 'child'
    if (method === 'GET' && path === '/chats') {
      if (child) return locked()
      const instanceId = url.searchParams.get('instanceId')
      return json(200, { items: Object.values(CHATS).filter(chat => chat.instanceId === instanceId) })
    }
    const history = path.match(/^\/chats\/([^/]+)\/messages$/)?.[1]
    if (method === 'GET' && history !== undefined) {
      if (child && !caller.chatNames.includes(history)) return locked()
      // Omni's `before` takes that time itself too (services/messages.ts, lte).
      const before = url.searchParams.get('before')
      const items = Object.values(MESSAGES).filter(message => message.chatId === history && (before === null || message.platformTimestamp <= before))
        .sort((a, b) => b.platformTimestamp.localeCompare(a.platformTimestamp)).slice(0, Number(url.searchParams.get('limit') ?? 100))
      return json(200, { items })
    }
    const chatId = path.match(/^\/chats\/([^/]+)$/)?.[1]
    if (method === 'GET' && chatId !== undefined) {
      if (child && caller.chatId !== chatId) return locked()
      return CHATS[chatId] ? json(200, { data: CHATS[chatId] }) : json(404, { error: { code: 'NOT_FOUND', message: 'Chat not found' } })
    }
    if (method === 'POST' && (path === '/messages/send' || path === '/messages/send/reaction')) {
      const body = JSON.parse(init.body)
      if (child && (!caller.chatNames.includes(body.to) || body.to !== caller.recipient || body.instanceId !== caller.instanceId)) return locked()
      sent.push({ path, body, key: caller.text })
      return json(path === '/messages/send' ? 201 : 200, path === '/messages/send' ? { data: { messageId: randomUUID(), status: 'sent' } } : { success: true, data: { messageId: randomUUID() } })
    }
    const messageId = path.match(/^\/messages\/([^/]+)$/)?.[1]
    if (method === 'GET' && messageId !== undefined) {
      // A chat key holds no messages:read.
      if (child) return json(403, { error: { code: 'FORBIDDEN', message: 'Missing scope messages:read' } })
      return MESSAGES[messageId] ? json(200, { data: MESSAGES[messageId] }) : json(404, { error: { code: 'NOT_FOUND', message: 'Message not found' } })
    }
    if (method === 'POST' && path === '/messages/media/download') {
      if (child) return locked()
      const message = MESSAGES[JSON.parse(init.body).messageId]
      return message?.hasMedia ? json(200, { data: { mediaLocalPath: message.mediaPath, mediaMimeType: message.mediaMimeType } }) : json(404, { error: { message: 'No media' } })
    }
    const file = path.match(/^\/media\/(.+)$/)?.[1]
    if (method === 'GET' && file !== undefined) {
      if (child) return locked()
      const bytes = omni.files[file]
      return bytes ? new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } }) : json(404, {})
    }
    if (method === 'POST' && path === '/keys/children') {
      if (omni.mint === 'missing') return json(404, {})
      if (omni.mint === 'refused') return json(403, { error: { code: 'FORBIDDEN', message: 'this key cannot mint chat keys' } })
      const chat = CHATS[JSON.parse(init.body).chatId]
      const made = {
        id: randomUUID(), text: `omni_sk_child_${randomUUID().slice(0, 8)}`, kind: 'child', revoked: false, chatId: chat.id,
        chatNames: [chat.id, chat.externalId], instanceId: chat.instanceId, recipient: chat.externalId,
      }
      keys.set(made.text, made)
      return json(201, { data: { id: made.id, plainTextKey: made.text, parentKeyId: link.id, chatId: chat.id, chatExternalId: chat.externalId, instanceId: chat.instanceId, scopes: ['messages:send', 'chats:read'], expiresAt: null } })
    }
    if (method === 'GET' && path === `/instances/${INSTANCE}`) return json(200, { data: { id: INSTANCE, name: 'Pessoal', ownerIdentifier: `${OWNER}:12@s.whatsapp.net` } })
    const revoke = path.match(/^\/keys\/children\/([^/]+)\/revoke$/)?.[1]
    if (method === 'POST' && revoke === 'self') {
      caller.revoked = true
      return json(200, { data: { id: caller.id, status: 'revoked' } })
    }
    if (method === 'POST' && revoke !== undefined) {
      const found = omni.children().find(key => key.id === revoke)
      if (!found) return json(404, { error: { code: 'NOT_FOUND', message: 'API key not found' } })
      const status = found.revoked ? 'already_revoked' : 'revoked'
      found.revoked = true
      return json(200, { data: { id: found.id, status } })
    }
    if (method === 'POST' && path === '/auth/validate') return json(child ? 403 : 200, child ? { error: { message: 'Missing scope auth:validate' } } : { data: { scopes: ['*'] } })
    return json(404, { error: { code: 'NOT_FOUND', message: 'Not Found' } })
  }
  return omni
}

// The Omni Bot (the team's first Main Bot) on model deepseek/flash; deepseek also serves pro.
export const teamState = (extra = {}) => ({
  version: 1, mainBotIds: ['m1'], revision: 1,
  bots: { m1: { id: 'm1', name: 'Omni', role: 'Orchestrator', instructions: '', createdAt: 1, model: 'deepseek/flash' } },
  rooms: {}, agents: {}, exchanges: [], exchangeTurns: {},
  ...extra,
})
export const record = (id, sessionId, extra = {}) => ({
  id, sessionId, chatId: CHAT, chatJid: CHATS[CHAT].externalId, chatName: 'Marina', channelId: INSTANCE, origin: OMNI,
  self: null, title: 'Marina', status: 'idle', turnOpenAt: null, at: 1, ...extra,
})

// One DSH start: the real Bot team and this plugin on a fake DSH over `home`. Sessions are
// stand-ins whose log ends where `cut` puts it; selectModel writes model/selection into the
// Session, as DSH's session controller does. Each stand-in agent has a scoped tool list whose
// restrictions are recorded (`restricts`), and runs on deepseek/flash. `mask` hides the restart
// hook, as a Bot team before it has none. `fake.createError` makes the next Session fail to
// be made. `services`: DSH services the plugin reads with ctx.get (llm, attachments).
export async function boot(t, home, { mask = false, services = {} } = {}) {
  const ctx = fakeContext({ services })
  const agents = new Map()
  const made = []
  const resolved = []
  const selected = []
  const archived = []
  const archiving = []
  const restricts = []
  const fake = { archiveError: null, createError: null, restrictError: null }
  const emit = (id, type, data, time) => {
    for (const listener of ctx.listeners.get('session/event') ?? []) if (listener.length >= 2) listener({ id }, { type, data, ...(time === undefined ? {} : { time }) })
  }
  // A new live agent for a Session, as DSH makes one on a resume, a clear or a compaction.
  const freshAgent = (sessionId) => {
    const calls = []
    const keep = (message) => { calls.push(message) }
    const agent = {
      id: sessionId,
      session: { id: sessionId, seq: 0, eventAt: () => undefined },
      options: { provider: 'deepseek', model: 'flash' },
      status: 'idle', calls, inbox: { nextStep: [], nextTurn: [], remove: () => false }, followup: keep, steer: keep, cancel() {},
    }
    // Its own scope: effects it owns, and its tool restrictions.
    agent.ctx = {
      effect: () => {},
      tools: { restrict: (filter) => {
        if (fake.restrictError) throw fake.restrictError
        restricts.push({ agent, sessionId, filter })
        return () => {}
      } },
    }
    agents.set(sessionId, agent)
    return agent
  }
  const agentOf = sessionId => agents.get(sessionId) ?? freshAgent(sessionId)
  // A Session whose last turn a restart cut a second ago.
  const cut = (sessionId) => {
    const events = [{ type: 'turn/start', time: Date.now() - 60_000 }, { type: 'turn/end', time: Date.now() - 1000, data: { reason: { kind: 'interrupted' } } }]
    Object.assign(agentOf(sessionId).session, { seq: events.length, eventAt: seq => events[seq] })
  }
  const workspaces = new Map()
  Object.assign(ctx, {
    llm: { listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }], listModels: async () => [{ id: 'flash' }, { id: 'pro' }], resolveModelInfo: async () => ({}) },
    workspaceRegistry: {
      get: id => workspaces.get(id),
      resolveByPath: async path => [...workspaces.values()].find(workspace => workspace.path === path),
      create: async (path) => {
        const workspace = { id: `w${workspaces.size + 1}`, path }
        workspaces.set(workspace.id, workspace)
        return workspace
      },
      archiveSession: async (sessionId, options) => {
        archiving.push([sessionId, options])
        if (fake.archiveError) throw fake.archiveError
        if (!archived.includes(sessionId)) archived.push(sessionId)
      },
      get archivedSessionIds() { return [...archived] },
    },
    sessionController: {
      create: async () => {
        if (fake.createError) throw fake.createError
        const sessionId = `session-${randomUUID().slice(0, 8)}`
        made.push(sessionId)
        return { sessionId }
      },
      resolveAgent: async (sessionId) => {
        resolved.push(sessionId)
        return { agent: agentOf(sessionId) }
      },
      selectModel: async ({ sessionId, provider, model, reasoningEffort }) => {
        const selection = { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }
        selected.push([sessionId, `${provider}/${model}`])
        emit(sessionId, 'model/selection', selection)
        return { selected: selection }
      },
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  const team = createTeam(ctx, { home })
  const registered = []
  const register = team.resumable.register
  team.resumable.register = (entry) => {
    registered.push(entry)
    return register(entry)
  }
  const base = mask ? Object.create(team, { resumable: { value: undefined }, resumesDone: { value: undefined } }) : team
  const channels = createRuntime(ctx, base)
  await channels.load()
  const call = (endpoint, body) => team.extended.endpointOf(endpoint).fn(body)
  const view = () => team.extended.view()
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    await ctx.dispose()
  }
  // Stopped before its home goes (homeFor).
  if (stopsOf.has(home)) stopsOf.get(home).push(stop)
  else t.after(stop)
  return { ctx, team, channels, call, view, emit, cut, agentOf, freshAgent, made, resolved, selected, archived, archiving, restricts, registered, fake, stop }
}

// A fresh home linked to `omni`, with the team in it; removed once every start on it stopped.
const stopsOf = new Map()
export function homeFor(t, omni, state = teamState()) {
  const home = mkdtempSync(join(tmpdir(), 'omni-threads-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(state))
  if (omni) writeFileSync(join(home, LINK_FILE), JSON.stringify({ url: OMNI, key: omni.link.text, keyId: omni.link.id, scopes: ['*'], pairedAt: '2026-10-27T00:00:00.000Z' }))
  stopsOf.set(home, [])
  t.after(async () => {
    for (const stop of stopsOf.get(home)) await stop()
    stopsOf.delete(home)
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })
  return home
}
// What this test asked Omni, leaving out the event stream the link starts (omni-events.js).
export const askedOf = omni => omni.asked.filter(call => !call.includes(' /events/'))
export const saved = home => JSON.parse(readFileSync(join(home, 'state.json'), 'utf8'))
export const keysOf = home => (existsSync(join(home, KEYS_FILE)) ? JSON.parse(readFileSync(join(home, KEYS_FILE), 'utf8')) : null)
// A guard's answer for one tool call in one Session: the first refusal, else undefined.
export const guarded = (ctx, sessionId, name) => ctx.guards.map(guard => guard({ name, agent: { id: sessionId } })).find(answer => answer !== undefined)
