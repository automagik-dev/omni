/**
 * Zenvia API v2 client.
 *
 * Scoped to one API token + sender. One instance per Zenvia Omni instance.
 *
 * Auth model: the static `X-API-TOKEN` header on every call (a token created
 * in the Zenvia console). There is no sign-in/refresh.
 *
 * Source of truth: the public Zenvia API v2 OpenAPI specification.
 */

import type { ZenviaOutboundMessage, ZenviaSendResponse } from './types';
import { ZenviaApiError, ZenviaErrorCode, mapHttpStatusToZenviaError } from './utils/errors';

const DEFAULT_TIMEOUT_MS = 30_000;

export const DEFAULT_ZENVIA_BASE_URL = 'https://api.zenvia.com/v2';

/**
 * Hosts the API token may be sent to. Inbound `fileUrl`s are fetched through
 * `downloadFile`, and the token must never leak to a URL outside Zenvia.
 */
const ZENVIA_HOST_SUFFIX = '.zenvia.com';

export interface ZenviaClientOptions {
  /** API base URL (trailing slash tolerated). Defaults to Zenvia production. */
  baseUrl?: string;
  /** API token — sent as the `X-API-TOKEN` header. */
  apiToken: string;
  timeoutMs?: number;
}

interface ZenviaRequestInit {
  method: 'GET' | 'POST';
  body?: string;
  operation: string;
}

export class ZenviaClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;

  constructor(opts: ZenviaClientOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_ZENVIA_BASE_URL).replace(/\/+$/, '');
    this.apiToken = opts.apiToken;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ─────────────────────────────────────────────────────────────
  // Messages
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /channels/whatsapp/messages. Returns the created message; its `id`
   * is what later `MESSAGE_STATUS` events reference.
   */
  async sendMessage(message: ZenviaOutboundMessage): Promise<ZenviaSendResponse> {
    const res = await this.request('/channels/whatsapp/messages', {
      method: 'POST',
      body: JSON.stringify(message),
      operation: 'sendMessage',
    });
    return this.parseJson<ZenviaSendResponse>(res);
  }

  // ─────────────────────────────────────────────────────────────
  // Media
  // ─────────────────────────────────────────────────────────────

  /**
   * Fetch an inbound file by the `fileUrl` Zenvia put on the webhook. Only
   * https URLs are fetched, and the token is attached only when the host is
   * Zenvia's — never to a third-party URL. Returns the raw response so the caller can apply the
   * SDK download guard before reading the body.
   */
  async downloadFile(fileUrl: string): Promise<Response> {
    const url = new URL(fileUrl);
    if (url.protocol !== 'https:') {
      throw new ZenviaApiError(ZenviaErrorCode.INVALID_REQUEST, 'Refusing to download a non-https file URL', {
        operation: 'downloadFile',
      });
    }
    const headers: Record<string, string> = {};
    if (url.hostname.endsWith(ZENVIA_HOST_SUFFIX)) {
      headers['X-API-TOKEN'] = this.apiToken;
    }
    const res = await this.fetchWithTimeout(url.toString(), { method: 'GET', headers });
    if (!res.ok) {
      throw await this.errorFromResponse(res, 'downloadFile');
    }
    return res;
  }

  // ─────────────────────────────────────────────────────────────
  // Health
  // ─────────────────────────────────────────────────────────────

  /**
   * True when the configured token is accepted. Uses GET /subscriptions — a
   * cheap authenticated read available to every account.
   */
  async ping(): Promise<boolean> {
    try {
      const res = await this.request('/subscriptions', { method: 'GET', operation: 'ping' });
      await res.text();
      return true;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // HTTP helpers
  // ─────────────────────────────────────────────────────────────

  private async request(path: string, init: ZenviaRequestInit): Promise<Response> {
    const headers: Record<string, string> = { 'X-API-TOKEN': this.apiToken };
    if (init.body) headers['Content-Type'] = 'application/json';

    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body,
    });

    if (!res.ok) {
      throw await this.errorFromResponse(res, init.operation);
    }
    return res;
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

  /**
   * Zenvia errors come as `{ code, message, details[] }`. Classify by HTTP
   * status and keep the vendor code + message (truncated) for diagnosis.
   */
  private async errorFromResponse(res: Response, operation: string): Promise<ZenviaApiError> {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      /* body unreadable — keep empty */
    }
    let vendorCode: string | undefined;
    let vendorMessage: string | undefined;
    try {
      const parsed = JSON.parse(bodyText) as { code?: unknown; message?: unknown };
      if (typeof parsed.code === 'string') vendorCode = parsed.code;
      if (typeof parsed.message === 'string') vendorMessage = parsed.message;
    } catch {
      /* not JSON — fall back to the raw body */
    }
    const code = mapHttpStatusToZenviaError(res.status) ?? ZenviaErrorCode.UNKNOWN;
    const detail = vendorMessage ?? bodyText.slice(0, 200);
    const message = `HTTP ${res.status} from Zenvia ${operation}${vendorCode ? ` (${vendorCode})` : ''}${detail ? `: ${detail}` : ''}`;
    return new ZenviaApiError(code, message, {
      httpStatus: res.status,
      operation,
      vendorCode,
      raw: bodyText || undefined,
    });
  }
}
