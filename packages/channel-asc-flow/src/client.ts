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

  /**
   * Authenticated GET. Same one-shot re-auth as `post`, and the same reason to
   * gate it on the missing `cod_error`: a GET is idempotent, but a business 401
   * is an answer, not an expired token.
   *
   * The only reader today is `/atendimento?codigo_atendimento=…`, which is how
   * inbound media is resolved (the flow hands us a file NAME, the atendimento
   * carries the bytes).
   */
  async get(path: string, query: Record<string, string | number> = {}): Promise<AscFlowResponse> {
    let response = await this.rawRequest('GET', path, query, undefined, await this.getToken());

    if (response.status === 401 && codErrorOf(response.body) === undefined) {
      this.logger.info('[asc-flow] 401 without cod_error — re-authenticating and retrying', { path });
      response = await this.rawRequest('GET', path, query, undefined, await this.getToken(true));
    }

    return response;
  }

  private rawPost(
    path: string,
    payload: Record<string, unknown>,
    token?: string,
    form = false,
  ): Promise<AscFlowResponse> {
    return this.rawRequest('POST', path, {}, payload, token, form);
  }

  /**
   * Authenticated POST of a FORM body, for the endpoints that do not read JSON.
   *
   * `/sendMsgInterativaAvancado` is one: sent as JSON it answers
   * `400 Faltando identificador da conta` with `cod_conta` right there in the
   * body, because it never parses it. Sent as `application/x-www-form-urlencoded`
   * with PHP-style nested keys (`msg_interativa_parametros[list][secao][0]…`)
   * the same payload is accepted. Measured 06/09/2026.
   *
   * Percent-encoding is UTF-8, the platform's `/mensagem` latin-1 rule does NOT
   * apply here: `acentuação · ç ã` came back off the handset intact.
   */
  async callForm(path: string, payload: Record<string, unknown>): Promise<unknown> {
    let response = await this.rawPost(path, payload, await this.getToken(), true);
    if (response.status === 401 && codErrorOf(response.body) === undefined) {
      response = await this.rawPost(path, payload, await this.getToken(true), true);
    }
    if (isPlatformOk(response)) return response.body;

    const codError = codErrorOf(response.body);
    throw new AscFlowApiError(
      mapHttpStatusToAscFlowError(response.status, codError !== undefined),
      `ASC ${path} failed (HTTP ${response.status}${codError === undefined ? '' : `, cod_error ${codError}`})`,
      { httpStatus: response.status, operation: path, codError, raw: JSON.stringify(response.body).slice(0, 500) },
    );
  }

  private async rawRequest(
    method: 'GET' | 'POST',
    path: string,
    query: Record<string, string | number>,
    payload: Record<string, unknown> | undefined,
    token?: string,
    form = false,
  ): Promise<AscFlowResponse> {
    const headers: Record<string, string> = {
      'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
    };
    if (token) headers.authorization = `Bearer ${token}`;

    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers,
        ...(payload === undefined ? {} : { body: form ? formEncode(payload) : JSON.stringify(payload) }),
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

/**
 * PHP-style nested form encoding — `{a: {b: [1]}}` → `a[b][0]=1`.
 *
 * The shape the platform's form endpoints expect; a nested object sent as a
 * JSON string in a form field is not read (`/sendMsgInterativaAvancado`
 * answered `Contato com telefone é obrigatório` for exactly that).
 */
function formEncode(payload: Record<string, unknown>): string {
  const params = new URLSearchParams();
  const walk = (value: unknown, key: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${key}[${i}]`));
    } else if (typeof value === 'object' && value !== null) {
      for (const [k, v] of Object.entries(value)) walk(v, key ? `${key}[${k}]` : k);
    } else if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  };
  walk(payload, '');
  return params.toString();
}
