/**
 * STS AssumeRoleWithWebIdentity credential provider (fully offline).
 *
 * The XML parse step is a pure function; the provider takes injected
 * `fetchImpl` + `now` seams, so every path here — request shape, caching,
 * expiry-triggered refresh, malformed responses, missing/empty token file —
 * runs without any network or real clock.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebIdentityCredentialProvider, parseAssumeRoleWithWebIdentityResponse } from '../web-identity';

function stsXml({
  accessKeyId = 'ASIA-TEST',
  secretAccessKey = 'secret-test',
  sessionToken = 'token-test',
  expiration = '2026-01-01T01:00:00.000Z',
}: Partial<Record<'accessKeyId' | 'secretAccessKey' | 'sessionToken' | 'expiration', string>> = {}): string {
  return `<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <AssumeRoleWithWebIdentityResult>
    <Credentials>
      <SessionToken>${sessionToken}</SessionToken>
      <SecretAccessKey>${secretAccessKey}</SecretAccessKey>
      <Expiration>${expiration}</Expiration>
      <AccessKeyId>${accessKeyId}</AccessKeyId>
    </Credentials>
  </AssumeRoleWithWebIdentityResult>
</AssumeRoleWithWebIdentityResponse>`;
}

describe('parseAssumeRoleWithWebIdentityResponse', () => {
  it('extracts all four credential fields from a valid response', () => {
    const credentials = parseAssumeRoleWithWebIdentityResponse(stsXml());
    expect(credentials.accessKeyId).toBe('ASIA-TEST');
    expect(credentials.secretAccessKey).toBe('secret-test');
    expect(credentials.sessionToken).toBe('token-test');
    expect(credentials.expiration).toBeInstanceOf(Date);
    expect(credentials.expiration.toISOString()).toBe('2026-01-01T01:00:00.000Z');
  });

  it('throws on a response missing a credential field', () => {
    const withoutToken = stsXml().replace(/<SessionToken>[^<]+<\/SessionToken>/, '');
    expect(() => parseAssumeRoleWithWebIdentityResponse(withoutToken)).toThrow(/Malformed STS.*sessionToken/);
  });

  it('throws on garbage that is not an STS response at all', () => {
    expect(() => parseAssumeRoleWithWebIdentityResponse('<html>welcome to a captive portal</html>')).toThrow(
      /Malformed STS AssumeRoleWithWebIdentity response/,
    );
  });

  it('throws on an unparseable Expiration timestamp', () => {
    expect(() => parseAssumeRoleWithWebIdentityResponse(stsXml({ expiration: 'not-a-date' }))).toThrow(
      /Malformed STS.*expiration/,
    );
  });
});

describe('WebIdentityCredentialProvider', () => {
  let tmpDir: string;
  let tokenFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'web-identity-test-'));
    tokenFile = join(tmpDir, 'token');
    // Trailing newline on purpose: the provider must trim the projected token.
    writeFileSync(tokenFile, 'header.payload.signature\n');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const PARAMS = { roleArn: 'arn:aws:iam::123456789012:role/media', stsRegion: 'sa-east-1' };

  it('reports its source as web-identity for logging', () => {
    const provider = new WebIdentityCredentialProvider({ ...PARAMS, tokenFile });
    expect(provider.source).toBe('web-identity');
  });

  it('POSTs an unsigned AssumeRoleWithWebIdentity form to the regional STS endpoint', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const provider = new WebIdentityCredentialProvider(
      { ...PARAMS, tokenFile },
      {
        fetchImpl: async (input, init) => {
          requests.push({ url: String(input), init });
          return new Response(stsXml(), { status: 200 });
        },
      },
    );

    const credentials = await provider.getCredentials();
    expect(credentials.accessKeyId).toBe('ASIA-TEST');

    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (!request) throw new Error('unreachable');
    expect(request.url).toBe('https://sts.sa-east-1.amazonaws.com/');
    expect(request.init?.method).toBe('POST');
    const body = new URLSearchParams(String(request.init?.body));
    expect(body.get('Action')).toBe('AssumeRoleWithWebIdentity');
    expect(body.get('Version')).toBe('2011-06-15');
    expect(body.get('RoleArn')).toBe(PARAMS.roleArn);
    expect(body.get('RoleSessionName')).toBe('omni-media');
    expect(body.get('WebIdentityToken')).toBe('header.payload.signature'); // trimmed
    expect(body.get('DurationSeconds')).toBe('3600');
    // Unsigned: the token IS the auth — no SigV4 Authorization header.
    expect(new Headers(request.init?.headers).has('authorization')).toBe(false);
  });

  it('caches credentials and refreshes only within 10 minutes of expiry', async () => {
    const T0 = Date.parse('2026-01-01T00:00:00.000Z');
    let nowMs = T0;
    let fetchCount = 0;
    const provider = new WebIdentityCredentialProvider(
      { ...PARAMS, tokenFile },
      {
        fetchImpl: async () => {
          fetchCount++;
          // Each exchange mints creds valid until T0+1h (first) / T0+2h (second).
          const expiration = fetchCount === 1 ? '2026-01-01T01:00:00.000Z' : '2026-01-01T02:00:00.000Z';
          return new Response(stsXml({ sessionToken: `token-${fetchCount}`, expiration }), { status: 200 });
        },
        now: () => nowMs,
      },
    );

    // First call fetches; immediate second call is served from cache.
    expect((await provider.getCredentials()).sessionToken).toBe('token-1');
    expect((await provider.getCredentials()).sessionToken).toBe('token-1');
    expect(fetchCount).toBe(1);

    // 601s of life left (> 10 min margin) — still cached.
    nowMs = T0 + (3600 - 601) * 1000;
    expect((await provider.getCredentials()).sessionToken).toBe('token-1');
    expect(fetchCount).toBe(1);

    // 599s left (≤ 10 min margin) — refresh kicks in.
    nowMs = T0 + (3600 - 599) * 1000;
    expect((await provider.getCredentials()).sessionToken).toBe('token-2');
    expect(fetchCount).toBe(2);
  });

  it('rejects with the token path when the token file is missing, without calling STS', async () => {
    let fetched = false;
    const provider = new WebIdentityCredentialProvider(
      { ...PARAMS, tokenFile: join(tmpDir, 'does-not-exist') },
      {
        fetchImpl: async () => {
          fetched = true;
          return new Response(stsXml(), { status: 200 });
        },
      },
    );
    await expect(provider.getCredentials()).rejects.toThrow(/Cannot read web-identity token file.*does-not-exist/);
    expect(fetched).toBe(false);
  });

  it('rejects when the token file is empty', async () => {
    writeFileSync(tokenFile, '  \n');
    const provider = new WebIdentityCredentialProvider(
      { ...PARAMS, tokenFile },
      { fetchImpl: async () => new Response(stsXml(), { status: 200 }) },
    );
    await expect(provider.getCredentials()).rejects.toThrow(/token file .* is empty/);
  });

  it('rejects with the HTTP status on an STS error response', async () => {
    const provider = new WebIdentityCredentialProvider(
      { ...PARAMS, tokenFile },
      { fetchImpl: async () => new Response('<ErrorResponse>AccessDenied</ErrorResponse>', { status: 403 }) },
    );
    await expect(provider.getCredentials()).rejects.toThrow(/AssumeRoleWithWebIdentity failed \(HTTP 403\)/);
  });

  it('rejects on a 200 response with a malformed body and retries on the next call', async () => {
    let fetchCount = 0;
    const provider = new WebIdentityCredentialProvider(
      { ...PARAMS, tokenFile },
      {
        fetchImpl: async () => {
          fetchCount++;
          return fetchCount === 1 ? new Response('<oops/>', { status: 200 }) : new Response(stsXml(), { status: 200 });
        },
      },
    );
    await expect(provider.getCredentials()).rejects.toThrow(/Malformed STS/);
    // A failed exchange must not poison the cache — the next call retries.
    expect((await provider.getCredentials()).accessKeyId).toBe('ASIA-TEST');
    expect(fetchCount).toBe(2);
  });

  it('serves the still-valid cached credential when a refresh exchange fails', async () => {
    const T0 = Date.parse('2026-01-01T00:00:00.000Z');
    let nowMs = T0;
    let fetchCount = 0;
    const provider = new WebIdentityCredentialProvider(
      { ...PARAMS, tokenFile },
      {
        fetchImpl: async () => {
          fetchCount++;
          // First exchange succeeds (cred valid until T0+1h); every later one throws.
          if (fetchCount === 1) {
            return new Response(stsXml({ sessionToken: 'token-1', expiration: '2026-01-01T01:00:00.000Z' }), {
              status: 200,
            });
          }
          throw new Error('STS unreachable');
        },
        now: () => nowMs,
      },
    );

    // Prime the cache.
    expect((await provider.getCredentials()).sessionToken).toBe('token-1');
    expect(fetchCount).toBe(1);

    // Advance into the refresh margin (599s of life left ≤ 10 min): the refresh
    // fetch throws, but the cached cred still has ~10 min left, so it is served.
    nowMs = T0 + (3600 - 599) * 1000;
    const served = await provider.getCredentials();
    expect(served.sessionToken).toBe('token-1');
    expect(fetchCount).toBe(2); // it did attempt a refresh before falling back
  });

  it('throws when a refresh fails and no still-valid credential is cached', async () => {
    const T0 = Date.parse('2026-01-01T00:00:00.000Z');
    let nowMs = T0;
    let fetchCount = 0;
    const provider = new WebIdentityCredentialProvider(
      { ...PARAMS, tokenFile },
      {
        fetchImpl: async () => {
          fetchCount++;
          if (fetchCount === 1) {
            return new Response(stsXml({ sessionToken: 'token-1', expiration: '2026-01-01T01:00:00.000Z' }), {
              status: 200,
            });
          }
          throw new Error('STS unreachable');
        },
        now: () => nowMs,
      },
    );

    expect((await provider.getCredentials()).sessionToken).toBe('token-1');

    // Advance past expiry: the cached cred is no longer usable, so a failed
    // refresh must surface the error rather than serve a dead credential.
    nowMs = T0 + 3600 * 1000 + 1000;
    await expect(provider.getCredentials()).rejects.toThrow(/STS unreachable/);
  });
});
