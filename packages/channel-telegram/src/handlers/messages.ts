/**
 * Message event handlers for Telegram bot
 *
 * Handles incoming messages (text, media, stickers, etc.)
 * and converts them to Omni message.received events.
 */

import { createLogger } from '@omni/core';
import type { TelegramBotLike, TelegramMessageLike } from '../grammy-shim';
import type { TelegramPlugin } from '../plugin';
import { buildDisplayName, toPlatformUserId } from '../utils/identity';
import { tryDownloadTelegramMedia } from '../utils/media-download';
import { extractTelegramMessageContent } from './extract-content';

const log = createLogger('telegram:messages');

/**
 * Check if a message contains a bot mention
 */
function hasBotMention(msg: TelegramMessageLike, botUsername: string): boolean {
  if (!msg.entities) return false;

  return msg.entities.some((entity) => {
    if (entity.type !== 'mention') return false;
    const mentionText = msg.text?.substring(entity.offset, entity.offset + entity.length);
    return mentionText === `@${botUsername}`;
  });
}

async function downloadIfMedia(params: {
  bot: TelegramBotLike;
  instanceId: string;
  externalId: string;
  content: ReturnType<typeof extractTelegramMessageContent>;
}): Promise<{ localPath: string } | null> {
  const { bot, instanceId, externalId, content } = params;
  if (!content.mediaFileId) return null;
  if (content.type === 'text') return null;

  return tryDownloadTelegramMedia({
    bot,
    instanceId,
    externalId,
    fileId: content.mediaFileId,
    mimeType: content.mimeType,
    filename: content.filename,
  });
}

function buildChatName(msg: TelegramMessageLike, displayName: string): string | undefined {
  return ('title' in msg.chat ? msg.chat.title : undefined) || (msg.chat.type === 'private' ? displayName : undefined);
}

/**
 * Set up message handlers for a grammy Bot
 */
export function setupMessageHandlers(bot: TelegramBotLike, plugin: TelegramPlugin, instanceId: string): void {
  bot.on('message', async (ctx) => {
    const msg = (ctx as { message: TelegramMessageLike }).message;
    const from = msg.from;

    // Skip messages from bots (including self)
    if (!from || from.is_bot) return;

    const chatId = String(msg.chat.id);
    const userId = toPlatformUserId(from.id);
    const externalId = String(msg.message_id);
    const displayName = buildDisplayName(from);

    const content = extractTelegramMessageContent(msg);
    const replyToId = msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined;

    const botInfo = bot.botInfo;
    const isMention = botInfo?.username ? hasBotMention(msg, botInfo.username) : false;

    log.debug('Received message', {
      instanceId,
      chatId,
      from: userId,
      type: content.type,
      chatType: msg.chat.type,
      isMention,
    });

    const platformTimestamp = msg.date * 1000;

    const local = await downloadIfMedia({ bot, instanceId, externalId, content });

    await plugin.handleMessageReceived(
      instanceId,
      externalId,
      chatId,
      userId,
      {
        type: content.type,
        text: content.text,
        mediaUrl: content.mediaFileId,
        localPath: local?.localPath,
        mimeType: content.mimeType,
        isVoiceNote: content.isVoiceNote,
      },
      replyToId,
      {
        chatType: msg.chat.type,
        username: from.username,
        isMention,
        mediaFileId: content.mediaFileId,
        filename: content.filename,
        localPath: local?.localPath,

        // Cross-channel rawPayload contract
        displayName,
        pushName: displayName,
        chatName: buildChatName(msg, displayName),
        isGroup: msg.chat.type === 'group' || msg.chat.type === 'supergroup',
        isDM: msg.chat.type === 'private',
        isForwarded: !!msg.forward_origin,
      },
      platformTimestamp,
    );
  });

  bot.on('edited_message', async (ctx) => {
    const msg = (ctx as { editedMessage?: TelegramMessageLike }).editedMessage;
    if (!msg) return;

    const from = msg.from;
    if (!from || from.is_bot) return;

    const chatId = String(msg.chat.id);
    const userId = toPlatformUserId(from.id);
    const externalId = String(msg.message_id);

    const content = extractTelegramMessageContent(msg);

    log.debug('Received edited message', { instanceId, chatId, externalId });

    const displayName = buildDisplayName(from);
    const local = await downloadIfMedia({ bot, instanceId, externalId, content });

    await plugin.handleMessageReceived(
      instanceId,
      externalId,
      chatId,
      userId,
      {
        type: content.type,
        text: content.text,
        mediaUrl: content.mediaFileId,
        localPath: local?.localPath,
        mimeType: content.mimeType,
        isVoiceNote: content.isVoiceNote,
      },
      undefined,
      {
        chatType: msg.chat.type,
        username: from.username,
        displayName,
        pushName: displayName,
        chatName: buildChatName(msg, displayName),
        isGroup: msg.chat.type === 'group' || msg.chat.type === 'supergroup',
        isDM: msg.chat.type === 'private',
        isEdited: true,
        editDate: (msg.edit_date ?? msg.date) * 1000,
        mediaFileId: content.mediaFileId,
        filename: content.filename,
        localPath: local?.localPath,
      },
      (msg.edit_date ?? msg.date) * 1000,
    );
  });

  log.info('Message handlers set up', { instanceId });
}
