/**
 * Reaction level engine for Telegram
 *
 * Implements tiered reaction behavior for processing feedback:
 * - off: No automatic reactions (default)
 * - ack: React with eyes emoji on receive, remove after response
 * - minimal: React to every Nth message (deterministic counter)
 * - extensive: React to every message with contextual emoji
 */

import { createLogger } from '@omni/core';
import type { TelegramBotLike } from '../grammy-shim';

const log = createLogger('telegram:reactions:levels');

export type ReactionLevel = 'off' | 'ack' | 'minimal' | 'extensive';

export interface ReactionLevelConfig {
  /** Reaction level mode */
  level: ReactionLevel;
  /** Emoji for ack mode (default: eyes) */
  ackEmoji?: string;
  /** Counter interval for minimal mode (default: 5 — react every 5th message) */
  minimalInterval?: number;
  /** Emoji set for extensive mode */
  extensiveEmojis?: string[];
}

const DEFAULT_ACK_EMOJI = '\u{1F440}'; // 👀
const DEFAULT_MINIMAL_INTERVAL = 5;
const DEFAULT_EXTENSIVE_EMOJIS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F525}', '\u{1F60A}', '\u{1F389}'] as const; // 👍, ❤️, 🔥, 😊, 🎉
const FALLBACK_EMOJI = '\u{1F44D}'; // 👍

/** Per-instance message counters for minimal mode (deterministic, not random) */
const messageCounters = new Map<string, number>();

/**
 * Get the current counter for an instance, increment it, and return the new value.
 */
function incrementCounter(instanceId: string): number {
  const current = messageCounters.get(instanceId) ?? 0;
  const next = current + 1;
  messageCounters.set(instanceId, next);
  return next;
}

/**
 * Reset counter for an instance (for testing).
 */
export function resetCounter(instanceId: string): void {
  messageCounters.delete(instanceId);
}

/**
 * Determine if a reaction should be set based on the reaction level config.
 * Returns the emoji to react with, or null if no reaction should be set.
 */
export function shouldReact(instanceId: string, config: ReactionLevelConfig): string | null {
  switch (config.level) {
    case 'off':
      return null;

    case 'ack':
      return config.ackEmoji ?? DEFAULT_ACK_EMOJI;

    case 'minimal': {
      const count = incrementCounter(instanceId);
      const interval = config.minimalInterval ?? DEFAULT_MINIMAL_INTERVAL;
      if (count % interval === 0) {
        // Cycle through extensive emojis for variety
        const emojis = config.extensiveEmojis ?? DEFAULT_EXTENSIVE_EMOJIS;
        const idx = Math.floor(count / interval) % emojis.length;
        return emojis[idx] ?? FALLBACK_EMOJI;
      }
      return null;
    }

    case 'extensive': {
      const emojis = config.extensiveEmojis ?? DEFAULT_EXTENSIVE_EMOJIS;
      const count = incrementCounter(instanceId);
      return emojis[count % emojis.length] ?? FALLBACK_EMOJI;
    }

    default:
      return null;
  }
}

/**
 * Set the ack reaction on a received message. Safe to call — catches all errors.
 * Returns true if the reaction was set successfully.
 */
export async function setAckReaction(
  bot: TelegramBotLike,
  chatId: string,
  messageId: number,
  emoji: string,
): Promise<boolean> {
  try {
    await bot.api.setMessageReaction(chatId, messageId, [{ type: 'emoji', emoji }]);
    log.debug('Set ack reaction', { chatId, messageId, emoji });
    return true;
  } catch (error) {
    const errStr = String(error);
    // Permission errors — fail silently with warning
    if (
      errStr.includes('REACTION_INVALID') ||
      errStr.includes('not enough rights') ||
      errStr.includes('CHAT_NOT_MODIFIED') ||
      errStr.includes('Bad Request')
    ) {
      log.warn('Cannot set reaction (permission or API limitation)', { chatId, messageId, error: errStr });
      return false;
    }
    log.warn('Failed to set ack reaction', { chatId, messageId, error: errStr });
    return false;
  }
}

/**
 * Remove the ack reaction after response is sent. Safe to call — catches all errors.
 * Reaction removal failure must never block message delivery.
 */
export async function removeAckReaction(bot: TelegramBotLike, chatId: string, messageId: number): Promise<void> {
  try {
    await bot.api.setMessageReaction(chatId, messageId, []);
    log.debug('Removed ack reaction', { chatId, messageId });
  } catch (error) {
    // Always fail silently — reaction removal must never block response delivery
    log.debug('Failed to remove ack reaction (non-blocking)', { chatId, messageId, error: String(error) });
  }
}
