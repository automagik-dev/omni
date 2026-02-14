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

/**
 * Set up message handlers for a grammy Bot
 */
export function setupMessageHandlers(bot: TelegramBotLike, plugin: TelegramPlugin, instanceId: string): void {
  // Handle all message types
  bot.on('message', async (ctx) => {
    const msg = (ctx as { message: TelegramMessageLike }).message;
    const from = msg.from;

    // Skip messages from bots (including self)
    if (from?.is_bot) return;
    if (!from) return;

    const chatId = String(msg.chat.id);
    const userId = toPlatformUserId(from.id);
    const externalId = String(msg.message_id);
    const displayName = buildDisplayName(from);

    const content = extractTelegramMessageContent(msg);
    const replyToId = msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined;

    // Check for bot mention
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

    // T0: Telegram `message.date` is in seconds since epoch → × 1000
    const platformTimestamp = msg.date * 1000;

    await plugin.handleMessageReceived(
      instanceId,
      externalId,
      chatId,
      userId,
      {
        type: content.type,
        text: content.text,
        mediaUrl: content.mediaFileId, // Will be resolved to URL by media processor
        mimeType: content.mimeType,
      },
      replyToId,
      {
        // Telegram-specific fields
        chatType: msg.chat.type,
        username: from.username,
        isMention,
        mediaFileId: content.mediaFileId,
        filename: content.filename,

        // Cross-channel rawPayload contract (used by message-persistence, agent-dispatcher, agent-responder)
        displayName,
        pushName: displayName,
        chatName:
          ('title' in msg.chat ? msg.chat.title : undefined) || (msg.chat.type === 'private' ? displayName : undefined),
        isGroup: msg.chat.type === 'group' || msg.chat.type === 'supergroup',
        isDM: msg.chat.type === 'private',
        isForwarded: !!msg.forward_origin,
      },
      platformTimestamp,
    );
  });

  // Handle edited messages
  bot.on('edited_message', async (ctx) => {
    const msg = (ctx as { editedMessage?: TelegramMessageLike }).editedMessage;
    if (!msg) return;
    const from = msg.from;
    if (!from || from.is_bot) return;

    const chatId = String(msg.chat.id);
    const userId = toPlatformUserId(from.id);
    const externalId = String(msg.message_id);
    const text = msg.text ?? msg.caption ?? '';

    log.debug('Received edited message', { instanceId, chatId, externalId });

    // Re-emit as a regular message with edited flag in rawPayload
    // This follows the WhatsApp pattern where edits are processed through handleMessageReceived
    const displayName = buildDisplayName(from);
    await plugin.handleMessageReceived(
      instanceId,
      externalId,
      chatId,
      userId,
      {
        type: 'text',
        text,
      },
      undefined,
      {
        chatType: msg.chat.type,
        username: from.username,
        displayName,
        pushName: displayName,
        chatName:
          ('title' in msg.chat ? msg.chat.title : undefined) || (msg.chat.type === 'private' ? displayName : undefined),
        isGroup: msg.chat.type === 'group' || msg.chat.type === 'supergroup',
        isDM: msg.chat.type === 'private',
        isEdited: true,
        editDate: (msg.edit_date ?? msg.date) * 1000,
      },
      (msg.edit_date ?? msg.date) * 1000,
    );
  });

  log.info('Message handlers set up', { instanceId });
}
