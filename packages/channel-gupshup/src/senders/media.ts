/**
 * Gupshup media message sender
 *
 * Handles IMAGE, AUDIO, VIDEO, DOCUMENT, STICKER outbound messages.
 */

import type { GupshupClient } from '../client';
import type { GupshupOutboundMessage, GupshupSendResponse } from '../types';

type MediaOutboundType = 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'STICKER';

/**
 * Map a MIME type to a Gupshup media type string.
 * Defaults to 'DOCUMENT' for unknown types.
 */
export function resolveMediaType(mimeType?: string): MediaOutboundType {
  if (!mimeType) return 'DOCUMENT';
  if (mimeType === 'image/webp') return 'STICKER';
  if (mimeType.startsWith('image/')) return 'IMAGE';
  if (mimeType.startsWith('audio/')) return 'AUDIO';
  if (mimeType.startsWith('video/')) return 'VIDEO';
  return 'DOCUMENT';
}

export async function sendMedia(
  client: GupshupClient,
  to: string,
  mediaUrl: string,
  mimeType?: string,
  caption?: string,
  filename?: string,
): Promise<GupshupSendResponse> {
  const type = resolveMediaType(mimeType);
  const msg: GupshupOutboundMessage = { type, url: mediaUrl };
  if (caption) msg.caption = caption;
  if (filename) msg.filename = filename;
  return client.send(to, msg);
}
