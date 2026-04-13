/**
 * Gupshup location message sender
 */

import type { GupshupClient } from '../client';
import type { GupshupSendResponse } from '../types';

export async function sendLocation(
  client: GupshupClient,
  to: string,
  lat: number,
  lng: number,
  name?: string,
  address?: string,
  text?: string,
): Promise<GupshupSendResponse> {
  return client.send(to, {
    type: 'LOCATION',
    latitude: lat,
    longitude: lng,
    name,
    address,
    text,
  });
}
