/**
 * Media storage service - handles local filesystem storage for media files
 *
 * @see history-sync wish
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import {
  type MediaObjectStat,
  type MediaStorageBackend,
  createMediaBackend,
  isMediaNotFoundError,
} from '@omni/channel-sdk';
import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { messages } from '@omni/db';
import { eq } from 'drizzle-orm';

import { scopedHandle } from '../tenancy/tenant-scope';
import { type MediaFetchOptions, fetchMediaUrl } from '../utils/safe-media-fetch';

export type { MediaFetchOptions } from '../utils/safe-media-fetch';

const log = createLogger('services:media-storage');

/**
 * Default base path for media storage
 */
const DEFAULT_MEDIA_PATH = './data/media';

/**
 * Stored media result
 */
export interface StoredMediaResult {
  localPath: string;
  size: number;
  mimeType?: string;
}

/**
 * Media bytes materialized as a local filesystem path for a processing service
 * (which only accepts a path and reads whole files off disk), paired with a
 * cleanup that removes any temp file created for it.
 */
export interface MaterializedMedia {
  path: string;
  cleanup: () => Promise<void>;
}

function normalizeMimeType(value: string | null | undefined): string | undefined {
  return value?.split(';')[0]?.trim().toLowerCase() || undefined;
}

function isHtmlMime(value: string | null | undefined): boolean {
  const mimeType = normalizeMimeType(value);
  return mimeType === 'text/html' || mimeType === 'application/xhtml+xml';
}

function looksLikeHtml(buffer: Buffer): boolean {
  const preview = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  return preview.startsWith('<!doctype html') || preview.startsWith('<html>') || preview.startsWith('<html ');
}

function shouldRejectHtmlMedia(
  expectedMimeType: string | undefined,
  responseMimeType: string | undefined,
  buffer: Buffer,
): boolean {
  const expected = normalizeMimeType(expectedMimeType);
  if (!expected || isHtmlMime(expected)) return false;
  return isHtmlMime(responseMimeType) || looksLikeHtml(buffer);
}

/**
 * Get file extension from mime type
 */
function getExtensionFromMime(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    // Images
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
    // Audio
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/opus': '.opus',
    'audio/wav': '.wav',
    'audio/aac': '.aac',
    'audio/flac': '.flac',
    // Video
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/x-matroska': '.mkv',
    // Documents
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'text/plain': '.txt',
    'text/csv': '.csv',
    // Archives
    'application/zip': '.zip',
    'application/x-rar-compressed': '.rar',
    'application/vnd.rar': '.rar',
    'application/x-7z-compressed': '.7z',
    'application/x-tar': '.tar',
    'application/gzip': '.gz',
    'application/x-bzip2': '.bz2',
  };

  return mimeToExt[mimeType] ?? '.bin';
}

/**
 * The presigned-URL lifetime ceiling for TENANT-CONTEXT URLs, sourced from
 * `RELEASE_SLOS.yaml` `revocation.presigned_url_ttl_seconds_max`. A tenant-bound
 * URL may never outlive this window, so a revoked tenant's already-minted URL
 * self-expires inside the revocation-propagation ceiling and no post-revocation
 * refresh can extend it. DUAL-WORLD: legacy/flag-off presigns carry no tenant to
 * bind, so they are unaffected and keep the backend's own default TTL.
 */
export const PRESIGNED_URL_TTL_CEILING_SECONDS = 60;

/** RFC-4122 shape — the only value admissible as a tenant-context key segment. */
const KEY_SEGMENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Guard a path segment used to build a TENANT-CONTEXT object key or presign
 * prefix. Every segment of a tenant-prefixed key must be a well-formed UUID,
 * which serves two invariants at once:
 *
 *   * Trusted derivation — the tenant/instance/message come from the verified
 *     worker scope/envelope (ADR-0008), never a request- or attacker-controllable
 *     field, so a well-formed UUID is exactly the shape a trusted producer stamps.
 *   * Traversal safety — a UUID contains no `/`, `\`, `.`, or `..`, so the
 *     composed key can never escape its `tenants/<tenantId>/instances/<instanceId>/`
 *     prefix (fail-closed: a non-UUID segment throws rather than write to an
 *     unpredictable location).
 */
function assertTenantKeySegment(value: string, label: string): void {
  if (typeof value !== 'string' || !KEY_SEGMENT_UUID.test(value)) {
    throw new Error(`media-storage: refusing a non-UUID ${label} for a tenant-context object key`);
  }
}

export class MediaStorageService {
  private basePath: string;
  private backend: MediaStorageBackend;

  /**
   * The handle every query in this service uses.
   *
   * Inside a tenant-scoped request this is the request's tenant-stamped
   * transaction (wish: omni-full-multitenancy, G4 — see `tenancy/tenant-scope.ts`);
   * for a legacy credential, a worker, or the CLI it is the ambient pool and
   * the query issued is byte-for-byte the one issued before the conversion.
   */
  private get db(): Database {
    return scopedHandle(this.pool);
  }

  /**
   * The revocation gate a tenant-context presign must pass (G5 deliverable (c);
   * RELEASE_SLOS `presigned_url_issue_or_refresh_after_revocation_max: 0`).
   *
   * Wired by `services/index.ts` to `isTenantWorkAdmissible` on the auth-plane
   * read connection — the same trusted, non-caller-controlled `tenants.status`
   * read the batch-job and replay executors use for their dequeue gates. Null
   * until wired, which is why a tenant-context presign fails CLOSED without it.
   */
  private tenantAdmissible: ((tenantId: string) => Promise<boolean>) | null = null;

  /**
   * Inject the revocation gate. Tests inject a synthetic epoch through this,
   * which is what lets the ceiling be proven without a wall clock.
   */
  setTenantAdmissibilityCheck(check: (tenantId: string) => Promise<boolean>): void {
    this.tenantAdmissible = check;
  }

  constructor(
    private readonly pool: Database,
    basePath?: string,
    backend?: MediaStorageBackend,
  ) {
    this.basePath = basePath ?? process.env.MEDIA_STORAGE_PATH ?? DEFAULT_MEDIA_PATH;
    this.backend = backend ?? createMediaBackend(this.basePath);

    // Ensure base directory exists (only meaningful for the local backend;
    // remote deployments should not create a spurious ./data/media directory).
    if (this.backend.mode === 'local' && !existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
      log.info('Created media storage directory', { path: this.basePath });
    }
  }

  /**
   * Build the stable relative storage key for media.
   *
   * Legacy layout: `{instanceId}/{YYYY-MM}/{messageId}.{ext}`.
   * Tenant-context layout (when `trustedTenantId` is supplied):
   *   `tenants/{tenantId}/instances/{instanceId}/{YYYY-MM}/{messageId}.{ext}`.
   *
   * This key is both the local relative path and the S3 object key — it is what
   * gets recorded on the message row and never an expiring URL.
   *
   * `trustedTenantId` is derived by the CALLER from the verified worker
   * scope/envelope (ADR-0008), never from a payload or request field. When
   * present, the object is partitioned under a per-tenant prefix and every
   * segment is UUID-validated, so the key is traversal-safe by construction.
   * DUAL-WORLD: with no trusted tenant the key is byte-identical to pre-G5, and
   * reads of already-stored legacy keys are unaffected — the stored reference is
   * used verbatim, so migration of existing objects to the tenant prefix is a
   * SEPARATE later backfill, not this path.
   */
  buildKey(
    instanceId: string,
    messageId: string,
    mimeType?: string,
    timestamp?: Date,
    trustedTenantId?: string,
  ): string {
    const date = timestamp ?? new Date();
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const ext = mimeType ? getExtensionFromMime(mimeType) : '.bin';

    if (trustedTenantId !== undefined) {
      assertTenantKeySegment(trustedTenantId, 'tenantId');
      assertTenantKeySegment(instanceId, 'instanceId');
      assertTenantKeySegment(messageId, 'messageId');
      return join('tenants', trustedTenantId, 'instances', instanceId, yearMonth, `${messageId}${ext}`);
    }

    return join(instanceId, yearMonth, `${messageId}${ext}`);
  }

  /**
   * Build the absolute local storage path for media (local backend only).
   * Mirrors {@link buildKey}: `{basePath}/{key}` for whichever layout applies.
   */
  buildPath(
    instanceId: string,
    messageId: string,
    mimeType?: string,
    timestamp?: Date,
    trustedTenantId?: string,
  ): string {
    return join(this.basePath, this.buildKey(instanceId, messageId, mimeType, timestamp, trustedTenantId));
  }

  /**
   * Store media from base64 data.
   *
   * `trustedTenantId` (derived by the caller from the verified worker
   * scope/envelope) tenant-prefixes the object key; omit it for legacy/flag-off
   * writes, which stay byte-identical.
   */
  async storeFromBase64(
    instanceId: string,
    messageId: string,
    base64Data: string,
    mimeType?: string,
    timestamp?: Date,
    trustedTenantId?: string,
  ): Promise<StoredMediaResult> {
    const buffer = Buffer.from(base64Data, 'base64');
    const key = this.buildKey(instanceId, messageId, mimeType, timestamp, trustedTenantId);
    const result = await this.backend.store({ key, buffer, mimeType });

    log.debug('Stored media from base64', { messageId, reference: result.reference, size: result.size });

    return {
      localPath: result.reference,
      size: result.size,
      mimeType: result.mimeType,
    };
  }

  /**
   * Store media from buffer.
   *
   * `trustedTenantId` (derived by the caller from the verified worker
   * scope/envelope) tenant-prefixes the object key; omit it for legacy/flag-off
   * writes, which stay byte-identical.
   */
  async storeFromBuffer(
    instanceId: string,
    messageId: string,
    buffer: Buffer,
    mimeType?: string,
    timestamp?: Date,
    trustedTenantId?: string,
  ): Promise<StoredMediaResult> {
    const key = this.buildKey(instanceId, messageId, mimeType, timestamp, trustedTenantId);
    const result = await this.backend.store({ key, buffer, mimeType });

    log.debug('Stored media from buffer', { messageId, reference: result.reference, size: result.size });

    return {
      localPath: result.reference,
      size: result.size,
      mimeType: result.mimeType,
    };
  }

  /**
   * Store media from URL (download)
   */
  async storeFromUrl(
    instanceId: string,
    messageId: string,
    url: string,
    mimeType?: string,
    timestamp?: Date,
    fetchOptions?: MediaFetchOptions,
    trustedTenantId?: string,
  ): Promise<StoredMediaResult> {
    // Fetch the media (fetchOptions allows callers to supply auth headers, e.g.
    // Slack bot token). The fetch is SSRF-guarded: private/metadata targets are
    // rejected before connecting, on the initial URL and on every redirect hop.
    // In a tenant context the `OMNI_MEDIA_URL_GUARD=off` escape hatch is
    // SUBSUMED (G5 deliverable (b), ADR-0009): the media URL comes from a
    // tenant-controlled payload, so no per-deployment flag may open private
    // ranges to it. Legacy callers pass no tenant and keep the hatch.
    const response = await fetchMediaUrl(url, { ...fetchOptions, trustedTenantId });
    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.status}`);
    }

    const responseContentType = response.headers.get('content-type') ?? undefined;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (shouldRejectHtmlMedia(mimeType, responseContentType, buffer)) {
      throw new Error(
        `Downloaded media content mismatch: expected ${mimeType}, received ${responseContentType ?? 'unknown content type'}`,
      );
    }

    const contentType = mimeType ?? responseContentType;

    return this.storeFromBuffer(instanceId, messageId, buffer, contentType, timestamp, trustedTenantId);
  }

  /**
   * Update message with local path after storage
   */
  async updateMessageLocalPath(messageId: string, localPath: string): Promise<void> {
    await this.db.update(messages).set({ mediaLocalPath: localPath }).where(eq(messages.id, messageId));
  }

  /**
   * Backend-aware read: serves stored media in BOTH modes (local disk read or
   * S3 GET). In remote mode the stored reference is an S3 key with no file
   * under basePath, so a disk lookup would 404 — readers must go through the
   * backend.
   *
   * Returns `null` ONLY when the object does not exist (local ENOENT / S3
   * NoSuchKey). Transient or config failures (endpoint unreachable, bad
   * credentials, missing bucket) are rethrown so callers can surface a
   * retryable 5xx instead of a lying 404.
   */
  async readMediaViaBackend(relativePath: string): Promise<{ buffer: Buffer; size: number } | null> {
    try {
      const buffer = await this.backend.read(relativePath);
      return { buffer, size: buffer.length };
    } catch (error) {
      if (isMediaNotFoundError(error)) return null;
      throw error;
    }
  }

  /**
   * Stat a stored reference without reading its bytes. `null` means the object
   * does not exist; transient backend failures are rethrown (same contract as
   * {@link readMediaViaBackend}).
   */
  async statMedia(reference: string): Promise<MediaObjectStat | null> {
    return this.backend.stat(reference);
  }

  /**
   * Read an inclusive byte range of a stored reference. The backend fetches
   * only the requested bytes (positional file read / S3 ranged GET), so Range
   * serving never buffers the whole object.
   */
  async readMediaRange(reference: string, start: number, endInclusive: number): Promise<Buffer> {
    return this.backend.readRange(reference, start, endInclusive);
  }

  /**
   * Stream the full bytes of a stored reference without heap buffering
   * (local file stream / S3 streaming GET).
   */
  async readMediaStream(reference: string): Promise<ReadableStream<Uint8Array>> {
    return this.backend.readStream(reference);
  }

  /**
   * Get mime type from file extension
   */
  getMimeType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const extToMime: Record<string, string> = {
      // Images
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      // Audio
      '.ogg': 'audio/ogg',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.opus': 'audio/opus',
      '.wav': 'audio/wav',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
      // Video
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska',
      // Documents
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      // Archives
      '.zip': 'application/zip',
      '.rar': 'application/vnd.rar',
      '.7z': 'application/x-7z-compressed',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      '.bz2': 'application/x-bzip2',
    };

    return extToMime[ext] ?? 'application/octet-stream';
  }

  /**
   * Get base path for serving
   */
  getBasePath(): string {
    return this.basePath;
  }

  /**
   * The active storage mode (`local` | `remote`).
   */
  getStorageMode(): MediaStorageBackend['mode'] {
    return this.backend.mode;
  }

  /**
   * Read the full bytes of a stored reference back into a Buffer, delegating to
   * the active backend (local disk read or S3 GET). Used by the media processor
   * in remote mode to obtain bytes for transcription/vision, since the stored
   * reference is an S3 key rather than a readable local path.
   */
  async read(reference: string): Promise<Buffer> {
    return this.backend.read(reference);
  }

  /**
   * Presign a time-limited GET URL for a stored reference (remote mode only).
   * Throws in local mode. Consumed by remote-mode URL emission (Group 2).
   *
   * DUAL-WORLD legacy path: a presign with NO trusted tenant is byte-identical to
   * pre-G5 — the backend applies its own default TTL and there is no tenant
   * binding (a flag-off deployment has no tenant to bind).
   *
   * Tenant-context path (`trustedTenantId` supplied, derived from the verified
   * worker scope/envelope): the URL is bound to tenant + object + expiry per
   * ADR-0008:
   *   * tenant + object — a tenant may presign ONLY objects under its own
   *     `tenants/<tenantId>/` prefix; a foreign- or legacy-keyed reference is
   *     refused (the authorization decision, made against the trusted tenant, not
   *     a caller claim);
   *   * expiry — the lifetime is clamped to {@link PRESIGNED_URL_TTL_CEILING_SECONDS}
   *     (RELEASE_SLOS ≤ 60s), so a tenant-bound URL can never outlive the
   *     revocation-propagation window and no post-revocation refresh can extend it.
   *
   *   * the authorization decision — the presign is REFUSED once the tenant is
   *     revoked (suspended/archived), which is the other, independent half of
   *     the RELEASE_SLOS pair: a clamped TTL bounds how long ONE url lives, but
   *     `presigned_url_issue_or_refresh_after_revocation_max: 0` says a revoked
   *     tenant issues NONE — without the gate it could mint a fresh 60-second
   *     URL forever and every one would be "inside the ceiling".
   *
   * Proven against synthetic epochs in `presign-revocation-ceiling.test.ts`; no
   * production timing is claimed anywhere in that contract.
   */
  async presignedUrl(reference: string, ttlSeconds?: number, trustedTenantId?: string): Promise<string> {
    if (trustedTenantId === undefined) {
      // Legacy/flag-off: no tenant exists to revoke, so no gate and no clamp —
      // byte-identical to pre-G5.
      return this.backend.presignedUrl(reference, ttlSeconds);
    }

    assertTenantKeySegment(trustedTenantId, 'tenantId');
    const tenantPrefix = `${join('tenants', trustedTenantId)}/`;
    if (!reference.startsWith(tenantPrefix)) {
      throw new Error('media-storage: refusing to presign an object outside the requesting tenant prefix');
    }

    // Fail CLOSED when no gate is wired: the multitenancy world always wires one
    // (`services/index.ts`), so its absence under a tenant-context presign is a
    // misconfiguration we must not mint an unguarded URL through — the same
    // stance `batch-jobs.ts` takes for a tenant job with no auth-plane handle.
    if (!this.tenantAdmissible) {
      throw new Error('media-storage: refusing to presign — no tenant revocation check is wired');
    }
    if (!(await this.tenantAdmissible(trustedTenantId))) {
      throw new Error('media-storage: refusing to presign for a revoked tenant');
    }

    const effectiveTtl = Math.min(ttlSeconds ?? PRESIGNED_URL_TTL_CEILING_SECONDS, PRESIGNED_URL_TTL_CEILING_SECONDS);
    return this.backend.presignedUrl(reference, effectiveTtl);
  }

  /**
   * Materialize a stored reference as a local filesystem path a processing
   * service can read, with a cleanup for any temp file created.
   *
   * - `local`: the bytes already live at `{basePath}/{reference}`, so hand back
   *   that path directly with a no-op cleanup (byte-for-byte the pre-remote
   *   behavior — no copy, and cleanup never deletes the stored file).
   * - `remote`: `reference` is an S3 key, not a local path. Fetch the bytes via
   *   the storage backend and write them to an `os.tmpdir()` temp file,
   *   returning a cleanup that removes it. The temp file keeps the stored
   *   extension so processors that sniff by extension (e.g. audio duration)
   *   behave as on disk.
   *
   * Callers MUST invoke `cleanup` in a `finally` so remote temp files are
   * removed on success and on processing error alike.
   */
  async materializeForProcessing(reference: string): Promise<MaterializedMedia> {
    if (this.backend.mode === 'local') {
      return { path: join(this.basePath, reference), cleanup: async () => {} };
    }

    const buffer = await this.backend.read(reference);
    const ext = extname(reference) || '.bin';
    const tempPath = join(tmpdir(), `omni-media-${randomUUID()}${ext}`);
    try {
      await writeFile(tempPath, buffer);
    } catch (error) {
      // A failed write (ENOSPC, permissions) can leave a partial file behind.
      await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }

    return {
      path: tempPath,
      cleanup: async () => {
        await rm(tempPath, { force: true });
      },
    };
  }
}
