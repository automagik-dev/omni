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
    const fileId = (resultAny.file as Record<string, unknown>)?.id as string | undefined;
    logger.debug('File uploaded successfully', { fileId, filename: options.filename });
    return fileId ?? '';
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
