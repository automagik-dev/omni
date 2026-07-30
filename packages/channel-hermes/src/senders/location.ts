/**
 * Hermes — location message sender.
 */

import type { HermesClient } from '../client';
import type { HermesOutboundMessage, HermesSendResponse } from '../types';
import { toHermesPhone } from '../utils/identity';

export async function sendLocation(
  client: HermesClient,
  to: string,
  latitude: number,
  longitude: number,
  name?: string,
  address?: string,
  replyTo?: string,
): Promise<HermesSendResponse> {
  const payload: HermesOutboundMessage = {
    to: toHermesPhone(to),
    recipient_type: 'individual',
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
