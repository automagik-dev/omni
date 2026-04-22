import { createLogger } from '@omni/core';
import type { Message } from 'discord.js';

const log = createLogger('discord:forwarded-attachments');

export interface ForwardedAttachment {
  url: string;
  filename: string;
  contentType: string;
  size: number;
}

/**
 * Extract attachments from a forwarded/referenced message.
 * Discord uses message references for replies, cross-posts, and forwarded messages.
 * Referenced messages may have attachments with different URL patterns.
 */
export async function extractForwardedAttachments(message: Message): Promise<ForwardedAttachment[]> {
  const reference = message.reference;
  if (!reference?.messageId) return [];

  try {
    // Fetch the referenced message
    const channel = message.channel;
    if (!('messages' in channel)) return [];

    const referencedMessage = await channel.messages.fetch(reference.messageId);
    if (!referencedMessage) return [];

    const attachments: ForwardedAttachment[] = [];

    for (const [, attachment] of referencedMessage.attachments) {
      attachments.push({
        url: attachment.url,
        filename: attachment.name ?? `attachment-${attachment.id}`,
        contentType: attachment.contentType ?? 'application/octet-stream',
        size: attachment.size,
      });
    }

    if (attachments.length > 0) {
      log.debug('Extracted forwarded attachments', {
        messageId: message.id,
        referencedMessageId: reference.messageId,
        count: attachments.length,
      });
    }

    return attachments;
  } catch (error) {
    log.warn('Failed to extract forwarded attachments', {
      messageId: message.id,
      referencedMessageId: reference.messageId,
      error: String(error),
    });
    return [];
  }
}

/**
 * Download a forwarded attachment and return its buffer.
 */
export async function downloadForwardedAttachment(attachment: ForwardedAttachment): Promise<Buffer | null> {
  try {
    const response = await fetch(attachment.url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      log.warn('Failed to download forwarded attachment', {
        url: attachment.url,
        status: response.status,
      });
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    log.debug('Downloaded forwarded attachment', {
      filename: attachment.filename,
      size: arrayBuffer.byteLength,
    });
    return Buffer.from(arrayBuffer);
  } catch (error) {
    log.warn('Error downloading forwarded attachment', {
      url: attachment.url,
      error: String(error),
    });
    return null;
  }
}
