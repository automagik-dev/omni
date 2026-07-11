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
import { MediaStorageService } from '../media-storage';

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
