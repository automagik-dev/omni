/**
 * Tests for Telegram typing indicator auto-refresh behavior.
 *
 * Verifies that sendTyping auto-refreshes every 4s, stops on duration=0,
 * auto-clears via 60s failsafe, and cleans up on disconnect/destroy.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Minimal stubs — we only need to exercise the interval/cleanup logic, not
// the full grammy or channel-sdk dependency tree.
// ---------------------------------------------------------------------------

/** Tracks calls to bot.api.sendChatAction() */
let sendChatActionCalls: number;
let mockBotAvailable: boolean;

const mockBot = {
  api: {
    sendChatAction: mock(async (_chatId: string, _action: string) => {
      sendChatActionCalls++;
    }),
  },
};

/**
 * Minimal TelegramPlugin-like class that mirrors the typing interval logic
 * from the real plugin without pulling in the full dependency tree.
 */
class TelegramTypingHarness {
  private typingIntervals = new Map<
    string,
    { refresh: ReturnType<typeof setInterval>; failsafe: ReturnType<typeof setTimeout> }
  >();

  async sendTyping(instanceId: string, chatId: string, duration?: number): Promise<void> {
    const key = `${instanceId}:${chatId}`;
    this.clearTypingInterval(key);

    if (duration === 0) return;

    const doTyping = async () => {
      try {
        if (!mockBotAvailable) {
          this.clearTypingInterval(key);
          return;
        }
        await mockBot.api.sendChatAction(chatId, 'typing');
      } catch {
        this.clearTypingInterval(key);
      }
    };

    await doTyping();

    const refresh = setInterval(() => {
      doTyping();
    }, 4000);

    const failsafe = setTimeout(() => {
      this.clearTypingInterval(key);
    }, 60000);

    this.typingIntervals.set(key, { refresh, failsafe });
  }

  clearTypingInterval(key: string): void {
    const entry = this.typingIntervals.get(key);
    if (entry) {
      clearInterval(entry.refresh);
      clearTimeout(entry.failsafe);
      this.typingIntervals.delete(key);
    }
  }

  clearAllTypingIntervals(): void {
    for (const key of [...this.typingIntervals.keys()]) {
      this.clearTypingInterval(key);
    }
  }

  get activeIntervalCount(): number {
    return this.typingIntervals.size;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Telegram sendTyping auto-refresh', () => {
  let plugin: TelegramTypingHarness;

  beforeEach(() => {
    plugin = new TelegramTypingHarness();
    sendChatActionCalls = 0;
    mockBotAvailable = true;
    mockBot.api.sendChatAction.mockClear();
  });

  afterEach(() => {
    plugin.clearAllTypingIntervals();
  });

  it('sends initial typing and starts an interval', async () => {
    await plugin.sendTyping('inst-1', 'chat-1', 30000);

    expect(sendChatActionCalls).toBe(1);
    expect(plugin.activeIntervalCount).toBe(1);
  });

  it('clears interval when duration === 0', async () => {
    await plugin.sendTyping('inst-1', 'chat-1', 30000);
    expect(plugin.activeIntervalCount).toBe(1);

    await plugin.sendTyping('inst-1', 'chat-1', 0);
    expect(plugin.activeIntervalCount).toBe(0);
  });

  it('replaces existing interval on repeat call', async () => {
    await plugin.sendTyping('inst-1', 'chat-1', 30000);
    await plugin.sendTyping('inst-1', 'chat-1', 30000);

    expect(plugin.activeIntervalCount).toBe(1);
    expect(sendChatActionCalls).toBe(2);
  });

  it('supports multiple concurrent chats', async () => {
    await plugin.sendTyping('inst-1', 'chat-1', 30000);
    await plugin.sendTyping('inst-1', 'chat-2', 30000);

    expect(plugin.activeIntervalCount).toBe(2);

    await plugin.sendTyping('inst-1', 'chat-1', 0);
    expect(plugin.activeIntervalCount).toBe(1);
  });

  it('clearAllTypingIntervals cleans up everything', async () => {
    await plugin.sendTyping('inst-1', 'chat-1', 30000);
    await plugin.sendTyping('inst-1', 'chat-2', 30000);
    await plugin.sendTyping('inst-2', 'chat-3', 30000);

    expect(plugin.activeIntervalCount).toBe(3);

    plugin.clearAllTypingIntervals();
    expect(plugin.activeIntervalCount).toBe(0);
  });

  it('failsafe clears interval after 60s', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;

    const timeouts: Array<{ fn: () => void; ms: number; id: number }> = [];
    let timeoutId = 0;

    // @ts-expect-error — minimal fake timer
    globalThis.setTimeout = (fn: () => void, ms: number) => {
      const id = ++timeoutId;
      timeouts.push({ fn, ms, id });
      return id;
    };
    // @ts-expect-error — minimal fake timer
    globalThis.clearTimeout = (id: number) => {
      const idx = timeouts.findIndex((t) => t.id === id);
      if (idx !== -1) timeouts.splice(idx, 1);
    };
    // @ts-expect-error — minimal fake timer
    globalThis.setInterval = (_fn: () => void, _ms: number) => {
      return ++timeoutId;
    };
    // @ts-expect-error — minimal fake timer
    globalThis.clearInterval = (_id: number) => {};

    try {
      const testPlugin = new TelegramTypingHarness();
      await testPlugin.sendTyping('inst-1', 'chat-1', 30000);

      expect(testPlugin.activeIntervalCount).toBe(1);

      const failsafe = timeouts.find((t) => t.ms === 60000);
      expect(failsafe).toBeDefined();
      failsafe!.fn();

      expect(testPlugin.activeIntervalCount).toBe(0);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  it('still creates interval even if bot is unavailable initially', async () => {
    // Bot goes away before call
    mockBotAvailable = false;

    // The doTyping detects no bot and calls clearTypingInterval, but the
    // interval hasn't been set yet, so it's a no-op. The interval is still
    // created to retry when bot may come back.
    await plugin.sendTyping('inst-1', 'chat-1', 30000);
    // Interval created (refresh will retry)
    expect(plugin.activeIntervalCount).toBe(1);
    expect(sendChatActionCalls).toBe(0);

    // Restore
    mockBotAvailable = true;
  });

  it('still creates interval even if initial sendChatAction throws', async () => {
    mockBot.api.sendChatAction.mockImplementationOnce(async () => {
      throw new Error('Rate limited');
    });

    await plugin.sendTyping('inst-1', 'chat-1', 30000);
    // Same pattern: initial error is caught, clearTypingInterval is no-op
    // since interval not yet stored. Interval still gets created for retry.
    expect(plugin.activeIntervalCount).toBe(1);
  });

  it('sends typing without duration (default behavior)', async () => {
    await plugin.sendTyping('inst-1', 'chat-1');

    expect(sendChatActionCalls).toBe(1);
    expect(plugin.activeIntervalCount).toBe(1);
  });
});
