/**
 * Reaction sender for Microsoft Teams.
 *
 * Teams accepts a fixed set of reaction types when bots add reactions through
 * a `messageReaction` activity:
 *   `like` | `heart` | `laugh` | `surprised` | `sad` | `angry`.
 *
 * Callers may pass any emoji or symbolic name; we map common aliases to one
 * of the supported Teams reactions and fall back to `like` for unknowns so
 * the call never silently drops. Unknown emoji are still logged so operators
 * can audit the mapping.
 *
 * The wire pattern: send a `messageReaction` activity with `replyToId` set
 * to the target activity ID and `reactionsAdded` (or `reactionsRemoved`)
 * carrying a single descriptor.
 */

import type { Logger } from '@omni/channel-sdk';
import { TeamsError, TeamsErrorCode } from '../types';
import type { TeamsReactionType, TeamsSendContext } from './types';

export interface TeamsReactionSendOptions {
  /** Activity ID of the target message the reaction attaches to */
  targetActivityId: string;
  /** Emoji or reaction name supplied by the dispatcher */
  emoji: string;
  /** When `true` (default) adds the reaction; when `false` removes it */
  add?: boolean;
}

/**
 * Add or remove a Teams reaction on a target activity.
 *
 * Returns the target activity ID — Teams doesn't assign a separate ID to a
 * reaction, but downstream code expects a stable string for the SendResult
 * `messageId` field. Returning the target ID matches the Slack plugin's
 * behaviour and lets the dispatcher correlate the reaction with the
 * underlying message.
 */
export async function sendReaction(
  ctx: TeamsSendContext,
  options: TeamsReactionSendOptions,
  logger: Logger,
): Promise<string> {
  if (!options.targetActivityId) {
    throw new TeamsError(TeamsErrorCode.SEND_FAILED, 'Reaction requires a target activity id');
  }
  if (!options.emoji) {
    throw new TeamsError(TeamsErrorCode.SEND_FAILED, 'Reaction requires an emoji');
  }

  const teamsReaction = mapEmojiToTeamsReaction(options.emoji);
  if (!teamsReaction.matched) {
    logger.warn('Unknown emoji mapped to Teams default reaction', {
      emoji: options.emoji,
      fallback: teamsReaction.type,
    });
  }

  const add = options.add ?? true;

  try {
    await ctx.sendActivity({
      type: 'messageReaction',
      replyToId: options.targetActivityId,
      reactionsAdded: add ? [{ type: teamsReaction.type }] : undefined,
      reactionsRemoved: add ? undefined : [{ type: teamsReaction.type }],
    });
    return options.targetActivityId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to send Teams reaction', {
      error: message,
      targetActivityId: options.targetActivityId,
      reaction: teamsReaction.type,
    });
    if (error instanceof TeamsError) throw error;
    throw new TeamsError(TeamsErrorCode.SEND_FAILED, `Failed to send Teams reaction: ${message}`);
  }
}

/**
 * Map an emoji or reaction name to one of the six reactions Teams accepts.
 *
 * Returned `matched: true` when the input mapped to a known Teams type
 * directly (or via an obvious alias); `false` when we fell back to `like`.
 */
export function mapEmojiToTeamsReaction(emoji: string): { type: TeamsReactionType; matched: boolean } {
  const normalized = emoji.trim().toLowerCase();
  const direct = EMOJI_REACTION_MAP[normalized];
  if (direct) return { type: direct, matched: true };

  // Single-codepoint emoji form ("👍" etc.) → look up by raw codepoint.
  const codepoint = EMOJI_REACTION_MAP[emoji.trim()];
  if (codepoint) return { type: codepoint, matched: true };

  return { type: 'like', matched: false };
}

const EMOJI_REACTION_MAP: Record<string, TeamsReactionType> = {
  // Direct named reactions
  like: 'like',
  heart: 'heart',
  laugh: 'laugh',
  surprised: 'surprised',
  sad: 'sad',
  angry: 'angry',

  // Common Slack-style aliases
  '+1': 'like',
  thumbsup: 'like',
  ':+1:': 'like',
  ':thumbsup:': 'like',
  red_heart: 'heart',
  ':heart:': 'heart',
  joy: 'laugh',
  ':joy:': 'laugh',
  ':laughing:': 'laugh',
  open_mouth: 'surprised',
  ':open_mouth:': 'surprised',
  ':scream:': 'surprised',
  cry: 'sad',
  ':cry:': 'sad',
  ':disappointed:': 'sad',
  rage: 'angry',
  ':rage:': 'angry',
  ':angry:': 'angry',

  // Unicode codepoints
  '👍': 'like',
  '❤️': 'heart',
  '❤': 'heart',
  '😂': 'laugh',
  '😆': 'laugh',
  '😮': 'surprised',
  '😱': 'surprised',
  '😢': 'sad',
  '😞': 'sad',
  '😡': 'angry',
  '🤬': 'angry',
};
