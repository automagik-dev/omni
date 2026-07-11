/**
 * SSRF guard tests for caller-influenced media URL fetching (PR #770 LOW-10).
 *
 * The deny-list must reject cloud-metadata/link-local, RFC1918, loopback and
 * non-http(s) targets before any connection is made — on the initial URL and
 * on every redirect hop — while leaving public platform CDNs (WhatsApp,
 * Telegram's fixed api.telegram.org, Slack) untouched.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  UnsafeMediaUrlError,
  assertSafeMediaUrl,
  fetchMediaUrl,
  isMediaUrlGuardEnabled,
  isPrivateOrReservedAddress,
} from '../safe-media-fetch';

const publicLookup = async () => [{ address: '93.184.216.34' }];
const privateLookup = async () => [{ address: '10.1.2.3' }];
const failingLookup = async () => {
  throw new Error('ENOTFOUND');
};

const originalFetch = globalThis.fetch;
const originalGuardEnv = process.env.OMNI_MEDIA_URL_GUARD;

beforeEach(() => {
  Reflect.deleteProperty(process.env, 'OMNI_MEDIA_URL_GUARD');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalGuardEnv === undefined) {
    Reflect.deleteProperty(process.env, 'OMNI_MEDIA_URL_GUARD');
  } else {
    process.env.OMNI_MEDIA_URL_GUARD = originalGuardEnv;
  }
});

describe('isPrivateOrReservedAddress', () => {
  it.each([
    '169.254.169.254', // cloud metadata / link-local
    '169.254.0.1',
    '10.0.0.1', // RFC1918
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '127.0.0.1', // loopback
    '127.1.2.3',
    '0.0.0.0',
    '0.1.2.3',
  ])('denies %s', (address) => {
    expect(isPrivateOrReservedAddress(address)).toBe(true);
  });

  it.each([
    '::1', // loopback
    '::', // unspecified
    'fc00::1', // ULA fc00::/7
    'fd12:3456::1',
    'fe80::1', // link-local fe80::/10
    'febf::1',
    '::ffff:10.0.0.1', // IPv4-mapped private
    '::ffff:169.254.169.254',
  ])('denies IPv6 %s', (address) => {
    expect(isPrivateOrReservedAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '93.184.216.34',
    '172.32.0.1', // just outside 172.16/12
    '172.15.255.255',
    '192.167.0.1',
    '2606:4700::1111', // public IPv6
    'fec0::1', // outside fe80::/10
  ])('allows public %s', (address) => {
    expect(isPrivateOrReservedAddress(address)).toBe(false);
  });
});

describe('assertSafeMediaUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertSafeMediaUrl(new URL('file:///etc/passwd'), publicLookup)).rejects.toThrow(UnsafeMediaUrlError);
    await expect(assertSafeMediaUrl(new URL('ftp://example.com/x'), publicLookup)).rejects.toThrow(UnsafeMediaUrlError);
  });

  it('rejects non-http(s) schemes even when the guard is disabled', async () => {
    await expect(
      assertSafeMediaUrl(new URL('file:///etc/passwd'), publicLookup, { OMNI_MEDIA_URL_GUARD: 'off' }),
    ).rejects.toThrow(UnsafeMediaUrlError);
  });

  it('rejects literal metadata/private/loopback IPs without touching DNS', async () => {
    const lookup = mock(publicLookup);
    await expect(assertSafeMediaUrl(new URL('http://169.254.169.254/latest/meta-data/'), lookup)).rejects.toThrow(
      UnsafeMediaUrlError,
    );
    await expect(assertSafeMediaUrl(new URL('https://10.0.0.8/internal'), lookup)).rejects.toThrow(UnsafeMediaUrlError);
    await expect(assertSafeMediaUrl(new URL('http://[::1]:8882/media'), lookup)).rejects.toThrow(UnsafeMediaUrlError);
    expect(lookup).toHaveBeenCalledTimes(0);
  });

  it('rejects hostnames that resolve to private addresses', async () => {
    await expect(assertSafeMediaUrl(new URL('https://internal.example.com/x'), privateLookup)).rejects.toThrow(
      /resolves to private address/,
    );
  });

  it('allows hostnames that resolve publicly', async () => {
    await expect(assertSafeMediaUrl(new URL('https://mmg.whatsapp.net/v/media.enc'), publicLookup)).resolves.toBe(
      undefined,
    );
  });

  it('passes through when DNS resolution fails (fetch will fail identically)', async () => {
    await expect(assertSafeMediaUrl(new URL('https://does-not-resolve.invalid/x'), failingLookup)).resolves.toBe(
      undefined,
    );
  });

  it('allows private targets when OMNI_MEDIA_URL_GUARD=off (lab/MinIO escape hatch)', async () => {
    const env = { OMNI_MEDIA_URL_GUARD: 'off' };
    await expect(assertSafeMediaUrl(new URL('http://127.0.0.1:9000/bucket/key'), privateLookup, env)).resolves.toBe(
      undefined,
    );
    expect(isMediaUrlGuardEnabled(env)).toBe(false);
    expect(isMediaUrlGuardEnabled({})).toBe(true);
  });
});

describe('fetchMediaUrl — SSRF policy on every hop', () => {
  it('refuses a private initial URL before any fetch happens', async () => {
    const fetchMock = mock(async () => new Response('nope'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchMediaUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(UnsafeMediaUrlError);
    await expect(fetchMediaUrl('http://10.20.30.40/file.bin')).rejects.toThrow(UnsafeMediaUrlError);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('refuses a redirect hop into a private range (public → metadata)', async () => {
    const fetchMock = mock(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchMediaUrl('https://93.184.216.34/media.bin')).rejects.toThrow(UnsafeMediaUrlError);
    // Only the public hop was fetched; the metadata hop was blocked pre-connect.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves Authorization across a same-origin redirect and strips it cross-origin', async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), authorization: headers.get('authorization') });
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { location: 'https://93.184.216.34/step2' } });
      }
      if (calls.length === 2) {
        return new Response(null, { status: 302, headers: { location: 'https://93.184.216.35/other-origin' } });
      }
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const res = await fetchMediaUrl('https://93.184.216.34/step1', {
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.authorization).toBe('Bearer tok'); // initial
    expect(calls[1]?.authorization).toBe('Bearer tok'); // same-origin hop keeps it
    expect(calls[2]?.authorization).toBeNull(); // cross-origin hop strips it
  });

  it('gives up after too many redirects', async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 302, headers: { location: 'https://93.184.216.34/loop' } }),
    ) as unknown as typeof fetch;

    await expect(fetchMediaUrl('https://93.184.216.34/loop')).rejects.toThrow('too many redirects');
  });
});
