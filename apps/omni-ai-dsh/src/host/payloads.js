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

/** The parsed value, or undefined when it does not match. */
export function parse(schema, value) {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}
