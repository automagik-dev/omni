/**
 * TDD tests for write-behind cache in auth key store (#70)
 *
 * The root cause of #70: storage.set() does a PostgreSQL UPSERT that can hang
 * indefinitely (row lock from concurrent incoming message processing on the
 * same sender-key row). Baileys' commitWithRetry awaits this, holding the
 * meId transaction mutex forever — freezing ALL message processing.
 *
 * Fix: keys.set() writes to an in-memory cache and returns immediately.
 * DB persist happens in the background. keys.get() reads cache first.
 */

import { describe, expect, it } from 'bun:test';
import type { PluginStorage } from '@omni/channel-sdk';
import { clearSenderKeys, createStorageAuthState } from '../auth';

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const wildcardPattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${wildcardPattern}$`);
}

/**
 * Create a mock PluginStorage where set() hangs forever (simulating the #70 bug)
 */
function createHangingStorage(): PluginStorage & { getCalls: string[]; setCalls: string[] } {
  const data = new Map<string, string>();
  const getCalls: string[] = [];
  const setCalls: string[] = [];

  return {
    getCalls,
    setCalls,
    async get<T>(key: string): Promise<T | null> {
      getCalls.push(key);
      const val = data.get(key);
      if (!val) return null;
      try {
        return JSON.parse(val) as T;
      } catch {
        return val as unknown as T;
      }
    },
    async set(key: string, value: unknown): Promise<void> {
      setCalls.push(key);
      // Simulate the #70 bug: UPSERT hangs forever for sender-key entries
      if (key.includes('sender-key') && !key.includes('sender-key-memory')) {
        // Never resolves — this is the exact bug
        return new Promise<void>(() => {});
      }
      data.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    async delete(key: string): Promise<boolean> {
      return data.delete(key);
    },
    async has(key: string): Promise<boolean> {
      return data.has(key);
    },
    async keys(pattern?: string): Promise<string[]> {
      const keys = Array.from(data.keys());
      if (!pattern) return keys;
      const regex = patternToRegex(pattern);
      return keys.filter((key) => regex.test(key));
    },
  };
}

/**
 * Create a fast mock storage (no hangs, for testing normal flow)
 */
function createFastStorage(): PluginStorage & {
  data: Map<string, string>;
  setCalls: string[];
} {
  const data = new Map<string, string>();
  const setCalls: string[] = [];

  return {
    data,
    setCalls,
    async get<T>(key: string): Promise<T | null> {
      const val = data.get(key);
      if (!val) return null;
      try {
        return JSON.parse(val) as T;
      } catch {
        return val as unknown as T;
      }
    },
    async set(key: string, value: unknown): Promise<void> {
      setCalls.push(key);
      data.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    async delete(key: string): Promise<boolean> {
      return data.delete(key);
    },
    async has(key: string): Promise<boolean> {
      return data.has(key);
    },
    async keys(pattern?: string): Promise<string[]> {
      const keys = Array.from(data.keys());
      if (!pattern) return keys;
      const regex = patternToRegex(pattern);
      return keys.filter((key) => regex.test(key));
    },
  };
}

describe('Auth key store write-behind cache (#70)', () => {
  const instanceId = 'test-instance';

  describe('keys.set — must not block on storage', () => {
    it('returns within 200ms even when storage.set hangs forever', async () => {
      const storage = createHangingStorage();
      const { state } = await createStorageAuthState(storage, instanceId);

      const t0 = Date.now();

      // Simulate what Baileys commitWithRetry does: write sender-key + sender-key-memory
      await state.keys.set({
        'sender-key': {
          'group@g.us::participant::0': { fake: 'sender-key-data' } as never,
        },
        'sender-key-memory': {
          'group@g.us': { fake: 'memory-data' } as never,
        },
      });

      const elapsed = Date.now() - t0;
      // Must return fast — the old code would hang forever here
      // 200ms threshold allows for CI/GC variance while still catching the real bug (hangs forever)
      expect(elapsed).toBeLessThan(200);
    });

    it('updates in-memory cache synchronously', async () => {
      const storage = createHangingStorage();
      const { state } = await createStorageAuthState(storage, instanceId);

      const testData = { keyData: 'test-value-123' } as never;

      await state.keys.set({
        'sender-key': {
          'group@g.us::me::0': testData,
        },
      });

      // Immediately read back — should come from cache, not storage
      const result = await state.keys.get('sender-key', ['group@g.us::me::0']);
      expect(result['group@g.us::me::0']).toBeTruthy();
    });

    it('handles null values (deletes) in cache', async () => {
      const storage = createFastStorage();
      const { state } = await createStorageAuthState(storage, instanceId);

      // First set a value
      await state.keys.set({
        'pre-key': { '42': { keyPair: 'test' } as never },
      });

      // Then delete it via null
      await state.keys.set({
        'pre-key': { '42': null as never },
      });

      // Should not be in cache
      const result = await state.keys.get('pre-key', ['42']);
      expect(result['42']).toBeUndefined();
    });
  });

  describe('keys.get — cache-first reads', () => {
    it('reads from cache without hitting storage', async () => {
      const storage = createFastStorage();
      const { state } = await createStorageAuthState(storage, instanceId);

      // Set data
      await state.keys.set({
        session: { 'peer-123': { session: 'data' } as never },
      });

      // Clear the storage to prove we read from cache
      storage.data.clear();

      const result = await state.keys.get('session', ['peer-123']);
      expect(result['peer-123']).toBeTruthy();
    });

    it('falls through to storage for cache misses', async () => {
      const storage = createFastStorage();

      // Pre-populate storage with serialized data (simulating restart)
      const key = `auth:${instanceId}:keys:session:peer-456`;
      storage.data.set(key, JSON.stringify({ session: 'from-db' }));

      const { state } = await createStorageAuthState(storage, instanceId);

      // Read without prior set — should come from storage
      const result = await state.keys.get('session', ['peer-456']);
      expect(result['peer-456']).toBeTruthy();
    });
  });

  describe('background persist', () => {
    it('eventually writes to storage', async () => {
      const storage = createFastStorage();
      const { state } = await createStorageAuthState(storage, instanceId);

      await state.keys.set({
        'pre-key': { '99': { publicKey: 'abc' } as never },
      });

      // Background persist should complete soon
      await new Promise((r) => setTimeout(r, 50));

      const key = `auth:${instanceId}:keys:pre-key:99`;
      expect(storage.data.has(key)).toBe(true);
    });

    it('does not throw when storage.set fails', async () => {
      const storage = createFastStorage();
      const { state } = await createStorageAuthState(storage, instanceId);

      // Make storage.set throw
      storage.set = async () => {
        throw new Error('DB connection lost');
      };

      // Should not throw — error is caught and logged
      await expect(
        state.keys.set({
          'pre-key': { '100': { publicKey: 'xyz' } as never },
        }),
      ).resolves.toBeUndefined();

      // Cache should still have the data
      const result = await state.keys.get('pre-key', ['100']);
      expect(result['100']).toBeTruthy();
    });

    it('serializes background persists for the same key', async () => {
      const persisted = new Map<string, string>();
      let isFirstWrite = true;

      const storage: PluginStorage = {
        async get<T>(key: string): Promise<T | null> {
          const value = persisted.get(key);
          if (!value) return null;
          return JSON.parse(value) as T;
        },
        async set(key: string, value: unknown): Promise<void> {
          // Simulate out-of-order completion risk:
          // first write is slower than second write.
          const shouldDelay = isFirstWrite;
          isFirstWrite = false;
          if (shouldDelay) {
            await new Promise((r) => setTimeout(r, 75));
          }
          persisted.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        },
        async delete(key: string): Promise<boolean> {
          return persisted.delete(key);
        },
        async has(key: string): Promise<boolean> {
          return persisted.has(key);
        },
        async keys(pattern?: string): Promise<string[]> {
          const keys = Array.from(persisted.keys());
          if (!pattern) return keys;
          const regex = patternToRegex(pattern);
          return keys.filter((key) => regex.test(key));
        },
      };

      const { state } = await createStorageAuthState(storage, instanceId);
      const keyId = 'ordered-key';

      await state.keys.set({
        'pre-key': { [keyId]: { value: 'first' } as never },
      });
      await state.keys.set({
        'pre-key': { [keyId]: { value: 'second' } as never },
      });

      // Allow queued background writes to drain.
      await new Promise((r) => setTimeout(r, 200));

      const storedRaw = persisted.get(`auth:${instanceId}:keys:pre-key:${keyId}`);
      expect(storedRaw).toBeTruthy();
      const stored = JSON.parse(storedRaw ?? '{}') as { value?: string };
      expect(stored.value).toBe('second');
    });
  });

  describe('clearSenderKeys', () => {
    it('removes only sender-key entries for the target instance', async () => {
      const storage = createFastStorage();
      const otherInstanceId = 'other-instance';

      const senderKeyA = `auth:${instanceId}:keys:sender-key:group-a@g.us::participant-a::0`;
      const senderKeyB = `auth:${instanceId}:keys:sender-key:group-b@g.us::participant-b::0`;
      const nonSenderKey = `auth:${instanceId}:keys:session:peer-1`;
      const otherInstanceSenderKey = `auth:${otherInstanceId}:keys:sender-key:group-c@g.us::participant-c::0`;

      storage.data.set(senderKeyA, JSON.stringify({ key: 'a' }));
      storage.data.set(senderKeyB, JSON.stringify({ key: 'b' }));
      storage.data.set(nonSenderKey, JSON.stringify({ session: 'keep' }));
      storage.data.set(otherInstanceSenderKey, JSON.stringify({ key: 'keep' }));

      const deleted = await clearSenderKeys(storage, instanceId);

      expect(deleted).toBe(2);
      expect(storage.data.has(senderKeyA)).toBe(false);
      expect(storage.data.has(senderKeyB)).toBe(false);
      expect(storage.data.has(nonSenderKey)).toBe(true);
      expect(storage.data.has(otherInstanceSenderKey)).toBe(true);
    });
  });
});
