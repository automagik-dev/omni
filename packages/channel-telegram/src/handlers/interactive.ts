/**
 * Interactive UI handlers for Telegram
 */

import { createLogger } from '@omni/core';
import type { Bot } from 'grammy';
import type { Poll, PollAnswer } from 'grammy/types';
import type { TelegramPlugin } from '../plugin';
import { buildDisplayName, toPlatformUserId } from '../utils/identity';

const log = createLogger('telegram:interactive');

export function setupInteractiveHandlers(bot: Bot, plugin: TelegramPlugin, instanceId: string): void {
  bot.on('callback_query:data', async (ctx) => {
    const cb = ctx.callbackQuery;
    if (!cb || !('data' in cb)) return;

    try {
      await bot.api.answerCallbackQuery(cb.id);
    } catch (error) {
      log.debug('Failed to answer callback query', { instanceId, error: String(error) });
    }

    const from = cb.from;
    if (!from || from.is_bot) return;

    const fromId = toPlatformUserId(from.id);
    const messageId = cb.message && 'message_id' in cb.message ? String(cb.message.message_id) : undefined;
    const chatId = cb.message && 'chat' in cb.message ? String(cb.message.chat.id) : undefined;

    await plugin.handleButtonClick({
      instanceId,
      callbackQueryId: cb.id,
      messageId,
      chatId,
      from: fromId,
      text: undefined,
      data: cb.data,
      rawPayload: {
        callbackQuery: cb,
        username: from.username,
        displayName: buildDisplayName(from),
      },
    });
  });

  bot.on('poll', async (ctx) => {
    const poll = ctx.poll as Poll;
    if (!poll) return;

    await plugin.handlePoll({
      instanceId,
      pollId: poll.id,
      question: poll.question,
      options: poll.options.map((o) => o.text),
      multiSelect: poll.allows_multiple_answers,
      rawPayload: { poll },
    });
  });

  bot.on('poll_answer', async (ctx) => {
    const answer = ctx.pollAnswer as PollAnswer;
    if (!answer) return;

    const user = answer.user;
    if (!user || user.is_bot) return;

    await plugin.handlePollVote({
      instanceId,
      pollId: answer.poll_id,
      from: toPlatformUserId(user.id),
      optionIds: answer.option_ids,
      rawPayload: { pollAnswer: answer },
    });
  });

  log.info('Interactive handlers set up', { instanceId });
}
