/**
 * Opt-in per-instance audio transcription switch (instances.audio_transcription).
 *
 * - No new option set (including a line carrying the legacy process_audio=false,
 *   which nothing ever honoured) → audio is transcribed exactly as today.
 * - 'auto', a missing instance, or a throwing lookup on a never-read instance
 *   → today's path. A lookup that throws after a successful read keeps the last
 *   known mode, so a known 'off' instance stays off.
 * - 'off' → the audio is still stored, but never sent to STT; one skipped
 *   media.processed (content '', skipped: true, reason 'transcription_off') is
 *   published and no media.processing.failed.
 * - Non-audio media ignore the switch (and never trigger the lookup).
 *
 * DB-free: every collaborator of processMessageMedia is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test';
import type { EventBus, MessageReceivedPayload } from '@omni/core';
import type { Database } from '@omni/db';
import type { MediaProcessingService } from '@omni/media-processing';
import type { Services } from '../../services';
import type { MediaStorageService } from '../../services/media-storage';
import { type MediaProcessorContext, __test__ } from '../media-processor';

const { processMessageMedia } = __test__;

const INSTANCE_ID = 'inst-audio-1';
const MESSAGE_ID = 'msg-uuid-audio';
const EVENT_ID = 'evt-audio-1';

type Published = { type: string; payload: Record<string, unknown> };

interface Harness {
  ctx: MediaProcessorContext;
  published: Published[];
  dbUpdates: Array<Record<string, unknown>>;
  process: ReturnType<typeof mock>;
  materialize: ReturnType<typeof mock>;
  storeFromUrl: ReturnType<typeof mock>;
  updateMessageLocalPath: ReturnType<typeof mock>;
  getById: ReturnType<typeof mock>;
}

/**
 * Build a processor context.
 * `instance`: the row instances.getById resolves; `'throw'` makes it reject;
 * `'absent'` leaves ctx.services.instances undefined.
 */
function makeHarness(
  instance: Record<string, unknown> | 'throw' | 'absent',
  processingType: 'transcription' | 'description' = 'transcription',
): Harness {
  const published: Published[] = [];
  const dbUpdates: Array<Record<string, unknown>> = [];

  const db = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        dbUpdates.push(values);
        return { where: async () => {} };
      },
    }),
    insert: () => ({ values: async () => {} }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  } as unknown as Database;

  const eventBus = {
    publish: async (type: string, payload: Record<string, unknown>) => {
      published.push({ type, payload });
    },
  } as unknown as EventBus;

  const process = mock(async () => ({
    success: true,
    content: processingType === 'transcription' ? 'olá mundo' : 'a sunset',
    contentFormat: 'text',
    processingType,
    provider: 'fake',
    model: 'fake-model',
    processingTimeMs: 1,
    costCents: 0,
  }));
  const mediaService = { canProcess: () => true, process } as unknown as MediaProcessingService;

  const cleanup = mock(async () => {});
  const materialize = mock(async (path: string) => ({ path: `/tmp/${path}`, cleanup }));
  const storeFromUrl = mock(async () => ({ localPath: 'inst-audio-1/2026-10/voice.ogg' }));
  const updateMessageLocalPath = mock(async () => {});
  const mediaStorage = {
    materializeForProcessing: materialize,
    storeFromUrl,
    updateMessageLocalPath,
  } as unknown as MediaStorageService;

  const getById = mock(async () => {
    if (instance === 'throw') throw new Error('instance lookup exploded');
    return instance;
  });

  const services = {
    chats: { findByExternalIdSmart: async () => ({ id: 'chat-uuid' }) },
    // mediaLocalPath null + a mediaUrl in the payload → the processor downloads
    // and stores the bytes, so storage running is observable.
    messages: { getByExternalId: async () => ({ id: MESSAGE_ID, mediaLocalPath: null, platformTimestamp: null }) },
    ...(instance === 'absent' ? {} : { instances: { getById } }),
  } as unknown as Services;

  return {
    ctx: {
      db,
      eventBus,
      services,
      mediaService,
      mediaStorage,
      defaultLanguage: 'pt',
      promptOverrides: {},
    },
    published,
    dbUpdates,
    process,
    materialize,
    storeFromUrl,
    updateMessageLocalPath,
    getById,
  };
}

function payloadFor(type: 'audio' | 'image', mimeType: string): MessageReceivedPayload {
  return {
    externalId: `ext-${type}-1`,
    chatId: 'chat-1',
    content: { type, mimeType, mediaUrl: `https://media.example.com/${type}` },
  } as unknown as MessageReceivedPayload;
}

// The mode cache is module state: keep it from leaking between tests or into other files.
beforeEach(() => __test__.resetAudioTranscriptionModeCache());
afterEach(() => {
  __test__.resetAudioTranscriptionModeCache();
  setSystemTime();
});

const audioPayload = payloadFor('audio', 'audio/ogg');
const imagePayload = payloadFor('image', 'image/jpeg');

async function run(h: Harness, payload: MessageReceivedPayload) {
  await processMessageMedia(
    h.ctx,
    payload,
    { instanceId: INSTANCE_ID, eventId: EVENT_ID, channelType: 'whatsapp-baileys' },
    { metadata: { correlationId: 'legacy' } },
  );
}

const ofType = (h: Harness, type: string) => h.published.filter((e) => e.type === type);

function expectTranscribedAsToday(h: Harness) {
  expect(h.storeFromUrl).toHaveBeenCalledTimes(1);
  expect(h.materialize).toHaveBeenCalledTimes(1);
  expect(h.process).toHaveBeenCalledTimes(1);
  const processed = ofType(h, 'media.processed');
  expect(processed).toHaveLength(1);
  expect(processed[0]?.payload.content).toBe('olá mundo');
  expect(processed[0]?.payload).not.toHaveProperty('skipped');
  expect(ofType(h, 'media.processing.failed')).toHaveLength(0);
}

describe('audio transcription switch — no new option: identical behaviour', () => {
  it('transcribes audio on an instance with processAudio=false and no audioTranscription', async () => {
    const h = makeHarness({ id: INSTANCE_ID, processAudio: false });
    await run(h, audioPayload);
    expectTranscribedAsToday(h);
  });

  it("transcribes audio as today when audioTranscription is 'auto'", async () => {
    const h = makeHarness({ id: INSTANCE_ID, audioTranscription: 'auto', processAudio: true });
    await run(h, audioPayload);
    expectTranscribedAsToday(h);
  });

  it('transcribes audio when the lookup throws for an instance never read before', async () => {
    const h = makeHarness('throw');
    await run(h, audioPayload);
    expect(h.getById).toHaveBeenCalledTimes(1);
    expectTranscribedAsToday(h);
  });

  it('transcribes audio when ctx.services.instances is absent', async () => {
    const h = makeHarness('absent');
    await run(h, audioPayload);
    expectTranscribedAsToday(h);
  });
});

describe("audio transcription switch — 'off'", () => {
  it('stores the audio, skips STT and publishes one skipped media.processed and no failure', async () => {
    const h = makeHarness({ id: INSTANCE_ID, audioTranscription: 'off' });
    await run(h, audioPayload);

    // Storage still ran exactly as today.
    expect(h.storeFromUrl).toHaveBeenCalledTimes(1);
    expect(h.updateMessageLocalPath).toHaveBeenCalledTimes(1);

    // Never sent to STT.
    expect(h.materialize).not.toHaveBeenCalled();
    expect(h.process).not.toHaveBeenCalled();

    const processed = ofType(h, 'media.processed');
    expect(processed).toHaveLength(1);
    expect(processed[0]?.payload).toEqual({
      eventId: EVENT_ID,
      mediaId: MESSAGE_ID,
      processingType: 'transcription',
      content: '',
      skipped: true,
      reason: 'transcription_off',
    });
    expect(processed[0]?.payload).not.toHaveProperty('error');

    expect(ofType(h, 'media.processing.failed')).toHaveLength(0);
    // No '[error' marker (or any other) written to the message row.
    expect(h.dbUpdates).toHaveLength(0);
  });

  it('leaves non-audio media unaffected: an image is processed as today without the lookup', async () => {
    const h = makeHarness({ id: INSTANCE_ID, audioTranscription: 'off' }, 'description');
    await run(h, imagePayload);

    expect(h.getById).not.toHaveBeenCalled();
    expect(h.materialize).toHaveBeenCalledTimes(1);
    expect(h.process).toHaveBeenCalledTimes(1);
    const processed = ofType(h, 'media.processed');
    expect(processed).toHaveLength(1);
    expect(processed[0]?.payload.content).toBe('a sunset');
    expect(processed[0]?.payload).not.toHaveProperty('skipped');
    expect(ofType(h, 'media.processing.failed')).toHaveLength(0);
  });
});

describe('audioTranscription mode cache', () => {
  it('reads the instance once per TTL for repeated audio on the same instance', async () => {
    const h = makeHarness({ id: INSTANCE_ID, audioTranscription: 'auto' });
    await run(h, audioPayload);
    await run(h, audioPayload);
    expect(h.getById).toHaveBeenCalledTimes(1);
    expect(h.process).toHaveBeenCalledTimes(2);
  });

  it('a failed lookup is not cached', async () => {
    const h = makeHarness('throw');
    await run(h, audioPayload);
    await run(h, audioPayload);
    expect(h.getById).toHaveBeenCalledTimes(2);
  });
});

describe('audioTranscription mode — lookup fails after the TTL expired', () => {
  const T0 = new Date('2026-10-19T12:00:00Z');
  const AFTER_TTL = new Date(T0.getTime() + 31_000);

  async function readThenFailAfterTtl(h: Harness) {
    setSystemTime(T0);
    await run(h, audioPayload);
    h.getById.mockImplementation(async () => {
      throw new Error('instance lookup exploded');
    });
    setSystemTime(AFTER_TTL);
    h.published.length = 0;
    h.process.mockClear();
    h.materialize.mockClear();
    h.storeFromUrl.mockClear();
    await run(h, audioPayload);
    expect(h.getById).toHaveBeenCalledTimes(2);
  }

  it("keeps a known 'off' instance off: no STT, one skipped media.processed", async () => {
    const h = makeHarness({ id: INSTANCE_ID, audioTranscription: 'off' });
    await readThenFailAfterTtl(h);

    expect(h.storeFromUrl).toHaveBeenCalledTimes(1);
    expect(h.materialize).not.toHaveBeenCalled();
    expect(h.process).not.toHaveBeenCalled();
    const processed = ofType(h, 'media.processed');
    expect(processed).toHaveLength(1);
    expect(processed[0]?.payload).toMatchObject({ skipped: true, reason: 'transcription_off', content: '' });
    expect(ofType(h, 'media.processing.failed')).toHaveLength(0);
  });

  it("keeps a known 'auto' instance transcribing", async () => {
    const h = makeHarness({ id: INSTANCE_ID, audioTranscription: 'auto' });
    await readThenFailAfterTtl(h);
    expectTranscribedAsToday(h);
  });
});
