/**
 * Gupshup CLOSE_CONTACT message sender (issue #559).
 *
 * Counterpart to `sendHandoff`: handoff pauses for a human attendant; close
 * terminates the conversation. The Gupshup-side Journey routes on the literal
 * `msg_type: 'CLOSE_CONTACT'` to an empty terminal node — no chat-fields
 * update, no template fire, no handoff queue. The customer's next inbound
 * re-enters the Welcome Journey (confirmed with Gupshup partner 2026-04-29).
 */

import type { GupshupClient } from '../client';
import type { GupshupSendResponse } from '../types';

export async function sendCloseContact(
  client: GupshupClient,
  to: string,
  text: string,
  closeReason?: string,
  closeOutcome?: string,
  closeFields?: Record<string, unknown>,
): Promise<GupshupSendResponse> {
  return client.send(to, {
    type: 'CLOSE_CONTACT',
    text,
    close_reason: closeReason,
    close_outcome: closeOutcome,
    close_fields: closeFields,
  });
}
