/**
 * Inbound file handler for Slack
 *
 * Handles:
 * - Download files from Slack CDN (requires bot token auth)
 * - Support: images, documents, audio, video
 * - Attachment metadata extraction (mime type, size, thumbnail)
 */

import { createDownloadGuard } from '@omni/channel-sdk';
import type { Logger } from '@omni/channel-sdk';
import type { SlackFileInfo } from '../types';

/** Download size guard — 50MB default */
const downloadGuard = createDownloadGuard();
import { SlackError, SlackErrorCode } from '../types';

/**
 * Extract file info from a Slack message event
 */
export function extractFileInfo(files: unknown[]): SlackFileInfo[] {
  if (!files || !Array.isArray(files)) return [];

  return files.map((file) => {
    const f = file as Record<string, unknown>;
    return {
      id: (f.id as string) ?? '',
      name: (f.name as string) ?? (f.title as string) ?? 'unknown',
      mimeType: (f.mimetype as string) ?? 'application/octet-stream',
      size: (f.size as number) ?? 0,
      urlPrivateDownload: f.url_private_download as string | undefined,
      urlPrivate: f.url_private as string | undefined,
      thumbnailUrl: (f.thumb_360 as string) ?? (f.thumb_160 as string) ?? undefined,
    };
  });
}

/**
 * Download a file from Slack's private CDN using bot token authentication
 */
export async function downloadSlackFile(
  url: string,
  botToken: string,
  logger: Logger,
): Promise<{ buffer: Buffer; mimeType: string }> {
  logger.debug('Downloading file from Slack CDN', { url: url.substring(0, 50) });

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${botToken}`,
      },
    });

    if (!response.ok) {
      throw new SlackError(
        SlackErrorCode.FILE_DOWNLOAD_FAILED,
        `Failed to download file: HTTP ${response.status} ${response.statusText}`,
      );
    }

    // Guard against oversized downloads before reading into memory
    downloadGuard.checkResponse(response, logger, { channel: 'slack', url: url.substring(0, 50) });

    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';

    logger.debug('File downloaded successfully', { size: buffer.length, mimeType });

    return { buffer, mimeType };
  } catch (error) {
    if (error instanceof SlackError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    logger.error('File download failed', { error: message });
    throw new SlackError(SlackErrorCode.FILE_DOWNLOAD_FAILED, `File download failed: ${message}`);
  }
}

/**
 * Get content type category from MIME type
 */
export function getContentTypeFromMime(mimeType: string): 'image' | 'audio' | 'video' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}
