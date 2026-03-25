/**
 * Tests for the event-driven media processing pipeline.
 *
 * Covers: awaitMediaProcessing(), mediaResultCache, mediaCompletions,
 * checkProcessedColumn, and the 10-minute promise leak circuit breaker.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { __test__ } from '../agent-dispatcher';

const {
  awaitMediaProcessing,
  mediaCompletions,
  mediaResultCache,
  checkProcessedColumn,
  getProcessedColumn,
  MEDIA_WAIT_NULL,
} = __test__;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock services object for awaitMediaProcessing */
function mockServices(
  overrides: {
    chat?: Record<string, unknown> | null;
    message?: Record<string, unknown> | null;
    updatedMessage?: Record<string, unknown> | null;
  } = {},
) {
  const chat = overrides.chat !== undefined ? overrides.chat : { id: 'chat-uuid-1' };
  const message = overrides.message !== undefined ? overrides.message : { id: 'msg-uuid-1', mediaLocalPath: null };
  const updatedMessage = overrides.updatedMessage !== undefined ? overrides.updatedMessage : message;

  return {
    chats: {
      findByExternalIdSmart: mock(() => Promise.resolve(chat)),
    },
    messages: {
      getByExternalId: mock(() => {
        // First call returns `message`, subsequent calls return `updatedMessage`
        const fn = mock(() => Promise.resolve(updatedMessage));
        fn.mockReturnValueOnce(Promise.resolve(message));
        // We need a stateful mock — rebuild per call
        return Promise.resolve(message);
      }),
    },
  } as unknown as Parameters<typeof awaitMediaProcessing>[0];
}

/** Build services with a stateful getByExternalId that returns different values on each call */
function mockServicesStateful(opts: {
  chat?: Record<string, unknown> | null;
  firstMessage?: Record<string, unknown> | null;
  secondMessage?: Record<string, unknown> | null;
}) {
  const chat = opts.chat ?? { id: 'chat-uuid-1' };
  let callCount = 0;

  return {
    chats: {
      findByExternalIdSmart: mock(() => Promise.resolve(chat)),
    },
    messages: {
      getByExternalId: mock(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(opts.firstMessage ?? null);
        return Promise.resolve(opts.secondMessage ?? opts.firstMessage ?? null);
      }),
    },
  } as unknown as Parameters<typeof awaitMediaProcessing>[0];
}

// ---------------------------------------------------------------------------
// checkProcessedColumn
// ---------------------------------------------------------------------------
describe('checkProcessedColumn', () => {
  it('returns "pending" when message is null', () => {
    expect(checkProcessedColumn(null, 'transcription')).toBe('pending');
  });

  it('returns "pending" when column value is null', () => {
    expect(checkProcessedColumn({ transcription: null }, 'transcription')).toBe('pending');
  });

  it('returns "error" when column value starts with [error', () => {
    expect(checkProcessedColumn({ transcription: '[error: API failed]' }, 'transcription')).toBe('error');
  });

  it('returns "error" for media-processor failure marker format', () => {
    // Regression: media-processor writes `[error: media processing failed — reason]`
    // and the dispatcher must detect it as an error via startsWith('[error')
    const marker = '[error: media processing failed — Vision API quota exceeded]';
    expect(checkProcessedColumn({ imageDescription: marker }, 'imageDescription')).toBe('error');
    expect(checkProcessedColumn({ transcription: marker }, 'transcription')).toBe('error');
  });

  it('returns content and localPath when column has a value', () => {
    const result = checkProcessedColumn(
      { imageDescription: 'A photo of a cat', mediaLocalPath: null },
      'imageDescription',
    );
    expect(result).toEqual({ content: 'A photo of a cat', localPath: null });
  });
});

// ---------------------------------------------------------------------------
// getProcessedColumn
// ---------------------------------------------------------------------------
describe('getProcessedColumn', () => {
  it('maps audio → transcription', () => expect(getProcessedColumn('audio')).toBe('transcription'));
  it('maps image → imageDescription', () => expect(getProcessedColumn('image')).toBe('imageDescription'));
  it('maps video → videoDescription', () => expect(getProcessedColumn('video')).toBe('videoDescription'));
  it('maps document → documentExtraction', () => expect(getProcessedColumn('document')).toBe('documentExtraction'));
  it('returns null for unknown type', () => expect(getProcessedColumn('sticker')).toBeNull());
});

// ---------------------------------------------------------------------------
// awaitMediaProcessing
// ---------------------------------------------------------------------------
describe('awaitMediaProcessing', () => {
  afterEach(() => {
    // Clean up global state between tests
    mediaCompletions.clear();
    mediaResultCache.clear();
  });

  it('returns MEDIA_WAIT_NULL for unknown content type', async () => {
    const services = mockServices();
    const result = await awaitMediaProcessing(services, 'inst-1', 'chat-ext-1', 'ext-msg-1', 'sticker');
    expect(result).toEqual(MEDIA_WAIT_NULL);
  });

  it(
    'returns MEDIA_WAIT_NULL when chat is not found after retries',
    async () => {
      const services = mockServices({ chat: null });
      const result = await awaitMediaProcessing(services, 'inst-1', 'chat-ext-1', 'ext-msg-1', 'image');
      expect(result).toEqual(MEDIA_WAIT_NULL);
    },
    { timeout: 10_000 },
  );

  it(
    'returns MEDIA_WAIT_NULL when message is not found after retries',
    async () => {
      const services = mockServices({ message: null });
      const result = await awaitMediaProcessing(services, 'inst-1', 'chat-ext-1', 'ext-msg-1', 'image');
      expect(result).toEqual(MEDIA_WAIT_NULL);
    },
    { timeout: 10_000 },
  );

  it('returns immediately when DB already has processed result (DB-already-done)', async () => {
    const services = mockServices({
      message: {
        id: 'msg-uuid-1',
        imageDescription: 'A sunset over the ocean',
        mediaLocalPath: null,
      },
    });

    const result = await awaitMediaProcessing(services, 'inst-1', 'chat-ext-1', 'ext-msg-1', 'image');
    expect(result.content).toBe('A sunset over the ocean');
    // Should not have registered a promise
    expect(mediaCompletions.size).toBe(0);
  });

  it('returns MEDIA_WAIT_NULL when DB has error result', async () => {
    const services = mockServices({
      message: {
        id: 'msg-uuid-1',
        imageDescription: '[error: Vision API quota exceeded]',
        mediaLocalPath: null,
      },
    });

    const result = await awaitMediaProcessing(services, 'inst-1', 'chat-ext-1', 'ext-msg-1', 'image');
    expect(result).toEqual(MEDIA_WAIT_NULL);
  });

  it('resolves from event cache when result arrived before dispatcher asked (cache hit)', async () => {
    const msgId = 'msg-uuid-cache';
    const services = mockServices({
      message: { id: msgId, imageDescription: null, mediaLocalPath: null },
    });

    // Pre-populate the cache (simulating event arriving before awaitMediaProcessing)
    mediaResultCache.set(msgId, { content: 'Cached description from early event' });

    const result = await awaitMediaProcessing(services, 'inst-1', 'chat-ext-1', 'ext-msg-1', 'image');
    expect(result.content).toBe('Cached description from early event');
    // Cache entry should be consumed (deleted)
    expect(mediaResultCache.has(msgId)).toBe(false);
  });

  it('returns MEDIA_WAIT_NULL when cache has error result', async () => {
    const msgId = 'msg-uuid-cache-err';
    const services = mockServices({
      message: { id: msgId, imageDescription: null, mediaLocalPath: null },
    });

    mediaResultCache.set(msgId, { content: '', error: 'API failure' });

    const result = await awaitMediaProcessing(services, 'inst-1', 'chat-ext-1', 'ext-msg-1', 'image');
    expect(result).toEqual(MEDIA_WAIT_NULL);
  });

  it('resolves when media.processed event fires (NATS promise path)', async () => {
    const msgId = 'msg-uuid-nats';
    const services = mockServicesStateful({
      firstMessage: { id: msgId, imageDescription: null, mediaLocalPath: null },
      secondMessage: { id: msgId, imageDescription: 'Processed image', mediaLocalPath: 'inst-1/2026-03/photo.jpg' },
    });

    // Start the await — it will register a promise in mediaCompletions
    const promise = awaitMediaProcessing(services, 'inst-1', 'chat-ext-1', 'ext-msg-1', 'image');

    // Wait a tick for the promise to be registered
    await new Promise((r) => setTimeout(r, 10));

    // Verify promise was registered
    expect(mediaCompletions.has(msgId)).toBe(true);

    // Simulate media.processed event resolving the promise
    const pending = mediaCompletions.get(msgId);
    expect(pending).toBeDefined();
    pending!.resolve({ content: 'A beautiful sunset' });

    const result = await promise;
    expect(result.content).toBe('A beautiful sunset');
    // Promise should be cleaned up by caller in real code, but our mock doesn't delete
  });

  it('returns MEDIA_WAIT_NULL when event resolves with error', async () => {
    const msgId = 'msg-uuid-err-event';
    const services = mockServices({
      message: { id: msgId, imageDescription: null, mediaLocalPath: null },
    });

    const promise = awaitMediaProcessing(services, 'inst-1', 'chat-ext-1', 'ext-msg-1', 'image');

    await new Promise((r) => setTimeout(r, 10));

    const pending = mediaCompletions.get(msgId);
    pending!.resolve({ content: '', error: 'Gemini API failure' });

    const result = await promise;
    expect(result).toEqual(MEDIA_WAIT_NULL);
  });

  it('returns MEDIA_WAIT_NULL when event resolves with empty content', async () => {
    const msgId = 'msg-uuid-empty';
    const services = mockServices({
      message: { id: msgId, imageDescription: null, mediaLocalPath: null },
    });

    const promise = awaitMediaProcessing(services, 'inst-1', 'chat-ext-1', 'ext-msg-1', 'audio');

    await new Promise((r) => setTimeout(r, 10));

    const pending = mediaCompletions.get(msgId);
    pending!.resolve({ content: '' });

    const result = await promise;
    expect(result).toEqual(MEDIA_WAIT_NULL);
  });
});

// ---------------------------------------------------------------------------
// Promise leak cleanup (10-minute circuit breaker)
// ---------------------------------------------------------------------------
describe('mediaCompletions leak cleanup', () => {
  afterEach(() => {
    mediaCompletions.clear();
    mediaResultCache.clear();
  });

  it('rejects promise when older than 10 minutes (circuit breaker)', async () => {
    const msgId = 'msg-uuid-leak';
    const leakThreshold = 10 * 60_000;
    let rejectedError: Error | null = null;

    // Create a promise in mediaCompletions with an old createdAt
    const promise = new Promise<{ content: string; error?: string }>((resolve, reject) => {
      mediaCompletions.set(msgId, {
        resolve,
        reject,
        createdAt: Date.now() - leakThreshold - 1000, // 10min + 1s ago
      });
    });

    promise.catch((err) => {
      rejectedError = err;
    });

    // Simulate the cleanup interval logic (same as in setupAgentDispatcher)
    const now = Date.now();
    for (const [mediaId, pending] of mediaCompletions.entries()) {
      if (now - pending.createdAt > leakThreshold) {
        pending.reject(new Error('media processing promise leaked (10min circuit breaker)'));
        mediaCompletions.delete(mediaId);
      }
    }

    // Wait for rejection to propagate
    await new Promise((r) => setTimeout(r, 10));

    expect(rejectedError).not.toBeNull();
    expect(rejectedError!.message).toContain('circuit breaker');
    expect(mediaCompletions.has(msgId)).toBe(false);
  });

  it('does not reject promise younger than 10 minutes', () => {
    const msgId = 'msg-uuid-young';

    mediaCompletions.set(msgId, {
      resolve: () => {},
      reject: () => {
        throw new Error('Should not be called');
      },
      createdAt: Date.now() - 5 * 60_000, // Only 5 minutes old
    });

    const now = Date.now();
    const leakThreshold = 10 * 60_000;
    for (const [mediaId, pending] of mediaCompletions.entries()) {
      if (now - pending.createdAt > leakThreshold) {
        pending.reject(new Error('media processing promise leaked (10min circuit breaker)'));
        mediaCompletions.delete(mediaId);
      }
    }

    // Promise should still be in the map
    expect(mediaCompletions.has(msgId)).toBe(true);
  });
});
