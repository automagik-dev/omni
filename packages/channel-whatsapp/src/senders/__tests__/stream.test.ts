/**
 * WhatsAppStreamSender unit tests
 *
 * Verifies:
 * - Initial message creation + subsequent edits
 * - Throttle enforcement (default 2500ms)
 * - Custom throttle via options
 * - Edit fallback: on failure, stops editing and sends new message on final
 * - Final → markdown conversion + multi-chunk split
 * - Thinking deltas are no-ops (WhatsApp doesn't support blockquotes)
 * - Error/abort don't throw
 * - Tail window for long content
 * - Cursor marker during streaming
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { StreamDelta } from '@omni/core';
import { WhatsAppStreamSender } from '../stream';

// ─── Mock WASocket ─────────────────────────────────────────

interface SentMessage {
  jid: string;
  content: Record<string, unknown>;
  options?: unknown;
}

function createMockSocket(opts?: { editShouldFail?: boolean }) {
  const sent: SentMessage[] = [];
  let nextId = 100;
  const editShouldFail = opts?.editShouldFail ?? false;

  const sock = {
    sendMessage: mock(async (jid: string, content: Record<string, unknown>, options?: unknown) => {
      // If this is an edit and we're configured to fail edits
      if (content.edit && editShouldFail) {
        throw new Error('Edit not supported');
      }
      const msg: SentMessage = { jid, content, options };
      sent.push(msg);
      return { key: { id: `msg-${nextId++}` } };
    }),
  };

  return {
    sock: sock as unknown as import('@whiskeysockets/baileys').WASocket,
    sent,
  };
}

// Helper to wait for async timers
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe('WhatsAppStreamSender', () => {
  let mockSocket: ReturnType<typeof createMockSocket>;
  let sender: WhatsAppStreamSender;

  beforeEach(() => {
    mockSocket = createMockSocket();
    // Use a short throttle for tests to avoid long waits
    sender = new WhatsAppStreamSender(mockSocket.sock, '5511999999999@s.whatsapp.net', undefined, 'dm', {
      throttleMs: 100,
    });
  });

  // ─── Basic lifecycle ────────────────────────────────────────

  test('onContentDelta creates initial message with cursor', async () => {
    const delta: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'Hello',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };

    await sender.onContentDelta(delta);
    await tick(150); // Wait past throttle

    expect(mockSocket.sent.length).toBe(1);
    expect(mockSocket.sent[0]?.content.text).toContain('Hello');
    expect(mockSocket.sent[0]?.content.text).toContain('▍');
    // Initial message should NOT have edit key
    expect(mockSocket.sent[0]?.content.edit).toBeUndefined();
  });

  test('second contentDelta edits existing message', async () => {
    const delta1: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'Hello',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    const delta2: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'Hello world',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };

    await sender.onContentDelta(delta1);
    await tick(150); // Past throttle for first message

    await sender.onContentDelta(delta2);
    await tick(150); // Past throttle for edit

    expect(mockSocket.sent.length).toBe(2);
    // Second call should be an edit (has edit key)
    expect(mockSocket.sent[1]?.content.edit).toBeDefined();
    expect(mockSocket.sent[1]?.content.text).toContain('Hello world');
    expect(mockSocket.sent[1]?.content.text).toContain('▍');
  });

  test('onFinal sends converted text without cursor', async () => {
    const finalDelta: StreamDelta & { phase: 'final' } = {
      phase: 'final',
      content: '**bold** and _italic_',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };

    await sender.onFinal(finalDelta);

    expect(mockSocket.sent.length).toBe(1);
    const text = mockSocket.sent[0]?.content.text as string;
    // markdownToWhatsApp converts **bold** → *bold* and _italic_ → _italic_
    expect(text).toContain('*bold*');
    expect(text).not.toContain('▍'); // No cursor in final
  });

  test('onFinal edits placeholder if it exists', async () => {
    // Create placeholder
    const contentDelta: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'Partial...',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onContentDelta(contentDelta);
    await tick(150);

    const finalDelta: StreamDelta & { phase: 'final' } = {
      phase: 'final',
      content: 'Complete answer.',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onFinal(finalDelta);

    // sent[0] = initial message, sent[1] = edit (final)
    expect(mockSocket.sent.length).toBe(2);
    expect(mockSocket.sent[1]?.content.edit).toBeDefined();
    expect(mockSocket.sent[1]?.content.text).toBe('Complete answer.');
  });

  test('onFinal with empty content is a no-op', async () => {
    const delta: StreamDelta & { phase: 'final' } = {
      phase: 'final',
      content: '',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };

    await sender.onFinal(delta);
    expect(mockSocket.sent.length).toBe(0);
  });

  // ─── Thinking ───────────────────────────────────────────────

  test('onThinkingDelta is a no-op (no messages sent)', async () => {
    const delta: StreamDelta & { phase: 'thinking' } = {
      phase: 'thinking',
      thinking: 'Let me think about this...',
      thinkingElapsedMs: 3000,
    };

    await sender.onThinkingDelta(delta);
    await tick(150);

    expect(mockSocket.sent.length).toBe(0);
  });

  // ─── Throttle ───────────────────────────────────────────────

  test('throttle prevents rapid edits', async () => {
    const delta1: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'A',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    const delta2: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'AB',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };

    await sender.onContentDelta(delta1);
    // Immediately send second delta (within throttle window)
    await sender.onContentDelta(delta2);
    await tick(20); // Not enough time for throttle

    // Only the first message should have been sent
    expect(mockSocket.sent.length).toBe(1);

    // Wait for throttle to expire
    await tick(150);

    // Now the pending edit should have fired
    expect(mockSocket.sent.length).toBe(2);
  });

  test('custom throttleMs is respected', async () => {
    const customSender = new WhatsAppStreamSender(mockSocket.sock, '5511999999999@s.whatsapp.net', undefined, 'dm', {
      throttleMs: 500,
    });

    const delta1: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'First',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    const delta2: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'Second',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };

    await customSender.onContentDelta(delta1);
    await tick(200); // 200ms < 500ms throttle
    await customSender.onContentDelta(delta2);
    await tick(50);

    // Second delta should still be pending (throttled)
    expect(mockSocket.sent.length).toBe(1);

    // Wait for remaining throttle time
    await tick(400);
    expect(mockSocket.sent.length).toBe(2);
  });

  test('default throttle is 2500ms', () => {
    const defaultSender = new WhatsAppStreamSender(mockSocket.sock, '5511999999999@s.whatsapp.net');

    // Access private field via cast for testing
    expect((defaultSender as unknown as { throttleMs: number }).throttleMs).toBe(2500);
  });

  // ─── Fallback ───────────────────────────────────────────────

  test('edit failure triggers fallback: final sends new message', async () => {
    const failSocket = createMockSocket({ editShouldFail: true });
    const failSender = new WhatsAppStreamSender(failSocket.sock, '5511999999999@s.whatsapp.net', undefined, 'dm', {
      throttleMs: 100,
    });

    // First content delta creates initial message (not an edit, so succeeds)
    const contentDelta: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'Starting...',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await failSender.onContentDelta(contentDelta);
    await tick(150);

    // Initial send succeeds (not an edit)
    expect(failSocket.sent.length).toBe(1);

    // Second delta tries to edit → fails → editFailed = true
    const contentDelta2: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'More content...',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await failSender.onContentDelta(contentDelta2);
    await tick(150);

    // Edit failed — sent count stays at 1 (the failed edit throws but is caught)
    // Actually the mock throws, so sendMessage was called but threw — sent.length stays 1

    // Now final: since editFailed=true, should send as new message (not edit)
    const finalDelta: StreamDelta & { phase: 'final' } = {
      phase: 'final',
      content: 'Final answer.',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await failSender.onFinal(finalDelta);

    // Should have sent as new message (no edit key)
    const finalMsg = failSocket.sent[failSocket.sent.length - 1];
    expect(finalMsg?.content.edit).toBeUndefined();
    expect(finalMsg?.content.text).toBe('Final answer.');
  });

  // ─── Splitting ──────────────────────────────────────────────

  test('onFinal splits long messages into multiple chunks', async () => {
    // Create content longer than 65536 chars
    const longContent = 'x'.repeat(70_000);
    const delta: StreamDelta & { phase: 'final' } = {
      phase: 'final',
      content: longContent,
      thinking: undefined,
      thinkingDurationMs: undefined,
    };

    await sender.onFinal(delta);

    // Should have been split into 2+ messages
    expect(mockSocket.sent.length).toBeGreaterThanOrEqual(2);

    // Concatenate all sent text
    const allText = mockSocket.sent.map((m) => m.content.text as string).join('');
    expect(allText.length).toBe(70_000);
  });

  test('onFinal splits and edits placeholder for first chunk', async () => {
    // Create placeholder first
    const contentDelta: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'Start...',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onContentDelta(contentDelta);
    await tick(150);

    // Long final
    const longContent = 'a'.repeat(70_000);
    const finalDelta: StreamDelta & { phase: 'final' } = {
      phase: 'final',
      content: longContent,
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onFinal(finalDelta);

    // sent[0] = initial, sent[1] = edit (first chunk), sent[2+] = new messages (remaining chunks)
    expect(mockSocket.sent.length).toBeGreaterThanOrEqual(3);
    // First edit should have edit key
    expect(mockSocket.sent[1]?.content.edit).toBeDefined();
    // Remaining chunks should NOT have edit key
    expect(mockSocket.sent[2]?.content.edit).toBeUndefined();
  });

  // ─── Tail window ────────────────────────────────────────────

  test('long content during streaming shows tail window', async () => {
    const longContent = 'x'.repeat(5000);
    const delta: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: longContent,
      thinking: undefined,
      thinkingDurationMs: undefined,
    };

    await sender.onContentDelta(delta);
    await tick(150);

    expect(mockSocket.sent.length).toBe(1);
    const text = mockSocket.sent[0]?.content.text as string;
    expect(text).toContain('⏳ ...');
    // Should be truncated
    expect(text.length).toBeLessThan(4100);
    expect(text).toContain('▍');
  });

  // ─── Error & Abort ──────────────────────────────────────────

  test('onError does not throw', async () => {
    const delta: StreamDelta & { phase: 'error' } = {
      phase: 'error',
      error: 'Something went wrong',
    };

    // Should not throw
    await sender.onError(delta);
  });

  test('abort does not throw', async () => {
    await sender.abort();
  });

  test('abort after content creation does not throw', async () => {
    const contentDelta: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'In progress...',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onContentDelta(contentDelta);
    await tick(150);

    await sender.abort();
  });

  // ─── Reply-to ───────────────────────────────────────────────

  test('initial message includes replyTo when provided', async () => {
    const replyToSender = new WhatsAppStreamSender(
      mockSocket.sock,
      '5511999999999@s.whatsapp.net',
      'original-msg-id',
      'dm',
      { throttleMs: 100 },
    );

    const delta: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'Reply content',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };

    await replyToSender.onContentDelta(delta);
    await tick(150);

    expect(mockSocket.sent.length).toBe(1);
    expect(mockSocket.sent[0]?.options).toBeDefined();
  });

  // ─── Identical text dedup ───────────────────────────────────

  test('identical text is not re-edited', async () => {
    const delta: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'Same text',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };

    await sender.onContentDelta(delta);
    await tick(150);
    expect(mockSocket.sent.length).toBe(1);

    // Send same text again
    await sender.onContentDelta(delta);
    await tick(150);

    // Should not have sent a second message (text unchanged)
    expect(mockSocket.sent.length).toBe(1);
  });

  // ─── Phase guards ──────────────────────────────────────────

  test('deltas after final are ignored', async () => {
    const finalDelta: StreamDelta & { phase: 'final' } = {
      phase: 'final',
      content: 'Done.',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onFinal(finalDelta);

    const lateContent: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'Late arrival',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onContentDelta(lateContent);
    await tick(150);

    // Only the final message should exist
    expect(mockSocket.sent.length).toBe(1);
    expect(mockSocket.sent[0]?.content.text).toBe('Done.');
  });
});
