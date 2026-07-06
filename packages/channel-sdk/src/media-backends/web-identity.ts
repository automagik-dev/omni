/**
 * IRSA / web-identity S3 credentials via STS `AssumeRoleWithWebIdentity`.
 *
 * On EKS, the pod identity webhook mounts a projected ServiceAccount token and
 * injects `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` when the
 * ServiceAccount carries the `eks.amazonaws.com/role-arn` annotation.
 * Exchanging that token for temporary S3 credentials is a single UNSIGNED
 * HTTPS call — the web-identity token IS the authentication, so no SigV4
 * signing and no `@aws-sdk` dependency are needed (repo rule: Bun-native only).
 *
 * {@link WebIdentityCredentialProvider} caches the minted credentials and
 * refreshes them once they are within {@link REFRESH_MARGIN_MS} of expiry,
 * re-reading the token file on every exchange (kubelet rotates the projected
 * token). The XML parse step ({@link parseAssumeRoleWithWebIdentityResponse})
 * is a pure function so it is unit-testable without any network.
 */

import { readFile } from 'node:fs/promises';
import { createLogger } from '@omni/core';
import { z } from 'zod';
import type { S3WebIdentityParams } from './config';

const log = createLogger('services:media-backends:web-identity');

/** Temporary credentials minted by STS AssumeRoleWithWebIdentity. */
export interface StsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

/**
 * Credential-source contract the S3 backend consumes. `source` is surfaced in
 * logs so operators can tell how a running pod authenticates to S3.
 */
export interface S3CredentialProvider {
  readonly source: 'web-identity';
  getCredentials(): Promise<StsCredentials>;
  /**
   * Mint a fresh credential regardless of cache freshness, updating the cache.
   * The S3 backend calls this before signing a presigned URL whose TTL exceeds
   * the current credential's remaining life, so the URL is signed by a
   * full-lifetime credential rather than one about to expire.
   */
  forceRefresh(): Promise<StsCredentials>;
}

/** Refresh window: mint fresh credentials once within 10 min of expiry. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
/**
 * Safety floor for serving a cached credential after a failed refresh: only
 * reuse the cache when it still has more than this much life left, so a served
 * credential does not expire mid-operation.
 */
const STALE_SERVE_FLOOR_MS = 60 * 1000;
const STS_API_VERSION = '2011-06-15';
const ROLE_SESSION_NAME = 'omni-media';
/** Requested STS session lifetime — the ceiling on a temporary credential's life. */
export const SESSION_DURATION_SECONDS = 3600;

/** Zod gate over the fields extracted from the STS XML (external input). */
const StsCredentialsSchema = z.object({
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  sessionToken: z.string().min(1),
  expiration: z.coerce.date(),
});

/** First text content of `<tag>…</tag>` in `xml`, or undefined when absent. */
function xmlTagText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return match?.[1];
}

/**
 * Parse an STS `AssumeRoleWithWebIdentity` XML response into credentials.
 * Pure (no I/O) so malformed-response handling is unit-testable offline.
 * @throws when any of AccessKeyId/SecretAccessKey/SessionToken/Expiration is
 *   missing, empty, or (for Expiration) not a parseable timestamp.
 */
export function parseAssumeRoleWithWebIdentityResponse(xml: string): StsCredentials {
  const parsed = StsCredentialsSchema.safeParse({
    accessKeyId: xmlTagText(xml, 'AccessKeyId'),
    secretAccessKey: xmlTagText(xml, 'SecretAccessKey'),
    sessionToken: xmlTagText(xml, 'SessionToken'),
    expiration: xmlTagText(xml, 'Expiration'),
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Malformed STS AssumeRoleWithWebIdentity response: ${issues}`);
  }
  return parsed.data;
}

/** Minimal fetch shape — injection seam so tests never touch the network. */
export type StsFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface WebIdentityProviderOptions {
  /** Injection seam for tests — defaults to the global fetch. */
  fetchImpl?: StsFetch;
  /** Injection seam for tests — defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Caching credential provider over STS `AssumeRoleWithWebIdentity`.
 *
 * `getCredentials()` returns the cached credentials while they have more than
 * {@link REFRESH_MARGIN_MS} of life left, and otherwise performs a fresh
 * token exchange (single-flighted, so concurrent callers share one request).
 */
export class WebIdentityCredentialProvider implements S3CredentialProvider {
  readonly source = 'web-identity' as const;

  private readonly params: S3WebIdentityParams;
  private readonly fetchImpl: StsFetch;
  private readonly now: () => number;
  private cached: StsCredentials | null = null;
  /** Single-flight guard: concurrent refreshes share one STS exchange. */
  private inflight: Promise<StsCredentials> | null = null;

  constructor(params: S3WebIdentityParams, options: WebIdentityProviderOptions = {}) {
    this.params = params;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  async getCredentials(): Promise<StsCredentials> {
    if (this.cached && this.cached.expiration.getTime() - this.now() > REFRESH_MARGIN_MS) {
      return this.cached;
    }
    try {
      return await this.refresh();
    } catch (error) {
      return this.serveStaleOrThrow(error);
    }
  }

  /**
   * Force a fresh STS exchange regardless of cache freshness, updating the
   * cache. Unlike {@link getCredentials} this does NOT serve a stale credential
   * on failure — the caller (presign) decides how to degrade.
   */
  async forceRefresh(): Promise<StsCredentials> {
    return this.refresh();
  }

  /**
   * Single-flighted STS exchange shared by the refresh-margin path and
   * {@link forceRefresh}: concurrent callers await one request, and the minted
   * credential replaces the cache.
   */
  private refresh(): Promise<StsCredentials> {
    this.inflight ??= this.assumeRole()
      .then((credentials) => {
        this.cached = credentials;
        return credentials;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /**
   * The refresh exchange failed while inside the refresh margin. In
   * web-identity-only mode a brief STS blip must not break media ops when a
   * usable credential is still cached: serve the cached credential while it has
   * more than {@link STALE_SERVE_FLOOR_MS} of life left, otherwise rethrow.
   */
  private serveStaleOrThrow(error: unknown): StsCredentials {
    const cached = this.cached;
    const remainingMs = cached ? cached.expiration.getTime() - this.now() : 0;
    if (cached && remainingMs > STALE_SERVE_FLOOR_MS) {
      log.warn(`STS refresh failed, serving cached credential valid for ${Math.floor(remainingMs / 1000)}s`, {
        source: this.source,
        error: String(error),
      });
      return cached;
    }
    throw error;
  }

  /**
   * Perform the unsigned STS exchange: POST the web-identity token to the
   * regional STS endpoint and parse the XML response. The token file is
   * re-read on EVERY exchange — kubelet rotates the projected token.
   */
  private async assumeRole(): Promise<StsCredentials> {
    const token = await this.readToken();
    const body = new URLSearchParams({
      Action: 'AssumeRoleWithWebIdentity',
      Version: STS_API_VERSION,
      RoleArn: this.params.roleArn,
      RoleSessionName: ROLE_SESSION_NAME,
      WebIdentityToken: token,
      DurationSeconds: String(SESSION_DURATION_SECONDS),
    });
    const response = await this.fetchImpl(`https://sts.${this.params.stsRegion}.amazonaws.com/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 500);
      throw new Error(`STS AssumeRoleWithWebIdentity failed (HTTP ${response.status}): ${detail}`);
    }
    return parseAssumeRoleWithWebIdentityResponse(await response.text());
  }

  private async readToken(): Promise<string> {
    let raw: string;
    try {
      raw = await readFile(this.params.tokenFile, 'utf8');
    } catch (error) {
      throw new Error(`Cannot read web-identity token file "${this.params.tokenFile}": ${String(error)}`);
    }
    const token = raw.trim();
    if (!token) {
      throw new Error(`Web-identity token file "${this.params.tokenFile}" is empty`);
    }
    return token;
  }
}
