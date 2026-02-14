/**
 * Media storage service - handles local filesystem storage for media files
 *
 * @see history-sync wish
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { messages } from '@omni/db';
import { eq } from 'drizzle-orm';

const log = createLogger('services:media-storage');

/**
 * Default base path for media storage
 */
const DEFAULT_MEDIA_PATH = './data/media';

/**
 * Media metadata from message
 */
export interface MediaMetadata {
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
  waveform?: number[];
  isVoiceNote?: boolean;
  filename?: string;
}

/**
 * Stored media result
 */
export interface StoredMediaResult {
  localPath: string;
  size: number;
  mimeType?: string;
}

/**
 * Get file extension from mime type
 */
function getExtensionFromMime(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    // Images
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
    // Audio
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/opus': '.opus',
    'audio/wav': '.wav',
    'audio/aac': '.aac',
    'audio/flac': '.flac',
    // Video
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/x-matroska': '.mkv',
    // Documents
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'text/plain': '.txt',
    'text/csv': '.csv',
    // Archives
    'application/zip': '.zip',
    'application/x-rar-compressed': '.rar',
    'application/vnd.rar': '.rar',
    'application/x-7z-compressed': '.7z',
    'application/x-tar': '.tar',
    'application/gzip': '.gz',
    'application/x-bzip2': '.bz2',
  };

  return mimeToExt[mimeType] ?? '.bin';
}

export class MediaStorageService {
  private basePath: string;

  constructor(
    private db: Database,
    basePath?: string,
  ) {
    this.basePath = basePath ?? process.env.MEDIA_STORAGE_PATH ?? DEFAULT_MEDIA_PATH;

    // Ensure base directory exists
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
      log.info('Created media storage directory', { path: this.basePath });
    }
  }

  /**
   * Build storage path for media
   * Format: {basePath}/{instanceId}/{YYYY-MM}/{messageId}.{ext}
   */
  buildPath(instanceId: string, messageId: string, mimeType?: string, timestamp?: Date): string {
    const date = timestamp ?? new Date();
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const ext = mimeType ? getExtensionFromMime(mimeType) : '.bin';

    return join(this.basePath, instanceId, yearMonth, `${messageId}${ext}`);
  }

  /**
   * Store media from base64 data
   */
  async storeFromBase64(
    instanceId: string,
    messageId: string,
    base64Data: string,
    mimeType?: string,
    timestamp?: Date,
  ): Promise<StoredMediaResult> {
    const localPath = this.buildPath(instanceId, messageId, mimeType, timestamp);

    // Ensure directory exists
    const dir = dirname(localPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Decode and write
    const buffer = Buffer.from(base64Data, 'base64');
    writeFileSync(localPath, buffer);

    log.debug('Stored media from base64', { messageId, localPath, size: buffer.length });

    return {
      localPath: localPath.replace(this.basePath, '').replace(/^\//, ''),
      size: buffer.length,
      mimeType,
    };
  }

  /**
   * Store media from buffer
   */
  async storeFromBuffer(
    instanceId: string,
    messageId: string,
    buffer: Buffer,
    mimeType?: string,
    timestamp?: Date,
  ): Promise<StoredMediaResult> {
    const localPath = this.buildPath(instanceId, messageId, mimeType, timestamp);

    // Ensure directory exists
    const dir = dirname(localPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(localPath, buffer);

    log.debug('Stored media from buffer', { messageId, localPath, size: buffer.length });

    return {
      localPath: localPath.replace(this.basePath, '').replace(/^\//, ''),
      size: buffer.length,
      mimeType,
    };
  }

  /**
   * Store media from URL (download)
   */
  async storeFromUrl(
    instanceId: string,
    messageId: string,
    url: string,
    mimeType?: string,
    timestamp?: Date,
  ): Promise<StoredMediaResult> {
    // Fetch the media
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = mimeType ?? response.headers.get('content-type') ?? undefined;

    return this.storeFromBuffer(instanceId, messageId, buffer, contentType, timestamp);
  }

  /**
   * Update message with local path after storage
   */
  async updateMessageLocalPath(messageId: string, localPath: string): Promise<void> {
    await this.db.update(messages).set({ mediaLocalPath: localPath }).where(eq(messages.id, messageId));
  }

  /**
   * Read media file
   */
  readMedia(relativePath: string): { buffer: Buffer; size: number } | null {
    const fullPath = join(this.basePath, relativePath);

    if (!existsSync(fullPath)) {
      return null;
    }

    try {
      const buffer = readFileSync(fullPath);
      const stat = statSync(fullPath);
      return {
        buffer,
        size: Number(stat.size),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get mime type from file extension
   */
  getMimeType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const extToMime: Record<string, string> = {
      // Images
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      // Audio
      '.ogg': 'audio/ogg',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.opus': 'audio/opus',
      '.wav': 'audio/wav',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
      // Video
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska',
      // Documents
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      // Archives
      '.zip': 'application/zip',
      '.rar': 'application/vnd.rar',
      '.7z': 'application/x-7z-compressed',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      '.bz2': 'application/x-bzip2',
    };

    return extToMime[ext] ?? 'application/octet-stream';
  }

  /**
   * Get base path for serving
   */
  getBasePath(): string {
    return this.basePath;
  }
}
