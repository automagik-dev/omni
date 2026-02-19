/**
 * Message event handlers for Discord client
 *
 * Handles incoming messages and converts them to Omni format.
 * Supports all Discord message types including:
 * - Basic: text, image, audio, video, document
 * - Interactive: sticker, poll
 * - Operations: edit, delete
 */

import { createDownloadGuard, createInboundDedupeCache, sanitizeMessage } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';
import type { ContentType } from '@omni/core/types';
import { ChannelType, type Client, type Message, type PartialMessage } from 'discord.js';
import type { DiscordPlugin } from '../plugin';
import type { ExtractedContent } from '../types';
import { type ForwardedAttachment, extractForwardedAttachments } from './forwarded-attachments';

const log = createLogger('discord:messages');

/** Shared dedupe cache for all Discord instances */
const dedupeCache = createInboundDedupeCache();

/** Download size guard — 50MB default */
const downloadGuard = createDownloadGuard();

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

  // Check attachment size before processing
  try {
    downloadGuard.checkSize(attachment.size, log, { channel: 'discord' });
  } catch {
    return null; // Attachment too large — skip
  }

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
 * Try to extract content from forwarded/referenced message attachments.
 * Returns extracted content and attachment metadata if the primary message
 * has no attachments but the referenced message does.
 */
async function tryExtractForwardedContent(
  message: Message,
  primaryContent: ExtractedContent | null,
): Promise<{ content: ExtractedContent | null; attachments: ForwardedAttachment[] }> {
  if (primaryContent?.mediaUrl || message.attachments.size > 0 || !message.reference?.messageId) {
    return { content: null, attachments: [] };
  }

  const attachments = await extractForwardedAttachments(message);
  if (attachments.length === 0) {
    return { content: null, attachments: [] };
  }

  const firstAttachment = attachments[0];
  if (!firstAttachment) {
    return { content: null, attachments };
  }

  // Build content from the attachment metadata — do NOT download the file.
  // The emitted payload carries the CDN URL; downloading just to validate
  // reachability wastes bandwidth and spikes memory for large files.
  const mediaType = getMediaType(firstAttachment.contentType);
  const content: ExtractedContent = {
    type: mediaType,
    mediaUrl: firstAttachment.url,
    mimeType: firstAttachment.contentType,
    filename: firstAttachment.filename,
    size: firstAttachment.size,
    text: primaryContent?.text,
  };

  log.debug('Using forwarded attachment as primary content', {
    messageId: message.id,
    filename: firstAttachment.filename,
    contentType: firstAttachment.contentType,
  });

  return { content, attachments };
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
 * Resolve the display name for a chat/channel.
 * For DMs: user display name. For threads: "parent → thread". For channels: channel name.
 */
function resolveChatName(message: Message, isDMChannel: boolean, isThread: boolean): string | undefined {
  if (isDMChannel) {
    return message.author.displayName || message.author.globalName || message.author.username;
  }
  if (isThread && 'parent' in message.channel && message.channel.parent) {
    const parentName = message.channel.parent.name;
    const threadName = message.channel.name;
    return `${parentName} → ${threadName}`;
  }
  if ('name' in message.channel) {
    return message.channel.name ?? undefined;
  }
  return undefined;
}

/**
 * Set threadId on a payload for messages in Discord thread channels.
 * Skips DMs and channels that already have a threadId set.
 */
function applyThreadId(
  payload: Record<string, unknown>,
  chatId: string,
  isThread: boolean,
  isDMChannel: boolean,
): void {
  if (isThread && !isDMChannel && !payload.threadId) {
    payload.threadId = chatId;
  }
}

/**
 * Process a single message
 */
async function processMessage(plugin: DiscordPlugin, instanceId: string, message: Message): Promise<void> {
  let content = extractContent(message);

  // Wire: forwarded attachment extraction from referenced messages
  const forwarded = await tryExtractForwardedContent(message, content);
  const forwardedAttachments = forwarded.attachments;
  if (forwarded.content) {
    content = forwarded.content;
  }

  if (!content) {
    log.debug('Skipping message with no extractable content', {
      instanceId,
      messageId: message.id,
    });
    return;
  }

  // ── Sanitize inbound text ──
  if (content.text) {
    const sanitized = sanitizeMessage(content.text, log, {
      instanceId,
      messageId: message.id,
    });
    if (!sanitized.ok) return; // Drop messages with null bytes or exceeding max length
    content.text = sanitized.text;
  }

  // ── Dedupe check ──
  if (dedupeCache.isDuplicate(instanceId, message.id, 'discord', log)) {
    return; // Duplicate — drop silently
  }

  const chatId = message.channel.id;
  const from = message.author.id;
  const replyToId = getReplyToId(message);

  // Resolve chat name: channel name for servers, recipient name for DMs
  // For threads: "parent-channel → thread-name"
  const isDMChannel = isDM(message);
  const isThread =
    message.channel.type === ChannelType.PublicThread ||
    message.channel.type === ChannelType.PrivateThread ||
    message.channel.type === ChannelType.AnnouncementThread;

  // Check if channel is Forum or Media type — auto-thread creation should be skipped.
  // Forum/media posts arrive as PublicThread messages; the channel itself is typed as
  // PublicThread while its parent is GuildForum (15) or GuildMedia (16). We must check
  // both the channel type and its parent type to correctly identify forum/media posts.
  const GUILD_MEDIA_TYPE = 16;
  const parentType = 'parent' in message.channel ? (message.channel.parent?.type as number | undefined) : undefined;
  const isForumOrMedia =
    (message.channel.type as number) === ChannelType.GuildForum ||
    (message.channel.type as number) === GUILD_MEDIA_TYPE ||
    parentType === ChannelType.GuildForum ||
    parentType === GUILD_MEDIA_TYPE;

  if (isForumOrMedia) {
    log.debug('Message in forum/media channel — auto-thread creation should be skipped', {
      channelId: chatId,
      channelType: message.channel.type,
      parentType,
    });
  }

  const chatName = resolveChatName(message, isDMChannel, isThread);

  // Wire: resolve per-guild config overrides for this message's guild
  const guildId = message.guild?.id;
  const guildConfig = guildId ? plugin.getGuildConfig(instanceId, guildId) : undefined;

  // Build extended content for raw payload
  const extendedPayload: Record<string, unknown> = {
    messageId: message.id,
    channelId: chatId,
    guildId,
    guildConfig, // Per-guild config overrides (agentReplyFilter, maxLines, toolPolicies, etc.)
    authorId: from,
    authorTag: message.author.tag,
    // displayName is used by agent-responder for sender name prefixing
    displayName: message.author.displayName || message.author.globalName || message.author.username,
    // pushName + chatName used by message-persistence for chat name and message preview
    pushName: message.author.displayName || message.author.globalName || message.author.username,
    chatName,
    isGroup: !isDMChannel,
    isThread,
    isForumOrMedia, // Downstream consumers should skip auto-thread creation for forum/media channels
    forwardedAttachments: forwardedAttachments.length > 0 ? forwardedAttachments : undefined,
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

  // For messages IN a thread channel (per_thread session strategy):
  // The thread channel ID is the threadId. Regular GUILD_TEXT replies are excluded.
  applyThreadId(extendedPayload, chatId, isThread, isDMChannel);

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
    message.createdTimestamp, // T0: Discord timestamps are already in milliseconds
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
