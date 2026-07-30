/**
 * Hermes — media message sender (image / audio / video / document / sticker).
 *
 * Two transport forms, per the Hermes spec:
 *   - `url` + `content_type` when a public media URL is available. Hermes
 *     fetches the file itself — the URL's server must return a matching
 *     Content-Type header.
 *   - `id` + `content_type` after uploading raw bytes to POST /api/v2/upload
 *     (< 2 MB) when only bytes are available.
 *
 * Shape quirks vs Meta Cloud API:
 *   - Media rides FLAT on the message object (no nested `image: {...}`).
 *   - Stickers use `sticker: { link }` and require a public .webp URL — the
 *     spec documents no sticker-via-id form, so byte-only stickers throw.
 *   - Captions: image / video / document only (audio + sticker reject them).
 */

import type { HermesClient } from '../client';
import type { HermesOutboundMessage, HermesSendResponse } from '../types';
import { HermesApiError, HermesErrorCode } from '../utils/errors';
import { toHermesPhone } from '../utils/identity';

export type HermesMediaKind = 'image' | 'audio' | 'video' | 'document' | 'sticker';

/** Media source — exactly one of `url` (public link) or `bytes` (uploaded first). */
export interface HermesMediaSource {
  url?: string;
  bytes?: ArrayBuffer;
}

/**
 * Map a MIME type to a Hermes media kind.
 *
 *   - `image/webp` → `sticker` (matches the whatsapp-cloud heuristic)
 *   - `image/*`    → `image`
 *   - `audio/*`    → `audio`
 *   - `video/*`    → `video`
 *   - anything else (including unknown / undefined) → `document`
 */
export function resolveHermesMediaType(mimeType?: string): HermesMediaKind {
  if (!mimeType) return 'document';
  if (mimeType === 'image/webp') return 'sticker';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

const CAPTIONABLE_KINDS: ReadonlySet<HermesMediaKind> = new Set(['image', 'video', 'document']);

export async function sendMedia(
  client: HermesClient,
  to: string,
  source: HermesMediaSource,
  mimeType?: string,
  caption?: string,
  replyTo?: string,
): Promise<HermesSendResponse> {
  const kind = resolveHermesMediaType(mimeType);

  if (kind === 'sticker') {
    return sendSticker(client, to, source, replyTo);
  }

  const payload: HermesOutboundMessage = {
    to: toHermesPhone(to),
    recipient_type: 'individual',
    type: kind,
    content_type: mimeType ?? 'application/octet-stream',
  };

  if (source.url) {
    payload.url = source.url;
  } else if (source.bytes) {
    const uploaded = await client.upload(source.bytes, mimeType ?? 'application/octet-stream');
    payload.id = uploaded.id;
  } else {
    throw new HermesApiError(HermesErrorCode.INVALID_REQUEST, 'sendMedia requires a media url or bytes', {
      operation: 'sendMedia',
    });
  }

  if (caption && CAPTIONABLE_KINDS.has(kind)) {
    payload.caption = caption;
  }
  if (replyTo) payload.context = { message_id: replyTo };
  return client.sendMessage(payload);
}

/** Stickers only ship by public .webp URL — Hermes documents no id form. */
async function sendSticker(
  client: HermesClient,
  to: string,
  source: HermesMediaSource,
  replyTo?: string,
): Promise<HermesSendResponse> {
  if (!source.url) {
    throw new HermesApiError(
      HermesErrorCode.INVALID_REQUEST,
      'Hermes stickers require a public .webp URL (no sticker-via-id form)',
      { operation: 'sendMedia' },
    );
  }
  const payload: HermesOutboundMessage = {
    to: toHermesPhone(to),
    recipient_type: 'individual',
    type: 'sticker',
    sticker: { link: source.url },
  };
  if (replyTo) payload.context = { message_id: replyTo };
  return client.sendMessage(payload);
}
