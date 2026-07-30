/**
 * Hermes (Mutant) API client.
 *
 * Wraps the Hermes REST endpoints scoped to a single WhatsApp line
 * (`media_id` UUID) + username/password pair. One instance per Hermes Omni
 * instance.
 *
 * Auth model: POST /api/v2/users/sign_in with `{ username, password }`
 * returns `{ jwt }`. The token is cached and sent as `Authorization:
 * Bearer <jwt>` on every call. On a 401 the client re-signs-in ONCE and
 * retries the request; a second 401 throws `HERMES_AUTH_FAILED`.
 *
 * Source of truth: the official Mutant Postman collection ("Hermes API").
 */

import type { HermesOutboundMessage, HermesSendResponse, HermesSignInResponse, HermesUploadResponse } from './types';
import { HermesApiError, HermesErrorCode, mapHttpStatusToHermesError } from './utils/errors';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface HermesClientOptions {
  /** Base URL of the Hermes deployment (trailing slash tolerated). */
  baseUrl: string;
  username: string;
  password: string;
  /** Hermes UUID of the WhatsApp line — injected as `media_id` on every call. */
  mediaId: string;
  timeoutMs?: number;
}

interface HermesRequestInit {
  method: 'GET' | 'POST' | 'DELETE';
  body?: string | ArrayBuffer;
  contentType?: string;
  operation: string;
}

export class HermesClient {
  readonly mediaId: string;

  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  /** Cached JWT from the last successful sign_in. */
  private jwt: string | null = null;

  constructor(opts: HermesClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.username = opts.username;
    this.password = opts.password;
    this.mediaId = opts.mediaId;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ─────────────────────────────────────────────────────────────
  // Auth
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /api/v2/users/sign_in — exchange username/password for a JWT.
   * Caches the token for subsequent calls. Throws `HERMES_AUTH_FAILED` when
   * the credentials are rejected or the response carries no `jwt`.
   */
  async signIn(): Promise<string> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/api/v2/users/sign_in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });
    if (!res.ok) {
      throw await this.errorFromResponse(res, 'sign_in', HermesErrorCode.AUTH_FAILED);
    }
    const parsed = (await res.json()) as HermesSignInResponse;
    if (!parsed.jwt) {
      throw new HermesApiError(HermesErrorCode.AUTH_FAILED, 'Hermes sign_in returned no jwt (malformed response)', {
        operation: 'sign_in',
      });
    }
    this.jwt = parsed.jwt;
    return parsed.jwt;
  }

  /** True when the configured credentials sign in successfully (connect/getHealth). */
  async ping(): Promise<boolean> {
    try {
      await this.signIn();
      return true;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Messages
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /api/v2/messages — wraps the message in the Hermes envelope,
   * injecting the line `media_id`. Returns `{ message: { id } }` where `id`
   * is the Hermes UUID later referenced by `statuses[].id` webhooks.
   */
  async sendMessage(message: HermesOutboundMessage): Promise<HermesSendResponse> {
    const res = await this.authorizedFetch('/api/v2/messages', {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ message: { media_id: this.mediaId, ...message } }),
      operation: 'sendMessage',
    });
    return this.parseJson<HermesSendResponse>(res);
  }

  /** POST /api/v2/messages/read — mark an incoming message (wamid) as read. */
  async markAsRead(wamid: string): Promise<void> {
    const res = await this.authorizedFetch('/api/v2/messages/read', {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ message: { media_id: this.mediaId, id: wamid } }),
      operation: 'markAsRead',
    });
    await res.text();
  }

  /**
   * POST /api/v2/upload?media_id=… — upload raw bytes (< 2 MB per Hermes
   * docs) with their Content-Type. Returns the file `id` usable in
   * media-via-id sends.
   */
  async upload(bytes: ArrayBuffer, contentType: string): Promise<HermesUploadResponse> {
    const res = await this.authorizedFetch(`/api/v2/upload?media_id=${encodeURIComponent(this.mediaId)}`, {
      method: 'POST',
      contentType,
      body: bytes,
      operation: 'upload',
    });
    return this.parseJson<HermesUploadResponse>(res);
  }

  // ─────────────────────────────────────────────────────────────
  // HTTP helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Perform an authenticated request. Signs in lazily when no JWT is cached;
   * on a 401 response, re-signs-in ONCE and retries. A second 401 throws
   * `HERMES_AUTH_FAILED`. Non-401 failures map via HTTP status.
   */
  private async authorizedFetch(path: string, init: HermesRequestInit): Promise<Response> {
    const token = this.jwt ?? (await this.signIn());
    let res = await this.doFetch(path, init, token);

    if (res.status === 401) {
      this.jwt = null;
      const freshToken = await this.signIn();
      res = await this.doFetch(path, init, freshToken);
      if (res.status === 401) {
        throw new HermesApiError(
          HermesErrorCode.AUTH_FAILED,
          `Hermes rejected a freshly issued JWT during ${init.operation} — check credentials`,
          { httpStatus: 401, operation: init.operation },
        );
      }
    }

    if (!res.ok) {
      throw await this.errorFromResponse(res, init.operation);
    }
    return res;
  }

  private doFetch(path: string, init: HermesRequestInit, token: string): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (init.contentType) headers['Content-Type'] = init.contentType;
    return this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body,
    });
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  private async errorFromResponse(res: Response, operation: string, codeOverride?: string): Promise<HermesApiError> {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      /* body unreadable — keep empty */
    }
    const code = codeOverride ?? mapHttpStatusToHermesError(res.status);
    const message = `HTTP ${res.status} from Hermes ${operation}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`;
    return new HermesApiError(code, message, {
      httpStatus: res.status,
      operation,
      raw: bodyText || undefined,
    });
  }
}
