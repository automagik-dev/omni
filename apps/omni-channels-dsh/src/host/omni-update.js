// Updating an Omni this host knows: one found on this computer with a key (omni-discover.js),
// or the linked one (omni-link.js). The app never updates an Omni by itself: it asks the
// Omni (POST /api/v2/system/update), the Omni asks its owner on WhatsApp, and only the
// owner's reply there ("update <code>") runs the update its operator set up. A sandboxed
// Omni on this computer (`confirm: 'app'`: it listens on loopback only) takes the person's
// yes in the app instead, so the page asks before it asks, and the update starts at once.
// An Omni from before that route answers 404, and is updated where it runs, with `omni update`.
//
// The key stays on this host; the page sees what the Omni runs, what is out, and where an
// update stands. Under Unfold (AUTOMAGIK_HOST=unfold) no Omni is asked: Unfold updates its own.
import { z } from 'zod'
import { foundOmni, unfoldHost } from './omni-discover.js'

const TIMEOUT_MS = 10_000
const CLIENT_ID = process.env.OMNI_CLIENT_ID === 'omni-desktop' ? 'omni-desktop' : 'omni-dsh'
export const TERMINAL_COMMAND = 'omni update'

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })
const refused = message => Object.assign(new Error(message), { code: 'bot/refused' })

const version = z.string().max(64)
const Status = z.object({
  data: z.object({
    current: version.nullable().optional(),
    channel: z.string().max(32).optional(),
    latest: version.nullable().optional(),
    updateAvailable: z.boolean().optional(),
    mode: z.enum(['off', 'command']).optional(),
    confirm: z.enum(['whatsapp', 'app']).optional(),
    pending: z.object({ version, expiresAt: z.string().max(64).optional() }).optional(),
    inFlight: z.object({ version, startedAt: z.string().max(64).optional() }).optional(),
  }),
})
const Accepted = z.object({
  data: z.discriminatedUnion('status', [
    z.object({ status: z.literal('awaiting-confirmation'), version, expiresAt: z.string().max(64).optional() }),
    z.object({ status: z.literal('started'), version, startedAt: z.string().max(64).optional() }),
  ]),
})
const Target = z.object({ id: z.string().regex(/^[a-f0-9]{16}$/).optional() })
const RequestPayload = Target.extend({ version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).max(64) })

// What each refusal of POST /system/update means to the person asking.
export const REFUSALS = {
  UPDATE_NOT_CONFIGURED: `Updates from the app are off on this Omni. Update it where it runs: ${TERMINAL_COMMAND}`,
  CONFIRM_CHANNEL_MISSING: 'This Omni has no WhatsApp chat with you to confirm the update in.',
  UPDATE_PENDING: 'An update is already waiting for your yes on WhatsApp.',
  UPDATE_IN_PROGRESS: 'This Omni is updating right now.',
  VERSION_MISMATCH: 'A newer Omni came out meanwhile. Look again.',
  ALREADY_CURRENT: 'This Omni is up to date.',
  REGISTRY_UNAVAILABLE: 'Could not check for the newest Omni right now. Try again later.',
  CONFIRM_SEND_FAILED: 'Omni could not send the confirmation to WhatsApp. Try again.',
  UPDATE_START_FAILED: 'The update could not start on this Omni. Its logs say why.',
}
export const UNFOLD_UPDATES = 'Updates for this Omni come with Unfold.'
export const FORBIDDEN = `This device may not update that Omni: its key lacks the system scopes. Update it where it runs: ${TERMINAL_COMMAND}`

export function install(rt) {
  // The Omni asked about, with its key: one found on this computer, else the linked one.
  function targetOf(body) {
    const parsed = Target.safeParse(body ?? {})
    if (!parsed.success) throw invalid('Pick an Omni to update')
    if (parsed.data.id) {
      const omni = foundOmni(parsed.data.id)
      if (!omni) throw refused('That Omni is not there any more. Look again.')
      return { url: omni.url, key: omni.key ?? null }
    }
    const link = rt.omniLink()
    return link ? { url: link.url, key: link.key } : null
  }

  async function ask(target, method, body) {
    try {
      const response = await fetch(`${target.url}/api/v2/system/update`, {
        method,
        headers: { accept: 'application/json', 'x-api-key': target.key, 'x-omni-client': CLIENT_ID, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      return { status: response.status, json: await response.json().catch(() => null) }
    } catch {
      return null
    }
  }

  // `state`: terminal (update it where it runs), available (with `confirm: 'app'` when the
  // person's yes here starts it), off (out, but not from here),
  // pending (waiting for the owner on WhatsApp), updating, current, forbidden, unreachable,
  // unknown, or none (nothing to ask).
  async function status(body) {
    if (unfoldHost()) return { state: 'none' }
    const target = targetOf(body)
    if (target === null) return { state: 'none' }
    if (!target.key) return { state: 'terminal', command: TERMINAL_COMMAND }
    const reply = await ask(target, 'GET')
    if (reply === null) return { state: 'unreachable' }
    if (reply.status === 404) return { state: 'terminal', command: TERMINAL_COMMAND }
    if (reply.status === 401 || reply.status === 403) return { state: 'forbidden', message: FORBIDDEN, command: TERMINAL_COMMAND }
    const parsed = Status.safeParse(reply.json)
    if (reply.status !== 200 || !parsed.success) return { state: 'unknown' }
    const data = parsed.data.data
    const known = { current: data.current ?? null, latest: data.latest ?? null }
    if (data.inFlight) return { state: 'updating', ...known, version: data.inFlight.version }
    if (data.pending) return { state: 'pending', ...known, version: data.pending.version, expiresAt: data.pending.expiresAt ?? null }
    if (data.updateAvailable && data.latest) {
      if (data.mode !== 'command') return { state: 'off', ...known, command: TERMINAL_COMMAND }
      return { state: 'available', ...known, ...(data.confirm === 'app' ? { confirm: 'app' } : {}) }
    }
    return { state: data.latest ? 'current' : 'unknown', ...known }
  }

  async function request(body) {
    if (unfoldHost()) throw refused(UNFOLD_UPDATES)
    const parsed = RequestPayload.safeParse(body ?? {})
    if (!parsed.success) throw invalid('Pick the version to update to')
    const target = targetOf(parsed.data)
    if (target === null || !target.key) throw refused(`Update it where it runs: ${TERMINAL_COMMAND}`)
    const reply = await ask(target, 'POST', { version: parsed.data.version })
    if (reply === null) throw refused(`Could not reach Omni at ${target.url}`)
    if (reply.status === 202) {
      const accepted = Accepted.safeParse(reply.json)
      if (!accepted.success) throw refused(`Omni answered 202 at ${new URL(target.url).host} without the update`)
      const answer = accepted.data.data
      if (answer.status === 'started') return { state: 'updating', version: answer.version }
      return { state: 'awaiting-confirmation', version: answer.version, expiresAt: answer.expiresAt ?? null }
    }
    if (reply.status === 404) throw refused(`This Omni cannot be updated from the app. Update it where it runs: ${TERMINAL_COMMAND}`)
    if (reply.status === 401 || reply.status === 403) throw refused(FORBIDDEN)
    const code = reply.json?.error?.code
    const message = typeof reply.json?.error?.message === 'string' ? reply.json.error.message : null
    throw refused(REFUSALS[code] ?? message ?? `Omni answered ${reply.status} at ${new URL(target.url).host}`)
  }

  rt.omniUpdateEndpoint = (endpoint, body) => (endpoint === 'omni-update-request' ? request(body) : status(body))
  rt.ctx.effect(() => rt.hooks.endpoint('omni-update-status', status, { read: true }), 'omni-channels: omni-update-status')
  // Asking for an update starts one on that Omni (once its owner says yes), so only a host
  // that may change things answers it.
  rt.ctx.effect(() => rt.hooks.endpoint('omni-update-request', request), 'omni-channels: omni-update-request')
}
