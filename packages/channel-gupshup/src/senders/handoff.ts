/**
 * Gupshup HANDOFF message sender
 */

import type { GupshupClient } from '../client';
import type { GupshupSendResponse } from '../types';

export async function sendHandoff(
  client: GupshupClient,
  to: string,
  text: string,
  extraInfo?: string,
): Promise<GupshupSendResponse> {
  return client.send(to, { type: 'HANDOFF', text, extra_info: extraInfo });
}
