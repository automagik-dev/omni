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

function normalizeMimeType(value: string | null | undefined): string | undefined {
  return value?.split(';')[0]?.trim().toLowerCase() || undefined;
}

function isHtmlMime(value: string | null | undefined): boolean {
  const mimeType = normalizeMimeType(value);
  return mimeType === 'text/html' || mimeType === 'application/xhtml+xml';
}

function looksLikeHtml(buffer: Buffer): boolean {
  const preview = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  return preview.startsWith('<!doctype html') || preview.startsWith('<html') || preview.includes('<html');
}

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedSuffix = suffix.toLowerCase();
  return normalizedHost === normalizedSuffix || normalizedHost.endsWith(`.${normalizedSuffix}`);
}

function isSlackHost(url: URL): boolean {
  return hostMatchesSuffix(url.hostname, 'slack.com');
}

function headersWithOptionalAuthorization(botToken: string, preserveAuthorization: boolean): Headers {
  const headers = new Headers();
  if (preserveAuthorization) headers.set('Authorization', `Bearer ${botToken}`);
  headers.set('Accept', 'application/octet-stream');
  return headers;
}

async function fetchSlackPrivateUrl(url: string, botToken: string): Promise<Response> {
  let currentUrl = new URL(url);
  let preserveAuthorization = true;

  for (let redirects = 0; redirects <= 5; redirects++) {
    const response: Response = await fetch(currentUrl.toString(), {
      headers: headersWithOptionalAuthorization(botToken, preserveAuthorization),
      redirect: 'manual',
    });

    if (response.status < 300 || response.status >= 400) return response;

    const location: string | null = response.headers.get('location');
    if (!location) return response;

    const nextUrl: URL = new URL(location, currentUrl);
    preserveAuthorization = isSlackHost(currentUrl) && isSlackHost(nextUrl);
    currentUrl = nextUrl;
  }

  throw new SlackError(SlackErrorCode.FILE_DOWNLOAD_FAILED, 'Failed to download file: too many redirects');
}

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
  expectedMimeType?: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  logger.debug('Downloading file from Slack CDN', { url: url.substring(0, 50) });

  try {
    const response = await fetchSlackPrivateUrl(url, botToken);

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
    if (!isHtmlMime(expectedMimeType) && (isHtmlMime(mimeType) || looksLikeHtml(buffer))) {
      throw new SlackError(
        SlackErrorCode.FILE_DOWNLOAD_FAILED,
        `Failed to download file bytes: Slack returned HTML instead of ${expectedMimeType ?? 'media'}`,
      );
    }

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
