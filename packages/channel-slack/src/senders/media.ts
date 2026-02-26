/**
 * Outbound file/media sender for Slack
 *
 * Handles:
 * - Upload files via files.uploadV2 API
 * - Support: images, documents with thread context
 */

import type { Logger } from '@omni/channel-sdk';
import type { WebClient } from '@slack/web-api';
import { SlackError, SlackErrorCode } from '../types';

export interface MediaUploadOptions {
  /** Channel ID to upload to */
  channelId: string;
  /** File content as buffer */
  content: Buffer;
  /** Filename */
  filename: string;
  /** Optional thread TS */
  threadTs?: string;
  /** Optional initial comment/caption */
  initialComment?: string;
}

/**
 * Upload a file to Slack
 */
export async function uploadFile(client: WebClient, options: MediaUploadOptions, logger: Logger): Promise<string> {
  logger.debug('Uploading file to Slack', {
    channelId: options.channelId,
    filename: options.filename,
    size: options.content.length,
  });

  try {
    const uploadArgs: Record<string, unknown> = {
      channel_id: options.channelId,
      file: options.content,
      filename: options.filename,
      initial_comment: options.initialComment,
    };
    if (options.threadTs) {
      uploadArgs.thread_ts = options.threadTs;
    }
    const result = await client.files.uploadV2(uploadArgs as unknown as Parameters<typeof client.files.uploadV2>[0]);

    const resultAny = result as unknown as Record<string, unknown>;
    // files.uploadV2 returns a `files` array, not a `file` object
    const files = resultAny.files as Array<Record<string, unknown>> | undefined;
    const firstFile = files?.[0] as Record<string, unknown> | undefined;
    const fileId = firstFile?.id as string | undefined;

    // Prefer the channel message ts (needed for chat.update/delete/reactions)
    // files.uploadV2 embeds it under files[0].shares.private[channelId][0].ts
    const shares = firstFile?.shares as Record<string, unknown> | undefined;
    const privateShares = shares?.private as Record<string, Array<Record<string, unknown>>> | undefined;
    const publicShares = shares?.public as Record<string, Array<Record<string, unknown>>> | undefined;
    const channelEntries = privateShares?.[options.channelId] ?? publicShares?.[options.channelId];
    const messageTs = channelEntries?.[0]?.ts as string | undefined;

    logger.debug('File uploaded successfully', { fileId, messageTs, filename: options.filename });
    return messageTs ?? fileId ?? '';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to upload file', { error: message, filename: options.filename });
    throw new SlackError(SlackErrorCode.FILE_UPLOAD_FAILED, `Failed to upload file: ${message}`);
  }
}

/**
 * Upload a file from URL to Slack
 */
export async function uploadFileFromUrl(
  client: WebClient,
  options: {
    channelId: string;
    url: string;
    filename: string;
    threadTs?: string;
    initialComment?: string;
  },
  logger: Logger,
): Promise<string> {
  logger.debug('Downloading file for Slack upload', { url: options.url.substring(0, 50) });

  try {
    const response = await fetch(options.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return uploadFile(
      client,
      {
        channelId: options.channelId,
        content: buffer,
        filename: options.filename,
        threadTs: options.threadTs,
        initialComment: options.initialComment,
      },
      logger,
    );
  } catch (error) {
    if (error instanceof SlackError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to upload file from URL', { error: message });
    throw new SlackError(SlackErrorCode.FILE_UPLOAD_FAILED, `Failed to upload file from URL: ${message}`);
  }
}
