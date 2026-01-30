/**
 * Location message sender
 */

import type { AnyMessageContent, WASocket } from '@whiskeysockets/baileys';

/**
 * Location data
 */
export interface LocationData {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

/**
 * Build location message content
 */
export function buildLocationContent(location: LocationData): AnyMessageContent {
  return {
    location: {
      degreesLatitude: location.latitude,
      degreesLongitude: location.longitude,
      name: location.name,
      address: location.address,
    },
  };
}

/**
 * Send a location message
 */
export async function sendLocationMessage(
  sock: WASocket,
  jid: string,
  location: LocationData,
  replyToId?: string,
): Promise<string | undefined> {
  const content = buildLocationContent(location);

  const result = await sock.sendMessage(
    jid,
    content,
    replyToId ? { quoted: { key: { id: replyToId, remoteJid: jid } } as never } : undefined,
  );

  return result?.key?.id ?? undefined;
}

/**
 * Validate location coordinates
 */
export function isValidLocation(location: LocationData): boolean {
  return (
    typeof location.latitude === 'number' &&
    typeof location.longitude === 'number' &&
    location.latitude >= -90 &&
    location.latitude <= 90 &&
    location.longitude >= -180 &&
    location.longitude <= 180
  );
}
