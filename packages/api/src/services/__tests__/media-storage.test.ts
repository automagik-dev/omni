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
});
