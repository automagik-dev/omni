/**
 * Media message handlers
 *
 * Extends message handling with media-specific processing:
 * - Download media to local storage
 * - Emit media.received events with local paths
 */

import type { WAMessage } from '@whiskeysockets/baileys';
import type { WhatsAppPlugin } from '../plugin';
import { detectMediaType, downloadMedia } from '../utils/download';

/**
 * Media handling configuration
 */
export interface MediaConfig {
  /** Base path for saving downloaded media */
  mediaBasePath: string;
  /** Whether to download media automatically */
  autoDownload: boolean;
  /** Maximum file size to auto-download (0 = unlimited) */
  maxAutoDownloadSize: number;
}

const DEFAULT_MEDIA_CONFIG: MediaConfig = {
  mediaBasePath: './media',
  autoDownload: true,
  maxAutoDownloadSize: 50 * 1024 * 1024, // 50MB
};

/**
 * Process an incoming media message
 *
 * Downloads the media and emits a media.received event.
 *
 * @param msg - Baileys message containing media
 * @param plugin - WhatsApp plugin instance
 * @param instanceId - Instance identifier
 * @param config - Media handling configuration
 */
export async function processMediaMessage(
  msg: WAMessage,
  plugin: WhatsAppPlugin,
  instanceId: string,
  config: MediaConfig = DEFAULT_MEDIA_CONFIG,
): Promise<void> {
  const mediaInfo = detectMediaType(msg);
  if (!mediaInfo) {
    return;
  }

  const externalId = msg.key.id || '';
  const _chatId = msg.key.remoteJid || '';

  // Download media if auto-download is enabled
  if (config.autoDownload) {
    const result = await downloadMedia(msg, config.mediaBasePath);

    if (result) {
      // Emit media.received event with local path
      await plugin.emitMediaReceivedInternal({
        instanceId,
        eventId: externalId,
        mediaId: externalId,
        mimeType: result.mimeType,
        size: result.size,
        url: `file://${result.localPath}`,
        duration: mediaInfo.duration,
      });
    }
  }
}

/**
 * Extract caption from a media message
 */
export function extractCaption(msg: WAMessage): string | undefined {
  const message = msg.message;
  if (!message) return undefined;

  if (message.imageMessage?.caption) {
    return message.imageMessage.caption;
  }

  if (message.videoMessage?.caption) {
    return message.videoMessage.caption;
  }

  if (message.documentMessage?.caption) {
    return message.documentMessage.caption;
  }

  return undefined;
}

/**
 * Check if a message contains media
 */
export function hasMedia(msg: WAMessage): boolean {
  return detectMediaType(msg) !== null;
}

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
