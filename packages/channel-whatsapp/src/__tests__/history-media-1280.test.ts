/**
 * #1280 — which media the Baileys channel downloads.
 *
 *   1. The history WhatsApp pushes right after pairing has no sync job, so the
 *      #1127 gate (`syncState?.downloadMedia === false`) let every old media
 *      through even with the instance's `downloadMediaOnSync` off (the
 *      default). Without a job, the instance setting now decides.
 *   2. Media inside an envelope (an HD photo arrives as
 *      `associatedChildMessage`, disappearing chats as `ephemeralMessage`, own
 *      devices as `deviceSentMessage`) was never downloaded: detection only
 *      looked at the top level.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Readable } from 'node:stream';

// Spread the real module: mock.module is process-wide (see media-remote-ingest.test.ts).
const realBaileys = await import('baileys');
const downloadMediaMessage = mock(async (_msg: unknown) => Readable.from([Buffer.from([1, 2, 3])]));
mock.module('baileys', () => ({ ...realBaileys, downloadMediaMessage }));

const { tryDownloadMedia } = await import('../handlers/messages');
const { detectMediaType } = await import('../utils/download');
const { WhatsAppPlugin } = await import('../plugin');

type WAMessage = Parameters<typeof tryDownloadMedia>[0];

const IMAGE = { mimetype: 'image/png', fileLength: 3, caption: 'foto HD' };

function message(id: string, content: Record<string, unknown>): WAMessage {
  return {
    key: { id, remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
    message: content,
    messageTimestamp: 1_600_000_000,
  } as unknown as WAMessage;
}

/** Remote backend that drains the stream, so nothing touches the local disk. */
const backend = {
  mode: 'remote' as const,
  storeStream: async ({ key, stream, mimeType }: { key: string; stream: Readable; mimeType: string }) => {
    for await (const _ of stream) {
    }
    return { reference: key, size: 3, mimeType };
  },
};

function createPlugin(options?: Record<string, unknown>) {
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
  const internals = plugin as unknown as {
    instances: { setInstance(id: string, config: unknown, status: unknown): void };
    processHistoryMessage: (instanceId: string, msg: WAMessage, syncState: unknown) => Promise<void>;
  };
  internals.instances.setInstance(
    'inst-1',
    { instanceId: 'inst-1', options },
    { state: 'connected', since: new Date() },
  );
  return internals;
}

beforeEach(() => {
  downloadMediaMessage.mockClear();
});

describe('initial history sync media (#1280)', () => {
  it('without a sync job, does not download when the instance has downloadMediaOnSync off', async () => {
    await createPlugin({ downloadMediaOnSync: false }).processHistoryMessage(
      'inst-1',
      message('h1', { imageMessage: IMAGE }),
      undefined,
    );
    expect(downloadMediaMessage).not.toHaveBeenCalled();
  });

  it('without a sync job or instance setting, falls back to the default (no download)', async () => {
    await createPlugin().processHistoryMessage('inst-1', message('h2', { imageMessage: IMAGE }), undefined);
    expect(downloadMediaMessage).not.toHaveBeenCalled();
  });

  it('without a sync job, downloads when the instance has downloadMediaOnSync on', async () => {
    await createPlugin({ downloadMediaOnSync: true }).processHistoryMessage(
      'inst-1',
      message('h3', { imageMessage: IMAGE }),
      undefined,
    );
    expect(downloadMediaMessage).toHaveBeenCalledTimes(1);
  });

  it("a sync job's downloadMedia still wins over the instance setting", async () => {
    const received: unknown[] = [];
    const job = { totalFetched: 0, downloadMedia: true, onMessage: (m: unknown) => received.push(m) };

    await createPlugin({ downloadMediaOnSync: false }).processHistoryMessage(
      'inst-1',
      message('h4', { imageMessage: IMAGE }),
      job,
    );

    expect(downloadMediaMessage).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
  });
});

describe('media inside envelopes (#1280)', () => {
  const wrapped = {
    associatedChildMessage: { associatedChildMessage: { message: { imageMessage: IMAGE } } },
    ephemeralMessage: { ephemeralMessage: { message: { imageMessage: IMAGE } } },
    viewOnceMessageV2: { viewOnceMessageV2: { message: { imageMessage: IMAGE } } },
    deviceSentMessage: {
      deviceSentMessage: { destinationJid: '5511888888888@s.whatsapp.net', message: { imageMessage: IMAGE } },
    },
    'deviceSentMessage → ephemeralMessage': {
      deviceSentMessage: { message: { ephemeralMessage: { message: { imageMessage: IMAGE } } } },
    },
  };

  for (const [envelope, content] of Object.entries(wrapped)) {
    it(`detects and downloads an image wrapped in ${envelope}`, async () => {
      const msg = message(`env-${envelope}`, content);

      expect(detectMediaType(msg)).toEqual({ type: 'image', mimeType: 'image/png' });

      const result = await tryDownloadMedia(msg, 'inst-1', 'env-1', undefined, backend as never);

      expect(result?.mimeType).toBe('image/png');
      expect(downloadMediaMessage).toHaveBeenCalledTimes(1);
      // Baileys gets the unwrapped content (it does not unwrap deviceSentMessage itself), same key.
      const passed = downloadMediaMessage.mock.calls[0]?.[0] as WAMessage;
      expect(passed.message?.imageMessage?.mimetype).toBe('image/png');
      expect(passed.key).toBe(msg.key);
    });
  }

  it('a plain document with caption is still detected', () => {
    const msg = message('doc', {
      documentWithCaptionMessage: { message: { documentMessage: { mimetype: 'application/pdf', fileName: 'a.pdf' } } },
    });
    expect(detectMediaType(msg)).toMatchObject({ type: 'document', mimeType: 'application/pdf', filename: 'a.pdf' });
  });
});
