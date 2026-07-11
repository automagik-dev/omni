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

export interface StoreStreamInput {
  /** Stable relative key in the layout `{instanceId}/{YYYY-MM}/{messageId}.{ext}`. */
  key: string;
  /**
   * Source stream (e.g. Baileys media stream). Consumed once, never buffered
   * whole in the heap — this is why streaming ingest exists for large video.
   */
  stream: NodeJS.ReadableStream;
  mimeType?: string;
  /**
   * Hard byte ceiling enforced while streaming. When exceeded the write is
   * aborted (multipart upload cancelled / partial file removed) and a
   * `DownloadTooLargeError` is thrown — matching the local size-guard behavior.
   */
  maxSizeBytes?: number;
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

/** Metadata for a stored object, fetched without reading its bytes. */
export interface MediaObjectStat {
  /** Object size in bytes. */
  size: number;
}

/**
 * Whether an error thrown by a backend read/stat means "the object does not
 * exist" — as opposed to a transient or configuration failure (endpoint down,
 * bad credentials, missing bucket) that callers must surface as retryable.
 *
 * Signals (verified against Bun 1.3.9 + MinIO):
 * - local: `readFile`/`stat` throw with `code: 'ENOENT'`.
 * - remote: `Bun.S3Client` throws `S3Error` with `code: 'NoSuchKey'` for a
 *   missing object. Unreachable endpoints yield `ConnectionRefused`, bad
 *   credentials `InvalidAccessKeyId`, a missing bucket `NoSuchBucket` — none
 *   of which mean the object is gone.
 */
export function isMediaNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'NoSuchKey';
}

export interface MediaStorageBackend {
  readonly mode: MediaStorageMode;

  /** Persist bytes under `key` and return the stable reference to record. */
  store(input: StoreMediaInput): Promise<StoreMediaResult>;

  /**
   * Stream bytes to `key` without buffering the whole payload in the heap.
   * Preserves the size-guard behavior: exceeding `maxSizeBytes` aborts the
   * write and throws. Returns a `size: 0` result when the source produced no
   * bytes (the caller treats that as a failed download, same as before).
   *
   * - `local` pipes through a size-guarded `createWriteStream` (the exact
   *   behavior the WhatsApp handler had before the backend abstraction).
   * - `remote` performs a streaming/multipart `Bun.S3Client` upload.
   */
  storeStream(input: StoreStreamInput): Promise<StoreMediaResult>;

  /**
   * Read the full bytes of a previously stored `key` back into a Buffer.
   *
   * - `local` reads `{basePath}/{key}` from disk.
   * - `remote` performs an S3 GET (`Bun.S3Client`).
   *
   * This is what the media processor uses in remote mode to obtain bytes for
   * transcription/vision, since the processing service only accepts a local
   * filesystem path and cannot read an S3 key directly.
   */
  read(key: string): Promise<Buffer>;

  /**
   * Stat a previously stored `key` without reading its bytes. Returns `null`
   * when the object does not exist; throws on transient/config failures
   * (endpoint unreachable, bad credentials, …) so callers can distinguish
   * "gone" from "down right now".
   */
  stat(key: string): Promise<MediaObjectStat | null>;

  /**
   * Read an inclusive byte range `[start, endInclusive]` of a stored `key`.
   * Backends fetch ONLY the requested bytes (`fs` positional read / S3 ranged
   * GET) — never the whole object — so Range-request serving stays O(range),
   * not O(object).
   */
  readRange(key: string, start: number, endInclusive: number): Promise<Buffer>;

  /**
   * Open a byte stream over the full object without buffering it in the heap
   * (local file stream / S3 streaming GET). Used to serve full-object GETs of
   * potentially multi-GB media.
   */
  readStream(key: string): Promise<ReadableStream<Uint8Array>>;

  /**
   * Presign a time-limited GET URL for a previously stored `key`.
   * Only meaningful in `remote` mode; the local backend throws.
   */
  presignedUrl(key: string, ttlSeconds?: number): Promise<string>;
}
