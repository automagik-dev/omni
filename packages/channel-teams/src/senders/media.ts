/**
 * Outbound media sender for Microsoft Teams.
 *
 * Bot Framework supports two attachment delivery modes:
 *
 * 1. **URL-based** — set `contentType` + `contentUrl`, Teams downloads the
 *    asset directly. Works for any publicly reachable URL (or signed URL
 *    that Teams' fetcher can follow). Used for `image`, `audio`, `video`,
 *    and `document` content when `mediaUrl` is supplied.
 *
 * 2. **Inline data URL** — for buffered content (`base64` metadata), we
 *    encode the buffer into a `data:` URL and pass it as `contentUrl`.
 *    The Bot Framework Connector relays this verbatim to Teams which
 *    materialises it as an attachment. Capped at the
 *    `TEAMS_CAPABILITIES.maxFileSize` (4 MB).
 *
 * The `caption` (or `text`) lands as the message body alongside the
 * attachment so Teams renders both in the same chat bubble.
 *
 * Out of scope for v1 (deferred to follow-up wishes — see DESIGN.md):
 * - File consent flow via OneDrive (`FileConsentCard`)
 * - SharePoint-backed channel files
 * - Adaptive Cards as media (covered by `senders/cards.ts` if/when added)
 */

import type { Logger } from '@omni/channel-sdk';
import { TeamsError, TeamsErrorCode } from '../types';
import type { TeamsOutboundAttachment, TeamsSendContext } from './types';

/**
 * Logical media kind requested by the caller. Maps onto Teams content types
 * with a sensible default when the caller did not supply a mime type.
 */
export type TeamsMediaKind = 'image' | 'audio' | 'video' | 'document';

export interface TeamsMediaSendOptions {
  /** Logical media kind — picks a default content type when `mimeType` is missing */
  kind: TeamsMediaKind;
  /** Public URL Teams can fetch (mutually exclusive with `content`) */
  mediaUrl?: string;
  /** Buffered media content (mutually exclusive with `mediaUrl`) */
  content?: Buffer;
  /** MIME type — required when `content` is supplied; auto-derived for URLs */
  mimeType?: string;
  /** Display filename (recommended for `document`; optional otherwise) */
  filename?: string;
  /** Optional caption / accompanying text */
  caption?: string;
  /** Bot Framework `replyToId` for thread replies */
  replyToId?: string;
  /** Maximum bytes accepted for inline buffers (defaults to 4 MB per capabilities) */
  maxBufferBytes?: number;
}

const DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

const DEFAULT_MIME_BY_KIND: Record<TeamsMediaKind, string> = {
  image: 'image/png',
  audio: 'audio/mpeg',
  video: 'video/mp4',
  document: 'application/octet-stream',
};

/**
 * Send a media attachment to Teams.
 *
 * Returns the activity ID of the new message — needed for downstream
 * replies, edits, or reactions.
 */
export async function sendMediaMessage(
  ctx: TeamsSendContext,
  options: TeamsMediaSendOptions,
  logger: Logger,
): Promise<string> {
  if (!options.mediaUrl && !options.content) {
    throw new TeamsError(TeamsErrorCode.SEND_FAILED, 'sendMediaMessage requires either mediaUrl or content');
  }

  const attachment = options.content ? buildBufferAttachment(options) : buildUrlAttachment(options);

  logger.debug('Sending Teams media attachment', {
    kind: options.kind,
    contentType: attachment.contentType,
    name: attachment.name,
    hasUrl: Boolean(attachment.contentUrl),
    inline: Boolean(options.content),
  });

  try {
    const response = await ctx.sendActivity({
      type: 'message',
      text: options.caption,
      textFormat: options.caption ? 'markdown' : undefined,
      attachments: [attachment],
      replyToId: options.replyToId,
    });
    return response.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to send Teams media activity', {
      error: message,
      kind: options.kind,
      filename: options.filename,
    });
    if (error instanceof TeamsError) throw error;
    throw new TeamsError(TeamsErrorCode.ATTACHMENT_FAILED, `Failed to send Teams attachment: ${message}`);
  }
}

/**
 * Send a media activity by URL — convenience wrapper that asserts a URL is
 * provided. Mirrors `uploadFileFromUrl` from the Slack plugin.
 */
export async function sendMediaFromUrl(
  ctx: TeamsSendContext,
  options: Omit<TeamsMediaSendOptions, 'content'> & { mediaUrl: string },
  logger: Logger,
): Promise<string> {
  return sendMediaMessage(ctx, options, logger);
}

/**
 * Send a media activity from a buffered payload. Encodes the buffer as a
 * `data:` URL — capped at `options.maxBufferBytes` (default 4 MB).
 */
export async function sendMediaFromBuffer(
  ctx: TeamsSendContext,
  options: Omit<TeamsMediaSendOptions, 'mediaUrl'> & { content: Buffer },
  logger: Logger,
): Promise<string> {
  return sendMediaMessage(ctx, options, logger);
}

function buildUrlAttachment(options: TeamsMediaSendOptions): TeamsOutboundAttachment {
  const contentType = options.mimeType ?? DEFAULT_MIME_BY_KIND[options.kind];
  return {
    contentType,
    name: options.filename,
    contentUrl: options.mediaUrl,
  };
}

function buildBufferAttachment(options: TeamsMediaSendOptions): TeamsOutboundAttachment {
  const content = options.content;
  // Type guard — `sendMediaMessage` has already validated `content` is set,
  // but the helper is exported and could be called independently.
  if (!content) {
    throw new TeamsError(TeamsErrorCode.SEND_FAILED, 'buildBufferAttachment called without content buffer');
  }

  const limit = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  if (content.length > limit) {
    throw new TeamsError(
      TeamsErrorCode.ATTACHMENT_FAILED,
      `Inline attachment exceeds Teams limit (${content.length} > ${limit} bytes)`,
    );
  }

  const contentType = options.mimeType ?? DEFAULT_MIME_BY_KIND[options.kind];
  const dataUrl = `data:${contentType};base64,${content.toString('base64')}`;

  return {
    contentType,
    name: options.filename ?? `file-${Date.now()}`,
    contentUrl: dataUrl,
  };
}
