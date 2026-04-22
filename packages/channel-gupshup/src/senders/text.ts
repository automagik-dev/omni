/**
 * Gupshup text message sender
 */

import type { GupshupClient } from '../client';
import type { GupshupSendResponse } from '../types';

export async function sendText(client: GupshupClient, to: string, text: string): Promise<GupshupSendResponse> {
  return client.send(to, { type: 'TEXT', text });
}
