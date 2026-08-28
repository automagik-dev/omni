/**
 * ASC platform REST client (`/rest/v2`).
 *
 * Auth: `POST /authuser {login, chave}` → `result.token`, a JWT valid for one
 * hour. Cached in-process and refreshed when under 5 minutes remain, or on an
 * authentication 401.
 *
 * 🔴 The overloaded 401. `/mensagem` answers 401 with a `cod_error` body for
 * BUSINESS failures (measured 28/08: `{"cod_error":10,"msg":"Atendimento já
 * finalizado!"}`). Re-authenticating and retrying such a call re-sends the
 * bubble — a duplicate on the beneficiary's handset. So the retry fires only
 * on a 401 with NO `cod_error`.
 */

import type { Logger } from '@omni/core';

import type { AscFlowResponse } from './types';
import { AscFlowApiError, AscFlowErrorCode, mapHttpStatusToAscFlowError } from './utils/errors';

/** Refresh the token when less than this remains of its hour. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;

/** Read `cod_error` off a decoded body, if present and non-zero. */
export function codErrorOf(body: unknown): number | string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>).cod_error;
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  return value;
}

/**
 * Whether a platform response is a success. HTTP 200 alone is not enough: the
 * platform reports refusals in-band through `cod_error` / `sucesso`.
 */
export function isPlatformOk({ status, body }: AscFlowResponse): boolean {
  if (status !== 200 || typeof body !== 'object' || body === null) return false;
  const record = body as Record<string, unknown>;
  const codError = record.cod_error ?? 0;
  const sucesso = record.sucesso ?? 1;
  return (codError === 0 || codError === '0') && (sucesso === 1 || sucesso === '1');
}

export class AscFlowClient {
  private token = '';
  private tokenExpiresAt = 0;
  /** In-flight auth, so concurrent turns share one `/authuser` round trip. */
  private pendingAuth: Promise<string> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly login: string,
    private readonly chave: string,
    private readonly logger: Logger,
  ) {}

  /** Current JWT, authenticating or refreshing as needed. */
  async getToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.token;
    }
    if (!this.pendingAuth) {
      this.pendingAuth = this.authenticate().finally(() => {
        this.pendingAuth = null;
      });
    }
    return this.pendingAuth;
  }

  private async authenticate(): Promise<string> {
    const { status, body } = await this.rawPost('/authuser', { login: this.login, chave: this.chave });
    const result =
      typeof body === 'object' && body !== null ? ((body as Record<string, unknown>).result ?? null) : null;
    const token = typeof result === 'object' && result !== null ? (result as Record<string, unknown>).token : undefined;

    if (status !== 200 || typeof token !== 'string' || token.length === 0) {
      throw new AscFlowApiError(AscFlowErrorCode.AUTH_FAILED, `ASC /authuser failed (HTTP ${status})`, {
        httpStatus: status,
        operation: 'authuser',
        raw: JSON.stringify(body).slice(0, 500),
      });
    }

    this.token = token;
    this.tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
    this.logger.info('[asc-flow] platform token refreshed');
    return token;
  }

  /**
   * Authenticated POST. Retries ONCE with a fresh token on an authentication
   * 401 (no `cod_error`); a business 401 is returned to the caller as-is.
   */
  async post(path: string, payload: Record<string, unknown>): Promise<AscFlowResponse> {
    let response = await this.rawPost(path, payload, await this.getToken());

    if (response.status === 401 && codErrorOf(response.body) === undefined) {
      this.logger.info('[asc-flow] 401 without cod_error — re-authenticating and retrying', { path });
      response = await this.rawPost(path, payload, await this.getToken(true));
    }

    return response;
  }

  /** Authenticated POST that throws unless the platform reports success. */
  async call(path: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await this.post(path, payload);
    if (isPlatformOk(response)) return response.body;

    const codError = codErrorOf(response.body);
    throw new AscFlowApiError(
      mapHttpStatusToAscFlowError(response.status, codError !== undefined),
      `ASC ${path} failed (HTTP ${response.status}${codError === undefined ? '' : `, cod_error ${codError}`})`,
      {
        httpStatus: response.status,
        operation: path,
        codError,
        raw: JSON.stringify(response.body).slice(0, 500),
      },
    );
  }

  private async rawPost(path: string, payload: Record<string, unknown>, token?: string): Promise<AscFlowResponse> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new AscFlowApiError(AscFlowErrorCode.UPSTREAM_ERROR, `ASC ${path} unreachable: ${String(err)}`, {
        operation: path,
      });
    }

    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      // Non-JSON body — keep the raw text for diagnosis.
    }
    return { status: response.status, body };
  }
}
