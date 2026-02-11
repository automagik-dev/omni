/**
 * Message event handlers for Telegram bot
 *
 * Handles incoming messages (text, media, stickers, etc.)
 * and converts them to Omni message.received events.
 */

import { createLogger } from '@omni/core';
import type { Bot } from 'grammy';
import type { Message, PhotoSize } from 'grammy/types';
import type { TelegramPlugin } from '../plugin';
import { buildDisplayName, toPlatformUserId } from '../utils/identity';

const log = createLogger('telegram:messages');

/** Extracted message content shape */
interface MessageContent {
  type: string;
  text?: string;
  mediaFileId?: string;
  mimeType?: string;
  filename?: string;
}

/** Extract photo content (picks largest size) */
function extractPhoto(msg: Message): MessageContent | null {
  if (!msg.photo || msg.photo.length === 0) return null;
  const largest = msg.photo.reduce((a: PhotoSize, b: PhotoSize) => ((a.file_size ?? 0) > (b.file_size ?? 0) ? a : b));
  return { type: 'image', text: msg.caption, mediaFileId: largest.file_id, mimeType: 'image/jpeg' };
}

/** Extract media content from audio/voice/video/video_note/document/sticker */
function extractMedia(msg: Message): MessageContent | null {
  if (msg.audio)
    return {
      type: 'audio',
      text: msg.caption,
      mediaFileId: msg.audio.file_id,
      mimeType: msg.audio.mime_type ?? 'audio/mpeg',
      filename: msg.audio.file_name,
    };
  if (msg.voice)
    return {
      type: 'audio',
      text: msg.caption,
      mediaFileId: msg.voice.file_id,
      mimeType: msg.voice.mime_type ?? 'audio/ogg',
    };
  if (msg.video)
    return {
      type: 'video',
      text: msg.caption,
      mediaFileId: msg.video.file_id,
      mimeType: msg.video.mime_type ?? 'video/mp4',
      filename: msg.video.file_name,
    };
  if (msg.video_note) return { type: 'video', mediaFileId: msg.video_note.file_id, mimeType: 'video/mp4' };
  if (msg.document)
    return {
      type: 'document',
      text: msg.caption,
      mediaFileId: msg.document.file_id,
      mimeType: msg.document.mime_type ?? 'application/octet-stream',
      filename: msg.document.file_name,
    };
  if (msg.sticker)
    return {
      type: 'sticker',
      text: msg.sticker.emoji,
      mediaFileId: msg.sticker.file_id,
      mimeType: msg.sticker.is_animated ? 'application/x-tgsticker' : 'image/webp',
    };
  return null;
}

/** Extract special content types (location, contact) */
function extractSpecial(msg: Message): MessageContent | null {
  if (msg.location) return { type: 'location', text: `Location: ${msg.location.latitude}, ${msg.location.longitude}` };
  if (msg.contact) return { type: 'contact', text: `Contact: ${msg.contact.first_name} ${msg.contact.phone_number}` };
  return null;
}

/**
 * Determine content type from a Telegram message
 */
function extractContent(msg: Message): MessageContent {
  if (msg.text) return { type: 'text', text: msg.text };
  return (
    extractPhoto(msg) ??
    extractMedia(msg) ??
    extractSpecial(msg) ?? { type: 'text', text: msg.caption ?? '[Unsupported message type]' }
  );
}

/**
 * Check if a message contains a bot mention
 */
function hasBotMention(msg: Message, botUsername: string): boolean {
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
export function setupMessageHandlers(bot: Bot, plugin: TelegramPlugin, instanceId: string): void {
  // Handle all message types
  bot.on('message', async (ctx) => {
    const msg = ctx.message;
    const from = msg.from;

    // Skip messages from bots (including self)
    if (from?.is_bot) return;
    if (!from) return;

    const chatId = String(msg.chat.id);
    const userId = toPlatformUserId(from.id);
    const externalId = String(msg.message_id);
    const displayName = buildDisplayName(from);

    const content = extractContent(msg);
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

    await plugin.handleMessageReceived(
      instanceId,
      externalId,
      chatId,
      userId,
      {
        type: content.type as 'text',
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
    );
  });

  log.info('Message handlers set up', { instanceId });
}
