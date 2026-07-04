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
  /**
   * Client used ONLY for `presign()`. When `publicEndpoint` is configured this
   * signs URLs against the externally-reachable host (so agent runtimes outside
   * the cluster can fetch them); uploads/reads keep using `client` and the
   * internal `endpoint`. Without `publicEndpoint` this IS `client`.
   */
  private presignClient: Bun.S3Client;
  private presignTtlSeconds: number;

  constructor(config: S3BackendConfig) {
    this.presignTtlSeconds = config.presignTtlSeconds;
    const clientOptions = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretKey,
      bucket: config.bucket,
      region: config.region,
      ...(config.forcePathStyle ? {} : { virtualHostedStyle: true }),
    };
    this.client = new Bun.S3Client({
      ...clientOptions,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
    this.presignClient = config.publicEndpoint
      ? new Bun.S3Client({ ...clientOptions, endpoint: config.publicEndpoint })
      : this.client;
    log.info('Initialized S3 media backend', {
      bucket: config.bucket,
      endpoint: config.endpoint ?? 'aws',
      publicEndpoint: config.publicEndpoint ?? config.endpoint ?? 'aws',
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
   * writer is ended with the error and the error rethrown, mirroring the local
   * size-guard. Like the local backend (which `rm`s the partial/empty file),
   * no object is left behind for an empty or aborted stream: `delete(key)`
   * runs best-effort in both paths. This is REQUIRED, not defensive —
   * observed on Bun 1.3.9 against MinIO, `writer.end(error)` does NOT abort
   * the upload: it commits the bytes written so far as a complete object
   * (single-part and multipart alike), and `writer.end()` on an empty stream
   * commits a 0-byte object.
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
      // End the writer, then remove whatever it committed: Bun's S3 writer
      // `end(error)` does NOT abort — it commits the bytes written so far as a
      // complete object (verified against MinIO), so the delete is what
      // actually prevents an orphaned partial object.
      await Promise.resolve(writer.end(error as Error)).catch(() => {});
      await this.deleteQuietly(key);
      throw error;
    }
    await writer.end();
    if (size === 0) {
      // Mirror the local backend: an empty stream must not leave a stored
      // object behind (writer.end() commits a 0-byte object without this).
      await this.deleteQuietly(key);
      log.debug('Removed empty media object from S3', { key });
      return { reference: key, size, mimeType };
    }
    log.debug('Streamed media to S3', { key, size });
    return { reference: key, size, mimeType };
  }

  /** Best-effort delete for cleanup paths — never masks the original error. */
  private async deleteQuietly(key: string): Promise<void> {
    try {
      await this.client.delete(key);
    } catch (error) {
      log.warn('Failed to delete orphaned S3 object', { key, error: String(error) });
    }
  }

  async read(key: string): Promise<Buffer> {
    const bytes = await this.client.file(key).arrayBuffer();
    log.debug('Read media from S3', { key, size: bytes.byteLength });
    return Buffer.from(bytes);
  }

  async presignedUrl(key: string, ttlSeconds: number = this.presignTtlSeconds): Promise<string> {
    return this.presignClient.presign(key, { expiresIn: ttlSeconds, method: 'GET' });
  }
}
