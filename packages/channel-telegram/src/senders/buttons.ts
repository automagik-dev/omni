/**
 * Inline button sender for Telegram (InlineKeyboard)
 */

import { createLogger } from '@omni/core';
import type { TelegramBotLike } from '../grammy-shim';
import { markdownToTelegramHtml } from '../utils/markdown-to-html';
import { sendTextMessage } from './text';

const log = createLogger('telegram:sender:buttons');

export type TelegramInlineButton = {
  text: string;
  data?: string;
  url?: string;
};

function buildInlineKeyboard(buttons: TelegramInlineButton[]) {
  // Avoid importing grammy types; just build the raw reply_markup shape.
  // Telegram expects: { inline_keyboard: [[{text, callback_data|url}, ...]] }
  const row = buttons
    .map((b) => {
      if (b.url) return { text: b.text, url: b.url };
      return { text: b.text, callback_data: b.data ?? b.text };
    })
    // Filter any invalid entries
    .filter((b) => typeof b.text === 'string' && (typeof (b as { url?: string }).url === 'string' || true));

  return { inline_keyboard: [row] };
}

/**
 * Sends a message with inline buttons.
 *
 * Telegram requires a text for `sendMessage` when attaching an inline keyboard.
 */
export async function sendInlineButtons(
  bot: TelegramBotLike,
  chatId: string,
  text: string,
  buttons: TelegramInlineButton[],
  replyToMessageId?: number,
  formatMode: 'convert' | 'passthrough' = 'convert',
  options?: Record<string, unknown>,
): Promise<number> {
  if (!buttons.length) {
    return sendTextMessage(bot, chatId, text, replyToMessageId, formatMode, options);
  }

  // Keep formatting behavior consistent with sendTextMessage.
  // For now, no splitting when buttons present (Telegram inline keyboards apply per message).
  //
  // Convert markdown → Telegram HTML, consistent with sendTextMessage behaviour.
  const useConversion = formatMode !== 'passthrough';
  const payloadText = useConversion ? markdownToTelegramHtml(text || ' ') : text || ' ';

  const result = await bot.api.sendMessage(chatId, payloadText, {
    ...(formatMode !== 'passthrough' ? { parse_mode: 'HTML' as const } : {}),
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
    reply_markup: buildInlineKeyboard(buttons),
    ...(options ?? {}),
  });

  log.debug('Sent inline buttons', { chatId, messageId: result.message_id, buttons: buttons.length });
  return result.message_id;
}
