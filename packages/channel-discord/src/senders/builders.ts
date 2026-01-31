/**
 * Unified message content builder
 *
 * Builds Discord message content from Omni OutgoingMessage format.
 */

import type { OutgoingMessage } from '@omni/channel-sdk';
import type { MessageCreateOptions } from 'discord.js';

/**
 * Build Discord message content from OutgoingMessage
 *
 * @param message - Outgoing message to convert
 * @returns Discord message options
 */
export function buildMessageContent(message: OutgoingMessage): MessageCreateOptions {
  const options: MessageCreateOptions = {};
  const content = message.content;

  switch (content.type) {
    case 'text':
      options.content = content.text;
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
      // Add caption as content if present
      if (content.text || content.caption) {
        options.content = content.text || content.caption;
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
      // Fall back to text content if available
      if (content.text) {
        options.content = content.text;
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
