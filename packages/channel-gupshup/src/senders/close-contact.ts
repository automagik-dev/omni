/**
 * Gupshup close-contact message sender.
 *
 * Counterpart to `sendHandoff`: handoff pauses for a human attendant; close
 * terminates the conversation. The Gupshup-side Journey routes on the literal
 * `msg_type: 'CLOSING'` to an empty terminal node — no chat-fields update,
 * no template fire, no handoff queue. The customer's next inbound re-enters
 * the Welcome Journey (confirmed with Gupshup partner 2026-04-29).
 *
 * Naming note: the Omni-side concept is "close contact" (route, table, event,
 * function names all use that). The wire literal Gupshup expects is the
 * single word `'CLOSING'` — kept here as `GUPSHUP_CLOSE_MSG_TYPE` so the
 * partner-contract value lives in exactly one place. Do NOT rename the
 * surrounding TypeScript symbols to match the wire literal: the asymmetry
 * is intentional and prevents leaking the partner contract into Omni's
 * internal API surface.
 */

import type { GupshupClient } from '../client';
import type { GupshupSendResponse } from '../types';

/** Wire literal that Gupshup's Journey routes on. Partner contract — do not change without re-confirming. */
export const GUPSHUP_CLOSE_MSG_TYPE = 'CLOSING' as const;

export async function sendCloseContact(
  client: GupshupClient,
  to: string,
  text: string,
  closeReason?: string,
  closeOutcome?: string,
  closeFields?: Record<string, unknown>,
): Promise<GupshupSendResponse> {
  return client.send(to, {
    type: GUPSHUP_CLOSE_MSG_TYPE,
    text,
    close_reason: closeReason,
    close_outcome: closeOutcome,
    close_fields: closeFields,
  });
}
