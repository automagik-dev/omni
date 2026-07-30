/**
 * Meta WhatsApp Cloud — media message sender.
 *
 * Handles image/audio/video/document/sticker outbound messages via the
 * `link` form (public URL). The `id` form (pre-uploaded media handle)
 * is Group 6's concern.
 *
 * Notes:
 *   - Audio messages reject captions on Meta's side. We drop any caption
 *     silently before sending.
 *   - Stickers also reject captions and filenames — dropped.
 *   - Documents use `filename` to set the display name on the recipient's
 *     device.
 */

import type { MetaWhatsAppClient } from '../client';
import type { MetaMediaPayload, MetaOutboundMessage, MetaSendResponse } from '../types';
import { toMetaPhone } from '../utils/identity';

export type MetaMediaKind = 'image' | 'audio' | 'video' | 'document' | 'sticker';

/**
 * Map a MIME type to a Meta media kind.
 *
 *   - `image/webp` → `sticker` (matches Gupshup's heuristic)
 *   - `image/*`    → `image`
 *   - `audio/*`    → `audio`
 *   - `video/*`    → `video`
 *   - anything else (including unknown / undefined) → `document`
 */
export function resolveMetaMediaType(mimeType?: string): MetaMediaKind {
  if (!mimeType) return 'document';
  if (mimeType === 'image/webp') return 'sticker';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

export async function sendMedia(
  client: MetaWhatsAppClient,
  to: string,
  mediaUrl: string,
  mimeType?: string,
  caption?: string,
  filename?: string,
  replyTo?: string,
): Promise<MetaSendResponse> {
  const kind = resolveMetaMediaType(mimeType);
  const media: MetaMediaPayload = { link: mediaUrl };

  // Captions: image / video / document only. Audio + sticker reject them.
  if (caption && (kind === 'image' || kind === 'video' || kind === 'document')) {
    media.caption = caption;
  }
  // Filenames: documents only.
  if (filename && kind === 'document') {
    media.filename = filename;
  }

  const payload: MetaOutboundMessage = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toMetaPhone(to),
    type: kind,
    [kind]: media,
  } as MetaOutboundMessage;

  if (replyTo) payload.context = { message_id: replyTo };
  return client.sendMessage(payload);
}
