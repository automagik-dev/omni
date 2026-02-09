/**
 * Reaction sender for Telegram
 */

import { createLogger } from '@omni/core';
import type { Bot } from 'grammy';
import type { ReactionTypeEmoji } from 'grammy/types';

const log = createLogger('telegram:sender:reaction');

/**
 * Set a reaction on a message
 *
 * Note: Telegram only supports a fixed set of emoji reactions.
 * If the emoji is not in the allowed set, the API will reject it.
 */
export async function setReaction(bot: Bot, chatId: string, messageId: number, emoji: string): Promise<void> {
  const reaction: ReactionTypeEmoji = {
    type: 'emoji',
    emoji: emoji as ReactionTypeEmoji['emoji'],
  };
  await bot.api.setMessageReaction(chatId, messageId, [reaction]);
  log.debug('Set reaction', { chatId, messageId, emoji });
}

/**
 * Remove all reactions from a message (set empty array)
 */
export async function removeReaction(bot: Bot, chatId: string, messageId: number): Promise<void> {
  await bot.api.setMessageReaction(chatId, messageId, []);
  log.debug('Removed reaction', { chatId, messageId });
}
