/**
 * Telegram channel post handlers
 *
 * Handles broadcast channel posts (channel_post / edited_channel_post)
 * and converts them to Omni message.received events.
 */

import { createLogger } from '@omni/core';
import type { Bot } from 'grammy';
import type { Message } from 'grammy/types';
import type { TelegramPlugin } from '../plugin';

const log = createLogger('telegram:channel-posts');

function extractText(msg: Message): string {
  return msg.text ?? msg.caption ?? '[Channel post]';
}

function getFromId(msg: Message): string {
  // Channel posts often do not have `from`; use sender_chat or chat as stable id.
  const senderChatId = (msg.sender_chat && 'id' in msg.sender_chat ? msg.sender_chat.id : undefined) as
    | number
    | undefined;
  return String(senderChatId ?? msg.chat.id);
}

export function setupChannelPostHandlers(bot: Bot, plugin: TelegramPlugin, instanceId: string): void {
  bot.on('channel_post', async (ctx) => {
    const msg = ctx.channelPost;
    if (!msg) return;

    const chatId = String(msg.chat.id);
    const externalId = String(msg.message_id);
    const fromId = getFromId(msg);
    const threadId = msg.message_thread_id;

    log.debug('Received channel post', { instanceId, chatId, externalId, threadId });

    await plugin.handleMessageReceived(
      instanceId,
      externalId,
      chatId,
      fromId,
      {
        type: 'text',
        text: extractText(msg),
      },
      undefined,
      {
        chatType: msg.chat.type,
        threadId,
        messageThreadId: threadId,
        isChannelPost: true,
        isGroup: false,
        isDM: false,
        chatName: 'title' in msg.chat ? msg.chat.title : undefined,
      },
      msg.date * 1000,
    );
  });

  bot.on('edited_channel_post', async (ctx) => {
    const msg = ctx.editedChannelPost;
    if (!msg) return;

    const chatId = String(msg.chat.id);
    const externalId = String(msg.message_id);
    const fromId = getFromId(msg);
    const threadId = msg.message_thread_id;

    log.debug('Received edited channel post', { instanceId, chatId, externalId, threadId });

    const ts = (msg.edit_date ?? msg.date) * 1000;

    await plugin.handleMessageReceived(
      instanceId,
      externalId,
      chatId,
      fromId,
      {
        type: 'text',
        text: extractText(msg),
      },
      undefined,
      {
        chatType: msg.chat.type,
        threadId,
        messageThreadId: threadId,
        isChannelPost: true,
        isEdited: true,
        editDate: ts,
        isGroup: false,
        isDM: false,
        chatName: 'title' in msg.chat ? msg.chat.title : undefined,
      },
      ts,
    );
  });

  log.info('Channel post handlers set up', { instanceId });
}
