/**
 * S3 / MinIO media backend built on Bun's native `Bun.S3Client`.
 *
 * No `@aws-sdk`/`minio` dependency: Bun ships an S3 client that covers the two
 * operations remote media needs — `write(key, data)` to upload and
 * `presign(key, …)` to mint a time-limited GET URL. A custom `endpoint`
 * (MinIO) makes the client address buckets path-style by default, which is what
 * self-hosted S3 expects; `forcePathStyle: false` opts into virtual-hosted
 * addressing for providers that require it.
 *
 * Credential sourcing (see config.ts):
 * - static (default): the OMNI_MEDIA_S3_* key pair, client built eagerly in
 *   the constructor — byte-compatible with the pre-IRSA behavior.
 * - web-identity (IRSA): temporary credentials from STS
 *   AssumeRoleWithWebIdentity via {@link WebIdentityCredentialProvider}. The
 *   `Bun.S3Client` carries a `sessionToken` and is REBUILT whenever the
 *   provider refreshes it; on STS failure the backend falls back to the static
 *   key pair when one is configured, else surfaces the error. Storage and
 *   streaming logic is identical in both modes.
 */

import { createLogger } from '@omni/core';
import { DownloadTooLargeError } from '../download-guard';
import type { S3BackendConfig } from './config';
import {
  type MediaObjectStat,
  type MediaStorageBackend,
  type StoreMediaInput,
  type StoreMediaResult,
  type StoreStreamInput,
  isMediaNotFoundError,
} from './types';
import { type S3CredentialProvider, type StsCredentials, WebIdentityCredentialProvider } from './web-identity';

const log = createLogger('services:media-backends:s3');

interface S3Clients {
  client: Bun.S3Client;
  /**
   * Client used ONLY for `presign()`. When `publicEndpoint` is configured this
   * signs URLs against the externally-reachable host (so agent runtimes outside
   * the cluster can fetch them); uploads/reads keep using `client` and the
   * internal `endpoint`. Without `publicEndpoint` this IS `client`.
   */
  presignClient: Bun.S3Client;
}

interface ResolvedS3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/** Build the storage + presign client pair for one set of credentials. */
function buildClients(config: S3BackendConfig, credentials: ResolvedS3Credentials): S3Clients {
  const clientOptions = {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
    bucket: config.bucket,
    region: config.region,
    ...(config.forcePathStyle ? {} : { virtualHostedStyle: true }),
  };
  const client = new Bun.S3Client({
    ...clientOptions,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
  });
  const presignClient = config.publicEndpoint
    ? new Bun.S3Client({ ...clientOptions, endpoint: config.publicEndpoint })
    : client;
  return { client, presignClient };
}

/** The static key pair from config, or null when it is incomplete. */
function staticCredentials(config: S3BackendConfig): ResolvedS3Credentials | null {
  if (!config.accessKeyId || !config.secretKey) return null;
  return { accessKeyId: config.accessKeyId, secretAccessKey: config.secretKey };
}

interface WebIdentityState {
  source: 'web-identity';
  provider: S3CredentialProvider;
  /** Clients built for the provider's current sessionToken; rebuilt on refresh. */
  current: (S3Clients & { sessionToken: string }) | null;
  /** Lazily built static-key clients used only when the STS exchange fails. */
  staticFallback: S3Clients | null;
}

type CredentialState = { source: 'static'; clients: S3Clients } | WebIdentityState;

export interface S3MediaBackendOptions {
  /**
   * Injection seam for tests — replaces the {@link WebIdentityCredentialProvider}
   * the backend would otherwise build from `config.webIdentity`.
   */
  credentialProvider?: S3CredentialProvider;
}

export class S3MediaBackend implements MediaStorageBackend {
  readonly mode = 'remote' as const;

  private readonly config: S3BackendConfig;
  private readonly state: CredentialState;
  private presignTtlSeconds: number;

  constructor(config: S3BackendConfig, options: S3MediaBackendOptions = {}) {
    this.config = config;
    this.presignTtlSeconds = config.presignTtlSeconds;
    this.state =
      config.credentialSource === 'web-identity'
        ? { source: 'web-identity', provider: resolveProvider(config, options), current: null, staticFallback: null }
        : { source: 'static', clients: buildClients(config, requireStaticCredentials(config)) };
    log.info('Initialized S3 media backend', {
      bucket: config.bucket,
      endpoint: config.endpoint ?? 'aws',
      publicEndpoint: config.publicEndpoint ?? config.endpoint ?? 'aws',
      forcePathStyle: config.forcePathStyle,
      credentialSource: this.state.source,
    });
  }

  /**
   * Resolve the client pair for the current credentials. Static mode returns
   * the constructor-built pair (zero overhead). Web-identity mode asks the
   * provider (cached until ~10 min before expiry) and rebuilds the
   * `Bun.S3Client` pair whenever the sessionToken changed; when the STS
   * exchange fails it falls back to the static key pair if one exists.
   */
  private async resolveClients(): Promise<S3Clients> {
    if (this.state.source === 'static') {
      return this.state.clients;
    }
    return this.resolveWebIdentityClients(this.state);
  }

  private async resolveWebIdentityClients(state: WebIdentityState): Promise<S3Clients> {
    let credentials: StsCredentials;
    try {
      credentials = await state.provider.getCredentials();
    } catch (error) {
      return this.fallbackToStaticClients(state, error);
    }
    if (!state.current || state.current.sessionToken !== credentials.sessionToken) {
      const clients = buildClients(this.config, {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      });
      const event = state.current ? 'S3 credentials refreshed' : 'S3 credentials acquired';
      state.current = { ...clients, sessionToken: credentials.sessionToken };
      log.info(event, { source: state.provider.source, expiration: credentials.expiration.toISOString() });
    }
    return state.current;
  }

  /** STS failed: use the static key pair when configured, else surface. */
  private fallbackToStaticClients(state: WebIdentityState, error: unknown): S3Clients {
    const credentials = staticCredentials(this.config);
    if (!credentials) throw error;
    log.warn('Web-identity credential exchange failed; falling back to static S3 keys', {
      source: 'static',
      error: String(error),
    });
    state.staticFallback ??= buildClients(this.config, credentials);
    return state.staticFallback;
  }

  async store({ key, buffer, mimeType }: StoreMediaInput): Promise<StoreMediaResult> {
    const { client } = await this.resolveClients();
    await client.write(key, buffer, mimeType ? { type: mimeType } : undefined);
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
    const { client } = await this.resolveClients();
    const writer = client.file(key, mimeType ? { type: mimeType } : undefined).writer();
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
      await this.deleteQuietly(client, key);
      throw error;
    }
    await writer.end();
    if (size === 0) {
      // Mirror the local backend: an empty stream must not leave a stored
      // object behind (writer.end() commits a 0-byte object without this).
      await this.deleteQuietly(client, key);
      log.debug('Removed empty media object from S3', { key });
      return { reference: key, size, mimeType };
    }
    log.debug('Streamed media to S3', { key, size });
    return { reference: key, size, mimeType };
  }

  /** Best-effort delete for cleanup paths — never masks the original error. */
  private async deleteQuietly(client: Bun.S3Client, key: string): Promise<void> {
    try {
      await client.delete(key);
    } catch (error) {
      log.warn('Failed to delete orphaned S3 object', { key, error: String(error) });
    }
  }

  async read(key: string): Promise<Buffer> {
    const { client } = await this.resolveClients();
    const bytes = await client.file(key).arrayBuffer();
    log.debug('Read media from S3', { key, size: bytes.byteLength });
    return Buffer.from(bytes);
  }

  async stat(key: string): Promise<MediaObjectStat | null> {
    const { client } = await this.resolveClients();
    try {
      const info = await client.file(key).stat();
      return { size: info.size };
    } catch (error) {
      // Bun's S3Client throws S3Error code 'NoSuchKey' for a missing object;
      // anything else (ConnectionRefused, InvalidAccessKeyId, NoSuchBucket…)
      // is a transient/config failure the caller must NOT treat as 404.
      if (isMediaNotFoundError(error)) return null;
      throw error;
    }
  }

  /**
   * Ranged S3 GET via `S3File.slice` — fetches exactly `[start, endInclusive]`
   * (Blob-style exclusive end, hence `endInclusive + 1`), never the whole
   * object. Verified against MinIO: `slice(10, 20)` returns bytes 10..19.
   */
  async readRange(key: string, start: number, endInclusive: number): Promise<Buffer> {
    const { client } = await this.resolveClients();
    const bytes = await client
      .file(key)
      .slice(start, endInclusive + 1)
      .arrayBuffer();
    return Buffer.from(bytes);
  }

  /** Streaming S3 GET — chunks flow to the consumer without heap buffering. */
  async readStream(key: string): Promise<ReadableStream<Uint8Array>> {
    const { client } = await this.resolveClients();
    return client.file(key).stream();
  }

  async presignedUrl(key: string, ttlSeconds: number = this.presignTtlSeconds): Promise<string> {
    const { presignClient } = await this.resolveClients();
    return presignClient.presign(key, { expiresIn: ttlSeconds, method: 'GET' });
  }
}

/** Provider for web-identity mode: the injected test seam or the real one. */
function resolveProvider(config: S3BackendConfig, options: S3MediaBackendOptions): S3CredentialProvider {
  if (options.credentialProvider) return options.credentialProvider;
  if (!config.webIdentity) {
    throw new Error('credentialSource=web-identity requires webIdentity params (tokenFile, roleArn, stsRegion)');
  }
  return new WebIdentityCredentialProvider(config.webIdentity);
}

/** Static mode requires the key pair — config resolution guarantees it. */
function requireStaticCredentials(config: S3BackendConfig): ResolvedS3Credentials {
  const credentials = staticCredentials(config);
  if (!credentials) {
    throw new Error('S3 media backend in static mode requires accessKeyId + secretKey');
  }
  return credentials;
}
