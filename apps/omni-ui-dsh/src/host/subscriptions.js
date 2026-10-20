// Subscriptions: which chats, groups or whole channels Tentacall watches, for which moment,
// and who acts on it. Tentacall changes them with its own tools while the user talks to it,
// and the board beside its chat shows them as they change (they ride the team view, so a
// save is on screen at the next poll). Sources are checked against the live omni channels
// and chats, so a subscription never names a chat that does not exist.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { output } from './tools.js'

export const TRIGGER_KINDS = ['reaction', 'message', 'mention', 'keyword', 'voice', 'media', 'down']
const RUNS_KEPT = 40
const LIST_LIMIT = 40

const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })
const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })
const split = text => String(text ?? '').split(',').map(part => part.trim()).filter(Boolean)
const yes = value => value === true || value === 'true' || value === 'yes'

// One line a person can read: "when you react 📌 in Grupo Obras → Ops".
export function sentenceOf(sub, nameOfWorker) {
  const trigger = sub.trigger.kind === 'reaction' ? `you react ${sub.trigger.emoji}`
    : sub.trigger.kind === 'keyword' ? `a message says ${sub.trigger.words.map(word => `"${word}"`).join(' or ')}`
      : { message: 'any new message', mention: 'someone mentions you', voice: 'a voice note arrives', media: 'a photo or file arrives', down: 'the channel disconnects' }[sub.trigger.kind]
  const where = sub.sources.map(source => (source.kind === 'channel' ? `all of ${source.name}` : source.name)).join(', ')
  const then = [sub.outputs.react ? 'reacts 👀 then ✅' : '', sub.outputs.replyToMe ? 'replies to you' : ''].filter(Boolean)
  return `when ${trigger} in ${where} → ${nameOfWorker(sub.worker)}${then.length ? ` (${then.join(', ')})` : ''}${sub.on ? '' : ' [paused]'}`
}

export function install(rt) {
  const { ctx, state } = rt
  const subs = () => (state.subscriptions ??= {})
  const runs = () => (state.subscriptionRuns ??= [])
  // Loads the team first: the check reads which Bot is Tentacall from the saved state.
  const isEventsBot = async (exec) => {
    await rt.load()
    return state.eventsBotId !== undefined && rt.selfOf(exec.agent?.id) === state.eventsBotId
  }
  const NOT_TENTACALL = 'Only Tentacall manages subscriptions. Ask Tentacall in its chat.'

  const nameOfWorker = (worker) => {
    if (worker.kind === 'events') return rt.botOf(state.eventsBotId)?.name ?? 'Tentacall'
    if (worker.kind === 'main') return rt.botOf(state.mainBotIds[0])?.name ?? 'the Main Bot'
    if (worker.kind === 'session') return worker.mode === 'ongoing' ? 'one ongoing DSH session' : 'a new DSH session each time'
    return rt.botOf(worker.botId)?.name ?? 'a deleted Bot'
  }

  // What can be watched right now: the live omni channels and their recent chats.
  async function watchable() {
    const overview = await rt.omniEndpoint('omni-overview', {})
    if (!overview.configured) throw refused(`Omni is not connected here (missing ${overview.missing.join(' and ')}), so there is nothing to watch yet.`)
    const channels = new Map(overview.channels.map(channel => [channel.id, channel]))
    return { channels, chats: overview.chats }
  }

  function sourceOf(ref, { channels, chats }) {
    const [kind, id] = ref.includes(':') ? ref.split(/:(.*)/s) : ['', ref]
    const channel = channels.get(id)
    if ((kind === 'channel' || kind === '') && channel) return { kind: 'channel', id, name: channel.name, type: channel.type }
    const chat = chats.find(item => item.id === id)
    if ((kind === 'chat' || kind === '') && chat) {
      return { kind: 'chat', id, name: chat.name, type: channels.get(chat.channelId)?.type ?? 'unknown', chatKind: chat.kind, channelId: chat.channelId }
    }
    throw invalid(`No channel or chat "${ref}". Use the ids list_watchable gives.`)
  }

  function workerOf(text) {
    const value = String(text ?? '').trim()
    const lower = value.toLowerCase()
    if (value === '' || lower === 'tentacall' || lower === 'me' || lower === 'you') return { kind: 'events' }
    if (lower === 'session' || lower === 'new session') return { kind: 'session', mode: 'new' }
    if (lower === 'ongoing session') return { kind: 'session', mode: 'ongoing' }
    const bot = Object.values(state.bots).find(item => item.name.toLowerCase() === lower)
    if (!bot) throw invalid(`No Bot named "${value}". Use a name from list_bots, "Tentacall", "new session" or "ongoing session".`)
    if (bot.id === state.eventsBotId) return { kind: 'events' }
    return state.mainBotIds.includes(bot.id) ? { kind: 'main' } : { kind: 'bot', botId: bot.id }
  }

  function triggerOf(args) {
    const kind = String(args.trigger ?? '')
    if (!TRIGGER_KINDS.includes(kind)) throw invalid(`trigger must be one of ${TRIGGER_KINDS.join(', ')}`)
    if (kind === 'reaction') {
      const emoji = String(args.emoji ?? '').trim()
      if (!emoji || /[\p{L}\p{N}]/u.test(emoji) || [...emoji].length > 4) throw invalid('A reaction trigger needs the one emoji the user will react with. Ask which one.')
      return { kind, emoji }
    }
    if (kind === 'keyword') {
      const words = split(args.words).slice(0, 10)
      if (words.length === 0) throw invalid('A keyword trigger needs the words to look for. Ask the user.')
      return { kind, words }
    }
    return { kind }
  }

  // `lookup` is one fresh read of omni (watchable()), made only when the sources change.
  async function save(args, lookup) {
    const existing = args.id ? subs()[args.id] : undefined
    if (args.id && !existing) throw invalid(`No subscription ${args.id}. Use list_subscriptions.`)
    const refs = split(args.sources)
    const sources = refs.length > 0 ? refs.map(ref => sourceOf(ref, lookup)) : existing?.sources ?? []
    if (sources.length === 0) throw invalid('Which chats, groups or channels? Ask the user, then pass their ids from list_watchable.')
    const sub = {
      id: existing?.id ?? `sub-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: String(args.name ?? existing?.name ?? '').trim().slice(0, 60),
      on: existing?.on ?? true,
      sources,
      trigger: args.trigger === undefined && existing ? existing.trigger : triggerOf(args),
      worker: args.worker === undefined && existing ? existing.worker : workerOf(args.worker),
      outputs: {
        react: args.react === undefined ? existing?.outputs.react ?? true : yes(args.react),
        replyToMe: args.reply_to_me === undefined ? existing?.outputs.replyToMe ?? false : yes(args.reply_to_me),
      },
      // Event text comes from other people; asking first is on unless the user turns it off.
      askFirst: args.ask_first === undefined ? existing?.askFirst ?? true : yes(args.ask_first),
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }
    if (!sub.name) sub.name = sentenceOf(sub, nameOfWorker).replace(/^when /, '').slice(0, 60)
    subs()[sub.id] = sub
    await rt.save()
    return sub
  }
  const setOn = async (id, on) => {
    const sub = subs()[id]
    if (!sub) throw invalid(`No subscription ${id}`)
    sub.on = on
    sub.updatedAt = Date.now()
    await rt.save()
    return sub
  }
  const remove = async (id) => {
    if (!subs()[id]) throw invalid(`No subscription ${id}`)
    delete subs()[id]
    state.subscriptionRuns = runs().filter(run => run.subId !== id)
    await rt.save()
  }
  // A test is a run on the newest message that could match; it shows the path end to end
  // on the board before omni's events are wired to this host.
  const test = async (id) => {
    const sub = subs()[id]
    if (!sub) throw invalid(`No subscription ${id}`)
    const run = { id: `run-${Date.now().toString(36)}`, subId: id, at: Date.now(), status: 'done', test: true, from: sub.sources[0]?.name ?? '', excerpt: 'Test run', summary: `${nameOfWorker(sub.worker)} would get the event with the message, its sender and the chat around it.` }
    state.subscriptionRuns = [run, ...runs()].slice(0, RUNS_KEPT)
    await rt.save()
    return run
  }

  rt.eventsBotId = () => (state.eventsBotId && state.bots[state.eventsBotId] ? state.eventsBotId : undefined)
  rt.subscriptionsView = () => ({
    subscriptions: Object.values(subs()).sort((a, b) => a.createdAt - b.createdAt),
    subscriptionRuns: runs(),
  })
  rt.subscriptionEndpoint = async (endpoint, body) => {
    const id = String(body?.id ?? '')
    if (endpoint === 'subscription-set-on') return setOn(id, body?.on === true)
    if (endpoint === 'subscription-delete') { await remove(id); return { id } }
    if (endpoint === 'subscription-test') return test(id)
    throw invalid(`Unknown subscriptions endpoint ${endpoint}`)
  }

  ctx.tools.register(defineTool({
    name: 'list_watchable',
    description: 'Tentacall only. The omni channels and their recent chats and groups that a subscription can watch, with the ids save_subscription takes.',
    parameters: { search: { type: 'string', description: 'Part of a chat, group or channel name' } },
    output,
    async execute(args, exec) {
      if (!await isEventsBot(exec)) return NOT_TENTACALL
      try {
        const { channels, chats } = await watchable()
        const needle = String(args.search ?? '').trim().toLowerCase()
        const found = chats.filter(chat => !needle || chat.name.toLowerCase().includes(needle)).slice(0, LIST_LIMIT)
        const lines = [...channels.values()].filter(channel => !needle || channel.name.toLowerCase().includes(needle))
          .map(channel => `channel:${channel.id} · ${channel.type} · ${channel.name} · ${channel.status}`)
        for (const chat of found) lines.push(`chat:${chat.id} · ${chat.kind} · ${chat.name} · on ${channels.get(chat.channelId)?.name ?? '?'}`)
        return lines.length > 0 ? lines.join('\n') : `Nothing matches "${args.search}". Ask the user for another name.`
      } catch (error) {
        return error.message
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'list_subscriptions',
    description: 'Tentacall only. The subscriptions you run, with their ids.',
    parameters: {},
    output,
    async execute(_args, exec) {
      if (!await isEventsBot(exec)) return NOT_TENTACALL
      await rt.load()
      const list = Object.values(subs())
      return list.length === 0 ? 'No subscriptions yet.' : list.map(sub => `${sub.id} · ${sub.name}: ${sentenceOf(sub, nameOfWorker)}`).join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'save_subscription',
    description: 'Tentacall only. Create a subscription, or change one by id. It shows on the board beside your chat at once. Ask the user for anything you do not know (which chats, which emoji, which words, who acts) instead of guessing.',
    parameters: {
      id: { type: 'string', description: 'Only to change an existing subscription' },
      name: { type: 'string', description: 'Short name the user would recognize' },
      sources: { type: 'string', description: 'Comma-separated ids from list_watchable, e.g. "chat:…, channel:…"' },
      trigger: { type: 'string', enum: TRIGGER_KINDS, description: 'reaction: the user reacts with an emoji. keyword: a message contains words. message, mention, voice, media (photo or file), down (channel disconnects)' },
      emoji: { type: 'string', description: 'For reaction: the one emoji' },
      words: { type: 'string', description: 'For keyword: comma-separated words' },
      worker: { type: 'string', description: 'Who acts: "Tentacall" (you; the default), a Bot name, "new session" or "ongoing session"' },
      react: { type: 'boolean', description: 'React 👀 when work starts and ✅ when done, on the message. Default true' },
      reply_to_me: { type: 'boolean', description: 'Also reply to the user in their own chat. Default false' },
      ask_first: { type: 'boolean', description: 'Ask the user before shell, file or network actions. Default true; only turn off when the user says so' },
    },
    output,
    async execute(args, exec) {
      if (!await isEventsBot(exec)) return NOT_TENTACALL
      try {
        await rt.load()
        const lookup = split(args.sources).length > 0 ? await watchable() : null
        const sub = await save(args, lookup)
        return `Saved ${sub.id} · ${sub.name}: ${sentenceOf(sub, nameOfWorker)}. It is on the board now.`
      } catch (error) {
        return `Not saved: ${error.message}`
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'pause_subscription',
    description: 'Tentacall only. Pause or resume a subscription by id.',
    parameters: {
      id: { type: 'string', required: true, description: 'Subscription id' },
      on: { type: 'boolean', required: true, description: 'true to resume, false to pause' },
    },
    output,
    async execute(args, exec) {
      if (!await isEventsBot(exec)) return NOT_TENTACALL
      try {
        await rt.load()
        const sub = await setOn(String(args.id), yes(args.on))
        return `${sub.name} is ${sub.on ? 'on' : 'paused'}.`
      } catch (error) {
        return error.message
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'delete_subscription',
    description: 'Tentacall only. Delete a subscription by id. Only when the user asks for it.',
    parameters: { id: { type: 'string', required: true, description: 'Subscription id' } },
    output,
    async execute(args, exec) {
      if (!await isEventsBot(exec)) return NOT_TENTACALL
      try {
        await rt.load()
        const name = subs()[String(args.id)]?.name
        await remove(String(args.id))
        return `Deleted ${name}.`
      } catch (error) {
        return error.message
      }
    },
  }))
}
