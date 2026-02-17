/**
 * Message event handlers for Telegram bot
 *
 * Handles incoming messages (text, media, stickers, etc.)
 * and converts them to Omni message.received events.
 *
 * Integration points wired here:
 * - Reaction levels: ack/minimal/extensive reactions on inbound messages
 * - Media group buffering: album photos batched into single agent call
 * - Sequential processing: per-chat message queue prevents race conditions
 */

import { createLogger } from '@omni/core';
import type { TelegramBotLike, TelegramMessageLike } from '../grammy-shim';
import { getChatQueue, getSessionKey } from '../middleware/sequentialize';
import type { TelegramPlugin } from '../plugin';
import type { ReactionLevelConfig } from '../reactions/levels';
import { removeAckReaction, setAckReaction, shouldReact } from '../reactions/levels';
import { buildDisplayName, toPlatformUserId } from '../utils/identity';
import { tryDownloadTelegramMedia } from '../utils/media-download';
import { extractTelegramMessageContent } from './extract-content';
import { MediaGroupBuffer } from './media-group';

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
 * Read the reaction level config from the instance options.
 * Falls back to 'off' if not configured.
 */
function getReactionConfig(plugin: TelegramPlugin, instanceId: string): ReactionLevelConfig {
  const instance = plugin.getInstanceState(instanceId);
  const options = instance?.config?.options;
  const level = (options?.reactionLevel as string) ?? 'off';
  return {
    level: level as ReactionLevelConfig['level'],
    ackEmoji: options?.ackEmoji as string | undefined,
    minimalInterval: options?.minimalInterval as number | undefined,
    extensiveEmojis: options?.extensiveEmojis as string[] | undefined,
  };
}

/**
 * Core message processing logic — extracted so it can be used by both
 * direct processing and media group flush callbacks.
 */
async function processInboundMessage(
  bot: TelegramBotLike,
  plugin: TelegramPlugin,
  instanceId: string,
  msg: TelegramMessageLike,
): Promise<void> {
  const from = msg.from;
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

  // --- Reaction levels: set ack reaction before processing ---
  const reactionConfig = getReactionConfig(plugin, instanceId);
  const reactionEmoji = shouldReact(instanceId, reactionConfig);
  let didSetAck = false;
  if (reactionEmoji && reactionConfig.level === 'ack') {
    didSetAck = await setAckReaction(bot, chatId, msg.message_id, reactionEmoji);
  } else if (reactionEmoji) {
    // minimal/extensive: fire-and-forget reaction (no removal needed)
    setAckReaction(bot, chatId, msg.message_id, reactionEmoji).catch(() => {});
  }

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
      mediaLocalPath: local?.localPath,

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

  // --- Reaction levels: remove ack reaction after response ---
  if (didSetAck) {
    await removeAckReaction(bot, chatId, msg.message_id);
  }
}

/**
 * Set up message handlers for a grammy Bot
 *
 * Integrations:
 * - Sequential queue: messages in the same chat are processed in FIFO order
 * - Media group buffer: album messages batched into single agent call
 * - Reaction levels: ack/minimal/extensive reactions on inbound messages
 */
export function setupMessageHandlers(bot: TelegramBotLike, plugin: TelegramPlugin, instanceId: string): void {
  const chatQueue = getChatQueue(instanceId);

  // Media group buffer — flushes batched album messages as single context
  const mediaGroupBuffer = new MediaGroupBuffer(async (result) => {
    // Process the first message of the album as representative,
    // but include combined caption + media refs in the rawPayload
    const first = result.messages[0];
    if (!first) return;

    const chatId = first.chatId;
    const threadId = first.rawPayload.message_thread_id as string | undefined;
    const key = getSessionKey(chatId, threadId);

    await chatQueue.enqueue(key, async () => {
      await plugin.handleMessageReceived(
        instanceId,
        first.externalId,
        first.chatId,
        first.from,
        {
          type: 'image', // Albums are image-primary
          text: result.combinedCaption || undefined,
          mediaUrl: result.mediaRefs[0]?.mediaFileId ?? result.mediaRefs[0]?.mediaUrl,
          localPath: first.content.localPath,
          mimeType: result.mediaRefs[0]?.mimeType,
        },
        first.replyToId,
        {
          ...first.rawPayload,
          isAlbum: true,
          mediaGroupId: result.mediaGroupId,
          albumSize: result.messages.length,
          mediaRefs: result.mediaRefs,
          combinedCaption: result.combinedCaption,
        },
        first.platformTimestamp,
      );
    });
  });

  bot.on('message', async (ctx) => {
    const msg = (ctx as { message: TelegramMessageLike }).message;
    const from = msg.from;

    // Skip messages from bots (including self)
    if (!from || from.is_bot) return;

    const chatId = String(msg.chat.id);
    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : undefined;

    // --- Media group buffering: batch album messages ---
    if (msg.media_group_id) {
      const userId = toPlatformUserId(from.id);
      const externalId = String(msg.message_id);
      const displayName = buildDisplayName(from);
      const content = extractTelegramMessageContent(msg);
      const botInfo = bot.botInfo;
      const isMention = botInfo?.username ? hasBotMention(msg, botInfo.username) : false;

      const local = await downloadIfMedia({ bot, instanceId, externalId, content });

      mediaGroupBuffer.add(msg.media_group_id, {
        externalId,
        chatId,
        from: userId,
        content: {
          type: content.type,
          text: content.text,
          caption: content.text,
          mediaFileId: content.mediaFileId,
          mediaUrl: content.mediaFileId,
          mimeType: content.mimeType,
          localPath: local?.localPath,
          filename: content.filename,
        },
        replyToId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
        rawPayload: {
          chatType: msg.chat.type,
          username: from.username,
          isMention,
          mediaFileId: content.mediaFileId,
          filename: content.filename,
          mediaLocalPath: local?.localPath,
          displayName,
          pushName: displayName,
          chatName: buildChatName(msg, displayName),
          isGroup: msg.chat.type === 'group' || msg.chat.type === 'supergroup',
          isDM: msg.chat.type === 'private',
          isForwarded: !!msg.forward_origin,
          message_thread_id: threadId,
        },
        platformTimestamp: msg.date * 1000,
        estimatedSize: JSON.stringify(content).length,
      });
      return; // Don't process individually — will be flushed by buffer
    }

    // --- Sequential queue: ensure per-chat ordering ---
    const key = getSessionKey(chatId, threadId);
    await chatQueue.enqueue(key, () => processInboundMessage(bot, plugin, instanceId, msg));
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

    // Edited messages also go through the sequential queue
    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : undefined;
    const key = getSessionKey(chatId, threadId);

    await chatQueue.enqueue(key, () =>
      plugin.handleMessageReceived(
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
          mediaLocalPath: local?.localPath,
        },
        (msg.edit_date ?? msg.date) * 1000,
      ),
    );
  });

  log.info('Message handlers set up', { instanceId, integrations: ['reactions', 'media-group', 'sequential-queue'] });
}
