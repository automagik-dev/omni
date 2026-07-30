/**
 * OAuth helpers — unit tests.
 *
 * Mocks the global `fetch` so we can assert request shape AND coverage of the
 * error paths (4xx invalid code, 5xx upstream, missing access_token).
 */

import { afterEach, describe, expect, it } from 'bun:test';

import { exchangeCodeForToken, getWabaDetails, registerPhoneNumber, subscribeApp } from '../oauth';
import { MetaApiError, MetaErrorCode } from '../utils/errors';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

interface MockCall {
  url: string;
  init: RequestInit;
}

function mockFetchSequence(
  responders: Array<(url: string, init: RequestInit) => { status: number; body: unknown; ok?: boolean }>,
): { calls: MockCall[]; restore: () => void } {
  const calls: MockCall[] = [];
  const original = globalThis.fetch;
  let i = 0;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const effectiveInit = init ?? {};
    calls.push({ url, init: effectiveInit });
    const responder = responders[Math.min(i, responders.length - 1)];
    i++;
    const out = responder?.(url, effectiveInit) ?? { status: 200, body: {} };
    const bodyStr = typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? {});
    return new Response(bodyStr, {
      status: out.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// exchangeCodeForToken
// ─────────────────────────────────────────────────────────────────────────

describe('exchangeCodeForToken', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('POSTs form-encoded credentials and returns the access token', async () => {
    const m = mockFetchSequence([
      () => ({ status: 200, body: { access_token: 'EAA-test', token_type: 'bearer', expires_in: 5184000 } }),
    ]);
    restore = m.restore;

    const result = await exchangeCodeForToken('the-code', 'app-id', 'app-secret');

    expect(result).toEqual({ accessToken: 'EAA-test', tokenType: 'bearer', expiresIn: 5184000 });

    const call = m.calls[0];
    expect(call).toBeDefined();
    expect(call?.url).toContain('https://graph.facebook.com/v25.0/oauth/access_token');
    expect(call?.init.method).toBe('POST');
    const headers = call?.init.headers as Record<string, string> | undefined;
    expect(headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(String(call?.init.body)).toContain('client_id=app-id');
    expect(String(call?.init.body)).toContain('client_secret=app-secret');
    expect(String(call?.init.body)).toContain('code=the-code');
  });

  it('respects a custom apiVersion + redirectUri', async () => {
    const m = mockFetchSequence([() => ({ status: 200, body: { access_token: 'tok', token_type: 'bearer' } })]);
    restore = m.restore;

    await exchangeCodeForToken('c', 'a', 's', 'https://app.example/cb', 'v23.0');

    expect(m.calls[0]?.url).toContain('https://graph.facebook.com/v23.0/oauth/access_token');
    expect(String(m.calls[0]?.init.body)).toContain('redirect_uri=https%3A%2F%2Fapp.example%2Fcb');
  });

  it('defaults tokenType to "bearer" when omitted', async () => {
    const m = mockFetchSequence([() => ({ status: 200, body: { access_token: 'tok' } })]);
    restore = m.restore;

    const result = await exchangeCodeForToken('c', 'a', 's');
    expect(result.tokenType).toBe('bearer');
    expect(result.expiresIn).toBeUndefined();
  });

  it('throws INVALID_REQUEST when code is empty', async () => {
    await expect(exchangeCodeForToken('', 'a', 's')).rejects.toBeInstanceOf(MetaApiError);
    try {
      await exchangeCodeForToken('', 'a', 's');
    } catch (err) {
      expect<string>((err as MetaApiError).code).toBe(MetaErrorCode.INVALID_REQUEST);
    }
  });

  it('throws INVALID_REQUEST when appId is missing', async () => {
    await expect(exchangeCodeForToken('c', '', 's')).rejects.toBeInstanceOf(MetaApiError);
  });

  it('maps Meta-side 4xx invalid code to MetaApiError', async () => {
    const m = mockFetchSequence([
      () => ({
        status: 400,
        body: {
          error: {
            message: 'This authorization code has been used.',
            type: 'OAuthException',
            code: 100,
            fbtrace_id: 'abc123',
          },
        },
      }),
    ]);
    restore = m.restore;

    await expect(exchangeCodeForToken('c', 'a', 's')).rejects.toBeInstanceOf(MetaApiError);
    try {
      await exchangeCodeForToken('c', 'a', 's');
    } catch (err) {
      const e = err as MetaApiError;
      expect<string>(e.code).toBe(MetaErrorCode.INVALID_REQUEST);
      expect(e.message).toContain('authorization code');
      expect(e.context.fbtraceId).toBe('abc123');
      expect(e.context.httpStatus).toBe(400);
    }
  });

  it('maps 5xx upstream errors to UPSTREAM_ERROR', async () => {
    const m = mockFetchSequence([() => ({ status: 503, body: { error: { message: 'Server down' } } })]);
    restore = m.restore;

    try {
      await exchangeCodeForToken('c', 'a', 's');
      throw new Error('expected throw');
    } catch (err) {
      const e = err as MetaApiError;
      expect(e).toBeInstanceOf(MetaApiError);
      expect<string>(e.code).toBe(MetaErrorCode.UPSTREAM_ERROR);
    }
  });

  it('throws AUTH_FAILED when the response has no access_token', async () => {
    const m = mockFetchSequence([() => ({ status: 200, body: { token_type: 'bearer' } })]);
    restore = m.restore;

    try {
      await exchangeCodeForToken('c', 'a', 's');
      throw new Error('expected throw');
    } catch (err) {
      const e = err as MetaApiError;
      expect<string>(e.code).toBe(MetaErrorCode.AUTH_FAILED);
      expect(e.message).toContain('access_token');
    }
  });

  it('throws UNKNOWN when the body is not JSON', async () => {
    const m = mockFetchSequence([() => ({ status: 200, body: 'not json' })]);
    restore = m.restore;

    try {
      await exchangeCodeForToken('c', 'a', 's');
      throw new Error('expected throw');
    } catch (err) {
      const e = err as MetaApiError;
      expect<string>(e.code).toBe(MetaErrorCode.UNKNOWN);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// getWabaDetails
// ─────────────────────────────────────────────────────────────────────────

describe('getWabaDetails', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('aggregates owned + client WABAs and their phone numbers', async () => {
    const m = mockFetchSequence([
      // GET /me/businesses
      () => ({ status: 200, body: { data: [{ id: 'biz_1', name: 'Acme' }] } }),
      // GET /biz_1/owned_whatsapp_business_accounts
      () => ({ status: 200, body: { data: [{ id: 'waba_owned' }] } }),
      // GET /waba_owned/phone_numbers
      () => ({
        status: 200,
        body: {
          data: [
            {
              id: 'pn_1',
              display_phone_number: '+55 11 99999-8888',
              verified_name: 'Acme Sales',
              quality_rating: 'GREEN',
            },
          ],
        },
      }),
      // GET /biz_1/client_whatsapp_business_accounts
      () => ({ status: 200, body: { data: [{ id: 'waba_client' }] } }),
      // GET /waba_client/phone_numbers
      () => ({ status: 200, body: { data: [{ id: 'pn_2', display_phone_number: '+55 21 88888-7777' }] } }),
    ]);
    restore = m.restore;

    const result = await getWabaDetails('EAA-token');

    expect(result.wabaIds).toEqual(['waba_owned', 'waba_client']);
    expect(result.phoneNumbers).toEqual([
      {
        phone_number_id: 'pn_1',
        wabaId: 'waba_owned',
        display_phone_number: '+55 11 99999-8888',
        verified_name: 'Acme Sales',
        quality_rating: 'GREEN',
      },
      {
        phone_number_id: 'pn_2',
        wabaId: 'waba_client',
        display_phone_number: '+55 21 88888-7777',
        verified_name: undefined,
        quality_rating: undefined,
      },
    ]);

    // Sanity: every call uses Bearer auth.
    for (const call of m.calls) {
      const headers = call.init.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe('Bearer EAA-token');
    }
  });

  it('returns empty arrays when /me/businesses has no businesses', async () => {
    const m = mockFetchSequence([() => ({ status: 200, body: { data: [] } })]);
    restore = m.restore;

    const result = await getWabaDetails('tok');
    expect(result).toEqual({ wabaIds: [], phoneNumbers: [] });
  });

  it('dedupes a WABA that appears in both owned + client lists', async () => {
    const m = mockFetchSequence([
      () => ({ status: 200, body: { data: [{ id: 'biz_1' }] } }),
      () => ({ status: 200, body: { data: [{ id: 'waba_x' }] } }),
      () => ({ status: 200, body: { data: [{ id: 'pn_1' }] } }),
      // Client list also has the same WABA — should be skipped.
      () => ({ status: 200, body: { data: [{ id: 'waba_x' }] } }),
    ]);
    restore = m.restore;

    const result = await getWabaDetails('tok');
    expect(result.wabaIds).toEqual(['waba_x']);
    expect(result.phoneNumbers).toHaveLength(1);
  });

  it('swallows sub-call failures and returns partial discovery', async () => {
    const m = mockFetchSequence([
      () => ({ status: 200, body: { data: [{ id: 'biz_1' }] } }),
      // Owned WABAs list fails (permission denied) — should continue with client list.
      () => ({ status: 403, body: { error: { message: 'no perms', code: 200 } } }),
      () => ({ status: 200, body: { data: [{ id: 'waba_c' }] } }),
      () => ({ status: 200, body: { data: [{ id: 'pn_c' }] } }),
    ]);
    restore = m.restore;

    const result = await getWabaDetails('tok');
    expect(result.wabaIds).toEqual(['waba_c']);
    expect(result.phoneNumbers).toEqual([
      {
        phone_number_id: 'pn_c',
        wabaId: 'waba_c',
        display_phone_number: undefined,
        verified_name: undefined,
        quality_rating: undefined,
      },
    ]);
  });

  it('throws AUTH_FAILED when accessToken is empty', async () => {
    await expect(getWabaDetails('')).rejects.toBeInstanceOf(MetaApiError);
  });

  it('surfaces a top-level /me/businesses failure as MetaApiError', async () => {
    const m = mockFetchSequence([() => ({ status: 401, body: { error: { message: 'bad token', code: 190 } } })]);
    restore = m.restore;

    try {
      await getWabaDetails('tok');
      throw new Error('expected throw');
    } catch (err) {
      const e = err as MetaApiError;
      expect(e).toBeInstanceOf(MetaApiError);
      expect<string>(e.code).toBe(MetaErrorCode.AUTH_FAILED);
    }
  });

  it('tolerates missing `data` arrays in the response', async () => {
    const m = mockFetchSequence([() => ({ status: 200, body: {} })]);
    restore = m.restore;

    const result = await getWabaDetails('tok');
    expect(result).toEqual({ wabaIds: [], phoneNumbers: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// registerPhoneNumber
// ─────────────────────────────────────────────────────────────────────────

describe('registerPhoneNumber', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('POSTs messaging_product + pin to /{phone_number_id}/register', async () => {
    const m = mockFetchSequence([() => ({ status: 200, body: { success: true } })]);
    restore = m.restore;

    await registerPhoneNumber('tok', '1234567890', '654321');

    const call = m.calls[0];
    expect(call?.url).toContain('https://graph.facebook.com/v25.0/1234567890/register');
    expect(call?.init.method).toBe('POST');
    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
    expect(body).toEqual({ messaging_product: 'whatsapp', pin: '654321' });
    const headers = call?.init.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer tok');
  });

  it('omits pin when not provided', async () => {
    const m = mockFetchSequence([() => ({ status: 200, body: {} })]);
    restore = m.restore;

    await registerPhoneNumber('tok', 'pn');
    const body = JSON.parse(String(m.calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toEqual({ messaging_product: 'whatsapp' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// subscribeApp
// ─────────────────────────────────────────────────────────────────────────

describe('subscribeApp', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('POSTs to /{waba_id}/subscribed_apps and returns success', async () => {
    const m = mockFetchSequence([() => ({ status: 200, body: { success: true } })]);
    restore = m.restore;

    const result = await subscribeApp('tok', 'waba_42');

    expect(result).toEqual({ success: true });
    expect(m.calls[0]?.url).toContain('https://graph.facebook.com/v25.0/waba_42/subscribed_apps');
    expect(m.calls[0]?.init.method).toBe('POST');
  });

  it('returns success when the body is empty (Meta sometimes returns 200 with nothing)', async () => {
    const m = mockFetchSequence([() => ({ status: 200, body: '' })]);
    restore = m.restore;

    const result = await subscribeApp('tok', 'waba_42');
    expect(result.success).toBe(true);
  });

  it('throws MetaApiError on 4xx', async () => {
    const m = mockFetchSequence([() => ({ status: 400, body: { error: { message: 'bad waba', code: 100 } } })]);
    restore = m.restore;

    try {
      await subscribeApp('tok', 'waba_bad');
      throw new Error('expected throw');
    } catch (err) {
      const e = err as MetaApiError;
      expect(e).toBeInstanceOf(MetaApiError);
      expect<string>(e.code).toBe(MetaErrorCode.INVALID_REQUEST);
    }
  });
});
