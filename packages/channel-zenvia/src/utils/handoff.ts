/**
 * Handoff planning for the Zenvia channel.
 *
 * The Zenvia API has no endpoint to transfer, assign or queue a
 * conversation. Its only routing primitive is the `conversation` field on an
 * outbound message:
 *
 *   { "solution": "conversion" | "zenvia_chat" | "nlu", "properties": { … } }
 *
 * When the contact REPLIES to that message, Zenvia hands the conversation to
 * the chosen solution and exposes `properties` there. Consequences:
 *   - The handoff is carried by the farewell message itself — the text the
 *     `/messages/send/handoff` route passes in.
 *   - It only takes effect on the contact's next message. Until then the
 *     conversation is still Omni's, which is why the route's default
 *     `agentPaused` side effect is the right one: the agent must not answer
 *     the reply that Zenvia is about to route to people.
 *   - Which solution receives it is per-instance config
 *     (`zenviaHandoffSolution`). Without it there is nowhere to route to, and
 *     the handoff is refused instead of pausing the agent on a conversation
 *     no human will ever see.
 *
 * `properties` carries the structured handoff context (the route's
 * `handoffFields`, `motivoHandoff` and `dadosLead`) so the receiving team
 * sees why and with what the contact arrived.
 */

import type { ZenviaConversationRouting, ZenviaHandoffSolution } from '../types';

export const HANDOFF_NOT_CONFIGURED_ERROR =
  'Zenvia handoff refused: zenviaHandoffSolution is not configured on this instance, so there is no solution to route the conversation to';

/**
 * Build the `conversation` routing for a handoff message. Explicit
 * `handoffFields` keys win over the derived ones.
 */
export function buildHandoffRouting(
  solution: ZenviaHandoffSolution,
  meta: Record<string, unknown>,
): ZenviaConversationRouting {
  const properties: Record<string, unknown> = {};

  const reason = meta.motivoHandoff;
  if (typeof reason === 'string' && reason.trim()) properties.handoffReason = reason.trim();

  const leadData = meta.dadosLead;
  if (leadData !== undefined && leadData !== null && leadData !== '') properties.leadData = leadData;

  const fields = meta.handoffFields;
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    Object.assign(properties, fields as Record<string, unknown>);
  }

  return Object.keys(properties).length > 0 ? { solution, properties } : { solution };
}
