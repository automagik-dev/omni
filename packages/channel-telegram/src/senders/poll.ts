/**
 * Poll sender for Telegram
 */

import { createLogger } from '@omni/core';
import type { TelegramBotLike } from '../grammy-shim';

const log = createLogger('telegram:sender:poll');

export async function sendPoll(
  bot: TelegramBotLike,
  chatId: string,
  poll: {
    question: string;
    options: string[];
    multiSelect?: boolean;
    isAnonymous?: boolean;
  },
  replyToMessageId?: number,
): Promise<number> {
  const question = poll.question;
  const options = poll.options;

  const result = await bot.api.sendPoll(chatId, question, options, {
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
    allows_multiple_answers: poll.multiSelect ?? false,
    is_anonymous: poll.isAnonymous ?? true,
  });

  log.debug('Sent poll', { chatId, messageId: result.message_id, options: options.length });
  return result.message_id;
}
