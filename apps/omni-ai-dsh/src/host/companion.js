// The person's own companion: the character they create in onboarding, which becomes their
// Main Bot (the orchestrator). Two ways to make one: describe it and have an image model draw
// it, when ChatGPT (DSH's openai-codex sign-in) or an OpenAI API key is connected; or pick
// one of Omni's characters. The look and name are applied to the Main Bot through
// @automagik/omni-dsh's `omniTeam` service when that plugin is present. The team step then
// adds the Omni Bot, which keeps the person's channels.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CompanionPayload, GeneratePayload, TeamPayload, parse } from './payloads.js'

// Where DSH keeps each sign-in (dsh-llm-pi-ai's recordKeyFor): a ChatGPT grant, or a key.
export const CODEX_RECORD = 'llm-pi-ai/openai-codex'
export const OPENAI_RECORD = 'llm-pi-ai/openai'
export const OPENAI_ENV = 'OPENAI_API_KEY'
// ChatGPT plans generate images through the Codex backend (the same request the Codex CLI makes).
export const CODEX_IMAGES = 'https://chatgpt.com/backend-api/codex/images/generations'
export const CODEX_IMAGE_MODEL = 'gpt-image-2'
export const OPENAI_IMAGES = 'https://api.openai.com/v1/images/generations'
export const OPENAI_IMAGE_MODEL = 'gpt-image-1'
const JWT_CLAIM = 'https://api.openai.com/auth'
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const ENTRY = 'omni-ai'

// The Main Bot's role once it is the person's companion: it leads the team.
export const COMPANION_ROLE = 'Your companion'

// The Omni Bot the team step adds: the octopus Omni always wore, keeping the person's channels.
// Its project is a folder of the team workspace (Bots may not work in the Omni home).
export const OMNI_PROJECT = 'omni'
export const OMNI_BOT = Object.freeze({
  name: 'Omni',
  kind: 'omni',
  role: 'Channel keeper',
  color: 'deepseek',
  avatar: Object.freeze({ shape: 'octopus' }),
  instructions: 'You keep the user\'s Omni: its channels and the chats on them. Read them, answer and act there as far as the user allows, and tell the Main Bot what needs a decision.',
})
// The Omni Bot's name when the companion already took "Omni".
export const OMNI_BOT_FALLBACK = 'Omni Channels'

// The plugin's own settings entry (DSH's settings.describe rows carry `ns` and `value`).
const ownEntry = (ctx) => {
  try {
    return (ctx.settings.describe?.() ?? []).find(row => row.ns === ENTRY)?.value ?? {}
  } catch {
    return {}
  }
}

// The style every companion is drawn in, so a description becomes one of the family.
export function companionPrompt(description) {
  return [
    'A single cute chibi mascot character for an app, the whole body visible and centered,',
    'soft rounded 3D shapes lit from the top left, big friendly eyes, a gentle smile,',
    'cyan and magenta accent lights, on a plain dark navy background, no text, no frame.',
    `The character: ${description}`,
  ].join(' ')
}

const refused = message => Object.assign(new Error(message), { code: 'omni-ai/refused' })
const invalid = message => Object.assign(new Error(message), { code: 'omni-ai/invalid' })

/** The ChatGPT account id inside an access token, or undefined. */
export function accountIdOf(token) {
  try {
    const part = String(token).split('.')[1]
    const payload = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    const id = payload?.[JWT_CLAIM]?.chatgpt_account_id
    return typeof id === 'string' && id !== '' ? id : undefined
  } catch {
    return undefined
  }
}

// Which image source this DSH can use right now, without revealing anything stored.
async function imageSource(ctx, now = Date.now()) {
  const grant = await ctx.credentials.readRecord?.(CODEX_RECORD).catch(() => undefined)
  const payload = grant?.kind === 'grant' ? grant.payload : undefined
  if (payload && typeof payload.access === 'string') {
    const fresh = typeof payload.expires !== 'number' || payload.expires > now + 60_000
    return { kind: 'chatgpt', fresh, token: payload.access, accountId: payload.accountId ?? accountIdOf(payload.access) }
  }
  const record = await ctx.credentials.readRecord?.(OPENAI_RECORD).catch(() => undefined)
  if (record?.kind === 'api-key' && typeof record.key === 'string' && record.key !== '') return { kind: 'openai', fresh: true, token: record.key }
  const env = await ctx.credentials.resolve?.(OPENAI_ENV).catch(() => undefined)
  if (typeof env?.value === 'string' && env.value !== '') return { kind: 'openai', fresh: true, token: env.value }
  return undefined
}

/** Where companion images are kept: the Omni home, never DSH's own. */
export const companionDir = (env = process.env) => join(env.OMNI_HOME || join(homedir(), '.omni'), 'ai')

function firstImage(body) {
  const item = Array.isArray(body?.data) ? body.data[0] : undefined
  if (typeof item?.b64_json === 'string') return { base64: item.b64_json }
  if (typeof item?.url === 'string' && item.url.startsWith('data:image/')) return { base64: item.url.split(',')[1] ?? '' }
  if (typeof item?.url === 'string' && item.url.startsWith('https://')) return { url: item.url }
  return undefined
}

export function createCompanionActions(ctx, { fetch: fetchImpl = globalThis.fetch, env = process.env, now = () => Date.now() } = {}) {
  const team = () => {
    try {
      return ctx.get?.('omniTeam') ?? undefined
    } catch {
      return undefined
    }
  }

  async function mainBotOf(rt) {
    await rt.load?.()
    if (!(rt.state?.mainBotIds ?? []).some(id => rt.botOf?.(id))) await rt.bootstrap?.()
    return (rt.state?.mainBotIds ?? []).find(id => rt.botOf?.(id))
  }

  async function omniProjectOf(rt) {
    await rt.load?.()
    const workspace = rt.teamFolder?.()
    return typeof workspace === 'string' ? join(workspace, OMNI_PROJECT) : undefined
  }

  // Made once, the first time Omni joins the team. Its greeting waits for the user to pick
  // its model, so joining sends nothing anywhere.
  async function joinOmni(rt) {
    await mainBotOf(rt)
    const existing = Object.values(rt.state?.bots ?? {}).find(bot => bot.kind === OMNI_BOT.kind)
    if (existing !== undefined) return existing
    const project = await omniProjectOf(rt)
    if (project !== undefined) mkdirSync(project, { recursive: true })
    const name = rt.findBot?.(OMNI_BOT.name) === undefined ? OMNI_BOT.name : OMNI_BOT_FALLBACK
    return rt.createBot({ ...OMNI_BOT, name, workDir: project, pickModel: true })
  }

  return {
    // What the companion step needs: can it generate, and is a companion already made.
    async companion() {
      const source = await imageSource(ctx, now())
      const entry = ownEntry(ctx)
      const rt = team()
      return {
        generate: source === undefined ? null : { kind: source.kind, ready: source.fresh },
        name: typeof entry.companionName === 'string' ? entry.companionName : undefined,
        hasTeam: rt !== undefined,
        omniProject: rt === undefined ? null : (await omniProjectOf(rt).catch(() => undefined)) ?? null,
      }
    },

    // Draws a companion from a description. Returns the image as a data URL for the page.
    async 'companion-generate'(payload, signal) {
      const fields = parse(GeneratePayload, payload)
      if (fields === undefined) throw invalid('Describe your companion in a few words.')
      const source = await imageSource(ctx, now())
      if (source === undefined) throw refused('Connect ChatGPT or an OpenAI key first, or pick a companion instead.')
      if (!source.fresh) throw refused('Your ChatGPT sign-in needs a refresh. Send one message on a ChatGPT model, or sign in again in Connect AI.')
      const prompt = companionPrompt(fields.description)
      const chatgpt = source.kind === 'chatgpt'
      const response = await fetchImpl(chatgpt ? CODEX_IMAGES : OPENAI_IMAGES, {
        method: 'POST',
        signal,
        headers: chatgpt
          ? { authorization: `Bearer ${source.token}`, 'chatgpt-account-id': source.accountId ?? '', originator: 'codex_cli_rs', 'content-type': 'application/json', accept: 'application/json' }
          : { authorization: `Bearer ${source.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: chatgpt ? CODEX_IMAGE_MODEL : OPENAI_IMAGE_MODEL, prompt, size: '1024x1024', ...(chatgpt ? {} : { n: 1 }) }),
      }).catch(() => { throw refused('The image service could not be reached. Check your connection and try again.') })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        const detail = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 160) : `HTTP ${response.status}`
        throw refused(`The image was not made: ${detail}`)
      }
      let image = firstImage(body)
      if (image?.url) {
        const fetched = await fetchImpl(image.url, { signal }).catch(() => undefined)
        const bytes = fetched?.ok ? Buffer.from(await fetched.arrayBuffer()) : undefined
        image = bytes ? { base64: bytes.toString('base64') } : undefined
      }
      if (!image?.base64) throw refused('The image service answered without an image. Try again.')
      if (Buffer.byteLength(image.base64, 'base64') > MAX_IMAGE_BYTES) throw refused('The image is too large to keep. Try again.')
      return { image: `data:image/png;base64,${image.base64}`, via: source.kind }
    },

    // Keeps the companion and makes it the Main Bot's look and name.
    async 'companion-save'(payload) {
      const fields = parse(CompanionPayload, payload)
      if (fields === undefined) throw invalid('Give your companion a name and a look.')
      let imageFile
      if (fields.image) {
        const base64 = fields.image.split(',')[1] ?? ''
        if (Buffer.byteLength(base64, 'base64') > MAX_IMAGE_BYTES) throw invalid('That image is too large.')
        const dir = companionDir(env)
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        imageFile = join(dir, 'companion.png')
        writeFileSync(imageFile, Buffer.from(base64, 'base64'), { mode: 0o600 })
      }
      const rt = team()
      let applied = false
      if (rt !== undefined) {
        const id = await mainBotOf(rt)
        if (id !== undefined) {
          await rt.updateBot(id, {
            name: fields.name,
            role: COMPANION_ROLE,
            ...(fields.color ? { color: fields.color } : {}),
            ...(fields.shape ? { avatar: { shape: fields.shape } } : {}),
          }).catch((error) => { throw refused(String(error?.message ?? error)) })
          applied = true
        }
      }
      await ctx.settings.update(ENTRY, {
        companionName: fields.name,
        ...(fields.shape ? { companionShape: fields.shape } : {}),
        ...(fields.color ? { companionColor: fields.color } : {}),
        ...(imageFile ? { companionImage: imageFile } : {}),
      })
      return { name: fields.name, applied, image: imageFile !== undefined }
    },

    // The companion's picture for the page: the generated one, if any.
    async 'companion-image'() {
      const entry = ownEntry(ctx)
      if (typeof entry.companionImage !== 'string') return { image: null }
      try {
        return { image: `data:image/png;base64,${readFileSync(entry.companionImage).toString('base64')}` }
      } catch {
        return { image: null }
      }
    },

    // Who joins the team. Omni on adds the Omni Bot (once); off keeps its connect step skipped.
    async 'team-save'(payload) {
      const fields = parse(TeamPayload, payload)
      if (fields === undefined) throw invalid('Choose who joins your team.')
      const { omni, genie, omniAbilities } = fields
      await ctx.settings.update(ENTRY, { teamOmni: omni, teamGenie: genie, ...(omniAbilities ? { teamOmniAbilities: JSON.stringify(omniAbilities) } : {}), ...(omni ? {} : { connectOmniSkipped: true }) })
      const rt = team()
      let omniBot = null
      if (omni && rt !== undefined) {
        const bot = await joinOmni(rt).catch((error) => { throw refused(String(error?.message ?? error)) })
        omniBot = { id: bot.id, name: bot.name }
      }
      return { omni, genie, abilities: omniAbilities ?? null, omniBot }
    },
  }
}
