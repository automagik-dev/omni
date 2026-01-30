/**
 * Media download utilities for WhatsApp plugin
 *
 * Handles downloading media from Baileys messages and saving to local storage.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { WAMessage } from '@whiskeysockets/baileys';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

/**
 * Result of downloading media
 */
export interface DownloadResult {
  /** Local file path where media was saved */
  localPath: string;
  /** MIME type of the media */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Original filename if available */
  filename?: string;
}

/**
 * Media type detection from message
 */
export interface DetectedMedia {
  /** Type of media content */
  type: 'image' | 'audio' | 'video' | 'document' | 'sticker';
  /** MIME type */
  mimeType: string;
  /** Original filename if available */
  filename?: string;
  /** Duration in seconds (for audio/video) */
  duration?: number;
  /** Is this a voice note (ptt) */
  isVoiceNote?: boolean;
}

/**
 * Detect media type from a Baileys message
 */
export function detectMediaType(msg: WAMessage): DetectedMedia | null {
  const message = msg.message;
  if (!message) return null;

  if (message.imageMessage) {
    return {
      type: 'image',
      mimeType: message.imageMessage.mimetype || 'image/jpeg',
    };
  }

  if (message.audioMessage) {
    return {
      type: 'audio',
      mimeType: message.audioMessage.mimetype || 'audio/ogg; codecs=opus',
      duration: message.audioMessage.seconds || undefined,
      isVoiceNote: message.audioMessage.ptt || false,
    };
  }

  if (message.videoMessage) {
    return {
      type: 'video',
      mimeType: message.videoMessage.mimetype || 'video/mp4',
      duration: message.videoMessage.seconds || undefined,
    };
  }

  if (message.documentMessage) {
    return {
      type: 'document',
      mimeType: message.documentMessage.mimetype || 'application/octet-stream',
      filename: message.documentMessage.fileName || undefined,
    };
  }

  if (message.stickerMessage) {
    return {
      type: 'sticker',
      mimeType: message.stickerMessage.mimetype || 'image/webp',
    };
  }

  return null;
}

/**
 * Get file extension from MIME type
 */
export function getExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'audio/ogg; codecs=opus': '.ogg',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/wav': '.wav',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/3gpp': '.3gp',
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'application/octet-stream': '.bin',
    'text/plain': '.txt',
    'text/csv': '.csv',
  };

  // Check exact match
  if (mimeToExt[mimeType]) {
    return mimeToExt[mimeType];
  }

  // Check partial match (e.g., 'image/jpeg' for 'image/jpeg; charset=utf-8')
  for (const [mime, ext] of Object.entries(mimeToExt)) {
    if (mimeType.startsWith(mime)) {
      return ext;
    }
  }

  // Default extension based on type
  if (mimeType.startsWith('image/')) return '.bin';
  if (mimeType.startsWith('audio/')) return '.audio';
  if (mimeType.startsWith('video/')) return '.video';
  if (mimeType.startsWith('application/')) return '.bin';

  return '.bin';
}

/**
 * Generate a unique filename for downloaded media
 */
export function generateFilename(mimeType: string, originalFilename?: string): string {
  if (originalFilename) {
    return originalFilename;
  }

  const uuid = randomUUID();
  const ext = getExtension(mimeType);
  return `${uuid}${ext}`;
}

/**
 * Download media from a Baileys message
 *
 * @param msg - Baileys WAMessage containing media
 * @param basePath - Base directory to save media
 * @returns Download result with local path and metadata
 */
export async function downloadMedia(msg: WAMessage, basePath: string): Promise<DownloadResult | null> {
  const mediaInfo = detectMediaType(msg);
  if (!mediaInfo) {
    return null;
  }

  try {
    // Download the media buffer
    const buffer = await downloadMediaMessage(msg, 'buffer', {});

    if (!buffer || !(buffer instanceof Buffer)) {
      return null;
    }

    // Generate filename and path
    const filename = generateFilename(mediaInfo.mimeType, mediaInfo.filename);
    const localPath = join(basePath, mediaInfo.type, filename);

    // Ensure directory exists
    await mkdir(dirname(localPath), { recursive: true });

    // Write file
    await writeFile(localPath, buffer);

    return {
      localPath,
      mimeType: mediaInfo.mimeType,
      size: buffer.length,
      filename: mediaInfo.filename,
    };
  } catch (_error) {
    // Download failed - could be expired or unavailable
    return null;
  }
}

/**
 * Download media to a buffer (without saving to disk)
 */
export async function downloadMediaToBuffer(msg: WAMessage): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const mediaInfo = detectMediaType(msg);
  if (!mediaInfo) {
    return null;
  }

  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {});

    if (!buffer || !(buffer instanceof Buffer)) {
      return null;
    }

    return {
      buffer,
      mimeType: mediaInfo.mimeType,
    };
  } catch {
    return null;
  }
}
