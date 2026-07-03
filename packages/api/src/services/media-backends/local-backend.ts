/**
 * Local filesystem media backend.
 *
 * Preserves the exact behavior MediaStorageService had before the backend
 * abstraction: write bytes to `{basePath}/{key}`, creating the parent directory
 * on demand, and return the relative key as the stable reference.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MediaStorageBackend, StoreMediaInput, StoreMediaResult } from './types';

export class LocalMediaBackend implements MediaStorageBackend {
  readonly mode = 'local' as const;

  constructor(private basePath: string) {}

  async store({ key, buffer, mimeType }: StoreMediaInput): Promise<StoreMediaResult> {
    const fullPath = join(this.basePath, key);

    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(fullPath, buffer);

    return { reference: key, size: buffer.length, mimeType };
  }

  async presignedUrl(_key?: string, _ttlSeconds?: number): Promise<string> {
    throw new Error('presignedUrl is only available in remote mode (set OMNI_MEDIA_MODE=remote)');
  }
}
