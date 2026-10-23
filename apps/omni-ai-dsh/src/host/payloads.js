// What the page may send, parsed at the boundary: the request on the /api route, then each
// action's payload, before an action reads a field. A request that does not parse reads as
// missing fields, so each action still answers with its own words ("Paste the whole API key.").
import { z } from 'zod'

export const MAX_KEY = 4096
export const MAX_ANSWER = 4096
const name = z.string().max(120)
const text = z.string().max(2 * MAX_KEY)

export const RequestBody = z.object({ endpoint: name, payload: z.unknown() })

// A pasted key or token: one unbroken string.
export const Secret = z.string().trim().min(1).max(MAX_KEY).regex(/^\S+$/)
export const Answer = z.string().trim().min(1).max(MAX_ANSWER)

export const DonePayload = z.object({ stepId: name })
export const CliproxyPayload = z.object({ baseURL: text.optional(), apiKey: text.optional() })
export const ProviderPayload = z.object({ provider: name })
export const KeyPayload = ProviderPayload.extend({ apiKey: text.optional() })
export const AnswerPayload = ProviderPayload.extend({ promptId: name.optional(), value: text.optional() })

// A companion: a name, and either one of Omni's characters (shape and color) or a generated image.
const companionName = z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u)
export const CompanionPayload = z.object({
  name: companionName,
  shape: z.string().regex(/^[a-z]{2,24}$/).optional(),
  color: z.string().regex(/^([a-z]{3,16}|#[0-9a-fA-F]{6})$/).optional(),
  image: z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).max(9 * 1024 * 1024).optional(),
  // The drawing shrunk for the Main Bot's avatar, within omni-ui's 160 KB limit.
  avatar: z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).max(160_000).optional(),
}).refine(value => value.shape !== undefined || value.image !== undefined, 'a look')
export const GeneratePayload = z.object({ description: z.string().trim().min(3).max(600) })
// Who joins the team, and which of the Omni Bot's abilities stay on.
export const TeamPayload = z.object({
  omni: z.boolean(),
  genie: z.boolean().default(false),
  omniAbilities: z.record(z.string().regex(/^[a-z]{2,24}$/), z.boolean()).refine(value => Object.keys(value).length <= 12).optional(),
})

/** The parsed value, or undefined when it does not match. */
export function parse(schema, value) {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}
