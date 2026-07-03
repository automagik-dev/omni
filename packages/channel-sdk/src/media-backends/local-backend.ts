/**
 * Local filesystem media backend.
 *
 * Preserves the exact behavior MediaStorageService had before the backend
 * abstraction: write bytes to `{basePath}/{key}`, creating the parent directory
 * on demand, and return the relative key as the stable reference.
 */

import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DownloadTooLargeError } from '../download-guard';
import type { MediaStorageBackend, StoreMediaInput, StoreMediaResult, StoreStreamInput } from './types';

export class LocalMediaBackend implements MediaStorageBackend {
  readonly mode = 'local' as const;

  constructor(private basePath: string) {}

  /**
   * Resolve `key` under basePath and reject any key that escapes it.
   * Keys are server-generated today, but the backend is an exported
   * channel-sdk contract — its safety must not depend on caller discipline.
   */
  private getSafePath(key: string): string {
    const fullPath = resolve(this.basePath, key);
    const base = resolve(this.basePath);
    if (fullPath !== base && !fullPath.startsWith(base + sep)) {
      throw new Error(`Media key escapes the storage root: ${key}`);
    }
    return fullPath;
  }

  async store({ key, buffer, mimeType }: StoreMediaInput): Promise<StoreMediaResult> {
    const fullPath = this.getSafePath(key);

    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(fullPath, buffer);

    return { reference: key, size: buffer.length, mimeType };
  }

  /**
   * Stream to `{basePath}/{key}` through a size-guarded transform. This is the
   * exact pipeline the WhatsApp handler used (`writeMediaStreamToFile`): count
   * bytes, abort past `maxSizeBytes`, remove a partial/empty file on failure.
   */
  async storeStream({ key, stream, mimeType, maxSizeBytes }: StoreStreamInput): Promise<StoreMediaResult> {
    const fullPath = this.getSafePath(key);

    let size = 0;
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (maxSizeBytes !== undefined && size > maxSizeBytes) {
          callback(new DownloadTooLargeError(size, maxSizeBytes));
          return;
        }
        callback(null, chunk);
      },
    });

    await mkdir(dirname(fullPath), { recursive: true });
    try {
      await pipeline(stream, sizeGuard, createWriteStream(fullPath));
    } catch (error) {
      await rm(fullPath, { force: true });
      throw error;
    }

    if (size === 0) {
      await rm(fullPath, { force: true });
    }

    return { reference: key, size, mimeType };
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.getSafePath(key));
  }

  async presignedUrl(_key?: string, _ttlSeconds?: number): Promise<string> {
    throw new Error('presignedUrl is only available in remote mode (set OMNI_MEDIA_MODE=remote)');
  }
}
