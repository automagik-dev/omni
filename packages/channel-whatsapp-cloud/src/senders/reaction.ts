/**
 * Meta WhatsApp Cloud — emoji reaction sender.
 *
 * Pass an empty string for `emoji` to remove the reaction. `messageId` is
 * the inbound `wamid` (e.g. `wamid.HBgM...`) and is required.
 */

import type { MetaWhatsAppClient } from '../client';
import type { MetaOutboundMessage, MetaSendResponse } from '../types';
import { MetaApiError, MetaErrorCode } from '../utils/errors';
import { toMetaPhone } from '../utils/identity';

export async function sendReaction(
  client: MetaWhatsAppClient,
  to: string,
  messageId: string,
  emoji: string,
): Promise<MetaSendResponse> {
  if (!messageId) {
    throw new MetaApiError(MetaErrorCode.INVALID_REQUEST, 'sendReaction requires a target messageId (wamid)', {
      operation: 'sendReaction',
    });
  }
  const payload: MetaOutboundMessage = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toMetaPhone(to),
    type: 'reaction',
    reaction: { message_id: messageId, emoji },
  };
  return client.sendMessage(payload);
}
