/**
 * Message formatting helpers
 *
 * Utilities for formatting messages across different channels.
 */

import type { ContentType } from '@omni/core/types';
import type { OutgoingContent, OutgoingMessage } from '../types/messaging';

/**
 * Create a simple text message
 */
export function textMessage(to: string, text: string, replyTo?: string): OutgoingMessage {
  return {
    to,
    content: {
      type: 'text',
      text,
    },
    replyTo,
  };
}

/**
 * Create an image message
 */
export function imageMessage(
  to: string,
  mediaUrl: string,
  options?: {
    caption?: string;
    mimeType?: string;
    replyTo?: string;
  },
): OutgoingMessage {
  return {
    to,
    content: {
      type: 'image',
      mediaUrl,
      caption: options?.caption,
      mimeType: options?.mimeType ?? 'image/jpeg',
    },
    replyTo: options?.replyTo,
  };
}

/**
 * Create a document message
 */
export function documentMessage(
  to: string,
  mediaUrl: string,
  filename: string,
  options?: {
    caption?: string;
    mimeType?: string;
    replyTo?: string;
  },
): OutgoingMessage {
  return {
    to,
    content: {
      type: 'document',
      mediaUrl,
      filename,
      caption: options?.caption,
      mimeType: options?.mimeType ?? 'application/octet-stream',
    },
    replyTo: options?.replyTo,
  };
}

/**
 * Create an audio message
 */
export function audioMessage(
  to: string,
  mediaUrl: string,
  options?: {
    mimeType?: string;
    replyTo?: string;
  },
): OutgoingMessage {
  return {
    to,
    content: {
      type: 'audio',
      mediaUrl,
      mimeType: options?.mimeType ?? 'audio/mpeg',
    },
    replyTo: options?.replyTo,
  };
}

/**
 * Create a video message
 */
export function videoMessage(
  to: string,
  mediaUrl: string,
  options?: {
    caption?: string;
    mimeType?: string;
    replyTo?: string;
  },
): OutgoingMessage {
  return {
    to,
    content: {
      type: 'video',
      mediaUrl,
      caption: options?.caption,
      mimeType: options?.mimeType ?? 'video/mp4',
    },
    replyTo: options?.replyTo,
  };
}

/**
 * Create a reaction message
 */
export function reactionMessage(to: string, targetMessageId: string, emoji: string): OutgoingMessage {
  return {
    to,
    content: {
      type: 'reaction',
      emoji,
      targetMessageId,
    },
  };
}

/**
 * Create a location message
 */
export function locationMessage(
  to: string,
  latitude: number,
  longitude: number,
  options?: {
    name?: string;
    address?: string;
    replyTo?: string;
  },
): OutgoingMessage {
  return {
    to,
    content: {
      type: 'location',
      location: {
        latitude,
        longitude,
        name: options?.name,
        address: options?.address,
      },
    },
    replyTo: options?.replyTo,
  };
}

/**
 * Truncate text to a maximum length
 */
export function truncateText(text: string, maxLength: number, ellipsis = '...'): string {
  if (maxLength <= 0 || text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Split long text into multiple messages
 */
export function splitText(text: string, maxLength: number): string[] {
  if (maxLength <= 0 || text.length <= maxLength) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining);
      break;
    }

    // Try to split at word boundary
    let splitIndex = remaining.lastIndexOf(' ', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    parts.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return parts;
}

/**
 * Get the primary text content from message content
 */
export function getTextContent(content: OutgoingContent): string | undefined {
  return content.text ?? content.caption;
}

/**
 * Check if content is media type
 */
export function isMediaContent(type: ContentType): boolean {
  return ['image', 'audio', 'video', 'document', 'sticker'].includes(type);
}
