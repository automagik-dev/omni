/**
 * TelegramStreamSender unit tests
 *
 * Verifies:
 * - Thinking → blockquote expandable rendering
 * - Content → progressive edit with cursor
 * - Final → clean multi-chunk delivery
 * - Error/abort → placeholder cleanup
 * - Throttle enforcement
 * - Tail window for long content
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { StreamDelta } from '@omni/core';
import { TelegramStreamSender } from '../stream';

// ─── Mock Bot ──────────────────────────────────────────────

interface SentMessage {
  chatId: string;
  text: string;
  options?: Record<string, unknown>;
}

interface EditedMessage {
  chatId: string;
  messageId: number;
  text: string;
  options?: Record<string, unknown>;
}

interface DeletedMessage {
  chatId: string;
  messageId: number;
}

function createMockBot() {
  const sent: SentMessage[] = [];
  const edited: EditedMessage[] = [];
  const deleted: DeletedMessage[] = [];
  let nextMessageId = 100;

  const bot = {
    api: {
      sendMessage: mock(async (chatId: string, text: string, options?: Record<string, unknown>) => {
        const msg = { chatId, text, options };
        sent.push(msg);
        return { message_id: nextMessageId++ };
      }),
      editMessageText: mock(
        async (chatId: string, messageId: number, text: string, options?: Record<string, unknown>) => {
          edited.push({ chatId, messageId, text, options });
          return true;
        },
      ),
      deleteMessage: mock(async (chatId: string, messageId: number) => {
        deleted.push({ chatId, messageId });
        return true;
      }),
    },
  };

  return {
    bot,
    sent,
    edited,
    deleted,
  };
}

// Helper to wait for async timers
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe('TelegramStreamSender', () => {
  let mockBot: ReturnType<typeof createMockBot>;
  let sender: TelegramStreamSender;

  beforeEach(() => {
    mockBot = createMockBot();
    sender = new TelegramStreamSender(mockBot.bot, '12345');
  });

  test('onFinal sends content as plain text when no thinking', async () => {
    const delta: StreamDelta & { phase: 'final' } = {
      phase: 'final',
      content: 'Hello world!',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };

    await sender.onFinal(delta);

    // No placeholder, should send as new message
    expect(mockBot.sent.length).toBe(1);
    expect(mockBot.sent[0]?.text).toBe('Hello world!');
  });

  test('onFinal with thinking includes blockquote expandable', async () => {
    const delta: StreamDelta & { phase: 'final' } = {
      phase: 'final',
      content: 'The answer is 42.',
      thinking: 'Let me think about this deeply...',
      thinkingDurationMs: 5000,
    };

    await sender.onFinal(delta);

    expect(mockBot.sent.length).toBe(1);
    const text = mockBot.sent[0]?.text ?? '';
    expect(text).toContain('<blockquote expandable>');
    expect(text).toContain('🧠 Thought');
    expect(text).toContain('5.0s');
    expect(text).toContain('The answer is 42.');
  });

  test('onFinal skips thinking if duration < 2s', async () => {
    const delta: StreamDelta & { phase: 'final' } = {
      phase: 'final',
      content: 'Quick answer.',
      thinking: 'Brief thought.',
      thinkingDurationMs: 500,
    };

    await sender.onFinal(delta);

    expect(mockBot.sent.length).toBe(1);
    const text = mockBot.sent[0]?.text ?? '';
    expect(text).not.toContain('<blockquote');
    expect(text).toBe('Quick answer.');
  });

  test('onFinal splits long messages into chunks', async () => {
    const longContent = 'x'.repeat(5000);
    const delta: StreamDelta & { phase: 'final' } = {
      phase: 'final',
      content: longContent,
      thinking: undefined,
      thinkingDurationMs: undefined,
    };

    await sender.onFinal(delta);

    expect(mockBot.sent.length).toBe(2);
    // Total content should cover the full 5000 chars
    const totalSent = mockBot.sent.map((m) => m.text).join('');
    expect(totalSent.length).toBe(5000);
  });

  test('onFinal edits placeholder if it exists', async () => {
    // First, create a placeholder via onContentDelta
    const contentDelta: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'Partial...',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onContentDelta(contentDelta);
    await tick(1000); // Wait for throttle

    // Now send final
    const finalDelta: StreamDelta & { phase: 'final' } = {
      phase: 'final',
      content: 'Complete answer.',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onFinal(finalDelta);

    // Should have edited the placeholder (first sent message)
    expect(mockBot.edited.length).toBeGreaterThanOrEqual(1);
    const lastEdit = mockBot.edited[mockBot.edited.length - 1];
    expect(lastEdit?.text).toBe('Complete answer.');
  });

  test('onError deletes placeholder', async () => {
    // Create a placeholder
    const contentDelta: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'Some progress...',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onContentDelta(contentDelta);
    await tick(1000);

    // Error should clean up
    const errorDelta: StreamDelta & { phase: 'error' } = {
      phase: 'error',
      error: 'Something went wrong',
    };
    await sender.onError(errorDelta);

    expect(mockBot.deleted.length).toBe(1);
  });

  test('abort deletes placeholder', async () => {
    // Create a placeholder
    const contentDelta: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'In progress...',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onContentDelta(contentDelta);
    await tick(1000);

    await sender.abort();

    expect(mockBot.deleted.length).toBe(1);
  });

  test('onContentDelta adds cursor marker', async () => {
    const delta: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'Hello',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onContentDelta(delta);
    await tick(1000); // Wait for throttle

    // Should have sent message with cursor
    expect(mockBot.sent.length).toBe(1);
    expect(mockBot.sent[0]?.text).toContain('█');
    expect(mockBot.sent[0]?.options).toHaveProperty('parse_mode', 'HTML');
  });

  test('onContentDelta uses tail window for long content', async () => {
    const longContent = 'x'.repeat(5000);
    const delta: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: longContent,
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onContentDelta(delta);
    await tick(1000);

    expect(mockBot.sent.length).toBe(1);
    expect(mockBot.sent[0]?.text).toContain('⏳ ...');
    // Should be truncated, not full 5000
    expect(mockBot.sent[0]?.text.length).toBeLessThan(4096);
  });

  test('onThinkingDelta skips display if under 2s', async () => {
    const delta: StreamDelta & { phase: 'thinking' } = {
      phase: 'thinking',
      thinking: 'Quick thought',
      thinkingElapsedMs: 100,
    };

    await sender.onThinkingDelta(delta);
    await tick(1000);

    // Should not have sent anything (thinking < 2s)
    expect(mockBot.sent.length).toBe(0);
    expect(mockBot.edited.length).toBe(0);
  });

  test('uses 900ms throttle for DMs (default)', async () => {
    // Default sender (no chatType) should use DM throttle
    const dmSender = new TelegramStreamSender(mockBot.bot, '12345');
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

    await dmSender.onContentDelta(delta1);
    await tick(500); // 500ms < 900ms DM throttle
    await dmSender.onContentDelta(delta2);

    // Only first edit should have fired (second is throttled)
    expect(mockBot.sent.length).toBe(1);
  });

  test('uses 3000ms throttle for groups', async () => {
    const groupSender = new TelegramStreamSender(mockBot.bot, '-100123456', undefined, 'group');
    const delta1: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'First',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    const delta2: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'Second update',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };

    await groupSender.onContentDelta(delta1);
    await tick(1500); // 1500ms < 3000ms group throttle
    await groupSender.onContentDelta(delta2);

    // Only first edit should have fired (second is still throttled at 3s)
    expect(mockBot.sent.length).toBe(1);

    // Wait past group throttle
    await tick(2000); // total ~3500ms > 3000ms
    // Pending edit should have fired by now
    expect(mockBot.sent.length + mockBot.edited.length).toBeGreaterThanOrEqual(2);
  });

  test('onFinal with empty content deletes placeholder', async () => {
    // Create placeholder
    const contentDelta: StreamDelta & { phase: 'content' } = {
      phase: 'content',
      content: 'temp',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onContentDelta(contentDelta);
    await tick(1000);

    const finalDelta: StreamDelta & { phase: 'final' } = {
      phase: 'final',
      content: '',
      thinking: undefined,
      thinkingDurationMs: undefined,
    };
    await sender.onFinal(finalDelta);

    expect(mockBot.deleted.length).toBe(1);
  });
});
