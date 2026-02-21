/**
 * Media message handlers
 *
 * Extends message handling with media-specific processing:
 * - Download media to local storage
 * - Emit media.received events with local paths
 */

import type { WAMessage } from '@whiskeysockets/baileys';

/**
 * Get media size from message if available
 */
export function getMediaSize(msg: WAMessage): number | undefined {
  const message = msg.message;
  if (!message) return undefined;

  if (message.imageMessage?.fileLength) {
    return Number(message.imageMessage.fileLength);
  }

  if (message.audioMessage?.fileLength) {
    return Number(message.audioMessage.fileLength);
  }

  if (message.videoMessage?.fileLength) {
    return Number(message.videoMessage.fileLength);
  }

  if (message.documentMessage?.fileLength) {
    return Number(message.documentMessage.fileLength);
  }

  if (message.stickerMessage?.fileLength) {
    return Number(message.stickerMessage.fileLength);
  }

  return undefined;
}
