/**
 * Gupshup media message sender
 *
 * Handles image, audio, video, and document (file) outbound messages.
 */

import type { GupshupClient } from '../client';
import type { GupshupSendResponse } from '../types';

type MediaType = 'image' | 'audio' | 'video' | 'file';

/**
 * Map a MIME type or content-type to a Gupshup media type string.
 * Defaults to 'file' for unknown types.
 */
export function resolveMediaType(mimeType?: string): MediaType {
  if (!mimeType) return 'file';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

export async function sendMedia(
  client: GupshupClient,
  to: string,
  url: string,
  mimeType?: string,
  caption?: string,
): Promise<GupshupSendResponse> {
  const type = resolveMediaType(mimeType);
  return client.sendMedia(to, type, url, caption);
}
