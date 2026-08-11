/**
 * Deferred-media download bridge (issue #897).
 *
 * Meta Cloud (`whatsapp-business`) inbound webhooks carry only a `media_id`, not
 * a public `mediaUrl` — so the message.received event has `content.mediaId` set
 * and `content.mediaUrl` absent. The media processor must materialize the bytes
 * by calling the channel plugin's `downloadInboundMedia(instanceId, mediaId)`,
 * store them, and feed a readable file to the processing service. Without this
 * bridge the audio is persisted but never downloaded or transcribed.
 *
 * These are pure unit tests (LocalMediaBackend, no MinIO/Docker). The fake
 * plugin is injected via `ctx.resolveChannelPlugin` so the test never touches
 * the shared `channelRegistry` singleton (which is fragile under bun's global
 * `mock.module` leakage across files).
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ChannelPlugin, LocalMediaBackend } from '@omni/channel-sdk';
import type { EventBus, MessageReceivedPayload } from '@omni/core';
import type { Database } from '@omni/db';
import type { MediaProcessingService } from '@omni/media-processing';
import type { Services } from '../../services';
import { MediaStorageService } from '../../services/media-storage';
import { type MediaProcessorContext, __test__ } from '../media-processor';

const { processMessageMedia } = __test__;

interface ProcessCapture {
  path?: string;
  bytes?: Buffer;
}

function makeFakeMediaService(capture: ProcessCapture): MediaProcessingService {
  return {
    canProcess: () => true,
    process: async (path: string) => {
      capture.path = path;
      capture.bytes = await readFile(path);
      return {
        success: true,
        content: 'transcribed: hello world',
        contentFormat: 'text',
        processingType: 'transcription',
        provider: 'fake',
        model: 'fake-model',
        processingTimeMs: 1,
        costCents: 0,
      };
    },
  } as unknown as MediaProcessingService;
}

/** Chainable no-op DB — the storage/persistence writes are asserted elsewhere. */
function makeMockDb(): Database {
  return {
    update: () => ({ set: () => ({ where: async () => {} }) }),
    insert: () => ({ values: async () => {} }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  } as unknown as Database;
}

function makeMockServices(): Services {
  return {
    chats: { findByExternalIdSmart: async () => ({ id: 'chat-uuid' }) },
    // No pre-existing local path — forces the processor down the download branch.
    messages: { getByExternalId: async () => ({ id: 'msg-uuid', mediaLocalPath: null, platformTimestamp: null }) },
  } as unknown as Services;
}

function makeContext(opts: {
  mediaStorage: MediaStorageService;
  mediaService: MediaProcessingService;
  published: Array<{ type: string; payload: Record<string, unknown> }>;
  plugin: ChannelPlugin | undefined;
}): MediaProcessorContext {
  const eventBus = {
    publish: async (type: string, payload: Record<string, unknown>) => {
      opts.published.push({ type, payload });
    },
  } as unknown as EventBus;

  return {
    db: makeMockDb(),
    eventBus,
    services: makeMockServices(),
    mediaService: opts.mediaService,
    mediaStorage: opts.mediaStorage,
    defaultLanguage: 'pt',
    promptOverrides: {},
    resolveChannelPlugin: async () => opts.plugin,
  };
}

/** Inbound Meta audio: mediaId set, NO mediaUrl (the defining shape of #897). */
const metaAudioPayload: MessageReceivedPayload = {
  externalId: 'wamid.meta-audio-1',
  chatId: '5511999999999',
  content: { type: 'audio', mimeType: 'audio/ogg; codecs=opus', mediaId: 'META_MEDIA_123' },
} as unknown as MessageReceivedPayload;

/** Distinctive bytes so a stored-vs-processed match can't be coincidental. */
const audioBytes = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0xde, 0xad, 0xbe, 0xef]);

function makeFakePlugin(
  overrides: Partial<ChannelPlugin>,
  calls: Array<{ instanceId: string; mediaRef: string }>,
): ChannelPlugin {
  return {
    id: 'whatsapp-business',
    name: 'Fake WA Business',
    version: '0.0.0-test',
    capabilities: {},
    initialize: async () => {},
    destroy: async () => {},
    connect: async () => {},
    disconnect: async () => {},
    getStatus: async () => 'connected',
    getConnectedInstances: () => [],
    sendMessage: async () => ({ success: true }),
    downloadInboundMedia: async (instanceId: string, mediaRef: string) => {
      calls.push({ instanceId, mediaRef });
      return { buffer: audioBytes, mimeType: 'audio/ogg' };
    },
    ...overrides,
  } as unknown as ChannelPlugin;
}

describe('media-processor deferred plugin download (issue #897)', () => {
  it('materializes Meta media via downloadInboundMedia, stores bytes, and transcribes', async () => {
    const tempBase = await mkdtemp(join(tmpdir(), 'omni-plugin-dl-'));
    try {
      const storage = new MediaStorageService(makeMockDb(), tempBase, new LocalMediaBackend(tempBase));

      const calls: Array<{ instanceId: string; mediaRef: string }> = [];
      const capture: ProcessCapture = {};
      const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const ctx = makeContext({
        mediaStorage: storage,
        mediaService: makeFakeMediaService(capture),
        published,
        plugin: makeFakePlugin({}, calls),
      });

      await processMessageMedia(
        ctx,
        metaAudioPayload,
        { instanceId: 'inst-wab-1', channelType: 'whatsapp-business' },
        { metadata: { correlationId: 'legacy' } },
      );

      // The plugin was asked for the exact Meta media id, scoped to the instance.
      expect(calls).toEqual([{ instanceId: 'inst-wab-1', mediaRef: 'META_MEDIA_123' }]);

      // The processing service received a readable file holding the plugin bytes.
      expect(capture.path).toBeDefined();
      expect(Array.from(capture.bytes!)).toEqual(Array.from(audioBytes));

      // Transcription ran and was published.
      const processed = published.find((e) => e.type === 'media.processed');
      expect(processed).toBeDefined();
      expect(processed?.payload.content).toBe('transcribed: hello world');
    } finally {
      await rm(tempBase, { recursive: true, force: true });
    }
  });

  it('is a no-op (no transcription) when the plugin cannot download inbound media', async () => {
    const tempBase = await mkdtemp(join(tmpdir(), 'omni-plugin-dl-'));
    try {
      const storage = new MediaStorageService(makeMockDb(), tempBase, new LocalMediaBackend(tempBase));

      const capture: ProcessCapture = {};
      const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const ctx = makeContext({
        mediaStorage: storage,
        mediaService: makeFakeMediaService(capture),
        published,
        // Plugin without downloadInboundMedia — the bridge must bail cleanly.
        plugin: makeFakePlugin({ downloadInboundMedia: undefined }, []),
      });

      await processMessageMedia(
        ctx,
        metaAudioPayload,
        { instanceId: 'inst-wab-1', channelType: 'whatsapp-business' },
        { metadata: { correlationId: 'legacy' } },
      );

      expect(capture.path).toBeUndefined();
      expect(published.find((e) => e.type === 'media.processed')).toBeUndefined();
    } finally {
      await rm(tempBase, { recursive: true, force: true });
    }
  });
});
