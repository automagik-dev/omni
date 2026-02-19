/**
 * WhatsAppStreamSender unit tests
 *
 * Verifies:
 * - Paragraph-based streaming (default): sends paragraphs as they complete
 * - onContentDelta with no \n\n separator → no messages sent yet
 * - onContentDelta with \n\n → completed paragraphs sent immediately
 * - onFinal sends remaining unsent content
 * - Quoting: first message quotes the trigger
 * - Multi-chunk splitting for long content
 * - Thinking deltas are no-ops
 * - Error/abort don't throw
 * - Phase guards (deltas after final are ignored)
 * - Edit mode (opt-in) still works with throttle
 * - Passthrough mode skips markdown conversion
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

function createMockSocket() {
  const sent: SentMessage[] = [];
  let nextId = 100;

  const sock = {
    sendMessage: mock(async (jid: string, content: Record<string, unknown>, options?: unknown) => {
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

describe('WhatsAppStreamSender (paragraph mode — default)', () => {
  let mockSocket: ReturnType<typeof createMockSocket>;
  let sender: WhatsAppStreamSender;

  beforeEach(() => {
    mockSocket = createMockSocket();
    sender = new WhatsAppStreamSender(mockSocket.sock, '5511999999999@s.whatsapp.net');
  });

  // ─── Content deltas — paragraph detection ──────────────────

  test('onContentDelta sends content immediately as a complete block', async () => {
    await sender.onContentDelta({
      phase: 'content',
      content: 'Hello world, no newlines here',
    });
    expect(mockSocket.sent.length).toBe(1);
    expect(mockSocket.sent[0]?.content.text).toBe('Hello world, no newlines here');
  });

  test('second onContentDelta sends only the new portion', async () => {
    // Each delta is cumulative — first block sent on first call
    await sender.onContentDelta({
      phase: 'content',
      content: 'First block.',
    });
    expect(mockSocket.sent.length).toBe(1);

    // Second call: cumulative content includes first block — only new portion sent
    await sender.onContentDelta({
      phase: 'content',
      content: 'First block.\n\nSecond block.',
    });
    expect(mockSocket.sent.length).toBe(2);
    const text = mockSocket.sent[1]?.content.text as string;
    expect(text).toContain('Second block.');
    expect(text).not.toContain('First block.');
  });

  test('multiple paragraphs sent progressively', async () => {
    // First delta: one complete paragraph
    await sender.onContentDelta({
      phase: 'content',
      content: 'Para 1.\n\nPara 2 typing...',
    });
    expect(mockSocket.sent.length).toBe(1);

    // Second delta: second paragraph completes, third starts
    await sender.onContentDelta({
      phase: 'content',
      content: 'Para 1.\n\nPara 2 done.\n\nPara 3 typing...',
    });
    expect(mockSocket.sent.length).toBe(2);
  });

  test('onFinal sends content not covered by prior deltas', async () => {
    // First block comes in via delta
    await sender.onContentDelta({
      phase: 'content',
      content: 'Block one.',
    });
    expect(mockSocket.sent.length).toBe(1);

    // Final has additional content that was never in a delta
    await sender.onFinal({
      phase: 'final',
      content: 'Block one.\n\nBlock two complete.',
    });

    expect(mockSocket.sent.length).toBe(2);
    const finalText = mockSocket.sent[1]?.content.text as string;
    expect(finalText).toContain('Block two complete.');
    expect(finalText).not.toContain('Block one.');
  });

  test('onFinal with all content already sent is a no-op', async () => {
    // All content sent in paragraphs
    await sender.onContentDelta({
      phase: 'content',
      content: 'All done.\n\n',
    });
    expect(mockSocket.sent.length).toBe(1);

    // Final has same content — nothing left to send
    await sender.onFinal({
      phase: 'final',
      content: 'All done.\n\n',
    });
    // No additional message
    expect(mockSocket.sent.length).toBe(1);
  });

  test('onFinal with no prior deltas sends everything', async () => {
    await sender.onFinal({
      phase: 'final',
      content: 'Complete answer.',
    });

    expect(mockSocket.sent.length).toBe(1);
    expect(mockSocket.sent[0]?.content.text).toBe('Complete answer.');
  });

  test('onFinal with empty content is a no-op', async () => {
    await sender.onFinal({
      phase: 'final',
      content: '',
    });
    expect(mockSocket.sent.length).toBe(0);
  });

  // ─── Thinking ───────────────────────────────────────────────

  test('onThinkingDelta is a no-op (no messages sent)', async () => {
    await sender.onThinkingDelta({
      phase: 'thinking',
      thinking: 'Let me think about this...',
      thinkingElapsedMs: 3000,
    });
    expect(mockSocket.sent.length).toBe(0);
  });

  // ─── Reply-to quoting ──────────────────────────────────────

  test('first message quotes trigger, subsequent do not', async () => {
    const quotingSender = new WhatsAppStreamSender(
      mockSocket.sock,
      '5511999999999@s.whatsapp.net',
      'original-msg-id',
      'group',
    );

    // First delta sends and should quote the trigger
    await quotingSender.onContentDelta({
      phase: 'content',
      content: 'First block.',
    });

    expect(mockSocket.sent.length).toBe(1);
    expect(mockSocket.sent[0]?.options).toBeDefined();
    const opts = mockSocket.sent[0]?.options as { quoted: { key: { id: string } } };
    expect(opts.quoted.key.id).toBe('original-msg-id');

    // Second delta (cumulative) — only new portion sent, no quote
    await quotingSender.onContentDelta({
      phase: 'content',
      content: 'First block.\n\nSecond block.',
    });

    expect(mockSocket.sent.length).toBe(2);
    expect(mockSocket.sent[1]?.options).toBeUndefined();
  });

  // ─── Splitting ──────────────────────────────────────────────

  test('onFinal splits long messages into multiple chunks', async () => {
    const longContent = 'x'.repeat(70_000);
    await sender.onFinal({
      phase: 'final',
      content: longContent,
    });

    expect(mockSocket.sent.length).toBeGreaterThanOrEqual(2);
    for (const msg of mockSocket.sent) {
      expect(msg.content.edit).toBeUndefined();
    }
    const allText = mockSocket.sent.map((m) => m.content.text as string).join('');
    expect(allText.length).toBe(70_000);
  });

  // ─── Error & Abort ──────────────────────────────────────────

  test('onError does not throw', async () => {
    await sender.onError({ phase: 'error', error: 'Something went wrong' });
  });

  test('abort does not throw', async () => {
    await sender.abort();
  });

  test('abort after content deltas does not throw', async () => {
    await sender.onContentDelta({
      phase: 'content',
      content: 'In progress...',
    });
    await sender.abort();
  });

  // ─── Phase guards ──────────────────────────────────────────

  test('deltas after final are ignored', async () => {
    await sender.onFinal({
      phase: 'final',
      content: 'Done.',
    });

    await sender.onContentDelta({
      phase: 'content',
      content: 'Late arrival',
    });

    expect(mockSocket.sent.length).toBe(1);
    expect(mockSocket.sent[0]?.content.text).toBe('Done.');
  });

  // ─── Passthrough mode ────────────────────────────────────────

  test('passthrough mode skips markdown conversion', async () => {
    const passthroughSender = new WhatsAppStreamSender(
      mockSocket.sock,
      '5511999999999@s.whatsapp.net',
      undefined,
      'dm',
      { formatMode: 'passthrough' },
    );

    await passthroughSender.onFinal({
      phase: 'final',
      content: '**raw markdown**',
    });

    expect(mockSocket.sent.length).toBe(1);
    expect(mockSocket.sent[0]?.content.text).toBe('**raw markdown**');
  });
});

describe('WhatsAppStreamSender (edit mode — opt-in)', () => {
  let mockSocket: ReturnType<typeof createMockSocket>;
  let sender: WhatsAppStreamSender;

  beforeEach(() => {
    mockSocket = createMockSocket();
    sender = new WhatsAppStreamSender(mockSocket.sock, '5511999999999@s.whatsapp.net', undefined, 'dm', {
      editMode: true,
      throttleMs: 0, // No throttle for tests
    });
  });

  test('onContentDelta creates initial message then edits', async () => {
    await sender.onContentDelta({
      phase: 'content',
      content: 'Hello',
    });

    // First call creates a new message
    expect(mockSocket.sent.length).toBe(1);
    expect(mockSocket.sent[0]?.content.text).toBe('Hello▍');
    expect(mockSocket.sent[0]?.content.edit).toBeUndefined();

    await sender.onContentDelta({
      phase: 'content',
      content: 'Hello world',
    });

    // Second call edits
    expect(mockSocket.sent.length).toBe(2);
    expect(mockSocket.sent[1]?.content.text).toBe('Hello world▍');
    expect(mockSocket.sent[1]?.content.edit).toBeDefined();
  });

  test('onFinal edits placeholder with final content', async () => {
    await sender.onContentDelta({
      phase: 'content',
      content: 'Working...',
    });
    expect(mockSocket.sent.length).toBe(1);

    await sender.onFinal({
      phase: 'final',
      content: 'Done!',
    });

    // Should edit the existing message
    expect(mockSocket.sent.length).toBe(2);
    expect(mockSocket.sent[1]?.content.edit).toBeDefined();
    expect(mockSocket.sent[1]?.content.text).toBe('Done!');
  });
});
