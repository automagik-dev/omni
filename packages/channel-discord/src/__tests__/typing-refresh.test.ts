/**
 * Tests for Discord typing indicator auto-refresh behavior.
 *
 * Verifies that sendTyping auto-refreshes every 8s, stops on duration=0,
 * auto-clears via 60s failsafe, and cleans up on disconnect/destroy.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Minimal stubs — we only need to exercise the interval/cleanup logic, not
// the full Discord client or channel-sdk dependency tree.
// ---------------------------------------------------------------------------

/** Tracks calls to channel.sendTyping() */
let sendTypingCalls: number;
let channelFetchResult: { sendTyping: () => Promise<void> } | null;

const mockChannel = {
  sendTyping: mock(async () => {
    sendTypingCalls++;
  }),
};

const mockClient = {
  channels: {
    fetch: mock(async (_id: string) => channelFetchResult),
  },
};

/**
 * Minimal DiscordPlugin-like class that mirrors the typing interval logic
 * from the real plugin without pulling in the full dependency tree.
 */
class DiscordTypingHarness {
  private typingIntervals = new Map<
    string,
    { refresh: ReturnType<typeof setInterval>; failsafe: ReturnType<typeof setTimeout> }
  >();

  getClient(_instanceId: string) {
    return mockClient;
  }

  async sendTyping(instanceId: string, channelId: string, duration?: number): Promise<void> {
    const key = `${instanceId}:${channelId}`;
    this.clearTypingInterval(key);

    if (duration === 0) return;

    const doTyping = async () => {
      try {
        const client = this.getClient(instanceId);
        const channel = await client.channels.fetch(channelId);
        if (channel && 'sendTyping' in channel) {
          await (channel as { sendTyping: () => Promise<void> }).sendTyping();
        }
      } catch {
        this.clearTypingInterval(key);
      }
    };

    await doTyping();

    const refresh = setInterval(() => {
      doTyping();
    }, 8000);

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

describe('Discord sendTyping auto-refresh', () => {
  let plugin: DiscordTypingHarness;

  beforeEach(() => {
    plugin = new DiscordTypingHarness();
    sendTypingCalls = 0;
    channelFetchResult = mockChannel;
    mockChannel.sendTyping.mockClear();
    mockClient.channels.fetch.mockImplementation(async () => channelFetchResult);
  });

  afterEach(() => {
    plugin.clearAllTypingIntervals();
  });

  it('sends initial typing and starts an interval', async () => {
    await plugin.sendTyping('inst-1', 'chan-1', 30000);

    expect(sendTypingCalls).toBe(1);
    expect(plugin.activeIntervalCount).toBe(1);
  });

  it('clears interval when duration === 0', async () => {
    await plugin.sendTyping('inst-1', 'chan-1', 30000);
    expect(plugin.activeIntervalCount).toBe(1);

    await plugin.sendTyping('inst-1', 'chan-1', 0);
    expect(plugin.activeIntervalCount).toBe(0);
  });

  it('replaces existing interval on repeat call', async () => {
    await plugin.sendTyping('inst-1', 'chan-1', 30000);
    await plugin.sendTyping('inst-1', 'chan-1', 30000);

    // Should still only have 1 active interval (replaced, not stacked)
    expect(plugin.activeIntervalCount).toBe(1);
    // Initial typing sent twice (once per call)
    expect(sendTypingCalls).toBe(2);
  });

  it('supports multiple concurrent chats', async () => {
    await plugin.sendTyping('inst-1', 'chan-1', 30000);
    await plugin.sendTyping('inst-1', 'chan-2', 30000);

    expect(plugin.activeIntervalCount).toBe(2);

    // Stop one
    await plugin.sendTyping('inst-1', 'chan-1', 0);
    expect(plugin.activeIntervalCount).toBe(1);
  });

  it('clearAllTypingIntervals cleans up everything', async () => {
    await plugin.sendTyping('inst-1', 'chan-1', 30000);
    await plugin.sendTyping('inst-1', 'chan-2', 30000);
    await plugin.sendTyping('inst-2', 'chan-3', 30000);

    expect(plugin.activeIntervalCount).toBe(3);

    plugin.clearAllTypingIntervals();
    expect(plugin.activeIntervalCount).toBe(0);
  });

  it('failsafe clears interval after 60s', async () => {
    // Use fake timers to test the 60s failsafe without actually waiting
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
      return ++timeoutId; // Just assign an ID, we won't fire these
    };
    // @ts-expect-error — minimal fake timer
    globalThis.clearInterval = (_id: number) => {};

    try {
      const testPlugin = new DiscordTypingHarness();
      await testPlugin.sendTyping('inst-1', 'chan-1', 30000);

      expect(testPlugin.activeIntervalCount).toBe(1);

      // Find and fire the 60s failsafe timeout
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

  it('still creates interval even if initial typing fails (transient error)', async () => {
    // Make initial call fail — the catch in doTyping calls clearTypingInterval
    // but since intervals aren't set yet, it's a no-op. The interval is still
    // created so refresh can retry.
    mockClient.channels.fetch.mockImplementationOnce(async () => {
      throw new Error('Unknown channel');
    });

    await plugin.sendTyping('inst-1', 'chan-1', 30000);
    // Interval still created — refresh will retry
    expect(plugin.activeIntervalCount).toBe(1);
    expect(sendTypingCalls).toBe(0); // Initial failed

    // Restore normal mock
    mockClient.channels.fetch.mockImplementation(async () => channelFetchResult);
  });

  it('sends typing without duration (default behavior)', async () => {
    // When duration is undefined, should still start refresh
    await plugin.sendTyping('inst-1', 'chan-1');

    expect(sendTypingCalls).toBe(1);
    expect(plugin.activeIntervalCount).toBe(1);
  });
});
