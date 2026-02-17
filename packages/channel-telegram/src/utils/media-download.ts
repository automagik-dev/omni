import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

import { createLogger } from '@omni/core';

import type { TelegramBotLike } from '../grammy-shim';

const log = createLogger('telegram:media-download');

const MEDIA_BASE_PATH = process.env.MEDIA_STORAGE_PATH || './data/media';

function toYearMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getExtensionFromMime(mimeType?: string): string {
  if (!mimeType) return '';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'video/mp4') return '.mp4';
  if (mimeType === 'audio/ogg') return '.ogg';
  if (mimeType === 'audio/mpeg') return '.mp3';
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'application/zip') return '.zip';
  return '';
}

function sanitizeFilename(name: string): string {
  return name.replaceAll(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Download a Telegram file_id to local disk.
 *
 * Stores at: data/media/{instanceId}/{YYYY-MM}/{externalId}{ext}
 */
export async function tryDownloadTelegramMedia(params: {
  bot: TelegramBotLike;
  instanceId: string;
  externalId: string;
  fileId: string;
  mimeType?: string;
  filename?: string;
}): Promise<{ localPath: string } | null> {
  const { bot, instanceId, externalId, fileId, mimeType, filename } = params;

  try {
    const file = await bot.api.getFile(fileId);
    const filePath = file.file_path;
    if (!filePath) return null;

    const url = `https://api.telegram.org/file/bot${bot.token}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    const now = new Date();
    const yearMonth = toYearMonth(now);

    const extFromName = filename ? extname(filename) : '';
    const ext = extFromName || getExtensionFromMime(mimeType);

    const safeName = filename ? sanitizeFilename(filename) : undefined;
    const baseName = safeName ? `${externalId}-${safeName}` : externalId;
    const nameWithExt = extname(baseName) ? baseName : `${baseName}${ext}`;

    const relativePath = join(instanceId, yearMonth, nameWithExt);
    const fullPath = join(MEDIA_BASE_PATH, relativePath);

    const dir = dirname(fullPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(fullPath, buffer);

    log.debug('Downloaded Telegram media', { instanceId, externalId, path: fullPath, size: buffer.length });

    return { localPath: fullPath };
  } catch (error) {
    log.warn('Telegram media download failed, continuing without local file', {
      instanceId,
      externalId,
      fileId,
      error: String(error),
    });
    return null;
  }
}
