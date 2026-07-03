/**
 * WhatsApp remote-mode ingest: Baileys media is STREAMED to the injected media
 * backend (`storeStream`), never written straight to local disk.
 *
 * In remote mode the returned `mediaLocalPath` is the S3 KEY the backend
 * recorded, and NO file lands under the local media base path. The size-guard
 * is preserved (streaming, not full-buffer).
 */

import { describe, expect, it, mock } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

const bytes = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

// Mock Baileys so `downloadMediaMessage('stream')` yields a Readable without a
// real WhatsApp socket. Only the runtime export used by download.ts is stubbed.
mock.module('baileys', () => ({
  downloadMediaMessage: mock(async () => Readable.from([bytes])),
}));

const { tryDownloadMedia } = await import('../handlers/messages');
type MediaStorageBackend = import('@omni/channel-sdk').MediaStorageBackend;
type StoreStreamInput = import('@omni/channel-sdk').StoreStreamInput;
type StoreMediaInput = import('@omni/channel-sdk').StoreMediaInput;
type StoreMediaResult = import('@omni/channel-sdk').StoreMediaResult;

const MEDIA_BASE_PATH = process.env.MEDIA_STORAGE_PATH || './data/media';

class RecordingRemoteBackend implements MediaStorageBackend {
  readonly mode = 'remote' as const;
  streamCalls: Array<{ key: string; size: number; guarded: boolean }> = [];

  async store({ key, buffer, mimeType }: StoreMediaInput): Promise<StoreMediaResult> {
    return { reference: key, size: buffer.length, mimeType };
  }
  async storeStream({ key, stream, mimeType, maxSizeBytes }: StoreStreamInput): Promise<StoreMediaResult> {
    let size = 0;
    for await (const chunk of stream) size += (chunk as Buffer).length;
    this.streamCalls.push({ key, size, guarded: maxSizeBytes !== undefined });
    return { reference: key, size, mimeType };
  }
  async presignedUrl(key: string): Promise<string> {
    return `https://s3.example/${key}?X-Amz-Signature=deadbeef`;
  }
}

// Minimal WAMessage with an image payload (detectMediaType + getMediaSize read these).
function makeImageMessage(id: string) {
  return {
    key: { id, remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
    message: { imageMessage: { mimetype: 'image/jpeg', fileLength: bytes.length } },
  } as unknown as Parameters<typeof tryDownloadMedia>[0];
}

describe('WhatsApp remote-mode ingest', () => {
  it('streams media to the backend and records the S3 key (no local disk write)', async () => {
    const backend = new RecordingRemoteBackend();
    const externalId = 'wa-remote-1';

    const result = await tryDownloadMedia(
      makeImageMessage(externalId),
      'inst-wa',
      externalId,
      'http://api.local',
      backend,
    );

    expect(result).not.toBeNull();
    // Recorded reference is the stable S3 key, never a presigned/expiring URL.
    expect(result?.mediaLocalPath).toBe(backend.streamCalls[0]?.key);
    expect(result?.mediaLocalPath).not.toContain('http');
    expect(result?.mediaLocalPath).not.toContain('X-Amz-Signature');
    expect(result?.mediaLocalPath).toContain('inst-wa/');
    expect(result?.mediaLocalPath).toContain(externalId);

    // Streamed exactly once, with the size-guard active.
    expect(backend.streamCalls).toHaveLength(1);
    expect(backend.streamCalls[0]?.size).toBe(bytes.length);
    expect(backend.streamCalls[0]?.guarded).toBe(true);

    // Remote mode must NOT write the media to local disk.
    expect(existsSync(join(MEDIA_BASE_PATH, result?.mediaLocalPath ?? 'missing'))).toBe(false);
  });
});
