/**
 * Extract mentions from a Bot Framework activity.
 *
 * Teams encodes mentions in two places:
 *   1. `activity.entities[]` where `type === 'mention'` carries the
 *      mentioned user's id, AAD object id, and display name.
 *   2. The body text wraps the visible label in `<at>Name</at>` tags,
 *      which are XML/HTML-style and survive across the wire.
 *
 * Downstream consumers care about two things:
 *   - the set of user IDs mentioned (so we can detect "@bot" routing),
 *   - the body text *without* the `<at>...</at>` markup so the LLM sees
 *     human-readable content.
 */

import type { InboundActivity, MentionEntity } from './activity-types';

export interface ParsedMention {
  /** AAD id when present, else the Bot Framework user id */
  userId: string;
  /** Display name as shown in Teams (best-effort) */
  name?: string;
  /** Whether the mention referenced the bot itself */
  isBot: boolean;
}

export interface MentionParseResult {
  mentions: ParsedMention[];
  /** Text with `<at>...</at>` tags stripped down to their label */
  cleanedText: string;
  /** Whether any mention referenced the bot's recipient id */
  mentionsBot: boolean;
}

export function parseMentions(activity: InboundActivity): MentionParseResult {
  const entities = activity.entities ?? [];
  const botRecipientId = activity.recipient?.id;
  const mentionEntities = entities.filter(isMentionEntity);

  const mentions: ParsedMention[] = mentionEntities.map((m) => {
    const mentioned = m.mentioned as MentionEntity['mentioned'];
    return {
      userId: mentioned.aadObjectId ?? mentioned.id,
      name: mentioned.name,
      isBot: !!botRecipientId && mentioned.id === botRecipientId,
    };
  });

  return {
    mentions,
    cleanedText: stripMentionMarkup(activity.text ?? ''),
    mentionsBot: mentions.some((m) => m.isBot),
  };
}

const MENTION_TAG_RE = /<at[^>]*>([\s\S]*?)<\/at>/gi;

/**
 * Replace `<at>Bot</at>` with `Bot` and collapse the whitespace around it.
 *
 * Teams prefixes channel-mention bodies with the bot's `<at>` block; if we
 * leave the literal markup in place the LLM sees noise. We keep the visible
 * label so contextual mentions ("hey @ops, please check") still read
 * naturally.
 */
export function stripMentionMarkup(text: string): string {
  if (!text) return '';
  return text.replace(MENTION_TAG_RE, '$1').replace(/\s+/g, ' ').trim();
}

function isMentionEntity(entity: Record<string, unknown>): boolean {
  if (entity.type !== 'mention') return false;
  const mentioned = entity.mentioned as { id?: string } | undefined;
  return typeof mentioned?.id === 'string';
}
