/**
 * Interactive UI handlers for Telegram
 */

import { createLogger } from '@omni/core';
import type { TelegramBotLike } from '../grammy-shim';
import type { TelegramPlugin } from '../plugin';
import { buildDisplayName, toPlatformUserId } from '../utils/identity';

const log = createLogger('telegram:interactive');

type CallbackQueryDataLike = {
  id: string;
  data?: string;
  from?: { id: number; is_bot: boolean; username?: string; first_name: string; last_name?: string };
  message?: { message_id?: number; chat?: { id: number } };
};

function getCallbackQueryData(ctx: unknown): CallbackQueryDataLike | null {
  const cbUnknown = (ctx as { callbackQuery?: unknown }).callbackQuery;
  if (!cbUnknown || typeof cbUnknown !== 'object') return null;

  const cb = cbUnknown as CallbackQueryDataLike;
  if (!cb.data) return null;
  return cb;
}

async function safeAnswerCallbackQuery(
  bot: TelegramBotLike,
  instanceId: string,
  callbackQueryId: string,
): Promise<void> {
  try {
    await bot.api.answerCallbackQuery(callbackQueryId);
  } catch (error) {
    log.debug('Failed to answer callback query', { instanceId, error: String(error) });
  }
}

export function setupInteractiveHandlers(bot: TelegramBotLike, plugin: TelegramPlugin, instanceId: string): void {
  bot.on('callback_query:data', async (ctx) => {
    const cb = getCallbackQueryData(ctx);
    if (!cb) return;

    await safeAnswerCallbackQuery(bot, instanceId, cb.id);

    const from = cb.from;
    if (!from || from.is_bot) return;

    const fromId = toPlatformUserId(from.id);
    const messageId = cb.message?.message_id ? String(cb.message.message_id) : undefined;
    const chatId = cb.message?.chat?.id ? String(cb.message.chat.id) : undefined;

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
    const poll = (ctx as { poll?: unknown }).poll as
      | {
          id: string;
          question: string;
          options: Array<{ text: string }>;
          allows_multiple_answers: boolean;
        }
      | undefined;
    if (!poll) return;

    try {
      await plugin.handlePoll({
        instanceId,
        pollId: poll.id,
        question: poll.question,
        options: poll.options.map((o) => o.text),
        multiSelect: poll.allows_multiple_answers,
        rawPayload: { poll },
      });
    } catch (error) {
      log.error('Failed to handle poll', { instanceId, pollId: poll.id, error: String(error) });
    }
  });

  bot.on('poll_answer', async (ctx) => {
    const answer = (ctx as { pollAnswer?: unknown }).pollAnswer as
      | {
          poll_id: string;
          user: { id: number; is_bot: boolean };
          option_ids: number[];
        }
      | undefined;
    if (!answer) return;

    const user = answer.user;
    if (!user || user.is_bot) return;

    try {
      await plugin.handlePollVote({
        instanceId,
        pollId: answer.poll_id,
        from: toPlatformUserId(user.id),
        optionIds: answer.option_ids,
        rawPayload: { pollAnswer: answer },
      });
    } catch (error) {
      log.error('Failed to handle poll answer', { instanceId, pollId: answer.poll_id, error: String(error) });
    }
  });

  log.info('Interactive handlers set up', { instanceId });
}
