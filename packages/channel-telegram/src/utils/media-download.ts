import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

import { createDownloadGuard } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';

import type { TelegramBotLike } from '../grammy-shim';

const log = createLogger('telegram:media-download');

/** Download size guard — 50MB default */
const downloadGuard = createDownloadGuard();

const MEDIA_BASE_PATH = process.env.MEDIA_STORAGE_PATH || './data/media';

/** Download retry settings */
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000; // 1s, 2s, 4s

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
 * Check if an error is a "file too large" error from Telegram.
 * These should not be retried — Telegram cannot serve files >20MB via Bot API.
 */
function isFileTooLargeError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('file is too big') || msg.includes('file_too_big') || msg.includes('413');
}

/**
 * Check if an error is a transient/retryable error.
 */
function isTransientError(error: unknown): boolean {
  if (isFileTooLargeError(error)) return false;

  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('429') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('timeout') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('fetch failed')
  );
}

/**
 * Call bot.api.getFile with retry logic.
 * - 3 attempts with exponential backoff (1s, 2s, 4s)
 * - "file too large" errors: immediate failure (no retry)
 * - On final failure: returns null
 */
export async function getFileWithRetry(bot: TelegramBotLike, fileId: string): Promise<{ file_path?: string } | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await bot.api.getFile(fileId);
    } catch (error) {
      // "File too large" — don't retry, immediate fallback
      if (isFileTooLargeError(error)) {
        log.warn('File too large for Bot API download (no retry)', { fileId, error: String(error) });
        return null;
      }

      // Transient error — retry with backoff
      if (isTransientError(error) && attempt < MAX_RETRIES - 1) {
        const delay = BACKOFF_BASE_MS * 2 ** attempt;
        log.warn('getFile transient failure, retrying', {
          fileId,
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          retryDelayMs: delay,
          error: String(error),
        });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // Final attempt or non-transient error
      log.warn('getFile failed after retries', {
        fileId,
        attempts: attempt + 1,
        error: String(error),
      });
      return null;
    }
  }

  return null;
}

/**
 * Download a Telegram file_id to local disk.
 *
 * Stores at: data/media/{instanceId}/{YYYY-MM}/{externalId}{ext}
 *
 * Uses getFileWithRetry for resilient downloads:
 * - 3 retries with exponential backoff on transient failures
 * - Immediate fallback on "file too large" errors
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
    const file = await getFileWithRetry(bot, fileId);
    if (!file) {
      log.warn('getFile returned null (fallback: no local file)', { instanceId, externalId, fileId });
      return null;
    }

    const filePath = file.file_path;
    if (!filePath) return null;

    const url = `https://api.telegram.org/file/bot${bot.token}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    // Check Content-Length before reading body to prevent memory exhaustion
    downloadGuard.checkResponse(res, log, {
      instanceId,
      url,
      channel: 'telegram',
    });

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

    log.debug('Downloaded Telegram media', { instanceId, externalId, path: relativePath, size: buffer.length });

    return { localPath: relativePath };
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
