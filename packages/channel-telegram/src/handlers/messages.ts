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
import type { MediaGroupResult } from './media-group';

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
  const level = (options?.telegramReactionLevel as string) ?? 'off';
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

  // --- Reaction levels: remove ack reaction in finally so it always runs ---
  try {
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
  } finally {
    // Always remove the ack reaction — even if processing throws
    if (didSetAck) {
      await removeAckReaction(bot, chatId, msg.message_id);
    }
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
export function setupMessageHandlers(bot: TelegramBotLike, plugin: TelegramPlugin, instanceId: string): () => void {
  const chatQueue = getChatQueue(instanceId);

  // Deferred flush signals: mediaGroupId → resolver.
  // When the first album message arrives we immediately reserve a chatQueue slot
  // via a Promise. The flush callback resolves it, unblocking the queued task.
  // This keeps FIFO ordering: non-album messages that arrive during the 500ms
  // buffer window are enqueued AFTER the album's reserved slot.
  const pendingFlushes = new Map<string, (result: MediaGroupResult) => void>();

  // Process a fully-buffered album result: downloads + handleMessageReceived.
  // Called from inside the chatQueue task (not from the flush callback directly).
  async function processAlbumResult(result: MediaGroupResult): Promise<void> {
    const first = result.messages[0];
    if (!first) return;

    // Download media for all album messages concurrently at flush time.
    // This happens here (not before buffering) so that the 500ms window
    // starts on message arrival rather than after each download finishes.
    await Promise.all(
      result.messages.map(async (albumMsg) => {
        if (!albumMsg.content.mediaFileId) return;
        const local = await tryDownloadTelegramMedia({
          bot,
          instanceId,
          externalId: albumMsg.externalId,
          fileId: albumMsg.content.mediaFileId,
          mimeType: albumMsg.content.mimeType,
          filename: albumMsg.content.filename,
        });
        if (local) {
          albumMsg.content.localPath = local.localPath;
        }
      }),
    );

    // Rebuild mediaRefs with the now-populated localPaths
    const mediaRefs = result.messages
      .filter((m) => m.content.mediaFileId || m.content.mediaUrl)
      .map((m) => ({
        type: m.content.type,
        mediaFileId: m.content.mediaFileId,
        mediaUrl: m.content.mediaUrl,
        mimeType: m.content.mimeType,
        localPath: m.content.localPath,
        filename: m.content.filename,
      }));

    await plugin.handleMessageReceived(
      instanceId,
      first.externalId,
      first.chatId,
      first.from,
      {
        // Derive content type from the actual first media item, not a hardcoded 'image'
        type: first.content.type || 'image',
        text: result.combinedCaption || undefined,
        mediaUrl: mediaRefs[0]?.mediaFileId ?? mediaRefs[0]?.mediaUrl,
        localPath: first.content.localPath,
        mimeType: mediaRefs[0]?.mimeType,
      },
      first.replyToId,
      {
        ...first.rawPayload,
        isAlbum: true,
        mediaGroupId: result.mediaGroupId,
        albumSize: result.messages.length,
        mediaRefs,
        combinedCaption: result.combinedCaption,
        mediaLocalPath: first.content.localPath,
      },
      first.platformTimestamp,
    );
  }

  // Media group buffer — resolves the deferred flush signal so the chatQueue
  // task that was reserved on first arrival can proceed with processing.
  const mediaGroupBuffer = new MediaGroupBuffer(async (result) => {
    const resolve = pendingFlushes.get(result.mediaGroupId);
    if (resolve) {
      pendingFlushes.delete(result.mediaGroupId);
      resolve(result); // Unblocks the waiting chatQueue task
    } else {
      // Safety fallback — shouldn't happen in normal flow
      await processAlbumResult(result);
    }
  });

  // Buffer an album message and reserve a chatQueue slot on its first arrival.
  // Extracted to keep the bot.on('message') handler below complexity limits.
  // Caller must have already verified from and mediaGroupId are non-null.
  function bufferAlbumMessage(
    msg: TelegramMessageLike,
    from: NonNullable<TelegramMessageLike['from']>,
    mediaGroupId: string,
    chatId: string,
    threadId: string | undefined,
  ): void {
    const userId = toPlatformUserId(from.id);
    const externalId = String(msg.message_id);
    const displayName = buildDisplayName(from);
    const content = extractTelegramMessageContent(msg);
    const botInfo = bot.botInfo;
    const isMention = botInfo?.username ? hasBotMention(msg, botInfo.username) : false;

    const isNewGroup = !pendingFlushes.has(mediaGroupId);

    // Add to buffer immediately — before any I/O — so the 500ms album window
    // starts on message arrival and groups all album parts regardless of
    // individual download latency. Downloads happen in processAlbumResult.
    mediaGroupBuffer.add(mediaGroupId, {
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
        localPath: undefined, // Populated in processAlbumResult
        filename: content.filename,
      },
      replyToId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
      rawPayload: {
        chatType: msg.chat.type,
        username: from.username,
        isMention,
        mediaFileId: content.mediaFileId,
        filename: content.filename,
        mediaLocalPath: undefined, // Populated in processAlbumResult
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

    if (isNewGroup) {
      // Reserve a slot in the sequential queue immediately on the first album
      // message. Non-album messages arriving in the same chat during the 500ms
      // buffer window will chain after this slot, preserving FIFO order.
      // ChatQueue.enqueue() updates the chain synchronously, so we don't await.
      const key = getSessionKey(chatId, threadId);
      let flushResolve!: (result: MediaGroupResult) => void;
      const flushPromise = new Promise<MediaGroupResult>((resolve) => {
        flushResolve = resolve;
      });
      pendingFlushes.set(mediaGroupId, flushResolve);
      chatQueue
        .enqueue(key, () => flushPromise.then(processAlbumResult))
        .catch((err) => {
          log.error('Album flush processing failed', { mediaGroupId, error: String(err) });
        });
    }
  }

  bot.on('message', async (ctx) => {
    const msg = (ctx as { message: TelegramMessageLike }).message;
    const from = msg.from;

    // Skip messages from bots (including self)
    if (!from || from.is_bot) return;

    const chatId = String(msg.chat.id);
    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : undefined;

    // --- Media group buffering: batch album messages ---
    if (msg.media_group_id) {
      bufferAlbumMessage(msg, from, msg.media_group_id, chatId, threadId);
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

    // Edited messages go through the sequential queue.
    // Enqueue BEFORE downloading so arrival order determines processing order,
    // not download latency (a faster download of a later edit must not race ahead).
    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : undefined;
    const key = getSessionKey(chatId, threadId);

    await chatQueue.enqueue(key, async () => {
      const local = await downloadIfMedia({ bot, instanceId, externalId, content });
      return plugin.handleMessageReceived(
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
      );
    });
  });

  log.info('Message handlers set up', { instanceId, integrations: ['reactions', 'media-group', 'sequential-queue'] });

  return () => {
    mediaGroupBuffer.destroy();
    pendingFlushes.clear();
  };
}
