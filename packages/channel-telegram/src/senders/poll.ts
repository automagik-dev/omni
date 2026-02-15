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
  options?: Record<string, unknown>,
): Promise<number> {
  const question = poll.question;
  const pollOptions = poll.options;

  const result = await bot.api.sendPoll(chatId, question, pollOptions, {
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
    allows_multiple_answers: poll.multiSelect ?? false,
    is_anonymous: poll.isAnonymous ?? true,
    ...(options ?? {}),
  });

  log.debug('Sent poll', { chatId, messageId: result.message_id, options: pollOptions.length });
  return result.message_id;
}
