/**
 * Tests for MediaStorageService.
 *
 * Covers the storeFromUrl error-surfacing contract that BatchJobService
 * depends on for omni#500 diagnostic clarity: when fetch fails, the error
 * must carry the HTTP status so callers can report the real reason instead
 * of the legacy generic "No media file path available" message.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MediaStorageBackend } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import { UnsafeMediaUrlError } from '../../utils/safe-media-fetch';
import { MediaStorageService, PRESIGNED_URL_TTL_CEILING_SECONDS } from '../media-storage';

const fakeDb = {} as unknown as Database;

/** Backend stub whose read/stat throw a supplied error (LOW-1 contract tests). */
function stubBackend(readError: Error & { code?: string }): MediaStorageBackend {
  return {
    mode: 'remote' as const,
    store: async ({ key, buffer, mimeType }) => ({ reference: key, size: buffer.length, mimeType }),
    storeStream: async ({ key, mimeType }) => ({ reference: key, size: 0, mimeType }),
    read: async () => {
      throw readError;
    },
    stat: async () => {
      throw readError;
    },
    readRange: async () => {
      throw readError;
    },
    readStream: async () => {
      throw readError;
    },
    presignedUrl: async (key) => `https://s3.example/${key}`,
  };
}

function codedError(code: string, message = code): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

describe('MediaStorageService.storeFromUrl (omni#500)', () => {
  let tmpDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'media-storage-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });

  it('throws with HTTP status when fetch returns non-ok', async () => {
    globalThis.fetch = mock(async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch;
    const service = new MediaStorageService(fakeDb, tmpDir);

    await expect(
      service.storeFromUrl('inst-1', 'msg-1', 'https://mmg.whatsapp.net/v/t62.7117-24/audio.enc?oe=1', 'audio/ogg'),
    ).rejects.toThrow('Failed to download media: 403');
  });

  it('throws when fetch itself rejects (network error)', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const service = new MediaStorageService(fakeDb, tmpDir);

    await expect(
      service.storeFromUrl('inst-1', 'msg-1', 'https://example.com/file.bin', 'application/octet-stream'),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('stores buffer and returns relative localPath on success', async () => {
    globalThis.fetch = mock(
      async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
    ) as unknown as typeof fetch;
    const service = new MediaStorageService(fakeDb, tmpDir);

    const result = await service.storeFromUrl(
      'inst-1',
      'msg-1',
      'https://example.com/file.mp3',
      'audio/mpeg',
      new Date('2026-04-23T00:00:00Z'),
    );

    expect(result.size).toBe(4);
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.localPath).toBe(join('inst-1', '2026-04', 'msg-1.mp3'));
  });

  it('rejects HTML bodies when a non-HTML media type is expected', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response('<!DOCTYPE html><html><body>login required</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    ) as unknown as typeof fetch;
    const service = new MediaStorageService(fakeDb, tmpDir);

    await expect(
      service.storeFromUrl('inst-1', 'msg-1', 'https://files.slack.com/private/photo.png', 'image/png'),
    ).rejects.toThrow('Downloaded media content mismatch');
  });

  it('does not reject plain text that mentions HTML snippets', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response('Slack note: use <html> only in documentation snippets.', {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }),
    ) as unknown as typeof fetch;
    const service = new MediaStorageService(fakeDb, tmpDir);

    const result = await service.storeFromUrl(
      'inst-1',
      'msg-1',
      'https://files.slack.com/private/note.txt',
      'text/plain',
      new Date('2026-04-23T00:00:00Z'),
    );

    expect(result.localPath).toBe(join('inst-1', '2026-04', 'msg-1.txt'));
    expect(result.mimeType).toBe('text/plain');
  });

  it('preserves Authorization across allowed private-media redirects', async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), authorization: headers.get('authorization') });
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://files-pri.slack.com/files-pri/photo.png' },
        });
      }
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }) as unknown as typeof fetch;

    const service = new MediaStorageService(fakeDb, tmpDir);
    const result = await service.storeFromUrl(
      'inst-1',
      'msg-1',
      'https://files.slack.com/download/photo.png',
      'image/png',
      new Date('2026-04-23T00:00:00Z'),
      {
        headers: { Authorization: 'Bearer test-token' },
        preserveAuthRedirectHostSuffixes: ['slack.com'],
      },
    );

    expect(result.localPath).toBe(join('inst-1', '2026-04', 'msg-1.png'));
    expect(calls).toHaveLength(2);
    expect(calls[0]?.authorization).toBe('Bearer test-token');
    expect(calls[1]?.authorization).toBe('Bearer test-token');
  });

  // ── SSRF deny-list (PR #770 LOW-10) ──────────────────────────────────────

  it('refuses to fetch cloud-metadata URLs before connecting', async () => {
    const fetchMock = mock(async () => new Response('should never be reached'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const service = new MediaStorageService(fakeDb, tmpDir);

    await expect(
      service.storeFromUrl('inst-1', 'msg-1', 'http://169.254.169.254/latest/meta-data/', 'image/png'),
    ).rejects.toThrow(UnsafeMediaUrlError);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('refuses to fetch RFC1918 URLs before connecting', async () => {
    const fetchMock = mock(async () => new Response('should never be reached'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const service = new MediaStorageService(fakeDb, tmpDir);

    await expect(
      service.storeFromUrl('inst-1', 'msg-1', 'http://10.8.0.12/internal/file.bin', 'application/octet-stream'),
    ).rejects.toThrow(UnsafeMediaUrlError);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('refuses a redirect that hops from a public host into a private range', async () => {
    const fetchMock = mock(
      async () => new Response(null, { status: 302, headers: { location: 'http://192.168.0.10/steal' } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const service = new MediaStorageService(fakeDb, tmpDir);

    await expect(
      service.storeFromUrl('inst-1', 'msg-1', 'https://93.184.216.34/media.png', 'image/png'),
    ).rejects.toThrow(UnsafeMediaUrlError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the public hop was requested
  });

  it('refuses non-http(s) media URLs', async () => {
    const fetchMock = mock(async () => new Response('nope'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const service = new MediaStorageService(fakeDb, tmpDir);

    await expect(service.storeFromUrl('inst-1', 'msg-1', 'file:///etc/passwd', 'text/plain')).rejects.toThrow(
      UnsafeMediaUrlError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

// ── G5 tenant-context storage prefixing + presigned binding (ADR-0008) ─────
//
// Two-tenant probes for the leg-D contract: tenant-context writes land under
// `tenants/<tenantId>/instances/<instanceId>/...`, presigns are bound to
// tenant + object + expiry (TTL ceiling 60s), and the legacy/flag-off world is
// byte-identical (no tenant → the pre-G5 key layout and presign call).

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INSTANCE_ID = '33333333-3333-4333-8333-333333333333';
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444';
const APRIL = new Date('2026-04-23T00:00:00Z');

/** Backend stub that records every store/presign call it receives. */
function capturingBackend() {
  const stored: Array<{ key: string }> = [];
  const presigns: Array<{ key: string; ttl: number | undefined }> = [];
  const backend: MediaStorageBackend = {
    mode: 'remote' as const,
    store: async ({ key, buffer, mimeType }) => {
      stored.push({ key });
      return { reference: key, size: buffer.length, mimeType };
    },
    storeStream: async ({ key, mimeType }) => ({ reference: key, size: 0, mimeType }),
    read: async () => Buffer.alloc(0),
    stat: async () => null,
    readRange: async () => Buffer.alloc(0),
    readStream: async () => new ReadableStream(),
    presignedUrl: async (key, ttl) => {
      presigns.push({ key, ttl });
      return `https://s3.example/${key}?ttl=${ttl ?? 'default'}`;
    },
  };
  return { backend, stored, presigns };
}

describe('MediaStorageService tenant-context key layout (G5 ADR-0008)', () => {
  it('prefixes tenant-context keys with tenants/<tenantId>/instances/<instanceId>/', () => {
    const service = new MediaStorageService(fakeDb, undefined, capturingBackend().backend);
    const key = service.buildKey(INSTANCE_ID, MESSAGE_ID, 'image/png', APRIL, TENANT_A);
    expect(key).toBe(join('tenants', TENANT_A, 'instances', INSTANCE_ID, '2026-04', `${MESSAGE_ID}.png`));
  });

  it('legacy world (no tenant) keeps the pre-G5 key layout byte-identical', () => {
    const service = new MediaStorageService(fakeDb, undefined, capturingBackend().backend);
    const key = service.buildKey(INSTANCE_ID, MESSAGE_ID, 'image/png', APRIL);
    expect(key).toBe(join(INSTANCE_ID, '2026-04', `${MESSAGE_ID}.png`));
  });

  it('fails closed on a non-UUID tenant/instance/message segment (traversal-safe)', () => {
    const service = new MediaStorageService(fakeDb, undefined, capturingBackend().backend);
    expect(() => service.buildKey(INSTANCE_ID, MESSAGE_ID, 'image/png', APRIL, '../../etc')).toThrow(
      /non-UUID tenantId/,
    );
    expect(() => service.buildKey('..', MESSAGE_ID, 'image/png', APRIL, TENANT_A)).toThrow(/non-UUID instanceId/);
    expect(() => service.buildKey(INSTANCE_ID, 'msg-1', 'image/png', APRIL, TENANT_A)).toThrow(/non-UUID messageId/);
  });

  it('storeFromBuffer with a trusted tenant stores under the tenant prefix', async () => {
    const { backend, stored } = capturingBackend();
    const service = new MediaStorageService(fakeDb, undefined, backend);
    const result = await service.storeFromBuffer(
      INSTANCE_ID,
      MESSAGE_ID,
      Buffer.from([1, 2, 3]),
      'image/png',
      APRIL,
      TENANT_A,
    );
    expect(stored[0]?.key).toBe(join('tenants', TENANT_A, 'instances', INSTANCE_ID, '2026-04', `${MESSAGE_ID}.png`));
    expect(result.localPath).toStartWith(join('tenants', TENANT_A));
  });

  it('storeFromBuffer without a tenant stores the legacy key byte-identically', async () => {
    const { backend, stored } = capturingBackend();
    const service = new MediaStorageService(fakeDb, undefined, backend);
    await service.storeFromBuffer(INSTANCE_ID, MESSAGE_ID, Buffer.from([1, 2, 3]), 'image/png', APRIL);
    expect(stored[0]?.key).toBe(join(INSTANCE_ID, '2026-04', `${MESSAGE_ID}.png`));
  });
});

describe('MediaStorageService.presignedUrl tenant binding (G5 ADR-0008)', () => {
  const tenantKey = (tenant: string) =>
    join('tenants', tenant, 'instances', INSTANCE_ID, '2026-04', `${MESSAGE_ID}.png`);

  it('legacy world passes the caller TTL to the backend verbatim (byte-identical)', async () => {
    const { backend, presigns } = capturingBackend();
    const service = new MediaStorageService(fakeDb, undefined, backend);
    await service.presignedUrl('inst-1/2026-04/msg.png', 3600);
    await service.presignedUrl('inst-1/2026-04/msg.png');
    expect(presigns).toEqual([
      { key: 'inst-1/2026-04/msg.png', ttl: 3600 },
      { key: 'inst-1/2026-04/msg.png', ttl: undefined },
    ]);
  });

  it('tenant-context presign of an own-prefix object clamps TTL to the 60s ceiling', async () => {
    const { backend, presigns } = capturingBackend();
    const service = new MediaStorageService(fakeDb, undefined, backend);
    await service.presignedUrl(tenantKey(TENANT_A), 3600, TENANT_A); // over ceiling → clamped
    await service.presignedUrl(tenantKey(TENANT_A), undefined, TENANT_A); // default → ceiling
    await service.presignedUrl(tenantKey(TENANT_A), 30, TENANT_A); // under ceiling → kept
    expect(presigns.map((p) => p.ttl)).toEqual([
      PRESIGNED_URL_TTL_CEILING_SECONDS,
      PRESIGNED_URL_TTL_CEILING_SECONDS,
      30,
    ]);
  });

  it("two-tenant probe: tenant B cannot presign tenant A's object", async () => {
    const { backend, presigns } = capturingBackend();
    const service = new MediaStorageService(fakeDb, undefined, backend);
    await expect(service.presignedUrl(tenantKey(TENANT_A), 30, TENANT_B)).rejects.toThrow(
      /outside the requesting tenant prefix/,
    );
    expect(presigns).toHaveLength(0); // refused before the backend was consulted
  });

  it('tenant-context presign refuses a legacy-keyed (unprefixed) reference', async () => {
    const { backend, presigns } = capturingBackend();
    const service = new MediaStorageService(fakeDb, undefined, backend);
    await expect(service.presignedUrl(`${INSTANCE_ID}/2026-04/${MESSAGE_ID}.png`, 30, TENANT_A)).rejects.toThrow(
      /outside the requesting tenant prefix/,
    );
    expect(presigns).toHaveLength(0);
  });

  it('refuses a malformed trusted tenant before touching the backend', async () => {
    const { backend, presigns } = capturingBackend();
    const service = new MediaStorageService(fakeDb, undefined, backend);
    await expect(service.presignedUrl(tenantKey(TENANT_A), 30, 'not-a-uuid')).rejects.toThrow(/non-UUID tenantId/);
    // A prefix-shaped forgery must not smuggle a traversal into the prefix check.
    await expect(service.presignedUrl('tenants/../secrets/x.png', 30, '..')).rejects.toThrow(/non-UUID tenantId/);
    expect(presigns).toHaveLength(0);
  });
});

describe('MediaStorageService.readMediaViaBackend error contract (PR #770 LOW-1)', () => {
  it('returns null for a missing object (local ENOENT)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'media-low1-'));
    try {
      const service = new MediaStorageService(fakeDb, tmp);
      expect(await service.readMediaViaBackend('inst-1/2026-07/missing.png')).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns null for a missing object (S3 NoSuchKey)', async () => {
    const service = new MediaStorageService(fakeDb, undefined, stubBackend(codedError('NoSuchKey')));
    expect(await service.readMediaViaBackend('inst-1/2026-07/missing.png')).toBeNull();
  });

  it('rethrows transient backend failures instead of masking them as missing', async () => {
    for (const code of ['ConnectionRefused', 'InvalidAccessKeyId', 'NoSuchBucket', 'UnknownError']) {
      const service = new MediaStorageService(fakeDb, undefined, stubBackend(codedError(code)));
      await expect(service.readMediaViaBackend('inst-1/2026-07/key.png')).rejects.toThrow(code);
    }
  });
});
