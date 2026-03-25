/**
 * Regression tests for media-processor bugs.
 *
 * Bug 1: Failure marker `[media processing failed: ...]` didn't match dispatcher's
 *   `startsWith('[error')` check, leaking failed media text into agent context.
 * Bug 2: Crash handler emitted `payload.externalId` (platform ID) as mediaId,
 *   but dispatcher awaits completions keyed by DB message UUID.
 *
 * Both fixes are tested through the setupMediaProcessor integration path.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { __test__ as dispatcherTest } from '../agent-dispatcher';
import { setupMediaProcessor } from '../media-processor';

const { checkProcessedColumn } = dispatcherTest;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Handler = (event: Record<string, unknown>) => Promise<void>;

function createMockEventBus() {
  const handlers: Record<string, Handler> = {};
  const published: Array<{ type: string; payload: Record<string, unknown> }> = [];

  return {
    handlers,
    published,
    eventBus: {
      subscribe: mock(async (type: string, handler: Handler) => {
        handlers[type] = handler;
        return { unsubscribe: mock(() => {}) };
      }),
      subscribePattern: mock(async () => ({ unsubscribe: mock(() => {}) })),
      publish: mock(async (type: string, payload: Record<string, unknown>) => {
        published.push({ type, payload });
      }),
      publishGeneric: mock(async () => {}),
    },
  };
}

/**
 * Create mock services with stateful call tracking.
 * resolveMediaPath (inside processMessageMedia) calls findByExternalIdSmart + getByExternalId.
 * If resolveMediaPath succeeds, the handler will proceed to call ctx.mediaService.process()
 * which will throw on a nonexistent file, triggering the crash handler.
 * The crash handler then calls findByExternalIdSmart + getByExternalId again.
 */
function createMockServices(opts: {
  messageId?: string;
  crashHandlerChatFound?: boolean;
  crashHandlerMessageFound?: boolean;
}) {
  const messageId = opts.messageId ?? 'msg-db-uuid';
  let chatCallCount = 0;
  let msgCallCount = 0;

  return {
    settings: {
      getSecret: mock(() => Promise.resolve(undefined)),
      getString: mock(() => Promise.resolve(undefined)),
    },
    chats: {
      findByExternalIdSmart: mock(() => {
        chatCallCount++;
        // First call: from resolveMediaPath (always succeed so handler proceeds)
        if (chatCallCount === 1) return Promise.resolve({ id: 'chat-db-uuid' });
        // Second call: from crash handler
        if (opts.crashHandlerChatFound === false) return Promise.resolve(null);
        return Promise.resolve({ id: 'chat-db-uuid' });
      }),
    },
    messages: {
      getByExternalId: mock(() => {
        msgCallCount++;
        // First call: from resolveMediaPath (return message with mediaLocalPath to trigger processing)
        if (msgCallCount === 1) {
          return Promise.resolve({
            id: messageId,
            mediaLocalPath: '/fake/nonexistent/file.ogg',
            platformTimestamp: null,
          });
        }
        // Second call: from crash handler
        if (opts.crashHandlerMessageFound === false) return Promise.resolve(null);
        return Promise.resolve({ id: messageId });
      }),
    },
  } as never;
}

// ---------------------------------------------------------------------------
// Bug 1 regression: marker format must match dispatcher check
// ---------------------------------------------------------------------------
describe('media-processor failure marker (bug 1)', () => {
  it('new marker format [error: media processing failed — ...] is detected by dispatcher', () => {
    // The media-processor now writes markers like: [error: media processing failed — reason]
    // The dispatcher checks: processed.startsWith('[error')
    const marker = '[error: media processing failed — Vision API quota exceeded]';
    expect(checkProcessedColumn({ transcription: marker }, 'transcription')).toBe('error');
    expect(checkProcessedColumn({ imageDescription: marker }, 'imageDescription')).toBe('error');
    expect(checkProcessedColumn({ videoDescription: marker }, 'videoDescription')).toBe('error');
    expect(checkProcessedColumn({ documentExtraction: marker }, 'documentExtraction')).toBe('error');
  });

  it('old marker format [media processing failed: ...] would NOT match dispatcher (proving the bug)', () => {
    // This shows the old format was broken — it doesn't start with [error
    const oldMarker = '[media processing failed: Vision API quota exceeded]';
    // The old marker would be treated as valid content, not an error!
    const result = checkProcessedColumn({ transcription: oldMarker }, 'transcription');
    expect(result).not.toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Bug 2 regression: crash handler must use DB message UUID
// ---------------------------------------------------------------------------
describe('media-processor crash handler mediaId (bug 2)', () => {
  afterEach(() => {
    // Reset any module-level state
  });

  it('uses DB message UUID (not externalId) in failure events when lookups succeed', async () => {
    const { eventBus, published, handlers } = createMockEventBus();
    const services = createMockServices({ messageId: 'msg-db-uuid-123' });

    await setupMediaProcessor(eventBus as never, {} as never, services);

    const handler = handlers['message.received']!;
    expect(handler).toBeDefined();

    // Trigger with a media message. resolveMediaPath will succeed (mock returns
    // message with mediaLocalPath), then mediaService.process() will throw on
    // the nonexistent file, hitting the crash handler.
    await handler({
      id: 'event-1',
      payload: {
        externalId: 'whatsapp-msg-id-456',
        chatId: 'chat-ext-id',
        content: { type: 'audio', mimeType: 'audio/ogg' },
      },
      metadata: {
        instanceId: 'inst-1',
        channelType: 'whatsapp-baileys',
      },
    });

    const failedEvents = published.filter((e) => e.type === 'media.processing.failed');
    const processedEvents = published.filter((e) => e.type === 'media.processed');

    expect(failedEvents.length).toBe(1);
    expect(processedEvents.length).toBe(1);

    // Both events must use the DB message UUID, not the platform externalId
    expect(failedEvents[0]!.payload.mediaId).toBe('msg-db-uuid-123');
    expect(processedEvents[0]!.payload.mediaId).toBe('msg-db-uuid-123');
    expect(failedEvents[0]!.payload.mediaId).not.toBe('whatsapp-msg-id-456');
  });

  it('falls back to externalId when crash handler chat lookup returns null', async () => {
    const { eventBus, published, handlers } = createMockEventBus();
    const services = createMockServices({ crashHandlerChatFound: false });

    await setupMediaProcessor(eventBus as never, {} as never, services);

    const handler = handlers['message.received']!;

    await handler({
      id: 'event-2',
      payload: {
        externalId: 'platform-ext-id',
        chatId: 'chat-ext-id',
        content: { type: 'image', mimeType: 'image/jpeg' },
      },
      metadata: {
        instanceId: 'inst-1',
        channelType: 'whatsapp-baileys',
      },
    });

    const failedEvents = published.filter((e) => e.type === 'media.processing.failed');
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0]!.payload.mediaId).toBe('platform-ext-id');
  });

  it('falls back to externalId when crash handler message lookup returns null', async () => {
    const { eventBus, published, handlers } = createMockEventBus();
    const services = createMockServices({ crashHandlerMessageFound: false });

    await setupMediaProcessor(eventBus as never, {} as never, services);

    const handler = handlers['message.received']!;

    await handler({
      id: 'event-3',
      payload: {
        externalId: 'platform-ext-id-2',
        chatId: 'chat-ext-id',
        content: { type: 'document', mimeType: 'application/pdf' },
      },
      metadata: {
        instanceId: 'inst-1',
        channelType: 'whatsapp-baileys',
      },
    });

    const failedEvents = published.filter((e) => e.type === 'media.processing.failed');
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0]!.payload.mediaId).toBe('platform-ext-id-2');
  });
});
