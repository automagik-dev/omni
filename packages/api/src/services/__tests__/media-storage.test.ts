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
import type { Database } from '@omni/db';
import { MediaStorageService } from '../media-storage';

const fakeDb = {} as unknown as Database;

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
});
