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
import type { S3BackendConfig } from './config';
import type { MediaStorageBackend, StoreMediaInput, StoreMediaResult } from './types';

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

  async presignedUrl(key: string, ttlSeconds: number = this.presignTtlSeconds): Promise<string> {
    return this.client.presign(key, { expiresIn: ttlSeconds, method: 'GET' });
  }
}
