/**
 * Media storage service - handles local filesystem storage for media files
 *
 * @see history-sync wish
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import { type MediaStorageBackend, createMediaBackend } from '@omni/channel-sdk';
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
 * Stored media result
 */
export interface StoredMediaResult {
  localPath: string;
  size: number;
  mimeType?: string;
}

/**
 * Media bytes materialized as a local filesystem path for a processing service
 * (which only accepts a path and reads whole files off disk), paired with a
 * cleanup that removes any temp file created for it.
 */
export interface MaterializedMedia {
  path: string;
  cleanup: () => Promise<void>;
}

export interface MediaFetchOptions extends RequestInit {
  /**
   * Host suffixes where Authorization should be preserved across manual
   * redirects. Fetch strips Authorization on cross-origin redirects; some
   * private media URLs redirect inside the platform-owned domain and still
   * require the same token.
   */
  preserveAuthRedirectHostSuffixes?: string[];
}

function normalizeMimeType(value: string | null | undefined): string | undefined {
  return value?.split(';')[0]?.trim().toLowerCase() || undefined;
}

function isHtmlMime(value: string | null | undefined): boolean {
  const mimeType = normalizeMimeType(value);
  return mimeType === 'text/html' || mimeType === 'application/xhtml+xml';
}

function looksLikeHtml(buffer: Buffer): boolean {
  const preview = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  return preview.startsWith('<!doctype html') || preview.startsWith('<html>') || preview.startsWith('<html ');
}

function shouldRejectHtmlMedia(
  expectedMimeType: string | undefined,
  responseMimeType: string | undefined,
  buffer: Buffer,
): boolean {
  const expected = normalizeMimeType(expectedMimeType);
  if (!expected || isHtmlMime(expected)) return false;
  return isHtmlMime(responseMimeType) || looksLikeHtml(buffer);
}

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedSuffix = suffix.toLowerCase();
  return normalizedHost === normalizedSuffix || normalizedHost.endsWith(`.${normalizedSuffix}`);
}

function shouldPreserveAuthForRedirect(url: URL, suffixes: string[] | undefined): boolean {
  return Boolean(suffixes?.some((suffix) => hostMatchesSuffix(url.hostname, suffix)));
}

function headersWithOptionalAuthorization(
  headers: RequestInit['headers'] | undefined,
  preserveAuthorization: boolean,
): Headers {
  const nextHeaders = new Headers(headers);
  if (!preserveAuthorization) nextHeaders.delete('authorization');
  return nextHeaders;
}

async function fetchWithOptionalAuthenticatedRedirects(
  url: string,
  fetchOptions?: MediaFetchOptions,
): Promise<Response> {
  const { preserveAuthRedirectHostSuffixes, ...init } = fetchOptions ?? {};
  if (!preserveAuthRedirectHostSuffixes?.length) {
    return fetch(url, init);
  }

  let currentUrl = new URL(url);
  let currentHeaders = new Headers(init.headers);

  for (let redirects = 0; redirects <= 5; redirects++) {
    const response: Response = await fetch(currentUrl.toString(), {
      ...init,
      headers: currentHeaders,
      redirect: 'manual',
    });

    if (response.status < 300 || response.status >= 400) return response;

    const location: string | null = response.headers.get('location');
    if (!location) return response;

    const nextUrl: URL = new URL(location, currentUrl);
    const preserveAuthorization =
      shouldPreserveAuthForRedirect(currentUrl, preserveAuthRedirectHostSuffixes) &&
      shouldPreserveAuthForRedirect(nextUrl, preserveAuthRedirectHostSuffixes);

    currentHeaders = headersWithOptionalAuthorization(init.headers, preserveAuthorization);
    currentUrl = nextUrl;
  }

  throw new Error('Failed to download media: too many redirects');
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
  private backend: MediaStorageBackend;

  constructor(
    private db: Database,
    basePath?: string,
    backend?: MediaStorageBackend,
  ) {
    this.basePath = basePath ?? process.env.MEDIA_STORAGE_PATH ?? DEFAULT_MEDIA_PATH;
    this.backend = backend ?? createMediaBackend(this.basePath);

    // Ensure base directory exists (only meaningful for the local backend;
    // remote deployments should not create a spurious ./data/media directory).
    if (this.backend.mode === 'local' && !existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
      log.info('Created media storage directory', { path: this.basePath });
    }
  }

  /**
   * Build the stable relative storage key for media.
   * Format: {instanceId}/{YYYY-MM}/{messageId}.{ext}
   *
   * This key is both the local relative path and the S3 object key — it is what
   * gets recorded on the message row and never an expiring URL.
   */
  buildKey(instanceId: string, messageId: string, mimeType?: string, timestamp?: Date): string {
    const date = timestamp ?? new Date();
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const ext = mimeType ? getExtensionFromMime(mimeType) : '.bin';

    return join(instanceId, yearMonth, `${messageId}${ext}`);
  }

  /**
   * Build the absolute local storage path for media (local backend only).
   * Format: {basePath}/{instanceId}/{YYYY-MM}/{messageId}.{ext}
   */
  buildPath(instanceId: string, messageId: string, mimeType?: string, timestamp?: Date): string {
    return join(this.basePath, this.buildKey(instanceId, messageId, mimeType, timestamp));
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
    const buffer = Buffer.from(base64Data, 'base64');
    const key = this.buildKey(instanceId, messageId, mimeType, timestamp);
    const result = await this.backend.store({ key, buffer, mimeType });

    log.debug('Stored media from base64', { messageId, reference: result.reference, size: result.size });

    return {
      localPath: result.reference,
      size: result.size,
      mimeType: result.mimeType,
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
    const key = this.buildKey(instanceId, messageId, mimeType, timestamp);
    const result = await this.backend.store({ key, buffer, mimeType });

    log.debug('Stored media from buffer', { messageId, reference: result.reference, size: result.size });

    return {
      localPath: result.reference,
      size: result.size,
      mimeType: result.mimeType,
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
    fetchOptions?: MediaFetchOptions,
  ): Promise<StoredMediaResult> {
    // Fetch the media (fetchOptions allows callers to supply auth headers, e.g. Slack bot token)
    const response = await fetchWithOptionalAuthenticatedRedirects(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.status}`);
    }

    const responseContentType = response.headers.get('content-type') ?? undefined;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (shouldRejectHtmlMedia(mimeType, responseContentType, buffer)) {
      throw new Error(
        `Downloaded media content mismatch: expected ${mimeType}, received ${responseContentType ?? 'unknown content type'}`,
      );
    }

    const contentType = mimeType ?? responseContentType;

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
   * Backend-aware variant of readMedia: serves stored media in BOTH modes
   * (local disk read or S3 GET). In remote mode the stored reference is an S3
   * key with no file under basePath, so readMedia's disk lookup would 404 —
   * the GET /media route must use this instead. Returns null when missing.
   */
  async readMediaViaBackend(relativePath: string): Promise<{ buffer: Buffer; size: number } | null> {
    try {
      const buffer = await this.backend.read(relativePath);
      return { buffer, size: buffer.length };
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

  /**
   * The active storage mode (`local` | `remote`).
   */
  getStorageMode(): MediaStorageBackend['mode'] {
    return this.backend.mode;
  }

  /**
   * Read the full bytes of a stored reference back into a Buffer, delegating to
   * the active backend (local disk read or S3 GET). Used by the media processor
   * in remote mode to obtain bytes for transcription/vision, since the stored
   * reference is an S3 key rather than a readable local path.
   */
  async read(reference: string): Promise<Buffer> {
    return this.backend.read(reference);
  }

  /**
   * Presign a time-limited GET URL for a stored reference (remote mode only).
   * Throws in local mode. Consumed by remote-mode URL emission (Group 2).
   */
  async presignedUrl(reference: string, ttlSeconds?: number): Promise<string> {
    return this.backend.presignedUrl(reference, ttlSeconds);
  }

  /**
   * Materialize a stored reference as a local filesystem path a processing
   * service can read, with a cleanup for any temp file created.
   *
   * - `local`: the bytes already live at `{basePath}/{reference}`, so hand back
   *   that path directly with a no-op cleanup (byte-for-byte the pre-remote
   *   behavior — no copy, and cleanup never deletes the stored file).
   * - `remote`: `reference` is an S3 key, not a local path. Fetch the bytes via
   *   the storage backend and write them to an `os.tmpdir()` temp file,
   *   returning a cleanup that removes it. The temp file keeps the stored
   *   extension so processors that sniff by extension (e.g. audio duration)
   *   behave as on disk.
   *
   * Callers MUST invoke `cleanup` in a `finally` so remote temp files are
   * removed on success and on processing error alike.
   */
  async materializeForProcessing(reference: string): Promise<MaterializedMedia> {
    if (this.backend.mode === 'local') {
      return { path: join(this.basePath, reference), cleanup: async () => {} };
    }

    const buffer = await this.backend.read(reference);
    const ext = extname(reference) || '.bin';
    const tempPath = join(tmpdir(), `omni-media-${randomUUID()}${ext}`);
    try {
      await writeFile(tempPath, buffer);
    } catch (error) {
      // A failed write (ENOSPC, permissions) can leave a partial file behind.
      await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }

    return {
      path: tempPath,
      cleanup: async () => {
        await rm(tempPath, { force: true });
      },
    };
  }
}
