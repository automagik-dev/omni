/**
 * S3 / MinIO media backend built on Bun's native `Bun.S3Client`.
 *
 * No `@aws-sdk`/`minio` dependency: Bun ships an S3 client that covers the two
 * operations remote media needs — `write(key, data)` to upload and
 * `presign(key, …)` to mint a time-limited GET URL. A custom `endpoint`
 * (MinIO) makes the client address buckets path-style by default, which is what
 * self-hosted S3 expects; `forcePathStyle: false` opts into virtual-hosted
 * addressing for providers that require it.
 */

import { createLogger } from '@omni/core';
import { DownloadTooLargeError } from '../download-guard';
import type { S3BackendConfig } from './config';
import type { MediaStorageBackend, StoreMediaInput, StoreMediaResult, StoreStreamInput } from './types';

const log = createLogger('services:media-backends:s3');

export class S3MediaBackend implements MediaStorageBackend {
  readonly mode = 'remote' as const;

  private client: Bun.S3Client;
  private presignTtlSeconds: number;

  constructor(config: S3BackendConfig) {
    this.presignTtlSeconds = config.presignTtlSeconds;
    this.client = new Bun.S3Client({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretKey,
      bucket: config.bucket,
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.forcePathStyle ? {} : { virtualHostedStyle: true }),
    });
    log.info('Initialized S3 media backend', {
      bucket: config.bucket,
      endpoint: config.endpoint ?? 'aws',
      forcePathStyle: config.forcePathStyle,
    });
  }

  async store({ key, buffer, mimeType }: StoreMediaInput): Promise<StoreMediaResult> {
    await this.client.write(key, buffer, mimeType ? { type: mimeType } : undefined);
    log.debug('Uploaded media to S3', { key, size: buffer.length });
    return { reference: key, size: buffer.length, mimeType };
  }

  /**
   * Streaming/multipart upload — chunks flow straight to S3 via the native
   * `Bun.S3Client` writer, never buffering the whole payload (large WhatsApp
   * video/documents). Enforces `maxSizeBytes` mid-stream: on overflow the
   * multipart upload is aborted (`writer.end(error)`) and the error rethrown,
   * mirroring the local size-guard.
   */
  async storeStream({ key, stream, mimeType, maxSizeBytes }: StoreStreamInput): Promise<StoreMediaResult> {
    const writer = this.client.file(key, mimeType ? { type: mimeType } : undefined).writer();
    let size = 0;
    try {
      for await (const chunk of stream) {
        const buffer = chunk as Buffer;
        size += buffer.length;
        if (maxSizeBytes !== undefined && size > maxSizeBytes) {
          throw new DownloadTooLargeError(size, maxSizeBytes);
        }
        await writer.write(buffer);
      }
    } catch (error) {
      // Abort the in-flight multipart upload so no partial object is committed.
      await Promise.resolve(writer.end(error as Error)).catch(() => {});
      throw error;
    }
    await writer.end();
    log.debug('Streamed media to S3', { key, size });
    return { reference: key, size, mimeType };
  }

  async presignedUrl(key: string, ttlSeconds: number = this.presignTtlSeconds): Promise<string> {
    return this.client.presign(key, { expiresIn: ttlSeconds, method: 'GET' });
  }
}
