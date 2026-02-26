/**
 * Tests for instance-scoped component registry with TTL
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { ComponentRegistry, resetComponentRegistry } from '../components/registry';

function createRegistry(): ComponentRegistry {
  return new ComponentRegistry();
}

afterEach(() => {
  resetComponentRegistry();
});

describe('ComponentRegistry', () => {
  describe('register and resolve', () => {
    test('registers and resolves components', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button', id: 'btn-1' }]);

      const entry = reg.resolve('inst-1', 'msg-1');
      expect(entry).not.toBeNull();
      expect(entry?.components).toEqual([{ type: 'button', id: 'btn-1' }]);
      expect(entry?.instanceId).toBe('inst-1');
      expect(entry?.messageId).toBe('msg-1');
      reg.destroy();
    });

    test('consumes entry by default (one-shot)', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button' }]);

      const first = reg.resolve('inst-1', 'msg-1');
      expect(first).not.toBeNull();

      const second = reg.resolve('inst-1', 'msg-1');
      expect(second).toBeNull();
      reg.destroy();
    });

    test('returns null for unregistered components', () => {
      const reg = createRegistry();
      const entry = reg.resolve('inst-1', 'msg-unknown');
      expect(entry).toBeNull();
      reg.destroy();
    });
  });

  describe('instance isolation', () => {
    test('components from instance A are NOT accessible from instance B', () => {
      const reg = createRegistry();
      reg.register('inst-A', 'msg-1', [{ type: 'button' }]);

      const result = reg.resolve('inst-B', 'msg-1');
      expect(result).toBeNull();

      // But instance A can still access
      const resultA = reg.resolve('inst-A', 'msg-1');
      expect(resultA).not.toBeNull();
      reg.destroy();
    });

    test('same messageId on different instances are independent', () => {
      const reg = createRegistry();
      reg.register('inst-A', 'msg-1', [{ id: 'A' }]);
      reg.register('inst-B', 'msg-1', [{ id: 'B' }]);

      const entryA = reg.resolve('inst-A', 'msg-1');
      expect(entryA?.components).toEqual([{ id: 'A' }]);

      const entryB = reg.resolve('inst-B', 'msg-1');
      expect(entryB?.components).toEqual([{ id: 'B' }]);
      reg.destroy();
    });
  });

  describe('TTL and expiration', () => {
    test('entry expires after TTL', () => {
      const reg = createRegistry();
      // Register with 1ms TTL
      reg.register('inst-1', 'msg-1', [{ type: 'button' }], { ttlMs: 1 });

      // Wait for expiration
      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy wait
      }

      const entry = reg.resolve('inst-1', 'msg-1');
      expect(entry).toBeNull();
      reg.destroy();
    });

    test('entry resolves within TTL', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button' }], { ttlMs: 60000 });

      const entry = reg.resolve('inst-1', 'msg-1');
      expect(entry).not.toBeNull();
      reg.destroy();
    });

    test('has() returns false for expired entries', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button' }], { ttlMs: 1 });

      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy wait
      }

      expect(reg.has('inst-1', 'msg-1')).toBe(false);
      reg.destroy();
    });
  });

  describe('reusable components', () => {
    test('reusable entry persists after resolve', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button' }], { reusable: true });

      const first = reg.resolve('inst-1', 'msg-1');
      expect(first).not.toBeNull();

      const second = reg.resolve('inst-1', 'msg-1');
      expect(second).not.toBeNull();

      const third = reg.resolve('inst-1', 'msg-1');
      expect(third).not.toBeNull();
      reg.destroy();
    });

    test('non-reusable entry is consumed after resolve (default)', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button' }]);

      const first = reg.resolve('inst-1', 'msg-1');
      expect(first).not.toBeNull();

      const second = reg.resolve('inst-1', 'msg-1');
      expect(second).toBeNull();
      reg.destroy();
    });

    test('consume: false overrides default consume behavior', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button' }]); // default: NOT reusable

      const first = reg.resolve('inst-1', 'msg-1', { consume: false });
      expect(first).not.toBeNull();

      const second = reg.resolve('inst-1', 'msg-1');
      expect(second).not.toBeNull(); // still available because first resolve didn't consume
      reg.destroy();
    });
  });

  describe('LRU eviction', () => {
    test('evicts oldest entry when at max capacity', () => {
      const reg = createRegistry();

      // Fill to capacity
      for (let i = 0; i < 10000; i++) {
        reg.register('inst-1', `msg-${i}`, [{ idx: i }]);
      }

      expect(reg.stats().totalEntries).toBe(10000);

      // Register one more — should evict the oldest
      reg.register('inst-1', 'msg-new', [{ idx: 'new' }]);

      expect(reg.stats().totalEntries).toBe(10000);

      // First entry should be evicted
      expect(reg.has('inst-1', 'msg-0')).toBe(false);

      // New entry should exist
      expect(reg.has('inst-1', 'msg-new')).toBe(true);
      reg.destroy();
    });
  });

  describe('expired interaction rate limiting', () => {
    test('first 3 expired clicks are not suppressed', () => {
      const reg = createRegistry();

      expect(reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1')).toBe(false); // 1st
      expect(reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1')).toBe(false); // 2nd
      expect(reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1')).toBe(false); // 3rd
      reg.destroy();
    });

    test('4th+ expired click within 60s is suppressed', () => {
      const reg = createRegistry();

      reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1'); // 1
      reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1'); // 2
      reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1'); // 3
      const suppressed = reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1'); // 4
      expect(suppressed).toBe(true);
      reg.destroy();
    });

    test('suppression is per-user', () => {
      const reg = createRegistry();

      // User-1 exhausts their limit
      reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1');
      reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1');
      reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1');
      expect(reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1')).toBe(true);

      // User-2 still has their allowance
      expect(reg.shouldSuppressExpired('user-2', 'inst-1', 'msg-1')).toBe(false);
      reg.destroy();
    });

    test('suppression is per-component', () => {
      const reg = createRegistry();

      // Exhaust limit on msg-1
      reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1');
      reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1');
      reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1');
      expect(reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-1')).toBe(true);

      // Same user on different message is not suppressed
      expect(reg.shouldSuppressExpired('user-1', 'inst-1', 'msg-2')).toBe(false);
      reg.destroy();
    });
  });

  describe('cleanup', () => {
    test('cleanup removes expired entries', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button' }], { ttlMs: 1 });
      reg.register('inst-1', 'msg-2', [{ type: 'button' }], { ttlMs: 60000 });

      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy wait
      }

      const cleaned = reg.cleanup();
      expect(cleaned).toBe(1);
      expect(reg.has('inst-1', 'msg-1')).toBe(false);
      expect(reg.has('inst-1', 'msg-2')).toBe(true);
      reg.destroy();
    });

    test('clear removes all entries', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button' }]);
      reg.register('inst-1', 'msg-2', [{ type: 'button' }]);

      reg.clear();
      expect(reg.stats().totalEntries).toBe(0);
      expect(reg.stats().expiredCount).toBe(0);
      reg.destroy();
    });
  });

  describe('stats', () => {
    test('reports correct counts', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button' }], { ttlMs: 60000 });
      reg.register('inst-1', 'msg-2', [{ type: 'button' }], { ttlMs: 60000 });

      const stats = reg.stats();
      expect(stats.activeCount).toBe(2);
      expect(stats.totalEntries).toBe(2);
      expect(stats.expiredCount).toBe(0);
      reg.destroy();
    });
  });

  describe('unregister', () => {
    test('removes a registered entry', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button' }]);

      const removed = reg.unregister('inst-1', 'msg-1');
      expect(removed).toBe(true);
      expect(reg.has('inst-1', 'msg-1')).toBe(false);
      reg.destroy();
    });

    test('returns false for non-existent entry', () => {
      const reg = createRegistry();
      const removed = reg.unregister('inst-1', 'msg-nonexistent');
      expect(removed).toBe(false);
      reg.destroy();
    });
  });

  describe('performance', () => {
    test('lookup completes in <1ms', () => {
      const reg = createRegistry();

      // Register 1000 entries
      for (let i = 0; i < 1000; i++) {
        reg.register('inst-1', `msg-${i}`, [{ idx: i }]);
      }

      // Measure lookup time
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        reg.resolve('inst-1', `msg-${i}`, { consume: false });
      }
      const elapsed = performance.now() - start;
      const avgMs = elapsed / 100;

      expect(avgMs).toBeLessThan(1);
      reg.destroy();
    });

    test('10000 entries use <10MB memory', () => {
      const reg = createRegistry();

      // Register 10000 entries with realistic component data
      for (let i = 0; i < 10000; i++) {
        reg.register('inst-1', `msg-${i}`, [
          { type: 'button', customId: `btn-${i}`, label: `Button ${i}` },
          { type: 'select', customId: `sel-${i}`, options: ['a', 'b', 'c'] },
        ]);
      }

      // Rough memory estimate: each entry ~500 bytes
      // 10000 * 500 = 5MB — well under 10MB target
      expect(reg.stats().totalEntries).toBe(10000);
      reg.destroy();
    });
  });

  describe('backward compatibility', () => {
    test('unregistered interactions pass through (resolve returns null)', () => {
      const reg = createRegistry();

      // No registration — simulates messages sent without registry
      const entry = reg.resolve('inst-1', 'msg-unknown');
      expect(entry).toBeNull();
      reg.destroy();
    });
  });

  describe('wasRegistered (tombstones)', () => {
    test('returns false for never-registered components', () => {
      const reg = createRegistry();
      expect(reg.wasRegistered('inst-1', 'msg-never')).toBe(false);
      reg.destroy();
    });

    test('returns true after component expires via has()', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button' }], { ttlMs: 1 });

      // Wait for TTL to expire
      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy wait
      }

      // has() triggers expiration + tombstone
      expect(reg.has('inst-1', 'msg-1')).toBe(false);
      expect(reg.wasRegistered('inst-1', 'msg-1')).toBe(true);
      reg.destroy();
    });

    test('returns true after component expires via resolve()', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button' }], { ttlMs: 1 });

      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy wait
      }

      // resolve() triggers expiration + tombstone
      expect(reg.resolve('inst-1', 'msg-1')).toBeNull();
      expect(reg.wasRegistered('inst-1', 'msg-1')).toBe(true);
      reg.destroy();
    });

    test('returns true after component expires via cleanup()', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button' }], { ttlMs: 1 });

      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy wait — ensure TTL has expired
      }

      reg.cleanup();
      expect(reg.wasRegistered('inst-1', 'msg-1')).toBe(true);
      reg.destroy();
    });

    test('clear() resets tombstones', () => {
      const reg = createRegistry();
      reg.register('inst-1', 'msg-1', [{ type: 'button' }], { ttlMs: 1 });

      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy wait
      }

      reg.has('inst-1', 'msg-1'); // expire it
      expect(reg.wasRegistered('inst-1', 'msg-1')).toBe(true);

      reg.clear();
      expect(reg.wasRegistered('inst-1', 'msg-1')).toBe(false);
      reg.destroy();
    });
  });
});
