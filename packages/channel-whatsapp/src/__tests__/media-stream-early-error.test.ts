/**
 * Regression for #1274: a Baileys media stream that errors BEFORE Omni starts
 * consuming it must reject the download, not crash the process.
 *
 * Baileys returns a live decipher stream. A small, undecryptable media can
 * finish arriving (and emit `ERR_OSSL_BAD_DECRYPT`) while the consumer is still
 * awaiting I/O (local `mkdir`, S3 client resolution). An `'error'` with no
 * listener is an uncaught exception that takes down the whole API.
 */

import { describe, expect, it, mock } from 'bun:test';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

let nextStream: PassThrough = new PassThrough();
/** Runs inside `mkdir` for the directory under test, before the real call. */
let duringMkdir: ((path: string) => Promise<void>) | null = null;

// Spread the real modules back in: `mock.module` is process-wide (see
// media-remote-ingest.test.ts).
// Bun patches the live namespace, so keep a reference to the real `mkdir`.
const realFsPromises = await import('node:fs/promises');
const realMkdir = realFsPromises.mkdir;
const realRm = realFsPromises.rm;
mock.module('node:fs/promises', () => ({
  ...realFsPromises,
  mkdir: async (...args: Parameters<typeof realMkdir>) => {
    await duringMkdir?.(String(args[0]));
    return realMkdir(...args);
  },
}));

const realBaileys = await import('baileys');
mock.module('baileys', () => ({
  ...realBaileys,
  downloadMediaMessage: mock(async () => nextStream),
}));

const { downloadMediaToBackend, downloadMediaToFile } = await import('../utils/download');
type MediaStorageBackend = import('@omni/channel-sdk').MediaStorageBackend;
type StoreStreamInput = import('@omni/channel-sdk').StoreStreamInput;
type StoreMediaResult = import('@omni/channel-sdk').StoreMediaResult;
type WAMessage = Parameters<typeof downloadMediaToFile>[0];

function makeImageMessage(): WAMessage {
  return {
    key: { id: 'wa-bad-decrypt', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
    message: { imageMessage: { mimetype: 'image/jpeg', fileLength: 8 } },
  } as unknown as WAMessage;
}

function decryptError(): Error {
  return Object.assign(new Error('simulated BAD_DECRYPT'), { code: 'ERR_OSSL_BAD_DECRYPT' });
}

/** Lets the stream's deferred `'error'` emission run. */
function flushStreamEvents(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Backend whose `storeStream` awaits a gate before reading, standing in for
 * the S3 backend's `await this.resolveClients()`.
 */
class GatedBackend {
  readonly mode = 'remote' as const;
  private releaseGate!: () => void;
  private readonly gate = new Promise<void>((resolve) => {
    this.releaseGate = resolve;
  });
  private markEntered!: () => void;
  readonly entered = new Promise<void>((resolve) => {
    this.markEntered = resolve;
  });

  release(): void {
    this.releaseGate();
  }

  async storeStream({ key, stream, mimeType }: StoreStreamInput): Promise<StoreMediaResult> {
    this.markEntered();
    await this.gate;
    let size = 0;
    for await (const chunk of stream) size += (chunk as Buffer).length;
    return { reference: key, size, mimeType };
  }
}

describe('media stream that errors before it is consumed (#1274)', () => {
  it('backend path: rejects instead of raising an uncaught error', async () => {
    const source = new PassThrough();
    nextStream = source;
    const backend = new GatedBackend();

    const download = downloadMediaToBackend(
      makeImageMessage(),
      backend as unknown as MediaStorageBackend,
      'inst-wa/2026-10/wa-bad-decrypt.jpg',
    );
    await backend.entered;

    // The decipher fails while the backend is still awaiting, before it reads.
    source.destroy(decryptError());
    await flushStreamEvents();
    backend.release();

    await expect(download).rejects.toThrow('simulated BAD_DECRYPT');
  });

  it('local path: rejects and leaves no file behind', async () => {
    const source = new PassThrough();
    nextStream = source;
    const outputDir = join(tmpdir(), `omni-bad-decrypt-${Date.now()}`);
    const outputPath = join(outputDir, 'media.jpg');

    // The decipher fails while writeMediaStreamToFile awaits mkdir, before it reads.
    duringMkdir = async (path) => {
      if (path !== outputDir) return;
      source.destroy(decryptError());
      await flushStreamEvents();
    };

    try {
      await expect(downloadMediaToFile(makeImageMessage(), outputPath)).rejects.toThrow('simulated BAD_DECRYPT');
      expect(existsSync(outputPath)).toBe(false);
    } finally {
      duringMkdir = null;
      await realRm(outputDir, { recursive: true, force: true });
    }
  });
});
