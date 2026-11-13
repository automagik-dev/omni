// #1716: Redeem, the one call that turns an invite code into a project's admission. Today its
// only source is the code list staff upload (invite-codes.js); a platform's Redeem can replace
// it here later with no change to the call, its answer, or the rule metadata built from it.
//
//   in:  { code, channel: 'whatsapp', sender: { lid?, phone? } }, the ids the message carries
//   out: { ok: true, project, inviteId, context?, capability? }
//        or { ok: false, reason: 'unknown' | 'used' | 'expired' }
//
// A code is used once. The same code again from the same sender (any id they share) answers the
// same ok, so a retried message admits them again; from another sender it is `used`. A call that
// cannot be made throws: the caller treats it as no ok.
import { z } from 'zod'
import { inviteCodes } from './invite-codes.js'

const Id = z.string().min(1).max(200)
export const RedeemIn = z.object({
  code: z.string().min(1).max(64), channel: z.literal('whatsapp'),
  sender: z.object({ lid: Id.optional(), phone: Id.optional() }).refine(sender => sender.lid !== undefined || sender.phone !== undefined),
})
export const RedeemOut = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), project: z.string().min(1), inviteId: z.string().min(1), context: z.string().optional(), capability: z.unknown().optional() }),
  z.object({ ok: z.literal(false), reason: z.enum(['unknown', 'used', 'expired']) }),
])

export function inviteRedeem(rt) {
  const source = inviteCodes(rt)
  return async input => RedeemOut.parse(await source.redeem(RedeemIn.parse(input)))
}
