/**
 * Gupshup HSM template message sender
 *
 * Template messages are required for initiating conversations outside the 24h window.
 * Templates must be pre-approved in the Gupshup dashboard.
 */

import type { GupshupClient } from '../client';
import type { GupshupSendResponse } from '../types';

export async function sendTemplate(
  client: GupshupClient,
  to: string,
  templateId: string,
  params: Record<string, string>,
): Promise<GupshupSendResponse> {
  return client.sendTemplate(to, templateId, params);
}
