import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ChatQueue, getSessionKey } from '../middleware/sequentialize';

describe('Sequential Processing', () => {
  describe('getSessionKey', () => {
    test('uses chatId as key for regular messages', () => {
      expect(getSessionKey('123', undefined)).toBe('123');
    });

    test('combines chatId and threadId for forum messages', () => {
      expect(getSessionKey('123', '456')).toBe('123:456');
    });

    test('different threadIds produce different keys', () => {
      expect(getSessionKey('123', '100')).not.toBe(getSessionKey('123', '200'));
    });

    test('same chatId with and without threadId produce different keys', () => {
      expect(getSessionKey('123', undefined)).not.toBe(getSessionKey('123', '456'));
    });
  });

  describe('ChatQueue', () => {
    let queue: ChatQueue;

    beforeEach(() => {
      queue = new ChatQueue();
    });

    afterEach(() => {
      queue.clear();
    });

    test('two messages in same chat processed in order', async () => {
      const order: number[] = [];

      const task1 = queue.enqueue('chat-1', async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push(1);
      });

      const task2 = queue.enqueue('chat-1', async () => {
        order.push(2);
      });

      await Promise.all([task1, task2]);

      expect(order).toEqual([1, 2]);
    });

    test('two messages in different chats processed concurrently', async () => {
      const startTimes: Record<string, number> = {};

      const task1 = queue.enqueue('chat-A', async () => {
        startTimes.A = Date.now();
        await new Promise((r) => setTimeout(r, 50));
      });

      const task2 = queue.enqueue('chat-B', async () => {
        startTimes.B = Date.now();
        await new Promise((r) => setTimeout(r, 50));
      });

      await Promise.all([task1, task2]);

      // Both should start within 10ms of each other (concurrent)
      const diff = Math.abs((startTimes.A ?? 0) - (startTimes.B ?? 0));
      expect(diff).toBeLessThan(30);
    });

    test('forum topic messages with different threadIds processed concurrently', async () => {
      const startTimes: Record<string, number> = {};

      const task1 = queue.enqueue('chat-1:thread-100', async () => {
        startTimes['100'] = Date.now();
        await new Promise((r) => setTimeout(r, 50));
      });

      const task2 = queue.enqueue('chat-1:thread-200', async () => {
        startTimes['200'] = Date.now();
        await new Promise((r) => setTimeout(r, 50));
      });

      await Promise.all([task1, task2]);

      const diff = Math.abs((startTimes['100'] ?? 0) - (startTimes['200'] ?? 0));
      expect(diff).toBeLessThan(30);
    });

    test('forum topic messages with same threadId processed sequentially', async () => {
      const order: number[] = [];

      const task1 = queue.enqueue('chat-1:thread-100', async () => {
        await new Promise((r) => setTimeout(r, 30));
        order.push(1);
      });

      const task2 = queue.enqueue('chat-1:thread-100', async () => {
        order.push(2);
      });

      await Promise.all([task1, task2]);

      expect(order).toEqual([1, 2]);
    });

    test('queue cleans up after tasks complete', async () => {
      await queue.enqueue('chat-1', async () => {});
      await queue.enqueue('chat-1', async () => {});

      // Allow .finally() microtask to run
      await new Promise((r) => setTimeout(r, 10));

      // Internal queue for chat-1 should be cleaned up
      expect(queue.activeQueues).toBe(0);
    });

    test('error in task does not block subsequent tasks', async () => {
      const order: number[] = [];

      const task1 = queue
        .enqueue('chat-1', async () => {
          order.push(1);
          throw new Error('Task 1 failed');
        })
        .catch(() => {}); // Swallow error

      const task2 = queue.enqueue('chat-1', async () => {
        order.push(2);
      });

      await Promise.all([task1, task2]);

      expect(order).toEqual([1, 2]);
    });
  });
});
