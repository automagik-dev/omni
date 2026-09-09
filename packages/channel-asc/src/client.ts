/**
 * ASC Brazil (ASCWhats GW) API client.
 *
 * Wraps the ASC REST endpoints scoped to a single WABA phone number
 * (`originador`) + static `asc-token` pair. One instance per ASC Omni
 * instance.
 *
 * Auth model: two static headers on EVERY call — `originador` (digits-only
 * E.164 of the WABA phone) and `asc-token`. There is no sign-in/refresh.
 *
 * Outbound goes through the single `POST /api/v1/messages` endpoint (a
 * faithful Graph API mirror) instead of ASC's per-type `sendX` endpoints —
 * one endpoint covers every message type.
 *
 * Source of truth: the ASC swagger ("ASCWhats GW", OpenAPI 3.0).
 */

import type { AscMediaInfo, AscOutboundMessage, AscSendResponse } from './types';
import { AscApiError, AscErrorCode, mapHttpStatusToAscError } from './utils/errors';

const DEFAULT_TIMEOUT_MS = 30_000;

export const DEFAULT_ASC_BASE_URL = 'https://apigw.ascbrazil.com.br';

export interface AscClientOptions {
  /** Gateway base URL (trailing slash tolerated). Defaults to ASC production. */
  baseUrl?: string;
  /** WABA phone number (digits-only E.164) — sent as the `originador` header. */
  originador: string;
  /** ASC access token — sent as the `asc-token` header. */
  ascToken: string;
  timeoutMs?: number;
}

interface AscRequestInit {
  method: 'GET' | 'POST';
  body?: string;
  operation: string;
}

export class AscClient {
  readonly originador: string;

  private readonly baseUrl: string;
  private readonly ascToken: string;
  private readonly timeoutMs: number;

  constructor(opts: AscClientOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_ASC_BASE_URL).replace(/\/+$/, '');
    this.originador = opts.originador;
    this.ascToken = opts.ascToken;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ─────────────────────────────────────────────────────────────
  // Messages
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/messages — Graph API mirror. Returns the Graph-shaped
   * response where `messages[0].id` is the wamid later referenced by
   * `statuses[].id` webhooks.
   */
  async sendMessage(message: AscOutboundMessage): Promise<AscSendResponse> {
    const res = await this.request('/api/v1/messages', {
      method: 'POST',
      body: JSON.stringify(message),
      operation: 'sendMessage',
    });
    return this.parseJson<AscSendResponse>(res);
  }

  /**
   * POST /api/v1/sendTypingIndicator — marks the referenced INBOUND message
   * as read AND shows the typing bubble (Cloud API semantics: self-dismisses
   * on reply or after ~25s). Requires the wamid of a received message.
   */
  async sendTypingIndicator(wamid: string): Promise<void> {
    const res = await this.request('/api/v1/sendTypingIndicator', {
      method: 'POST',
      body: JSON.stringify({ message_id: wamid }),
      operation: 'sendTypingIndicator',
    });
    await res.text();
  }

  /** POST /api/v1/markRead — mark an incoming message (wamid) as read. */
  async markRead(wamid: string): Promise<void> {
    const res = await this.request('/api/v1/markRead', {
      method: 'POST',
      body: JSON.stringify({ message_id: wamid }),
      operation: 'markRead',
    });
    await res.text();
  }

  /**
   * POST /api/v1/reactMessage — react to a message. An empty emoji removes
   * the reaction (Cloud API semantics). Dedicated endpoint because the
   * `/api/v1/messages` type enum does not include `reaction`.
   */
  async reactMessage(to: string, messageId: string, emoji: string): Promise<void> {
    const res = await this.request('/api/v1/reactMessage', {
      method: 'POST',
      body: JSON.stringify({ to, reaction: { message_id: messageId, emoji } }),
      operation: 'reactMessage',
    });
    await res.text();
  }

  // ─────────────────────────────────────────────────────────────
  // Media
  // ─────────────────────────────────────────────────────────────

  /** GET /api/v1/getDownloadMedia/{mediaId} — media lookup (mime, size, url). */
  async getMediaInfo(mediaId: string): Promise<AscMediaInfo> {
    const res = await this.request(`/api/v1/getDownloadMedia/${encodeURIComponent(mediaId)}`, {
      method: 'GET',
      operation: 'getMediaInfo',
    });
    return this.parseJson<AscMediaInfo>(res);
  }

  /**
   * GET /api/v1/downloadMedia/{mediaId} — the gateway proxies the bytes from
   * the Meta API and streams them back directly.
   */
  async downloadMedia(mediaId: string): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
    const res = await this.request(`/api/v1/downloadMedia/${encodeURIComponent(mediaId)}`, {
      method: 'GET',
      operation: 'downloadMedia',
    });
    const bytes = await res.arrayBuffer();
    const mimeType = res.headers.get('content-type') ?? 'application/octet-stream';
    return { bytes, mimeType };
  }

  // ─────────────────────────────────────────────────────────────
  // Health
  // ─────────────────────────────────────────────────────────────

  /**
   * True when the configured credentials are accepted (connect/getHealth).
   * Uses GET /api/v1/getWebhook — a cheap authenticated read.
   */
  async ping(): Promise<boolean> {
    try {
      const res = await this.request('/api/v1/getWebhook', { method: 'GET', operation: 'ping' });
      await res.text();
      return true;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // HTTP helpers
  // ─────────────────────────────────────────────────────────────

  private async request(path: string, init: AscRequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      originador: this.originador,
      'asc-token': this.ascToken,
    };
    if (init.body) headers['Content-Type'] = 'application/json';

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers,
        body: init.body,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw await this.errorFromResponse(res, init.operation);
    }
    return res;
  }

  private async parseJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * ASC documents no error envelope (most endpoints only declare a 200) —
   * classify by HTTP status and keep the raw body (truncated) for diagnosis.
   */
  private async errorFromResponse(res: Response, operation: string): Promise<AscApiError> {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      /* body unreadable — keep empty */
    }
    const code = mapHttpStatusToAscError(res.status) ?? AscErrorCode.UNKNOWN;
    const message = `HTTP ${res.status} from ASC ${operation}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`;
    return new AscApiError(code, message, {
      httpStatus: res.status,
      operation,
      raw: bodyText || undefined,
    });
  }
}
