/**
 * Text message sender for Telegram
 */

import { createLogger } from '@omni/core';
import type { Bot } from 'grammy';
import { splitHtmlMessage, splitMessage } from '../utils/formatting';
import { markdownToTelegramHtml } from '../utils/markdown-to-html';

const log = createLogger('telegram:sender:text');

export type MessageFormatMode = 'convert' | 'passthrough';

/**
 * Send a text message to a Telegram chat
 */
export async function sendTextMessage(
  bot: Bot,
  chatId: string,
  text: string,
  replyToMessageId?: number,
  formatMode: MessageFormatMode = 'convert',
): Promise<number> {
  const useConversion = formatMode !== 'passthrough';
  const payload = useConversion ? markdownToTelegramHtml(text) : text;
  const chunks = useConversion ? splitHtmlMessage(payload) : splitMessage(payload);

  let lastMessageId = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] ?? '';
    const result = await bot.api.sendMessage(chatId, chunk, {
      ...(useConversion ? { parse_mode: 'HTML' as const } : {}),
      // Only reply to original for first chunk
      ...(i === 0 && replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
    });
    lastMessageId = result.message_id;
  }

  log.debug('Sent text message', {
    chatId,
    chunks: chunks.length,
    messageId: lastMessageId,
    formatMode,
  });
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
