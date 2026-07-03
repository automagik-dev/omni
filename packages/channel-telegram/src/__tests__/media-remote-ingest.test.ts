/**
 * Telegram remote-mode ingest: media is persisted via the injected media
 * backend (buffer `store`), not written straight to local disk.
 *
 * In remote mode the returned `localPath` is the S3 KEY the backend recorded,
 * and NO file lands under the local media base path.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MediaStorageBackend, StoreMediaInput, StoreMediaResult, StoreStreamInput } from '@omni/channel-sdk';
import type { TelegramBotLike } from '../grammy-shim';
import { tryDownloadTelegramMedia } from '../utils/media-download';

const MEDIA_BASE_PATH = process.env.MEDIA_STORAGE_PATH || './data/media';

/** Records what the channel handed to the backend without touching disk or S3. */
class RecordingRemoteBackend implements MediaStorageBackend {
  readonly mode = 'remote' as const;
  storeCalls: Array<{ key: string; size: number }> = [];

  async store({ key, buffer, mimeType }: StoreMediaInput): Promise<StoreMediaResult> {
    this.storeCalls.push({ key, size: buffer.length });
    return { reference: key, size: buffer.length, mimeType };
  }
  async storeStream({ key, stream, mimeType }: StoreStreamInput): Promise<StoreMediaResult> {
    let size = 0;
    for await (const chunk of stream) size += (chunk as Buffer).length;
    return { reference: key, size, mimeType };
  }
  async presignedUrl(key: string): Promise<string> {
    return `https://s3.example/${key}?X-Amz-Signature=deadbeef`;
  }
}

const originalFetch = globalThis.fetch;

function makeBot(): TelegramBotLike {
  return {
    token: 'TESTBOTTOKEN',
    api: {
      getFile: () => Promise.resolve({ file_path: 'photos/file_0.jpg' }),
    },
  } as unknown as TelegramBotLike;
}

describe('Telegram remote-mode ingest', () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  beforeEach(() => {
    // Stub the Telegram file download so no network is required.
    globalThis.fetch = (async () =>
      new Response(bytes, {
        status: 200,
        headers: { 'content-length': String(bytes.length), 'content-type': 'image/jpeg' },
      })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('routes the buffer through the backend and records the S3 key (no local disk write)', async () => {
    const backend = new RecordingRemoteBackend();
    const externalId = 'tg-remote-msg-1';

    const result = await tryDownloadTelegramMedia(
      { bot: makeBot(), instanceId: 'inst-tg', externalId, fileId: 'file-id-1', mimeType: 'image/jpeg' },
      backend,
    );

    expect(result).not.toBeNull();
    // The recorded reference is the stable relative key — never a presigned URL.
    expect(result?.localPath).toBe(backend.storeCalls[0]?.key);
    expect(result?.localPath).not.toContain('http');
    expect(result?.localPath).not.toContain('X-Amz-Signature');

    // Exactly one store() call carrying the full buffer.
    expect(backend.storeCalls).toHaveLength(1);
    expect(backend.storeCalls[0]?.size).toBe(bytes.length);
    expect(backend.storeCalls[0]?.key).toContain('inst-tg/');
    expect(backend.storeCalls[0]?.key).toContain(externalId);

    // Remote mode must NOT write the file to local disk.
    expect(existsSync(join(MEDIA_BASE_PATH, result?.localPath ?? 'missing'))).toBe(false);
  });
});
