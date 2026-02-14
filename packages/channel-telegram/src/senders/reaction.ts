/**
 * Reaction sender for Telegram
 */

import { createLogger } from '@omni/core';
import type { TelegramBotLike } from '../grammy-shim';

const log = createLogger('telegram:sender:reaction');

/**
 * Set a reaction on a message
 *
 * Note: Telegram only supports a fixed set of emoji reactions.
 * If the emoji is not in the allowed set, the API will reject it.
 */
export async function setReaction(
  bot: TelegramBotLike,
  chatId: string,
  messageId: number,
  emoji: string,
): Promise<void> {
  await bot.api.setMessageReaction(chatId, messageId, [{ type: 'emoji', emoji }]);
  log.debug('Set reaction', { chatId, messageId, emoji });
}

/**
 * Remove all reactions from a message (set empty array)
 */
export async function removeReaction(bot: TelegramBotLike, chatId: string, messageId: number): Promise<void> {
  await bot.api.setMessageReaction(chatId, messageId, []);
  log.debug('Removed reaction', { chatId, messageId });
}
