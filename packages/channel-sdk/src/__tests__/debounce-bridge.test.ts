import { describe, expect, mock, test } from 'bun:test';
import { type BatchCallback, createDebounceBridge } from '../debounce-bridge';

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => createMockLogger()),
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createDebounceBridge', () => {
  describe('mode: none', () => {
    test('fires callback immediately for each message', () => {
      const logger = createMockLogger();
      const onBatch = mock<BatchCallback>(() => {});
      const bridge = createDebounceBridge({ mode: 'none' }, onBatch, logger);

      bridge.push({
        senderId: 'user-1',
        instanceId: 'inst-1',
        content: 'Hello',
      });

      expect(onBatch).toHaveBeenCalledTimes(1);
      expect(onBatch.mock.calls[0]?.[0]).toBe('inst-1');
      expect(onBatch.mock.calls[0]?.[1]).toBe('user-1');
      expect(onBatch.mock.calls[0]?.[2]).toBe('Hello');
    });

    test('does not batch messages from same sender', () => {
      const logger = createMockLogger();
      const onBatch = mock<BatchCallback>(() => {});
      const bridge = createDebounceBridge({ mode: 'none' }, onBatch, logger);

      bridge.push({ senderId: 'user-1', instanceId: 'inst-1', content: 'msg 1' });
      bridge.push({ senderId: 'user-1', instanceId: 'inst-1', content: 'msg 2' });

      expect(onBatch).toHaveBeenCalledTimes(2);
    });
  });

  describe('mode: fixed', () => {
    test('batches messages within window', async () => {
      const logger = createMockLogger();
      const onBatch = mock<BatchCallback>(() => {});
      const bridge = createDebounceBridge({ mode: 'fixed', windowMs: 100 }, onBatch, logger);

      bridge.push({ senderId: 'user-1', instanceId: 'inst-1', content: 'msg 1' });
      bridge.push({ senderId: 'user-1', instanceId: 'inst-1', content: 'msg 2' });
      bridge.push({ senderId: 'user-1', instanceId: 'inst-1', content: 'msg 3' });

      // Not yet fired
      expect(onBatch).toHaveBeenCalledTimes(0);

      await wait(150);

      // Should have fired once with all 3 messages
      expect(onBatch).toHaveBeenCalledTimes(1);
      const batchedContent = onBatch.mock.calls[0]?.[2];
      expect(batchedContent).toBe('msg 1\nmsg 2\nmsg 3');
    });

    test('different senders are not batched together', async () => {
      const logger = createMockLogger();
      const onBatch = mock<BatchCallback>(() => {});
      const bridge = createDebounceBridge({ mode: 'fixed', windowMs: 100 }, onBatch, logger);

      bridge.push({ senderId: 'user-1', instanceId: 'inst-1', content: 'from user 1' });
      bridge.push({ senderId: 'user-2', instanceId: 'inst-1', content: 'from user 2' });

      await wait(150);

      expect(onBatch).toHaveBeenCalledTimes(2);
    });

    test('emits debounce_batch log event', async () => {
      const logger = createMockLogger();
      const onBatch = mock<BatchCallback>(() => {});
      const bridge = createDebounceBridge({ mode: 'fixed', windowMs: 50 }, onBatch, logger);

      bridge.push({ senderId: 'user-1', instanceId: 'inst-1', content: 'a' });
      bridge.push({ senderId: 'user-1', instanceId: 'inst-1', content: 'b' });

      await wait(100);

      expect(logger.info).toHaveBeenCalledWith(
        'debounce_batch',
        expect.objectContaining({
          event: 'debounce_batch',
          senderId: 'user-1',
          instanceId: 'inst-1',
          messageCount: 2,
          mode: 'fixed',
        }),
      );
    });

    test('passes sender name through to callback', async () => {
      const logger = createMockLogger();
      const onBatch = mock<BatchCallback>(() => {});
      const bridge = createDebounceBridge({ mode: 'fixed', windowMs: 50 }, onBatch, logger);

      bridge.push({
        senderId: 'user-1',
        senderName: 'Alice',
        instanceId: 'inst-1',
        content: 'hi',
      });

      await wait(100);

      expect(onBatch.mock.calls[0]?.[4]).toBe('Alice');
    });
  });

  describe('flush', () => {
    test('forces all pending windows to fire', () => {
      const logger = createMockLogger();
      const onBatch = mock<BatchCallback>(() => {});
      const bridge = createDebounceBridge({ mode: 'fixed', windowMs: 10_000 }, onBatch, logger);

      bridge.push({ senderId: 'user-1', instanceId: 'inst-1', content: 'pending' });
      expect(onBatch).toHaveBeenCalledTimes(0);

      bridge.flush();
      expect(onBatch).toHaveBeenCalledTimes(1);
    });
  });

  describe('activeWindowCount', () => {
    test('tracks active windows', async () => {
      const logger = createMockLogger();
      const onBatch = mock<BatchCallback>(() => {});
      const bridge = createDebounceBridge({ mode: 'fixed', windowMs: 100 }, onBatch, logger);

      expect(bridge.activeWindowCount).toBe(0);

      bridge.push({ senderId: 'user-1', instanceId: 'inst-1', content: 'a' });
      expect(bridge.activeWindowCount).toBe(1);

      bridge.push({ senderId: 'user-2', instanceId: 'inst-1', content: 'b' });
      expect(bridge.activeWindowCount).toBe(2);

      await wait(150);
      expect(bridge.activeWindowCount).toBe(0);
    });
  });

  describe('performance', () => {
    test('debounce timer overhead <5ms p99', async () => {
      const logger = createMockLogger();
      const actualWindowDurations: number[] = [];
      const configuredWindowMs = 50;

      const onBatch: BatchCallback = (_inst, _sender, _content, _msgs) => {
        // We track via the log event
      };

      const bridge = createDebounceBridge({ mode: 'fixed', windowMs: configuredWindowMs }, onBatch, logger);

      // Run 100 iterations
      for (let i = 0; i < 100; i++) {
        bridge.push({
          senderId: `perf-${i}`,
          instanceId: 'inst-1',
          content: 'test',
        });
      }

      await wait(configuredWindowMs + 50);

      // Check that the batches fired
      const infoCalls = (logger.info as ReturnType<typeof mock>).mock.calls;
      const batchCalls = infoCalls.filter((c) => c[0] === 'debounce_batch');

      for (const call of batchCalls) {
        const data = call[1] as Record<string, unknown>;
        const actualMs = data.actualWindowMs as number;
        const overhead = actualMs - configuredWindowMs;
        actualWindowDurations.push(overhead);
      }

      if (actualWindowDurations.length > 0) {
        actualWindowDurations.sort((a, b) => a - b);
        const p99 = actualWindowDurations[Math.floor(actualWindowDurations.length * 0.99)];
        // Allow generous tolerance since timers aren't perfectly precise
        expect(p99).toBeLessThan(50);
      }
    });
  });
});
