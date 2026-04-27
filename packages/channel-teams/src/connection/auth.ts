/**
 * OAuth credential acquisition + validation for the Bot Framework Connector.
 *
 * Microsoft Entra (formerly Azure AD) issues access tokens via the standard
 * OAuth2 client-credentials flow. The Connector accepts those tokens for
 * outbound calls (`POST {serviceUrl}/v3/conversations/...`) and for the
 * health check we hit `{login}/oauth2/v2.0/token` with the bot's app
 * credentials at connect-time.
 *
 * Lookup order, mirroring the Bot Framework JS SDK:
 *   - MultiTenant   → https://login.microsoftonline.com/botframework.com
 *   - SingleTenant  → https://login.microsoftonline.com/{tenantId}
 *   - UserAssignedMSI → managed-identity endpoint (out of scope for v1)
 *
 * Scope:
 *   - MultiTenant   → https://api.botframework.com/.default
 *   - SingleTenant  → https://api.botframework.com/.default (same scope; the
 *     tenant scoping happens in the authority).
 */

import type { TeamsConnectionOptions } from '../types';

export interface TeamsAccessToken {
  /** Bearer token used for outbound calls */
  token: string;
  /** Unix ms when the token expires */
  expiresAt: number;
  /** Token type returned by AAD (always 'Bearer') */
  tokenType: string;
}

/**
 * Build the AAD authority URL for the bot's app type.
 */
export function resolveAuthority(options: Pick<TeamsConnectionOptions, 'appType' | 'tenantId'>): string {
  const appType = options.appType ?? 'MultiTenant';
  if (appType === 'SingleTenant') {
    if (!options.tenantId) {
      throw new Error('tenantId is required for SingleTenant bot deployments');
    }
    return `https://login.microsoftonline.com/${encodeURIComponent(options.tenantId)}`;
  }
  if (appType === 'UserAssignedMSI') {
    throw new Error('UserAssignedMSI is not supported in v1 — use MultiTenant or SingleTenant');
  }
  return 'https://login.microsoftonline.com/botframework.com';
}

const TOKEN_PATH = '/oauth2/v2.0/token';
const BOT_FRAMEWORK_SCOPE = 'https://api.botframework.com/.default';

/**
 * Default request timeout for AAD token acquisition + Bot Framework REST calls.
 * Operators can override via `TEAMS_REQUEST_TIMEOUT_MS` (parsed as milliseconds).
 * Falls back to 15s if unset or unparseable. A finite timeout is required so a
 * hung Microsoft endpoint cannot stall the omni connect/send pipeline.
 */
export const DEFAULT_TEAMS_REQUEST_TIMEOUT_MS = 15_000;

export function resolveRequestTimeoutMs(): number {
  const raw = process.env.TEAMS_REQUEST_TIMEOUT_MS;
  if (!raw) return DEFAULT_TEAMS_REQUEST_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TEAMS_REQUEST_TIMEOUT_MS;
}

/**
 * Acquire an access token using the OAuth2 client-credentials flow.
 *
 * Returns the bearer token plus its absolute expiry. Throws on non-2xx
 * responses; the caller is responsible for translating into a `TeamsError`.
 *
 * Each call is bounded by `TEAMS_REQUEST_TIMEOUT_MS` (default 15s) via
 * `AbortSignal.timeout()` — a hung AAD endpoint will reject with `AbortError`
 * instead of stalling indefinitely. Tests can pass a custom `signal` to
 * override.
 */
export async function acquireAccessToken(
  options: TeamsConnectionOptions,
  fetchImpl: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(resolveRequestTimeoutMs()),
): Promise<TeamsAccessToken> {
  const authority = resolveAuthority(options);
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: options.appId,
    client_secret: options.appPassword,
    scope: BOT_FRAMEWORK_SCOPE,
  });

  const response = await fetchImpl(`${authority}${TOKEN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal,
  });

  if (!response.ok) {
    const detail = await safeReadBody(response);
    throw new TokenAcquisitionError(response.status, detail);
  }

  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
  };

  if (!json.access_token) {
    throw new TokenAcquisitionError(response.status, 'AAD response missing access_token');
  }

  const expiresInMs = (json.expires_in ?? 3600) * 1000;

  return {
    token: json.access_token,
    expiresAt: Date.now() + expiresInMs,
    tokenType: json.token_type ?? 'Bearer',
  };
}

/**
 * Lightweight credential validation used at `connect()`-time.
 *
 * We treat any successful token acquisition as proof that the App ID +
 * password are valid. We deliberately do NOT call `/v3/conversations` here —
 * that endpoint requires an active conversation reference and would fail
 * for legitimately-configured bots that have not yet been DM'd.
 */
export async function validateCredentials(
  options: TeamsConnectionOptions,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<TeamsAccessToken> {
  return acquireAccessToken(options, fetchImpl, signal);
}

export class TokenAcquisitionError extends Error {
  readonly httpStatus: number;
  constructor(httpStatus: number, detail: string) {
    super(`AAD token acquisition failed (${httpStatus}): ${detail}`);
    this.name = 'TokenAcquisitionError';
    this.httpStatus = httpStatus;
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 512);
  } catch {
    return '';
  }
}
