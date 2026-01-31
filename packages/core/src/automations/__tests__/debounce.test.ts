/**
 * Tests for debounce system
 */

import { describe, expect, mock, test } from 'bun:test';
import { DebounceManager, type DebouncedMessage, buildConversationKey, parseConversationKey } from '../debounce';
import type { DebounceConfig } from '../types';

describe('buildConversationKey', () => {
  test('builds key from instanceId and personId', () => {
    expect(buildConversationKey('wa-001', 'user-123')).toBe('wa-001:user-123');
  });
});

describe('parseConversationKey', () => {
  test('parses key back to components', () => {
    const result = parseConversationKey('wa-001:user-123');
    expect(result.instanceId).toBe('wa-001');
    expect(result.personId).toBe('user-123');
  });

  test('handles keys with colons in personId', () => {
    // Note: This will only get the first part after the first colon
    const result = parseConversationKey('wa-001:user:with:colons');
    expect(result.instanceId).toBe('wa-001');
    expect(result.personId).toBe('user');
  });
});

describe('DebounceManager', () => {
  describe('mode: none', () => {
    test('fires callback immediately', () => {
      const callback = mock(() => {});
      const config: DebounceConfig = { mode: 'none' };
      const manager = new DebounceManager(config, callback);

      const message: DebouncedMessage = {
        type: 'text',
        text: 'hello',
        timestamp: Date.now(),
        payload: { text: 'hello' },
      };

      manager.addMessage('key', message, { id: '123' }, 'wa-001');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('key', [message], { id: '123' }, 'wa-001');
    });
  });

  describe('mode: fixed', () => {
    test('waits for delay before firing', async () => {
      const callback = mock(() => {});
      const config: DebounceConfig = { mode: 'fixed', delayMs: 50 };
      const manager = new DebounceManager(config, callback);

      const message: DebouncedMessage = {
        type: 'text',
        text: 'hello',
        timestamp: Date.now(),
        payload: { text: 'hello' },
      };

      manager.addMessage('key', message, { id: '123' }, 'wa-001');

      // Should not fire immediately
      expect(callback).toHaveBeenCalledTimes(0);

      // Wait for delay
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(callback).toHaveBeenCalledTimes(1);
    });

    test('groups multiple messages', async () => {
      const callback = mock(() => {});
      const config: DebounceConfig = { mode: 'fixed', delayMs: 50 };
      const manager = new DebounceManager(config, callback);

      const from = { id: '123' };

      manager.addMessage('key', { type: 'text', text: 'msg1', timestamp: 1, payload: {} }, from, 'wa-001');
      manager.addMessage('key', { type: 'text', text: 'msg2', timestamp: 2, payload: {} }, from, 'wa-001');
      manager.addMessage('key', { type: 'text', text: 'msg3', timestamp: 3, payload: {} }, from, 'wa-001');

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(callback).toHaveBeenCalledTimes(1);
      const call = callback.mock.calls[0];
      expect(call).toBeDefined();
      const [, messages] = call as unknown as [string, DebouncedMessage[]];
      expect(messages.length).toBe(3);
      expect(messages[0]?.text).toBe('msg1');
      expect(messages[2]?.text).toBe('msg3');
    });
  });

  describe('mode: range', () => {
    test('delays within range', async () => {
      const callback = mock(() => {});
      const config: DebounceConfig = { mode: 'range', minMs: 20, maxMs: 40 };
      const manager = new DebounceManager(config, callback);

      const message: DebouncedMessage = {
        type: 'text',
        text: 'hello',
        timestamp: Date.now(),
        payload: {},
      };

      manager.addMessage('key', message, { id: '123' }, 'wa-001');

      // Should not fire before min
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(callback).toHaveBeenCalledTimes(0);

      // Should fire within max
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('flushAll', () => {
    test('fires all pending windows', () => {
      const callback = mock(() => {});
      const config: DebounceConfig = { mode: 'fixed', delayMs: 5000 };
      const manager = new DebounceManager(config, callback);

      manager.addMessage('key1', { type: 'text', timestamp: 1, payload: {} }, { id: '1' }, 'wa-001');
      manager.addMessage('key2', { type: 'text', timestamp: 2, payload: {} }, { id: '2' }, 'wa-002');

      manager.flushAll();

      expect(callback).toHaveBeenCalledTimes(2);
    });
  });

  describe('getActiveWindowCount', () => {
    test('returns count of active windows', () => {
      const callback = mock(() => {});
      const config: DebounceConfig = { mode: 'fixed', delayMs: 5000 };
      const manager = new DebounceManager(config, callback);

      expect(manager.getActiveWindowCount()).toBe(0);

      manager.addMessage('key1', { type: 'text', timestamp: 1, payload: {} }, { id: '1' }, 'wa-001');
      expect(manager.getActiveWindowCount()).toBe(1);

      manager.addMessage('key2', { type: 'text', timestamp: 2, payload: {} }, { id: '2' }, 'wa-002');
      expect(manager.getActiveWindowCount()).toBe(2);

      manager.flushAll();
      expect(manager.getActiveWindowCount()).toBe(0);
    });
  });

  describe('getPendingCount', () => {
    test('returns count of pending messages for a key', () => {
      const callback = mock(() => {});
      const config: DebounceConfig = { mode: 'fixed', delayMs: 5000 };
      const manager = new DebounceManager(config, callback);

      expect(manager.getPendingCount('key')).toBe(0);

      manager.addMessage('key', { type: 'text', timestamp: 1, payload: {} }, { id: '1' }, 'wa-001');
      expect(manager.getPendingCount('key')).toBe(1);

      manager.addMessage('key', { type: 'text', timestamp: 2, payload: {} }, { id: '1' }, 'wa-001');
      expect(manager.getPendingCount('key')).toBe(2);
    });
  });
});
