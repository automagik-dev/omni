/**
 * Gupshup interactive message sender
 *
 * Handles button and list messages via the Gupshup BSP API.
 */

import type { GupshupClient } from '../client';
import type { GupshupInteractiveContent, GupshupSendResponse } from '../types';

export async function sendInteractive(
  client: GupshupClient,
  to: string,
  interactive: GupshupInteractiveContent,
): Promise<GupshupSendResponse> {
  return client.sendInteractive(to, interactive);
}
