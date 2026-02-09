/**
 * Text message sender for Telegram
 */

import { createLogger } from '@omni/core';
import type { Bot } from 'grammy';
import { splitMessage } from '../utils/formatting';

const log = createLogger('telegram:sender:text');

/**
 * Send a text message to a Telegram chat
 */
export async function sendTextMessage(
  bot: Bot,
  chatId: string,
  text: string,
  replyToMessageId?: number,
): Promise<number> {
  const chunks = splitMessage(text);

  let lastMessageId = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] ?? '';
    const result = await bot.api.sendMessage(chatId, chunk, {
      // Only reply to original for first chunk
      ...(i === 0 && replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
    });
    lastMessageId = result.message_id;
  }

  log.debug('Sent text message', { chatId, chunks: chunks.length, messageId: lastMessageId });
  return lastMessageId;
}

/**
 * Edit a text message
 */
export async function editTextMessage(bot: Bot, chatId: string, messageId: number, newText: string): Promise<void> {
  await bot.api.editMessageText(chatId, messageId, newText);
  log.debug('Edited text message', { chatId, messageId });
}

/**
 * Delete a message
 */
export async function deleteMessage(bot: Bot, chatId: string, messageId: number): Promise<void> {
  await bot.api.deleteMessage(chatId, messageId);
  log.debug('Deleted message', { chatId, messageId });
}
