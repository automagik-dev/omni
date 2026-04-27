/**
 * Map Bot Framework attachments to Omni `OutgoingContent`-style fragments.
 *
 * Teams attachments arrive in two flavours:
 *   1. File / image / video — `contentType` is a real MIME type and
 *      `contentUrl` points at a downloadable resource (typically with a
 *      short-lived bearer token already baked in).
 *   2. Cards — `contentType` follows the `application/vnd.microsoft.card.*`
 *      pattern. Adaptive Cards in particular are inbound-only for v1; we
 *      preserve the raw payload for downstream tooling but don't attempt
 *      to render or transform.
 *
 * The top-level result is the *primary* media payload (first non-card
 * attachment) plus a list of additional attachments preserved for the
 * raw-payload trail so the host runtime can decide what to do with them.
 */

import type { ContentType } from '@omni/core/types';

import type { TeamsAttachmentInfo } from '../types';
import type { InboundActivity } from './activity-types';

const CARD_CONTENT_TYPES = new Set([
  'application/vnd.microsoft.card.adaptive',
  'application/vnd.microsoft.card.hero',
  'application/vnd.microsoft.card.thumbnail',
  'application/vnd.microsoft.card.receipt',
  'application/vnd.microsoft.card.signin',
  'application/vnd.microsoft.card.list',
  'application/vnd.microsoft.card.video',
  'application/vnd.microsoft.card.audio',
  'application/vnd.microsoft.card.animation',
  'application/vnd.microsoft.teams.card.list',
  'application/vnd.microsoft.teams.card.o365connector',
  'application/vnd.microsoft.teams.file.download.info',
]);

export interface ExtractedMedia {
  /** Omni content type — derived from the MIME type */
  type: Extract<ContentType, 'image' | 'audio' | 'video' | 'document'>;
  /** Direct download URL */
  mediaUrl: string;
  mimeType: string;
  filename?: string;
  caption?: string;
}

export interface AttachmentExtractionResult {
  /** Best-fit media payload (first downloadable attachment), if any */
  media?: ExtractedMedia;
  /** Card attachments (Adaptive Cards, Hero cards, Teams file info, etc.) */
  cards: TeamsAttachmentInfo[];
  /** All attachments normalised to the Teams-side info shape */
  all: TeamsAttachmentInfo[];
}

export function extractAttachments(activity: InboundActivity): AttachmentExtractionResult {
  const raw = activity.attachments ?? [];
  if (raw.length === 0) {
    return { cards: [], all: [] };
  }

  const all: TeamsAttachmentInfo[] = raw.map((a) => ({
    contentType: a.contentType,
    name: a.name,
    contentUrl: a.contentUrl,
    content: a.content,
    thumbnailUrl: a.thumbnailUrl,
  }));

  const cards = all.filter((a) => CARD_CONTENT_TYPES.has(a.contentType));

  // Pick the first non-card attachment with a downloadable URL as the
  // primary media. Teams sometimes sends a plain `<image>` link as a card
  // wrapper (file.download.info) — those land in `cards` and we keep them
  // for the raw payload so downstream code can resolve them later.
  const media = all.find((a) => !CARD_CONTENT_TYPES.has(a.contentType) && !!a.contentUrl);

  if (!media || !media.contentUrl) {
    return { cards, all };
  }

  const omniType = mapMimeTypeToContentType(media.contentType);

  return {
    media: {
      type: omniType,
      mediaUrl: media.contentUrl,
      mimeType: media.contentType,
      filename: media.name,
    },
    cards,
    all,
  };
}

function mapMimeTypeToContentType(mime: string): ExtractedMedia['type'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}
