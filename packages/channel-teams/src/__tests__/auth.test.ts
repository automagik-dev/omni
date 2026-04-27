/**
 * Tests for the AAD OAuth2 client-credentials helpers used at connect-time.
 *
 * Uses a stub `fetch` implementation — no real network calls.
 */

import { describe, expect, it, mock } from 'bun:test';

import { TokenAcquisitionError, acquireAccessToken, resolveAuthority, validateCredentials } from '../connection/auth';
import type { TeamsConnectionOptions } from '../types';

const baseOptions: TeamsConnectionOptions = {
  appId: 'app-id',
  appPassword: 'app-secret',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

describe('resolveAuthority', () => {
  it('defaults to the multi-tenant Bot Framework authority', () => {
    expect(resolveAuthority({})).toBe('https://login.microsoftonline.com/botframework.com');
  });

  it('resolves to the Microsoft Entra tenant authority when SingleTenant', () => {
    expect(resolveAuthority({ appType: 'SingleTenant', tenantId: 'tenant-guid' })).toBe(
      'https://login.microsoftonline.com/tenant-guid',
    );
  });

  it('throws when SingleTenant lacks a tenantId', () => {
    expect(() => resolveAuthority({ appType: 'SingleTenant' })).toThrow(/tenantId/);
  });

  it('rejects UserAssignedMSI in v1 with a clear message', () => {
    expect(() => resolveAuthority({ appType: 'UserAssignedMSI' })).toThrow(/UserAssignedMSI/);
  });

  it('URL-encodes tenant identifiers safely', () => {
    expect(resolveAuthority({ appType: 'SingleTenant', tenantId: 'tenant id with spaces' })).toBe(
      'https://login.microsoftonline.com/tenant%20id%20with%20spaces',
    );
  });
});

describe('acquireAccessToken', () => {
  it('returns the Bearer token with absolute expiry on 200 OK', async () => {
    const fetchStub = mock(async () =>
      jsonResponse(200, {
        access_token: 'token-123',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    );

    const before = Date.now();
    const token = await acquireAccessToken(baseOptions, fetchStub as unknown as typeof fetch);
    const after = Date.now();

    expect(token.token).toBe('token-123');
    expect(token.tokenType).toBe('Bearer');
    expect(token.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(token.expiresAt).toBeLessThanOrEqual(after + 3600 * 1000 + 1000);
  });

  it('issues the request with the documented OAuth2 form body', async () => {
    let captured: { url?: string; body?: string; headers?: Headers } = {};
    const fetchStub = mock(async (url: string, init: RequestInit) => {
      captured = {
        url,
        body: typeof init.body === 'string' ? init.body : '',
        headers: new Headers(init.headers ?? {}),
      };
      return jsonResponse(200, { access_token: 't', expires_in: 60, token_type: 'Bearer' });
    });

    await acquireAccessToken({ appId: 'my-app', appPassword: 'my-secret' }, fetchStub as unknown as typeof fetch);

    expect(captured.url).toBe('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token');
    expect(captured.headers?.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(captured.body).toContain('grant_type=client_credentials');
    expect(captured.body).toContain('client_id=my-app');
    expect(captured.body).toContain('client_secret=my-secret');
    expect(captured.body).toContain(encodeURIComponent('https://api.botframework.com/.default'));
  });

  it('throws TokenAcquisitionError on non-2xx', async () => {
    const fetchStub = mock(async () => textResponse(401, 'AADSTS70011: invalid_client'));

    await expect(acquireAccessToken(baseOptions, fetchStub as unknown as typeof fetch)).rejects.toBeInstanceOf(
      TokenAcquisitionError,
    );
  });

  it('throws when the response is missing access_token', async () => {
    const fetchStub = mock(async () => jsonResponse(200, { expires_in: 60 }));
    await expect(acquireAccessToken(baseOptions, fetchStub as unknown as typeof fetch)).rejects.toBeInstanceOf(
      TokenAcquisitionError,
    );
  });

  it('defaults to a 1h expiry when expires_in is omitted', async () => {
    const fetchStub = mock(async () => jsonResponse(200, { access_token: 't' }));
    const before = Date.now();
    const token = await acquireAccessToken(baseOptions, fetchStub as unknown as typeof fetch);
    expect(token.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - 50);
  });
});

describe('validateCredentials', () => {
  it('delegates to acquireAccessToken (treats successful token as valid)', async () => {
    const fetchStub = mock(async () => jsonResponse(200, { access_token: 'ok', expires_in: 60, token_type: 'Bearer' }));
    const token = await validateCredentials(baseOptions, fetchStub as unknown as typeof fetch);
    expect(token.token).toBe('ok');
  });

  it('rejects on 401 just like acquireAccessToken', async () => {
    const fetchStub = mock(async () => textResponse(401, 'AADSTS70011: invalid_client'));
    await expect(validateCredentials(baseOptions, fetchStub as unknown as typeof fetch)).rejects.toBeInstanceOf(
      TokenAcquisitionError,
    );
  });
});
