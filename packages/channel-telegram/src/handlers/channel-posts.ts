/**
 * Telegram channel post handlers
 *
 * Handles broadcast channel posts (channel_post / edited_channel_post)
 * and converts them to Omni message.received events.
 */

import { createLogger } from '@omni/core';
import type { TelegramBotLike, TelegramMessageLike } from '../grammy-shim';
import type { TelegramPlugin } from '../plugin';
import { extractTelegramMessageContent } from './extract-content';

const log = createLogger('telegram:channel-posts');

function getFromId(msg: TelegramMessageLike): string {
  // Channel posts often do not have `from`; use sender_chat or chat as stable id.
  return String(msg.sender_chat?.id ?? msg.chat.id);
}

export function setupChannelPostHandlers(bot: TelegramBotLike, plugin: TelegramPlugin, instanceId: string): void {
  bot.on('channel_post', async (ctx) => {
    const msg = (ctx as { channelPost?: TelegramMessageLike }).channelPost;
    if (!msg) return;

    const chatId = String(msg.chat.id);
    const externalId = String(msg.message_id);
    const fromId = getFromId(msg);
    const threadId = msg.message_thread_id;
    const content = extractTelegramMessageContent(msg);
    const replyToId = msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined;

    log.debug('Received channel post', { instanceId, chatId, externalId, threadId });

    await plugin.handleMessageReceived(
      instanceId,
      externalId,
      chatId,
      fromId,
      {
        type: content.type,
        text: content.text ?? '[Channel post]',
        mediaUrl: content.mediaFileId,
        mimeType: content.mimeType,
      },
      replyToId,
      {
        chatType: msg.chat.type,
        threadId,
        messageThreadId: threadId,
        isChannelPost: true,
        isGroup: false,
        isDM: false,
        mediaFileId: content.mediaFileId,
        filename: content.filename,
        displayName: msg.chat.title,
        pushName: msg.chat.title,
        chatName: msg.chat.title,
      },
      msg.date * 1000,
    );
  });

  bot.on('edited_channel_post', async (ctx) => {
    const msg = (ctx as { editedChannelPost?: TelegramMessageLike }).editedChannelPost;
    if (!msg) return;

    const chatId = String(msg.chat.id);
    const externalId = String(msg.message_id);
    const fromId = getFromId(msg);
    const threadId = msg.message_thread_id;
    const content = extractTelegramMessageContent(msg);
    const replyToId = msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined;

    log.debug('Received edited channel post', { instanceId, chatId, externalId, threadId });

    const ts = (msg.edit_date ?? msg.date) * 1000;

    await plugin.handleMessageReceived(
      instanceId,
      externalId,
      chatId,
      fromId,
      {
        type: content.type,
        text: content.text ?? '[Channel post]',
        mediaUrl: content.mediaFileId,
        mimeType: content.mimeType,
      },
      replyToId,
      {
        chatType: msg.chat.type,
        threadId,
        messageThreadId: threadId,
        isChannelPost: true,
        isEdited: true,
        editDate: ts,
        isGroup: false,
        isDM: false,
        mediaFileId: content.mediaFileId,
        filename: content.filename,
        displayName: msg.chat.title,
        pushName: msg.chat.title,
        chatName: msg.chat.title,
      },
      ts,
    );
  });

  log.info('Channel post handlers set up', { instanceId });
}
