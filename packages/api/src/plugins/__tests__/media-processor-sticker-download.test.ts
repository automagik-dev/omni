/**
 * Deferred-media sticker download (issue #1304).
 *
 * Meta Cloud (`whatsapp-business`) inbound stickers carry only a `media_id`,
 * like every Cloud API media type, and Meta expires media ids. The media
 * processor is the only place those bytes are materialized, but it only ran for
 * audio/image/document/video, so a sticker was saved with `hasMedia: true` and
 * never downloaded.
 *
 * A sticker is downloaded and stored, never sent to AI processing: no
 * description, no `media.processed` / `media.processing.failed`, no error
 * marker. Stickers from channels that ship a URL instead of a `mediaId`
 * (Telegram, Discord) are left exactly as before.
 *
 * Pure unit tests (LocalMediaBackend, no MinIO/Docker/Postgres). The fake
 * plugin is injected via `ctx.resolveChannelPlugin`, as in
 * media-processor-plugin-download.test.ts.
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ChannelPlugin, LocalMediaBackend } from '@omni/channel-sdk';
import type { EventBus, OmniEvent } from '@omni/core';
import type { Database } from '@omni/db';
import type { MediaProcessingService } from '@omni/media-processing';
import type { Services } from '../../services';
import { MediaStorageService } from '../../services/media-storage';
import { type MediaProcessorContext, __test__ } from '../media-processor';

const { handleMessageReceived } = __test__;

/** Distinctive bytes so a stored-vs-downloaded match can't be coincidental. */
const stickerBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0xca, 0xfe, 0xba, 0xbe]);

interface Harness {
  ctx: MediaProcessorContext;
  tempBase: string;
  pluginCalls: Array<{ instanceId: string; mediaRef: string }>;
  processCalls: string[];
  published: string[];
  /** Every `db.update(...).set(...)` payload — mediaLocalPath and error markers land here. */
  dbSets: Array<Record<string, unknown>>;
  lookups: number;
}

async function makeHarness(opts: { download?: () => Promise<{ buffer: Buffer; mimeType?: string }> } = {}) {
  const tempBase = await mkdtemp(join(tmpdir(), 'omni-sticker-dl-'));
  const h: Harness = {
    tempBase,
    pluginCalls: [],
    processCalls: [],
    published: [],
    dbSets: [],
    lookups: 0,
  } as unknown as Harness;

  const db = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        h.dbSets.push(values);
        return { where: async () => {} };
      },
    }),
    insert: () => ({ values: async () => {} }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  } as unknown as Database;

  const services = {
    chats: {
      findByExternalIdSmart: async () => {
        h.lookups++;
        return { id: 'chat-uuid' };
      },
    },
    messages: {
      getByExternalId: async () => ({ id: 'msg-uuid', mediaLocalPath: null, platformTimestamp: null }),
    },
  } as unknown as Services;

  const mediaService = {
    canProcess: () => true,
    process: async (path: string) => {
      h.processCalls.push(path);
      return { success: false, errorMessage: 'should never run', provider: 'fake', model: 'fake' };
    },
  } as unknown as MediaProcessingService;

  const plugin = {
    id: 'whatsapp-business',
    downloadInboundMedia: async (instanceId: string, mediaRef: string) => {
      h.pluginCalls.push({ instanceId, mediaRef });
      return opts.download ? opts.download() : { buffer: stickerBytes, mimeType: 'image/webp' };
    },
  } as unknown as ChannelPlugin;

  h.ctx = {
    db,
    eventBus: {
      publish: async (type: string) => {
        h.published.push(type);
      },
    } as unknown as EventBus,
    services,
    mediaService,
    mediaStorage: new MediaStorageService(db, tempBase, new LocalMediaBackend(tempBase)),
    defaultLanguage: 'pt',
    promptOverrides: {},
    resolveChannelPlugin: async () => plugin,
  };
  return h;
}

function stickerEvent(content: Record<string, unknown>, channelType = 'whatsapp-business'): OmniEvent {
  return {
    id: '00000000-0000-4000-8000-000000001304',
    type: 'message.received',
    timestamp: Date.now(),
    payload: {
      externalId: 'wamid.sticker-1',
      chatId: '5511999999999',
      content: { type: 'sticker', ...content },
    },
    metadata: { correlationId: 'legacy', instanceId: 'inst-wab-1', channelType },
  } as unknown as OmniEvent;
}

describe('media-processor deferred sticker download (issue #1304)', () => {
  it('downloads a Cloud API sticker via the plugin and stores it, without AI processing', async () => {
    const h = await makeHarness();
    try {
      await handleMessageReceived(h.ctx, stickerEvent({ mimeType: 'image/webp', mediaId: 'META_STICKER_1' }));

      expect(h.pluginCalls).toEqual([{ instanceId: 'inst-wab-1', mediaRef: 'META_STICKER_1' }]);

      // The stored reference is recorded on the message row and holds the plugin bytes.
      const localPath = h.dbSets.find((s) => 'mediaLocalPath' in s)?.mediaLocalPath as string | undefined;
      expect(localPath).toBeDefined();
      expect(localPath?.endsWith('.webp')).toBe(true);
      expect(Array.from(await readFile(join(h.tempBase, localPath!)))).toEqual(Array.from(stickerBytes));

      // Download only: no AI call, no media events.
      expect(h.processCalls).toEqual([]);
      expect(h.published).toEqual([]);
    } finally {
      await rm(h.tempBase, { recursive: true, force: true });
    }
  });

  it('stores a sticker as image/webp when neither the webhook nor the plugin names a MIME type', async () => {
    const h = await makeHarness({ download: async () => ({ buffer: stickerBytes }) });
    try {
      await handleMessageReceived(h.ctx, stickerEvent({ mediaId: 'META_STICKER_2' }));

      const localPath = h.dbSets.find((s) => 'mediaLocalPath' in s)?.mediaLocalPath as string | undefined;
      expect(localPath?.endsWith('.webp')).toBe(true);
    } finally {
      await rm(h.tempBase, { recursive: true, force: true });
    }
  });

  it('a failed sticker download publishes no failure events and writes no error marker', async () => {
    const h = await makeHarness({
      download: async () => {
        throw new Error('Graph 404: media id expired');
      },
    });
    try {
      await handleMessageReceived(h.ctx, stickerEvent({ mimeType: 'image/webp', mediaId: 'META_STICKER_3' }));

      expect(h.pluginCalls).toHaveLength(1);
      expect(h.dbSets).toEqual([]);
      expect(h.processCalls).toEqual([]);
      expect(h.published).toEqual([]);
    } finally {
      await rm(h.tempBase, { recursive: true, force: true });
    }
  });

  it('downloads a Hermes sticker (mediaId plus a direct mediaUrl) from the URL, without AI processing', async () => {
    const h = await makeHarness();
    try {
      // Hermes ships a 24h-lived direct S3 link next to the file id; the URL
      // path wins, as for Hermes images. Stub the network fetch only.
      const fetchedUrls: string[] = [];
      const storage = h.ctx.mediaStorage;
      storage.storeFromUrl = async (instanceId, messageId, url, mimeType, timestamp, _fetchOptions, tenantId) => {
        fetchedUrls.push(url);
        return storage.storeFromBuffer(instanceId, messageId, stickerBytes, mimeType, timestamp, tenantId);
      };

      await handleMessageReceived(
        h.ctx,
        stickerEvent(
          { mimeType: 'image/webp', mediaId: 'HERMES_FILE_1', mediaUrl: 'https://hermes-files.example/sticker.webp' },
          'hermes',
        ),
      );

      expect(fetchedUrls).toEqual(['https://hermes-files.example/sticker.webp']);
      expect(h.pluginCalls).toEqual([]);
      const localPath = h.dbSets.find((s) => 'mediaLocalPath' in s)?.mediaLocalPath as string | undefined;
      expect(Array.from(await readFile(join(h.tempBase, localPath!)))).toEqual(Array.from(stickerBytes));
      expect(h.processCalls).toEqual([]);
      expect(h.published).toEqual([]);
    } finally {
      await rm(h.tempBase, { recursive: true, force: true });
    }
  });

  it('leaves URL stickers (Telegram, Discord) untouched', async () => {
    const h = await makeHarness();
    try {
      await handleMessageReceived(
        h.ctx,
        stickerEvent({ mimeType: 'image/webp', mediaUrl: 'https://example.test/sticker.webp' }, 'telegram'),
      );

      expect(h.lookups).toBe(0);
      expect(h.pluginCalls).toEqual([]);
      expect(h.dbSets).toEqual([]);
      expect(h.processCalls).toEqual([]);
      expect(h.published).toEqual([]);
    } finally {
      await rm(h.tempBase, { recursive: true, force: true });
    }
  });
});
