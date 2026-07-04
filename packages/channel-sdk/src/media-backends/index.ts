/**
 * Media backend factory + public surface.
 *
 * `createMediaBackend` is the single seam MediaStorageService uses to obtain a
 * backend. The S3 client is constructed lazily here and ONLY in remote mode, so
 * local deployments never build an S3 client or require S3 credentials.
 */

import { type MediaBackendConfig, resolveMediaBackendConfig } from './config';
import { LocalMediaBackend } from './local-backend';
import { S3MediaBackend } from './s3-backend';
import type { MediaStorageBackend } from './types';

export type { MediaBackendConfig, S3BackendConfig } from './config';
export { resolveMediaBackendConfig } from './config';
export { LocalMediaBackend } from './local-backend';
export { S3MediaBackend } from './s3-backend';
export type {
  MediaStorageBackend,
  MediaStorageMode,
  StoreMediaInput,
  StoreMediaResult,
  StoreStreamInput,
} from './types';

/**
 * Build the media backend selected by `config` (defaults to the environment).
 * @param basePath local filesystem base path — used only by the local backend.
 */
export function createMediaBackend(
  basePath: string,
  config: MediaBackendConfig = resolveMediaBackendConfig(),
): MediaStorageBackend {
  if (config.mode === 'remote') {
    return new S3MediaBackend(config.s3);
  }
  return new LocalMediaBackend(basePath);
}
