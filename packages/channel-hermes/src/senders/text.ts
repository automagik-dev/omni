/**
 * Hermes — text message sender.
 *
 * NOTE: unlike Meta Cloud API, Hermes takes `text` as a plain STRING
 * (On-Premises style), not `{ body }`. Replies quote a prior inbound wamid
 * via `context.message_id`.
 */

import type { HermesClient } from '../client';
import type { HermesOutboundMessage, HermesSendResponse } from '../types';
import { toHermesPhone } from '../utils/identity';

export async function sendText(
  client: HermesClient,
  to: string,
  text: string,
  replyTo?: string,
): Promise<HermesSendResponse> {
  const payload: HermesOutboundMessage = {
    to: toHermesPhone(to),
    recipient_type: 'individual',
    type: 'text',
    text,
  };
  if (replyTo) payload.context = { message_id: replyTo };
  return client.sendMessage(payload);
}
