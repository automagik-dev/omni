/**
 * Message event handlers for Discord client
 *
 * Handles incoming messages and converts them to Omni format.
 * Supports all Discord message types including:
 * - Basic: text, image, audio, video, document
 * - Interactive: sticker, poll
 * - Operations: edit, delete
 */

import { createLogger } from '@omni/core';
import type { ContentType } from '@omni/core/types';
import { ChannelType, type Client, type Message, type PartialMessage } from 'discord.js';
import type { DiscordPlugin } from '../plugin';
import type { ExtractedContent } from '../types';

const log = createLogger('discord:messages');

/**
 * Extract poll content from message
 */
function extractPollContent(message: Message): ExtractedContent | null {
  if (!message.poll) return null;

  const questionText = message.poll.question.text ?? '';
  return {
    type: 'poll',
    text: questionText,
    poll: {
      question: questionText,
      answers: message.poll.answers.map((a) => a.text ?? '').filter((t): t is string => Boolean(t)),
      multiSelect: message.poll.allowMultiselect,
      expiresAt: message.poll.expiresAt ?? undefined,
    },
  };
}

/**
 * Determine media type from MIME type
 */
function getMediaType(contentType: string): 'image' | 'audio' | 'video' | 'document' {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('video/')) return 'video';
  return 'document';
}

/**
 * Extract attachment content from message
 */
function extractAttachmentContent(message: Message): ExtractedContent | null {
  if (message.attachments.size === 0) return null;

  const attachment = message.attachments.first();
  if (!attachment) return null;

  const contentType = attachment.contentType ?? 'application/octet-stream';
  const mediaType = getMediaType(contentType);

  const base: ExtractedContent = {
    type: mediaType,
    mediaUrl: attachment.url,
    mimeType: contentType,
    filename: attachment.name ?? undefined,
    size: attachment.size,
  };

  // Add duration for audio/video
  if ((mediaType === 'audio' || mediaType === 'video') && attachment.duration !== null) {
    base.duration = attachment.duration;
  }

  // Add caption for non-audio types
  if (mediaType !== 'audio' && message.content) {
    base.text = message.content;
  }

  return base;
}

/**
 * Extract sticker content from message
 */
function extractStickerContent(message: Message): ExtractedContent | null {
  if (message.stickers.size === 0) return null;

  const sticker = message.stickers.first();
  if (!sticker) return null;

  return {
    type: 'sticker',
    stickerId: sticker.id,
    text: sticker.name,
    mediaUrl: sticker.url,
  };
}

/**
 * Extract text or embed content from message
 */
function extractTextContent(message: Message): ExtractedContent | null {
  if (message.content) {
    return { type: 'text', text: message.content };
  }

  if (message.embeds.length > 0) {
    const embed = message.embeds[0];
    return {
      type: 'text',
      text: embed?.description || embed?.title || '[Embed]',
    };
  }

  return null;
}

/**
 * Extract content from a Discord message
 */
function extractContent(message: Message): ExtractedContent | null {
  // Try each content type in priority order
  return (
    extractPollContent(message) ||
    extractAttachmentContent(message) ||
    extractStickerContent(message) ||
    extractTextContent(message)
  );
}

/**
 * Get the reply-to message ID if this is a reply
 */
function getReplyToId(message: Message): string | undefined {
  return message.reference?.messageId ?? undefined;
}

/**
 * Check if message should be processed
 */
function shouldProcessMessage(message: Message): boolean {
  // Skip bot messages (including self)
  if (message.author.bot) {
    return false;
  }

  // Skip system messages
  if (message.system) {
    return false;
  }

  return true;
}

/**
 * Determine if message is a DM
 */
function isDM(message: Message): boolean {
  return message.channel.type === ChannelType.DM;
}

/**
 * Process a single message
 */
async function processMessage(plugin: DiscordPlugin, instanceId: string, message: Message): Promise<void> {
  const content = extractContent(message);
  if (!content) {
    log.debug('Skipping message with no extractable content', {
      instanceId,
      messageId: message.id,
    });
    return;
  }

  const chatId = message.channel.id;
  const from = message.author.id;
  const replyToId = getReplyToId(message);

  // Resolve chat name: channel name for servers, recipient name for DMs
  const isDMChannel = isDM(message);
  const chatName = isDMChannel
    ? message.author.displayName || message.author.globalName || message.author.username
    : 'name' in message.channel
      ? (message.channel.name ?? undefined)
      : undefined;

  // Build extended content for raw payload
  const extendedPayload: Record<string, unknown> = {
    messageId: message.id,
    channelId: chatId,
    guildId: message.guild?.id,
    authorId: from,
    authorTag: message.author.tag,
    // displayName is used by agent-responder for sender name prefixing
    displayName: message.author.displayName || message.author.globalName || message.author.username,
    // pushName + chatName used by message-persistence for chat name and message preview
    pushName: message.author.displayName || message.author.globalName || message.author.username,
    chatName,
    isGroup: !isDMChannel,
    createdAt: message.createdTimestamp,
    isDM: isDMChannel,
    hasEmbeds: message.embeds.length > 0,
    hasAttachments: message.attachments.size > 0,
    hasStickers: message.stickers.size > 0,
    mentions: {
      users: Array.from(message.mentions.users.keys()),
      roles: Array.from(message.mentions.roles.keys()),
      channels: Array.from(message.mentions.channels.keys()),
      everyone: message.mentions.everyone,
    },
  };

  // Add thread info if applicable
  if (message.thread) {
    extendedPayload.threadId = message.thread.id;
    extendedPayload.threadName = message.thread.name;
  }

  await plugin.handleMessageReceived(
    instanceId,
    message.id, // externalId
    chatId,
    from,
    {
      type: content.type as ContentType,
      text: content.text,
      mediaUrl: content.mediaUrl,
      mimeType: content.mimeType,
    },
    replyToId,
    extendedPayload,
  );
}

/**
 * Process message update (edit)
 */
async function processMessageUpdate(
  plugin: DiscordPlugin,
  instanceId: string,
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
): Promise<void> {
  // Skip if content didn't change (could be embed loading, etc.)
  if (oldMessage.content === newMessage.content) {
    return;
  }

  // Skip bot messages
  if (newMessage.author?.bot) {
    return;
  }

  const newText = newMessage.content ?? '';
  const chatId = newMessage.channel.id;
  const messageId = newMessage.id;

  await plugin.handleMessageEdited(instanceId, messageId, chatId, newText);
}

/**
 * Process message delete
 */
async function processMessageDelete(
  plugin: DiscordPlugin,
  instanceId: string,
  message: Message | PartialMessage,
): Promise<void> {
  const chatId = message.channel.id;
  const messageId = message.id;
  // We can't reliably know if it was fromMe since the message may be partial
  const fromMe = message.author?.bot === true && message.author?.id === message.client.user?.id;

  await plugin.handleMessageDeleted(instanceId, messageId, chatId, fromMe);
}

/**
 * Set up message event handlers for a Discord client
 *
 * @param client - Discord.js Client instance
 * @param plugin - Discord plugin instance
 * @param instanceId - Instance identifier
 */
export function setupMessageHandlers(client: Client, plugin: DiscordPlugin, instanceId: string): void {
  // New message received
  client.on('messageCreate', async (message) => {
    if (shouldProcessMessage(message)) {
      await processMessage(plugin, instanceId, message);
    }
  });

  // Message edited
  client.on('messageUpdate', async (oldMessage, newMessage) => {
    // Fetch full message if partial
    const fullOld = oldMessage.partial ? await oldMessage.fetch().catch(() => null) : oldMessage;
    const fullNew = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;

    if (fullOld && fullNew) {
      await processMessageUpdate(plugin, instanceId, fullOld, fullNew);
    }
  });

  // Message deleted
  client.on('messageDelete', async (message) => {
    await processMessageDelete(plugin, instanceId, message);
  });

  // Bulk message delete
  client.on('messageDeleteBulk', async (messages) => {
    for (const message of messages.values()) {
      await processMessageDelete(plugin, instanceId, message);
    }
  });
}
