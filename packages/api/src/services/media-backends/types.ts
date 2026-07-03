/**
 * Pluggable media storage backend contract.
 *
 * A backend is selected at construction time by {@link resolveMediaBackendConfig}
 * (env `OMNI_MEDIA_MODE`). Both backends persist bytes under the same stable
 * relative key — `{instanceId}/{YYYY-MM}/{messageId}.{ext}` — and return that key
 * as the reference recorded on the message row (`messages.mediaLocalPath`). The
 * only difference is where the bytes land and how they are read back:
 *
 * - `local` writes to `{basePath}/{key}` on the local filesystem (unchanged behavior).
 * - `remote` uploads to an S3/MinIO bucket under `key` and can presign GET URLs.
 *
 * @see media-storage.ts for the service that computes keys and delegates here.
 */

export type MediaStorageMode = 'local' | 'remote';

export interface StoreMediaInput {
  /** Stable relative key in the layout `{instanceId}/{YYYY-MM}/{messageId}.{ext}`. */
  key: string;
  buffer: Buffer;
  mimeType?: string;
}

export interface StoreMediaResult {
  /**
   * Stable reference to persist on the message row. It is the same relative key
   * in both modes (a local relative path for `local`, an S3 object key for
   * `remote`) — never an expiring URL.
   */
  reference: string;
  size: number;
  mimeType?: string;
}

export interface MediaStorageBackend {
  readonly mode: MediaStorageMode;

  /** Persist bytes under `key` and return the stable reference to record. */
  store(input: StoreMediaInput): Promise<StoreMediaResult>;

  /**
   * Presign a time-limited GET URL for a previously stored `key`.
   * Only meaningful in `remote` mode; the local backend throws.
   */
  presignedUrl(key: string, ttlSeconds?: number): Promise<string>;
}
