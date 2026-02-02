/**
 * Unified message content builder
 *
 * Builds Discord message content from Omni OutgoingMessage format.
 */

import type { OutgoingMessage } from '@omni/channel-sdk';
import type { MessageCreateOptions } from 'discord.js';

/**
 * Format a single mention to Discord format
 */
function formatSingleMention(mention: { id: string; type?: string }): string {
  const type = mention.type || 'user';
  switch (type) {
    case 'user':
      return `<@${mention.id}>`;
    case 'role':
      return `<@&${mention.id}>`;
    case 'channel':
      return `<#${mention.id}>`;
    case 'everyone':
      return '@everyone';
    case 'here':
      return '@here';
    default:
      return `<@${mention.id}>`;
  }
}

/**
 * Format mentions array to Discord mention strings
 */
function formatMentions(mentions: Array<{ id: string; type?: string }>): string[] {
  return mentions.map(formatSingleMention);
}

/**
 * Get mention prefix from message metadata
 */
function getMentionPrefix(message: OutgoingMessage): string {
  const mentions = message.metadata?.mentions as Array<{ id: string; type?: string }> | undefined;
  return mentions?.length ? `${formatMentions(mentions).join(' ')} ` : '';
}

/**
 * Build options for text content
 */
function buildTextOptions(content: OutgoingMessage['content'], mentionPrefix: string): MessageCreateOptions {
  return { content: mentionPrefix + (content.text || '') };
}

/**
 * Build options for media content (image, audio, video, document)
 */
function buildMediaOptions(content: OutgoingMessage['content'], mentionPrefix: string): MessageCreateOptions {
  const options: MessageCreateOptions = {};
  if (content.mediaUrl) {
    options.files = [{ attachment: content.mediaUrl, name: content.filename }];
  }
  const caption = content.text || content.caption;
  if (caption) {
    options.content = mentionPrefix + caption;
  } else if (mentionPrefix) {
    options.content = mentionPrefix.trim();
  }
  return options;
}

/**
 * Build options for fallback/unknown content types
 */
function buildFallbackOptions(content: OutgoingMessage['content'], mentionPrefix: string): MessageCreateOptions {
  if (content.text) return { content: mentionPrefix + content.text };
  if (mentionPrefix) return { content: mentionPrefix.trim() };
  throw new Error(`Unsupported content type: ${content.type}`);
}

/**
 * Build Discord message content from OutgoingMessage
 */
export function buildMessageContent(message: OutgoingMessage): MessageCreateOptions {
  const content = message.content;
  const mentionPrefix = getMentionPrefix(message);

  let options: MessageCreateOptions;

  switch (content.type) {
    case 'text':
      options = buildTextOptions(content, mentionPrefix);
      break;
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
      options = buildMediaOptions(content, mentionPrefix);
      break;
    case 'sticker':
      throw new Error('Stickers should be sent via sendStickerMessage with sticker ID');
    case 'reaction':
      throw new Error('Reactions should be sent via addReaction, not sendMessage');
    default:
      options = buildFallbackOptions(content, mentionPrefix);
  }

  if (message.replyTo) {
    options.reply = { messageReference: message.replyTo };
  }

  return options;
}

/**
 * Check if a message content type is supported
 */
export function isSupportedContentType(type: string): boolean {
  return ['text', 'image', 'audio', 'video', 'document', 'sticker'].includes(type);
}

/**
 * Get the Discord file type from content type
 */
export function getFileType(contentType: string): 'image' | 'audio' | 'video' | 'document' {
  if (contentType === 'image') return 'image';
  if (contentType === 'audio') return 'audio';
  if (contentType === 'video') return 'video';
  return 'document';
}
