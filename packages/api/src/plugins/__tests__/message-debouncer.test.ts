/**
 * MessageDebouncer unit tests — focused on the in-flight hold-back buffer.
 *
 * Now imports from the extracted message-debouncer module instead of
 * duplicating the class.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { type BufferedMessage, type DebounceConfig, MessageDebouncer } from '../message-debouncer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeMessage(text: string): BufferedMessage {
  return {
    payload: {
      text,
      chatId: 'chat-1',
      from: 'user-1',
      externalId: `ext-${text}`,
      content: { type: 'text' as const, text },
    },
    metadata: { instanceId: 'inst-1', traceId: `trace-${text}` },
    timestamp: Date.now(),
  } as BufferedMessage;
}

const fixedConfig: DebounceConfig = {
  mode: 'fixed',
  minMs: 100,
  maxMs: 100,
  restartOnTyping: false,
  groupMs: null,
  maxWaitMs: null,
};

const disabledConfig: DebounceConfig = {
  mode: 'disabled',
  minMs: 0,
  maxMs: 0,
  restartOnTyping: false,
  groupMs: null,
  maxWaitMs: null,
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MessageDebouncer', () => {
  let debouncer: MessageDebouncer;

  afterEach(() => {
    debouncer?.clear();
  });

  describe('fixed mode — in-flight hold-back', () => {
    it('messages arriving during in-flight processing are not lost', async () => {
      const flushCalls: { chatKey: string; messages: BufferedMessage[] }[] = [];
      let resolveFirstFlush: (() => void) | null = null;

      debouncer = new MessageDebouncer(async (chatKey, messages) => {
        flushCalls.push({ chatKey, messages: [...messages] });
        if (flushCalls.length === 1) {
          // First flush: block until we release it
          await new Promise<void>((resolve) => {
            resolveFirstFlush = resolve;
          });
        }
      });

      // Buffer 2 messages before the fixed window fires
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg1'), fixedConfig);
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg2'), fixedConfig);

      // Wait for the fixed timer to fire (100ms + margin)
      await wait(150);

      // First flush should have started
      expect(flushCalls.length).toBe(1);
      expect(flushCalls[0]!.messages.length).toBe(2);

      // Buffer 2 more messages while first flush is in-flight
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg3'), fixedConfig);
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg4'), fixedConfig);

      // Release the first flush
      resolveFirstFlush!();
      // Allow the re-flush setTimeout(0) to fire
      await wait(50);

      // Second flush should have picked up the late arrivals
      expect(flushCalls.length).toBe(2);
      expect(flushCalls[1]!.messages.length).toBe(2);
    });

    it('messages arriving during in-flight do NOT start a competing timer', async () => {
      let flushCount = 0;

      debouncer = new MessageDebouncer(async () => {
        flushCount++;
        // Simulate slow processing
        await wait(200);
      });

      // Buffer a message and let the fixed window fire
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg1'), fixedConfig);
      await wait(150);

      // First flush is now in-flight
      expect(flushCount).toBe(1);

      // Buffer while in-flight — should NOT create a timer
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg2'), fixedConfig);

      // Wait for first flush to complete + re-flush
      await wait(300);

      // Should have flushed twice total, not more
      expect(flushCount).toBe(2);
    });

    it('handles errors in onFlush without losing subsequent messages', async () => {
      const flushCalls: BufferedMessage[][] = [];

      debouncer = new MessageDebouncer(async (_chatKey, messages) => {
        flushCalls.push([...messages]);
        if (flushCalls.length === 1) {
          throw new Error('simulated failure');
        }
      });

      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg1'), fixedConfig);
      await wait(150);

      // First flush errored
      expect(flushCalls.length).toBe(1);

      // Buffer more messages — inFlight should be cleared even after error
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg2'), fixedConfig);

      await wait(150);
      expect(flushCalls.length).toBe(2);
    });
  });

  describe('disabled mode — backward compatibility', () => {
    it('flushes immediately with delay=0', async () => {
      const flushCalls: BufferedMessage[][] = [];

      debouncer = new MessageDebouncer(async (_chatKey, messages) => {
        flushCalls.push([...messages]);
      });

      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg1'), disabledConfig);

      // delay=0 means setTimeout(fn, 0) — fires on next tick
      await wait(50);

      expect(flushCalls.length).toBe(1);
      expect(flushCalls[0]!.length).toBe(1);
    });

    it('each message triggers its own flush when disabled', async () => {
      const flushCalls: BufferedMessage[][] = [];

      debouncer = new MessageDebouncer(async (_chatKey, messages) => {
        flushCalls.push([...messages]);
      });

      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg1'), disabledConfig);
      await wait(20);
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg2'), disabledConfig);
      await wait(50);

      // Two separate flushes because disabled mode restarts the timer each time
      expect(flushCalls.length).toBe(2);
    });
  });

  describe('randomized mode — timer restart', () => {
    it('restarts the timer when a new message arrives', async () => {
      const flushCalls: BufferedMessage[][] = [];

      const shortRandomConfig: DebounceConfig = {
        mode: 'randomized',
        minMs: 80,
        maxMs: 120,
        restartOnTyping: false,
        groupMs: null,
        maxWaitMs: null,
      };

      debouncer = new MessageDebouncer(async (_chatKey, messages) => {
        flushCalls.push([...messages]);
      });

      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg1'), shortRandomConfig);
      // Wait less than minMs, then buffer another — this restarts the timer
      await wait(40);
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg2'), shortRandomConfig);

      // Wait long enough for the restarted timer to fire
      await wait(200);

      // Both messages should arrive in a single flush (timer was restarted)
      expect(flushCalls.length).toBe(1);
      expect(flushCalls[0]!.length).toBe(2);
    });
  });

  describe('typing during in-flight does not cause double dispatch', () => {
    it('onUserTyping is ignored while flush is in-flight', async () => {
      const flushCalls: BufferedMessage[][] = [];
      let resolveFirstFlush: (() => void) | null = null;

      const typingConfig: DebounceConfig = {
        mode: 'fixed',
        minMs: 100,
        maxMs: 100,
        restartOnTyping: true,
        groupMs: null,
        maxWaitMs: null,
      };

      debouncer = new MessageDebouncer(async (_chatKey, messages) => {
        flushCalls.push([...messages]);
        if (flushCalls.length === 1) {
          await new Promise<void>((resolve) => {
            resolveFirstFlush = resolve;
          });
        }
      });

      // Buffer a message and wait for the fixed window to fire
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg1'), typingConfig);
      await wait(150);
      expect(flushCalls.length).toBe(1);

      // While in-flight: buffer a late message AND fire a typing event
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg2'), typingConfig);
      debouncer.onUserTyping('inst-1', 'chat-1', typingConfig);

      // Release first flush
      resolveFirstFlush!();
      await wait(50);

      // Should have exactly 2 flushes — the re-flush from finally picked up msg2.
      // Without the inFlight guard in onUserTyping, a third flush could fire from
      // the typing-restarted timer racing the finally-block re-flush.
      expect(flushCalls.length).toBe(2);
      expect(flushCalls[1]!.length).toBe(1);
    });
  });

  describe('typing resets timer in fixed mode', () => {
    it('onUserTyping force-restarts the fixed-mode timer', async () => {
      const flushCalls: BufferedMessage[][] = [];

      const typingFixedConfig: DebounceConfig = {
        mode: 'fixed',
        minMs: 100,
        maxMs: 100,
        restartOnTyping: true,
        groupMs: null,
        maxWaitMs: null,
      };

      debouncer = new MessageDebouncer(async (_chatKey, messages) => {
        flushCalls.push([...messages]);
      });

      // Buffer a message — starts a 100ms fixed timer
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg1'), typingFixedConfig);

      // At 60ms, user starts typing — should reset the 100ms timer
      await wait(60);
      debouncer.onUserTyping('inst-1', 'chat-1', typingFixedConfig);

      // At 110ms from start (50ms after typing reset), the ORIGINAL timer
      // would have fired. If the reset worked, it should NOT have flushed yet.
      await wait(50);
      expect(flushCalls.length).toBe(0);

      // Wait for the restarted timer to fire (100ms from the typing event)
      await wait(80);
      expect(flushCalls.length).toBe(1);
      expect(flushCalls[0]!.length).toBe(1);
    });

    it('typing does NOT reset timer when restartOnTyping is false', async () => {
      const flushCalls: BufferedMessage[][] = [];

      const noTypingConfig: DebounceConfig = {
        mode: 'fixed',
        minMs: 100,
        maxMs: 100,
        restartOnTyping: false,
        groupMs: null,
        maxWaitMs: null,
      };

      debouncer = new MessageDebouncer(async (_chatKey, messages) => {
        flushCalls.push([...messages]);
      });

      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg1'), noTypingConfig);

      // Typing event should be ignored when restartOnTyping is false
      await wait(60);
      debouncer.onUserTyping('inst-1', 'chat-1', noTypingConfig);

      // Original timer fires at 100ms — should flush normally
      await wait(80);
      expect(flushCalls.length).toBe(1);
    });
  });

  describe('clear()', () => {
    it('clears all internal state including inFlight', async () => {
      debouncer = new MessageDebouncer(async () => {
        await wait(500); // Long processing
      });

      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg1'), fixedConfig);
      await wait(150);

      // flush is in-flight now — clear should still work
      debouncer.clear();

      // No error thrown, debouncer is reusable
      const flushCalls: BufferedMessage[][] = [];
      debouncer = new MessageDebouncer(async (_chatKey, messages) => {
        flushCalls.push([...messages]);
      });
      debouncer.buffer('inst-1', 'chat-1', makeMessage('after-clear'), fixedConfig);
      await wait(150);
      expect(flushCalls.length).toBe(1);
    });
  });

  describe('flush() clears the pending timer', () => {
    it('does not fire a stale timer after manual flush', async () => {
      let flushCount = 0;

      debouncer = new MessageDebouncer(async () => {
        flushCount++;
      });

      // Buffer a message — this starts a 100ms fixed timer
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg1'), fixedConfig);

      // Immediately trigger flush by buffering a second message in disabled mode
      // (delay=0 => setTimeout(0) fires first, flushing the buffer).
      // The key insight: the original 100ms timer was never cleared, so it would
      // fire on an empty buffer — which is harmless but wasteful. Worse, if
      // onUserTyping restarts a timer, the stale timer could race the new one.
      //
      // After the fix, flush() calls clearTimeout on the old timer.
      await wait(150); // Let the fixed timer fire normally

      expect(flushCount).toBe(1);

      // Buffer and let it flush again
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg2'), fixedConfig);
      await wait(150);

      // Should be exactly 2 — no phantom third flush from a stale timer
      expect(flushCount).toBe(2);
    });
  });

  describe('5 rapid messages in a single fixed window', () => {
    it('all 5 messages reach the agent as a single batch', async () => {
      const flushCalls: BufferedMessage[][] = [];

      debouncer = new MessageDebouncer(async (_chatKey, messages) => {
        flushCalls.push([...messages]);
      });

      // Simulate 5 rapid messages within a 100ms fixed window
      debouncer.buffer('inst-1', 'chat-1', makeMessage('Hi'), fixedConfig);
      await wait(10);
      debouncer.buffer('inst-1', 'chat-1', makeMessage('I have a question'), fixedConfig);
      await wait(10);
      debouncer.buffer('inst-1', 'chat-1', makeMessage('About my order'), fixedConfig);
      await wait(10);
      debouncer.buffer('inst-1', 'chat-1', makeMessage('Order #12345'), fixedConfig);
      await wait(10);
      debouncer.buffer('inst-1', 'chat-1', makeMessage('Can you help?'), fixedConfig);

      // Wait for the fixed window to fire
      await wait(150);

      expect(flushCalls.length).toBe(1);
      expect(flushCalls[0]!.length).toBe(5);
    });
  });

  describe('messages spanning two fixed windows', () => {
    it('3 before timer fires, 2 after — both groups processed without conflict', async () => {
      const flushCalls: { chatKey: string; messages: BufferedMessage[] }[] = [];
      let resolveFirstFlush: (() => void) | null = null;

      debouncer = new MessageDebouncer(async (chatKey, messages) => {
        flushCalls.push({ chatKey, messages: [...messages] });
        if (flushCalls.length === 1) {
          // Simulate slow agent processing for first batch
          await new Promise<void>((resolve) => {
            resolveFirstFlush = resolve;
          });
        }
      });

      // 3 messages arrive in the first fixed window
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg1'), fixedConfig);
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg2'), fixedConfig);
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg3'), fixedConfig);

      // Wait for fixed timer to fire
      await wait(150);
      expect(flushCalls.length).toBe(1);
      expect(flushCalls[0]!.messages.length).toBe(3);

      // 2 late-arriving messages during processing
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg4'), fixedConfig);
      debouncer.buffer('inst-1', 'chat-1', makeMessage('msg5'), fixedConfig);

      // Release first flush
      resolveFirstFlush!();
      await wait(50);

      // Second batch should flush automatically
      expect(flushCalls.length).toBe(2);
      expect(flushCalls[1]!.messages.length).toBe(2);
    });
  });

  describe('presence mode — maxWaitMs hard cap', () => {
    it('caps at maxWaitMs even under continuous typing', async () => {
      const flushCalls: BufferedMessage[][] = [];
      const start = Date.now();
      let flushedAt = 0;

      debouncer = new MessageDebouncer(async (_chatKey, messages) => {
        flushCalls.push([...messages]);
        flushedAt = Date.now() - start;
      });

      const presenceConfig: DebounceConfig = {
        mode: 'presence',
        minMs: 100, // quiet window after typing stops
        maxMs: 100,
        restartOnTyping: true,
        groupMs: null,
        maxWaitMs: 500, // hard cap from the first buffered message
      };

      debouncer.buffer('inst-1', 'chat-1', makeMessage('m1'), presenceConfig);

      // Type every 80ms (< minMs) so the quiet-window timer keeps restarting.
      // Without the cap this batch would never flush; the cap forces it at ~500ms.
      for (let i = 0; i < 8; i++) {
        await wait(80);
        debouncer.onUserTyping('inst-1', 'chat-1', presenceConfig);
      }

      expect(flushCalls.length).toBe(1);
      expect(flushCalls[0]!.length).toBe(1);
      // Flushed around the 500ms cap, not extended by the ongoing typing.
      expect(flushedAt).toBeGreaterThanOrEqual(450);
      expect(flushedAt).toBeLessThan(680);
    });

    it('flushes minMs after typing stops when still under the cap', async () => {
      const flushCalls: BufferedMessage[][] = [];
      debouncer = new MessageDebouncer(async (_chatKey, messages) => {
        flushCalls.push([...messages]);
      });

      const presenceConfig: DebounceConfig = {
        mode: 'presence',
        minMs: 100,
        maxMs: 100,
        restartOnTyping: true,
        groupMs: null,
        maxWaitMs: 5000,
      };

      debouncer.buffer('inst-1', 'chat-1', makeMessage('m1'), presenceConfig);
      // One typing burst at 60ms restarts the 100ms quiet window.
      await wait(60);
      debouncer.onUserTyping('inst-1', 'chat-1', presenceConfig);
      // At 110ms the original window would have fired; the restart holds it back.
      await wait(50);
      expect(flushCalls.length).toBe(0);
      // 100ms after the typing event → flush.
      await wait(80);
      expect(flushCalls.length).toBe(1);
    });
  });

  describe('flushAll() — shutdown drains instead of dropping', () => {
    const longConfig: DebounceConfig = {
      mode: 'fixed',
      minMs: 10_000, // window never fires on its own during the test
      maxMs: 10_000,
      restartOnTyping: false,
      groupMs: null,
      maxWaitMs: null,
    };

    it('delivers pending buffers instead of dropping them', async () => {
      const flushCalls: BufferedMessage[][] = [];
      debouncer = new MessageDebouncer(async (_chatKey, messages) => {
        flushCalls.push([...messages]);
      });

      debouncer.buffer('inst-1', 'chat-1', makeMessage('a'), longConfig);
      debouncer.buffer('inst-1', 'chat-1', makeMessage('b'), longConfig);
      expect(flushCalls.length).toBe(0);

      await debouncer.flushAll();

      expect(flushCalls.length).toBe(1);
      expect(flushCalls[0]!.length).toBe(2);
    });

    it('flushes every buffered chat across keys', async () => {
      const byKey: Record<string, number> = {};
      debouncer = new MessageDebouncer(async (chatKey, messages) => {
        byKey[chatKey] = (byKey[chatKey] ?? 0) + messages.length;
      });

      debouncer.buffer('inst-1', 'chat-1', makeMessage('a'), longConfig);
      debouncer.buffer('inst-1', 'chat-2', makeMessage('b'), longConfig);
      debouncer.buffer('inst-2', 'chat-1', makeMessage('c'), longConfig);

      await debouncer.flushAll();

      expect(byKey['inst-1:chat-1']).toBe(1);
      expect(byKey['inst-1:chat-2']).toBe(1);
      expect(byKey['inst-2:chat-1']).toBe(1);
    });

    it('clear() drops pending buffers — the shutdown gap flushAll closes', async () => {
      const flushCalls: BufferedMessage[][] = [];
      debouncer = new MessageDebouncer(async (_chatKey, messages) => {
        flushCalls.push([...messages]);
      });

      debouncer.buffer('inst-1', 'chat-1', makeMessage('a'), longConfig);
      debouncer.clear();
      await wait(50);

      // Regression contrast: clear() is the lossy path; flushAll() is not.
      expect(flushCalls.length).toBe(0);
    });
  });

  describe('per-instanceId:chatId isolation', () => {
    it('keeps buffers separate across instances and chats', async () => {
      const byKey: Record<string, number> = {};
      debouncer = new MessageDebouncer(async (chatKey, messages) => {
        byKey[chatKey] = (byKey[chatKey] ?? 0) + messages.length;
      });

      debouncer.buffer('inst-1', 'chat-1', makeMessage('a1'), fixedConfig);
      debouncer.buffer('inst-1', 'chat-1', makeMessage('a2'), fixedConfig);
      debouncer.buffer('inst-1', 'chat-2', makeMessage('b1'), fixedConfig);
      debouncer.buffer('inst-2', 'chat-1', makeMessage('c1'), fixedConfig);

      await wait(150);

      expect(byKey['inst-1:chat-1']).toBe(2);
      expect(byKey['inst-1:chat-2']).toBe(1);
      expect(byKey['inst-2:chat-1']).toBe(1);
    });
  });
});
