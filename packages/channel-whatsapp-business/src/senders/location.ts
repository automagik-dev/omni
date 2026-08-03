/**
 * Meta WhatsApp Cloud — location message sender.
 */

import type { MetaWhatsAppClient } from '../client';
import type { MetaOutboundMessage, MetaSendResponse } from '../types';
import { toMetaPhone } from '../utils/identity';

export async function sendLocation(
  client: MetaWhatsAppClient,
  to: string,
  latitude: number,
  longitude: number,
  name?: string,
  address?: string,
  replyTo?: string,
): Promise<MetaSendResponse> {
  const payload: MetaOutboundMessage = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toMetaPhone(to),
    type: 'location',
    location: {
      latitude,
      longitude,
      ...(name ? { name } : {}),
      ...(address ? { address } : {}),
    },
  };
  if (replyTo) payload.context = { message_id: replyTo };
  return client.sendMessage(payload);
}
