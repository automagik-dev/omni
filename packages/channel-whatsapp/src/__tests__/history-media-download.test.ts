/**
 * History sync media handling (#1127): honor the job's downloadMedia flag,
 * file media under the message's month, and aggregate failure logs.
 */

import { describe, expect, it, mock } from 'bun:test';
import { Readable } from 'node:stream';

// Spread the real module: mock.module is process-wide (see media-remote-ingest.test.ts).
const realBaileys = await import('baileys');
const downloadMediaMessage = mock(async () => Readable.from([Buffer.from([1, 2, 3])]));
mock.module('baileys', () => ({ ...realBaileys, downloadMediaMessage }));

const { tryDownloadMedia, logMediaDownloadFailure } = await import('../handlers/messages');
const { WhatsAppPlugin } = await import('../plugin');

type WAMessage = Parameters<typeof tryDownloadMedia>[0];

function imageMessage(id: string, epochSeconds: number): WAMessage {
  return {
    key: { id, remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
    message: { imageMessage: { mimetype: 'image/png', fileLength: 3 } },
    messageTimestamp: epochSeconds,
  } as unknown as WAMessage;
}

function createPlugin() {
  const plugin = new WhatsAppPlugin();
  const noop = () => {};
  const logger = { debug: noop, info: noop, warn: noop, error: noop };
  plugin.initialize({
    eventBus: { publish: mock(async () => 'id'), subscribe: mock(async () => ({})) } as never,
    logger: { ...logger, child: () => logger } as never,
    storage: {} as never,
    config: {} as never,
    db: {} as never,
  });
  return plugin as unknown as {
    processHistoryMessage: (instanceId: string, msg: WAMessage, syncState: unknown) => Promise<void>;
  };
}

describe('history sync media (#1127)', () => {
  it('skips the download when the job disables downloadMedia but keeps mime metadata', async () => {
    downloadMediaMessage.mockClear();
    const received: Array<{ content: { type: string; mimeType?: string; localPath?: string } }> = [];
    const syncState = { totalFetched: 0, downloadMedia: false, onMessage: (m: never) => received.push(m) };

    await createPlugin().processHistoryMessage('inst-1', imageMessage('hist-1', 1_600_000_000), syncState);

    expect(downloadMediaMessage).not.toHaveBeenCalled();
    expect(received).toHaveLength(1);
    expect(received[0]?.content).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(received[0]?.content.localPath).toBeUndefined();
  });

  it('files downloaded media under the message month, not the current month', async () => {
    const keys: string[] = [];
    const backend = {
      mode: 'remote' as const,
      storeStream: async ({ key, stream, mimeType }: { key: string; stream: Readable; mimeType: string }) => {
        for await (const _ of stream) {
        }
        keys.push(key);
        return { reference: key, size: 3, mimeType };
      },
    };
    const march2020 = Date.UTC(2020, 2, 15) / 1000;
    const result = await tryDownloadMedia(
      imageMessage('hist-2', march2020),
      'inst-1',
      'hist-2',
      undefined,
      backend as never,
    );

    expect(result?.mediaLocalPath).toContain('2020-03');
    expect(keys[0]).toContain('2020-03');
  });

  it('logs one media failure per window and counts the rest', () => {
    const t0 = 10_000_000_000_000;
    expect(logMediaDownloadFailure('a', new Error('x'), t0)).toBe(true);
    expect(logMediaDownloadFailure('b', new Error('x'), t0 + 1_000)).toBe(false);
    expect(logMediaDownloadFailure('c', new Error('x'), t0 + 61_000)).toBe(true);
  });
});
