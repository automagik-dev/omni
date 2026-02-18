import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { MediaGroupBuffer, type MediaGroupMessage } from '../handlers/media-group';

function createMessage(overrides: Partial<MediaGroupMessage> = {}): MediaGroupMessage {
  return {
    externalId: `msg-${Math.random().toString(36).slice(2, 8)}`,
    chatId: '123',
    from: 'user-1',
    content: {
      type: 'image',
      caption: 'test caption',
      mediaFileId: 'file-123',
      mimeType: 'image/jpeg',
    },
    rawPayload: {},
    platformTimestamp: Date.now(),
    estimatedSize: 1024,
    ...overrides,
  };
}

describe('Media Group Buffer', () => {
  let flushCallback: ReturnType<typeof mock>;
  let buffer: MediaGroupBuffer;

  beforeEach(() => {
    flushCallback = mock(() => {});
    buffer = new MediaGroupBuffer(flushCallback, 500);
  });

  afterEach(() => {
    buffer.flushAll();
  });

  test('5 photos as album result in 1 flush with all 5 media references', async () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      createMessage({
        externalId: `msg-${i}`,
        content: {
          type: 'image',
          caption: i === 0 ? 'Album caption' : undefined,
          mediaFileId: `file-${i}`,
          mimeType: 'image/jpeg',
        },
      }),
    );

    for (const msg of messages) {
      buffer.add('group-1', msg);
    }

    // Manually flush to test synchronously
    buffer.flush('group-1');

    expect(flushCallback).toHaveBeenCalledTimes(1);
    const result = flushCallback.mock.calls[0]?.[0];
    expect(result.mediaGroupId).toBe('group-1');
    expect(result.messages).toHaveLength(5);
    expect(result.mediaRefs).toHaveLength(5);
  });

  test('mixed media album (photos + videos) correctly batched', () => {
    buffer.add(
      'group-2',
      createMessage({ content: { type: 'image', mediaFileId: 'photo-1', mimeType: 'image/jpeg' } }),
    );
    buffer.add('group-2', createMessage({ content: { type: 'video', mediaFileId: 'video-1', mimeType: 'video/mp4' } }));
    buffer.add('group-2', createMessage({ content: { type: 'image', mediaFileId: 'photo-2', mimeType: 'image/png' } }));

    buffer.flush('group-2');

    const result = flushCallback.mock.calls[0]?.[0];
    expect(result.mediaRefs).toHaveLength(3);
    expect(result.mediaRefs[0].type).toBe('image');
    expect(result.mediaRefs[1].type).toBe('video');
    expect(result.mediaRefs[2].type).toBe('image');
  });

  test('buffer flushes on timeout', async () => {
    // Use a short timeout for testing
    const fastBuffer = new MediaGroupBuffer(flushCallback, 200);

    fastBuffer.add('group-timeout', createMessage());

    // Wait for timeout to fire
    await new Promise((r) => setTimeout(r, 350));

    expect(flushCallback).toHaveBeenCalledTimes(1);
    expect(flushCallback.mock.calls[0]?.[0].mediaGroupId).toBe('group-timeout');
  });

  test('buffer flushes when hitting 50 messages', () => {
    for (let i = 0; i < 50; i++) {
      buffer.add('group-cap', createMessage({ estimatedSize: 100 }));
    }

    // Should have flushed at 50
    expect(flushCallback).toHaveBeenCalledTimes(1);
    expect(flushCallback.mock.calls[0]?.[0].messages).toHaveLength(50);
  });

  test('buffer flushes when hitting 10MB total payload', () => {
    // Each message ~5MB, second should trigger flush
    buffer.add('group-size', createMessage({ estimatedSize: 5 * 1024 * 1024 }));
    buffer.add('group-size', createMessage({ estimatedSize: 5 * 1024 * 1024 }));

    expect(flushCallback).toHaveBeenCalledTimes(1);
    expect(flushCallback.mock.calls[0]?.[0].messages).toHaveLength(2);
  });

  test('partial album processes after timeout', async () => {
    const fastBuffer = new MediaGroupBuffer(flushCallback, 200);

    // Send only 2 of expected 5 photos
    fastBuffer.add('group-partial', createMessage());
    fastBuffer.add('group-partial', createMessage());

    await new Promise((r) => setTimeout(r, 350));

    expect(flushCallback).toHaveBeenCalledTimes(1);
    expect(flushCallback.mock.calls[0]?.[0].messages).toHaveLength(2);
  });

  test('combined caption joins all captions', () => {
    buffer.add('group-captions', createMessage({ content: { type: 'image', caption: 'First', mediaFileId: 'f1' } }));
    buffer.add('group-captions', createMessage({ content: { type: 'image', caption: 'Second', mediaFileId: 'f2' } }));

    buffer.flush('group-captions');

    const result = flushCallback.mock.calls[0]?.[0];
    expect(result.combinedCaption).toBe('First\nSecond');
  });

  test('pendingCount tracks active buffers', () => {
    expect(buffer.pendingCount).toBe(0);

    buffer.add('g1', createMessage());
    expect(buffer.pendingCount).toBe(1);

    buffer.add('g2', createMessage());
    expect(buffer.pendingCount).toBe(2);

    buffer.flush('g1');
    expect(buffer.pendingCount).toBe(1);

    buffer.flushAll();
    expect(buffer.pendingCount).toBe(0);
  });
});
