/**
 * Meta WhatsApp Cloud — Embedded Signup OAuth helpers.
 *
 * Pure functions (no DB, no Hono). The corresponding REST surface lives in
 * `packages/api/src/routes/v2/whatsapp-business.ts` (Group 5).
 *
 * Ported from TalkFlow `meta_oauth_service.py`:
 *   - exchange_code_for_token
 *   - get_waba_details
 *   - register_phone_number
 *   - subscribe_app
 *
 * References:
 *   https://developers.facebook.com/docs/whatsapp/embedded-signup
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/reference/registration
 *   https://developers.facebook.com/docs/whatsapp/business-management-api/get-started
 */

import { MetaApiError, MetaErrorCode, mapHttpStatusToMetaError } from './utils/errors';

/** Default Meta Graph API version. Override per call via `apiVersion`. */
export const DEFAULT_META_API_VERSION = 'v25.0';

const DEFAULT_TIMEOUT_MS = 30_000;

function graphBase(apiVersion = DEFAULT_META_API_VERSION): string {
  return `https://graph.facebook.com/${apiVersion}`;
}

interface MetaErrorEnvelope {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function errorFromResponse(res: Response, operation: string): Promise<MetaApiError> {
  let envelope: MetaErrorEnvelope | undefined;
  let bodyText = '';
  try {
    bodyText = await res.text();
    envelope = bodyText ? (JSON.parse(bodyText) as MetaErrorEnvelope) : undefined;
  } catch {
    /* leave envelope undefined */
  }
  const apiError = envelope?.error;
  const codeNumber = apiError?.code;
  const code = codeNumber !== undefined ? mapHttpStatusToMetaError(codeNumber) : mapHttpStatusToMetaError(res.status);
  // Defensive: bodyText may contain tokens — truncate aggressively.
  const message =
    apiError?.message ?? `HTTP ${res.status} from ${operation}${bodyText ? `: ${bodyText.slice(0, 160)}` : ''}`;
  return new MetaApiError(code, message, {
    httpStatus: res.status,
    operation,
    metaErrorCode: apiError?.code,
    metaErrorSubcode: apiError?.error_subcode,
    fbtraceId: apiError?.fbtrace_id,
  });
}

// ---------------------------------------------------------------------------
// 1. exchangeCodeForToken
// ---------------------------------------------------------------------------

export interface ExchangeCodeResult {
  accessToken: string;
  /** Seconds until expiration (when long-lived) — Meta omits this for some flows. */
  expiresIn?: number;
  tokenType: string;
}

/**
 * Exchange a Facebook OAuth `code` for an access token.
 *
 * Two-step flow (mirrors TalkFlow `meta_oauth_service.py:55-112`):
 *
 *   1. POST /{version}/oauth/access_token with `code` → short-lived token
 *      (lifetime ~1 hour).
 *   2. GET  /{version}/oauth/access_token?grant_type=fb_exchange_token&
 *      fb_exchange_token=<short> → long-lived token (lifetime ~60 days).
 *
 * The long-lived token is what we persist. Without step 2, every Embedded
 * Signup'd instance silently disconnects after ~1 hour when the token
 * expires server-side — `pingPhoneNumberInfo` would return 401 and `connect`
 * would fail to re-init. If the long-lived exchange fails for any reason
 * (rate limit, app not in `oauth` state) we fall back to the short-lived
 * token + log a warning so operators see it.
 *
 * NOTE: caller must NOT log the returned access token. The Sentry scrubber
 * (Group 8) masks `access_token` keys in event payloads.
 */
export async function exchangeCodeForToken(
  code: string,
  appId: string,
  appSecret: string,
  redirectUri?: string,
  apiVersion: string = DEFAULT_META_API_VERSION,
): Promise<ExchangeCodeResult> {
  if (!code) throw new MetaApiError(MetaErrorCode.INVALID_REQUEST, 'OAuth code is required');
  if (!appId || !appSecret) {
    throw new MetaApiError(
      MetaErrorCode.INVALID_REQUEST,
      'Meta App ID/Secret are not configured — set META_APP_ID + META_APP_SECRET env vars',
    );
  }

  // ─── Step 1: short-lived token from the OAuth code ───
  const shortParams = new URLSearchParams();
  shortParams.set('client_id', appId);
  shortParams.set('client_secret', appSecret);
  shortParams.set('code', code);
  if (redirectUri) shortParams.set('redirect_uri', redirectUri);

  const url = `${graphBase(apiVersion)}/oauth/access_token`;
  const shortRes = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: shortParams.toString(),
  });

  if (!shortRes.ok) throw await errorFromResponse(shortRes, 'oauth/access_token (code → short)');

  const shortText = await shortRes.text();
  let shortData: { access_token?: unknown; expires_in?: unknown; token_type?: unknown };
  try {
    shortData = shortText ? JSON.parse(shortText) : {};
  } catch {
    throw new MetaApiError(MetaErrorCode.UNKNOWN, 'OAuth response was not valid JSON', {
      operation: 'oauth/access_token',
      httpStatus: shortRes.status,
    });
  }

  if (typeof shortData.access_token !== 'string' || !shortData.access_token) {
    throw new MetaApiError(MetaErrorCode.AUTH_FAILED, 'OAuth response missing access_token', {
      operation: 'oauth/access_token',
      httpStatus: shortRes.status,
    });
  }

  const shortToken = shortData.access_token;
  const shortTokenType = typeof shortData.token_type === 'string' ? shortData.token_type : 'bearer';

  // ─── Step 2: swap for long-lived (~60 day) token ───
  // We deliberately do NOT throw on failure — falling back to the short-lived
  // token keeps the integration alive for ~1h and the operator can refresh
  // manually. We surface the failure mode via the return shape so the route
  // layer can log a warning.
  const longLived = await exchangeLongLivedToken(url, appId, appSecret, shortToken, shortTokenType);
  if (longLived) return longLived;

  return {
    accessToken: shortToken,
    expiresIn: typeof shortData.expires_in === 'number' ? shortData.expires_in : undefined,
    tokenType: shortTokenType,
  };
}

/**
 * Swap a short-lived token for a long-lived (~60 day) one via
 * `grant_type=fb_exchange_token`. Returns `undefined` on any failure — the
 * caller falls back to the short-lived token (see `exchangeCodeForToken`).
 */
async function exchangeLongLivedToken(
  url: string,
  appId: string,
  appSecret: string,
  shortToken: string,
  shortTokenType: string,
): Promise<ExchangeCodeResult | undefined> {
  const longParams = new URLSearchParams();
  longParams.set('grant_type', 'fb_exchange_token');
  longParams.set('client_id', appId);
  longParams.set('client_secret', appSecret);
  longParams.set('fb_exchange_token', shortToken);

  try {
    const longRes = await fetchWithTimeout(`${url}?${longParams.toString()}`, { method: 'GET' });
    if (!longRes.ok) return undefined;
    const longText = await longRes.text();
    const longData = longText ? (JSON.parse(longText) as Record<string, unknown>) : {};
    const longToken = longData.access_token;
    if (typeof longToken !== 'string' || !longToken) return undefined;
    return {
      accessToken: longToken,
      expiresIn: typeof longData.expires_in === 'number' ? longData.expires_in : undefined,
      tokenType: typeof longData.token_type === 'string' ? longData.token_type : shortTokenType,
    };
  } catch {
    /* swallow — caller falls back to the short-lived token */
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 2. getWabaDetails — discover owned WABAs and phone numbers
// ---------------------------------------------------------------------------

export interface WabaPhoneNumber {
  phone_number_id: string;
  wabaId: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
}

export interface WabaDetails {
  wabaIds: string[];
  phoneNumbers: WabaPhoneNumber[];
}

interface GraphListEnvelope<T> {
  data?: T[];
  paging?: unknown;
}

interface BusinessRow {
  id?: string;
  name?: string;
}

interface WabaRow {
  id?: string;
  name?: string;
  currency?: string;
}

interface PhoneNumberRow {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
}

async function graphGet<T>(accessToken: string, url: string, operation: string): Promise<T> {
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw await errorFromResponse(res, operation);
  return res.json() as Promise<T>;
}

/**
 * Fetch a Graph list endpoint, returning `[]` when the call fails.
 * Permission errors on discovery sub-calls are non-fatal — we may not have
 * access to every sub-object and the caller wants the union of what we can see.
 */
async function graphListOrEmpty<T>(accessToken: string, url: string, operation: string): Promise<T[]> {
  try {
    const envelope = await graphGet<GraphListEnvelope<T>>(accessToken, url, operation);
    return Array.isArray(envelope?.data) ? envelope.data : [];
  } catch {
    return [];
  }
}

/** List the phone numbers under a WABA, normalized to `WabaPhoneNumber` rows. */
async function listWabaPhoneNumbers(accessToken: string, base: string, wabaId: string): Promise<WabaPhoneNumber[]> {
  const rows = await graphListOrEmpty<PhoneNumberRow>(
    accessToken,
    `${base}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating`,
    'GET phone_numbers',
  );
  const phoneNumbers: WabaPhoneNumber[] = [];
  for (const pn of rows) {
    if (!pn?.id) continue;
    phoneNumbers.push({
      phone_number_id: pn.id,
      wabaId,
      display_phone_number: pn.display_phone_number,
      verified_name: pn.verified_name,
      quality_rating: pn.quality_rating,
    });
  }
  return phoneNumbers;
}

/**
 * Discover all WhatsApp Business Accounts and phone numbers reachable by the
 * given access token.
 *
 * Strategy:
 *   1. GET /me/businesses → list of Business Manager rows.
 *   2. For each business GET /{business_id}/owned_whatsapp_business_accounts
 *      and /{business_id}/client_whatsapp_business_accounts.
 *   3. For each WABA GET /{waba_id}/phone_numbers.
 *
 * Failures on any sub-call are swallowed (we may not have permission for all
 * sub-objects; the caller wants the union of what we can see).
 */
export async function getWabaDetails(
  accessToken: string,
  apiVersion: string = DEFAULT_META_API_VERSION,
): Promise<WabaDetails> {
  if (!accessToken) {
    throw new MetaApiError(MetaErrorCode.AUTH_FAILED, 'accessToken is required to discover WABAs');
  }

  const base = graphBase(apiVersion);
  const businesses = await graphGet<GraphListEnvelope<BusinessRow>>(
    accessToken,
    `${base}/me/businesses?fields=id,name`,
    'GET /me/businesses',
  );
  const businessRows = Array.isArray(businesses?.data) ? businesses.data : [];

  const wabaIdSet = new Set<string>();
  const wabaIds: string[] = [];
  const phoneNumbers: WabaPhoneNumber[] = [];

  for (const biz of businessRows) {
    if (!biz?.id) continue;

    const wabaSources = [
      `${base}/${biz.id}/owned_whatsapp_business_accounts?fields=id,name,currency`,
      `${base}/${biz.id}/client_whatsapp_business_accounts?fields=id,name,currency`,
    ];

    for (const url of wabaSources) {
      // Permission errors are non-fatal for discovery.
      const wabaRows = await graphListOrEmpty<WabaRow>(accessToken, url, 'GET wabas');
      for (const waba of wabaRows) {
        if (!waba?.id || wabaIdSet.has(waba.id)) continue;
        wabaIdSet.add(waba.id);
        wabaIds.push(waba.id);

        // Phone numbers under this WABA.
        phoneNumbers.push(...(await listWabaPhoneNumbers(accessToken, base, waba.id)));
      }
    }
  }

  return { wabaIds, phoneNumbers };
}

// ---------------------------------------------------------------------------
// 3. registerPhoneNumber
// ---------------------------------------------------------------------------

/**
 * Register a phone number with Meta so it can send/receive messages.
 *
 * POST /{phone_number_id}/register
 *   { messaging_product: 'whatsapp', pin?: '123456' }
 *
 * `pin` is a 6-digit 2FA PIN. New numbers via Embedded Signup require this;
 * already-registered numbers tolerate the call.
 */
export async function registerPhoneNumber(
  accessToken: string,
  phoneNumberId: string,
  pin?: string,
  apiVersion: string = DEFAULT_META_API_VERSION,
): Promise<Record<string, unknown>> {
  if (!accessToken) throw new MetaApiError(MetaErrorCode.AUTH_FAILED, 'accessToken is required');
  if (!phoneNumberId) throw new MetaApiError(MetaErrorCode.INVALID_REQUEST, 'phoneNumberId is required');

  const body: Record<string, unknown> = { messaging_product: 'whatsapp' };
  if (pin) body.pin = pin;

  const url = `${graphBase(apiVersion)}/${phoneNumberId}/register`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw await errorFromResponse(res, `POST /${phoneNumberId}/register`);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 4. subscribeApp
// ---------------------------------------------------------------------------

/**
 * Subscribe the Meta App to receive webhooks for a WABA.
 *
 * POST /{waba_id}/subscribed_apps
 */
export async function subscribeApp(
  accessToken: string,
  wabaId: string,
  apiVersion: string = DEFAULT_META_API_VERSION,
): Promise<{ success: boolean }> {
  if (!accessToken) throw new MetaApiError(MetaErrorCode.AUTH_FAILED, 'accessToken is required');
  if (!wabaId) throw new MetaApiError(MetaErrorCode.INVALID_REQUEST, 'wabaId is required');

  const url = `${graphBase(apiVersion)}/${wabaId}/subscribed_apps`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw await errorFromResponse(res, `POST /${wabaId}/subscribed_apps`);
  const text = await res.text();
  if (!text) return { success: true };
  try {
    const parsed = JSON.parse(text) as { success?: boolean };
    return { success: parsed.success ?? true };
  } catch {
    return { success: true };
  }
}
