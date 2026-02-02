/**
 * Unified message content builder
 *
 * Builds Discord message content from Omni OutgoingMessage format.
 */

import type { OutgoingMessage } from '@omni/channel-sdk';
import type { MessageCreateOptions } from 'discord.js';

/**
 * Format mentions array to Discord mention strings
 *
 * Converts structured mentions to Discord format:
 * - user: <@USER_ID>
 * - role: <@&ROLE_ID>
 * - channel: <#CHANNEL_ID>
 * - everyone: @everyone
 * - here: @here
 */
function formatMentions(mentions: Array<{ id: string; type?: string }>): string[] {
  return mentions.map((m) => {
    const type = m.type || 'user';
    switch (type) {
      case 'user':
        return `<@${m.id}>`;
      case 'role':
        return `<@&${m.id}>`;
      case 'channel':
        return `<#${m.id}>`;
      case 'everyone':
        return '@everyone';
      case 'here':
        return '@here';
      default:
        return `<@${m.id}>`;
    }
  });
}

/**
 * Build Discord message content from OutgoingMessage
 *
 * @param message - Outgoing message to convert
 * @returns Discord message options
 */
export function buildMessageContent(message: OutgoingMessage): MessageCreateOptions {
  const options: MessageCreateOptions = {};
  const content = message.content;

  // Check for mentions in metadata
  const mentions = message.metadata?.mentions as Array<{ id: string; type?: string }> | undefined;
  let mentionPrefix = '';
  if (mentions && mentions.length > 0) {
    mentionPrefix = `${formatMentions(mentions).join(' ')} `;
  }

  switch (content.type) {
    case 'text':
      options.content = mentionPrefix + (content.text || '');
      break;

    case 'image':
    case 'audio':
    case 'video':
    case 'document':
      if (content.mediaUrl) {
        options.files = [
          {
            attachment: content.mediaUrl,
            name: content.filename,
          },
        ];
      }
      // Add caption as content if present (with mentions)
      if (content.text || content.caption) {
        options.content = mentionPrefix + (content.text || content.caption);
      } else if (mentionPrefix) {
        options.content = mentionPrefix.trim();
      }
      break;

    case 'sticker':
      // Discord stickers are sent by ID via metadata
      // The sticker ID should be passed via the message metadata
      throw new Error('Stickers should be sent via sendStickerMessage with sticker ID');

    case 'reaction':
      // Reactions are not sent as messages, they're added to messages
      // This should be handled separately via addReaction
      throw new Error('Reactions should be sent via addReaction, not sendMessage');

    default:
      // Fall back to text content if available (with mentions)
      if (content.text) {
        options.content = mentionPrefix + content.text;
      } else if (mentionPrefix) {
        options.content = mentionPrefix.trim();
      } else {
        throw new Error(`Unsupported content type: ${content.type}`);
      }
  }

  // Handle reply
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
