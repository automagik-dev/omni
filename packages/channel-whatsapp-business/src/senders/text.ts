/**
 * Meta WhatsApp Cloud — text message sender.
 *
 * Wraps `MetaWhatsAppClient.sendMessage` for type=text. Normalizes the
 * destination phone to digits-only (Meta wire format) and supports
 * quoting/replying to a prior inbound `wamid` via `context.message_id`.
 */

import type { MetaWhatsAppClient } from '../client';
import type { MetaOutboundMessage, MetaSendResponse } from '../types';
import { toMetaPhone } from '../utils/identity';

export async function sendText(
  client: MetaWhatsAppClient,
  to: string,
  text: string,
  replyTo?: string,
): Promise<MetaSendResponse> {
  const payload: MetaOutboundMessage = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toMetaPhone(to),
    type: 'text',
    text: { body: text, preview_url: false },
  };
  if (replyTo) payload.context = { message_id: replyTo };
  return client.sendMessage(payload);
}
