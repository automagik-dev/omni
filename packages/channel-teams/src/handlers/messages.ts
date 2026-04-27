/**
 * Inbound message handler — translates a Bot Framework `message` activity
 * into the Omni `IncomingMessage` envelope and emits it via the plugin's
 * `handleIncomingMessage` hook.
 */

import { sanitizeMessage } from '@omni/channel-sdk';
import type { Logger } from '@omni/core';
import type { ContentType } from '@omni/core/types';

import type { TeamsActivityMeta } from '../types';
import type { InboundActivity } from './activity-types';
import { extractAttachments } from './attachments';
import { deriveChatId, toActivityMeta } from './conversation';
import { parseMentions } from './mentions';

export interface ParsedInboundMessage {
  /** Slim activity metadata (used for routing + thread tracking) */
  meta: TeamsActivityMeta;
  /** Stable chat id (channel id when in a channel; conversation id otherwise) */
  chatId: string;
  /** Sender id used as the `from` field in the Omni event */
  from: string;
  /** Optional sender display name */
  fromName?: string;
  /** Content payload (text + first non-card media when present) */
  content: {
    type: ContentType;
    text?: string;
    mediaUrl?: string;
    mimeType?: string;
  };
  /** Mention parse results (used by DM policy + @bot routing) */
  mentions: ReturnType<typeof parseMentions>;
  /** Parent activity id when the user replied to a thread root */
  replyToId?: string;
  /** Platform timestamp (Unix ms) — derived from `activity.timestamp` */
  platformTimestamp?: number;
  /** Raw activity payload, kept for downstream observability */
  rawPayload: Record<string, unknown>;
}

export interface ParseInboundOptions {
  logger?: Logger;
}

/**
 * Parse a raw Bot Framework activity into the Omni-shaped envelope.
 *
 * Returns `null` when the activity is not actionable as a chat message
 * (empty body + no media, system events, etc.).
 */
export function parseInboundMessage(
  activity: InboundActivity,
  opts: ParseInboundOptions = {},
): ParsedInboundMessage | null {
  if (activity.type !== 'message') return null;

  const meta = toActivityMeta(activity);
  const mentions = parseMentions(activity);
  const attachments = extractAttachments(activity);

  // Sanitize inbound text via the SDK helper before we hand it to the runtime.
  // sanitizeMessage rejects null bytes / oversized payloads / control chars and
  // is the canonical contract enforced by the SDK compliance suite.
  let text: string | undefined;
  if (mentions.cleanedText.length > 0) {
    if (opts.logger) {
      const sanitized = sanitizeMessage(mentions.cleanedText, opts.logger, {
        instanceId: meta.activityId,
        messageId: meta.activityId,
      });
      if (!sanitized.ok) {
        opts.logger.debug('teams_message_dropped_sanitization', {
          activityId: meta.activityId,
          conversationId: meta.conversationId,
          reason: sanitized.rejected,
        });
        return null;
      }
      text = sanitized.text;
    } else {
      text = mentions.cleanedText;
    }
  }

  // No text and no usable media = nothing to relay. We log + drop. The raw
  // payload still goes through the host runtime's webhook recorder so we
  // can debug schema drift.
  if (!text && !attachments.media) {
    opts.logger?.debug('[teams] inbound activity has no text and no media — dropping', {
      activityId: meta.activityId,
      conversationId: meta.conversationId,
    });
    return null;
  }

  const chatId = deriveChatId(meta);
  const fromName = meta.userName;

  const platformTimestamp = parsePlatformTimestamp(activity.timestamp);

  const content: ParsedInboundMessage['content'] = attachments.media
    ? {
        type: attachments.media.type,
        text,
        mediaUrl: attachments.media.mediaUrl,
        mimeType: attachments.media.mimeType,
      }
    : {
        type: 'text',
        text,
      };

  return {
    meta,
    chatId,
    from: meta.userId,
    fromName,
    content,
    mentions,
    replyToId: meta.replyToId,
    platformTimestamp,
    rawPayload: activity as unknown as Record<string, unknown>,
  };
}

function parsePlatformTimestamp(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}
