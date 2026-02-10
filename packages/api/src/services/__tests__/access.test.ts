/**
 * Unit tests for AccessService
 *
 * Tests mode-aware access control (disabled/blocklist/allowlist),
 * caching behavior, pattern matching, and priority tie-breaking.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { CacheProvider, EventBus } from '@omni/core';
import type { AccessMode, AccessRule, Database } from '@omni/db';
import { AccessService } from '../access';

// ============================================================================
// Helpers
// ============================================================================

function createRule(overrides: Partial<AccessRule> = {}): AccessRule {
  return {
    id: 'rule-1',
    instanceId: 'inst-1',
    ruleType: 'deny',
    phonePattern: null,
    platformUserId: null,
    personId: null,
    priority: 0,
    enabled: true,
    reason: null,
    expiresAt: null,
    action: 'block',
    blockMessage: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function createInstance(mode: AccessMode = 'blocklist') {
  return { id: 'inst-1', accessMode: mode };
}

/**
 * Create a mock DB that returns the given rules from getApplicableRules.
 */
function createMockDb(rules: AccessRule[]) {
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() => Promise.resolve(rules)),
          limit: mock(() => Promise.resolve([])),
        })),
        orderBy: mock(() => Promise.resolve(rules)),
        limit: mock(() => Promise.resolve([])),
        $dynamic: mock(() => ({
          where: mock(() => ({
            orderBy: mock(() => Promise.resolve(rules)),
          })),
          orderBy: mock(() => Promise.resolve(rules)),
        })),
      })),
    })),
    insert: mock(() => ({
      values: mock(() => ({
        returning: mock(() => Promise.resolve([createRule()])),
      })),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([createRule()])),
        })),
      })),
    })),
    delete: mock(() => ({
      where: mock(() => ({
        returning: mock(() => Promise.resolve([createRule()])),
      })),
    })),
  } as unknown as Database;
}

function createMockEventBus(): EventBus {
  return {
    publish: mock(() => Promise.resolve()),
    subscribe: mock(() => Promise.resolve({ unsubscribe: mock(() => {}) })),
    close: mock(() => Promise.resolve()),
  } as unknown as EventBus;
}

function createMockCache() {
  const store = new Map<string, unknown>();
  const cache = {
    _store: store,
    get: mock(async (key: string) => store.get(key) ?? null),
    set: mock(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    delete: mock(async (key: string) => {
      store.delete(key);
    }),
    has: mock(async (key: string) => store.has(key)),
    clear: mock(async () => {
      store.clear();
    }),
    stats: mock(async () => ({ hits: 0, misses: 0, size: 0, evictions: 0 })),
  };
  return cache as typeof cache & CacheProvider;
}

// ============================================================================
// Mode-Aware Access Control Tests
// ============================================================================

describe('AccessService', () => {
  describe('checkAccess - disabled mode', () => {
    test('always allows when mode is disabled, regardless of rules', async () => {
      const denyRule = createRule({ ruleType: 'deny', platformUserId: '+5511999@s.whatsapp.net' });
      const db = createMockDb([denyRule]);
      const service = new AccessService(db, null);

      const result = await service.checkAccess(createInstance('disabled'), '+5511999@s.whatsapp.net', 'whatsapp');

      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('disabled');
      expect(result.reason).toContain('disabled');
    });

    test('does not query DB when disabled', async () => {
      const db = createMockDb([]);
      const service = new AccessService(db, null);

      await service.checkAccess(createInstance('disabled'), '+5511999@s.whatsapp.net', 'whatsapp');

      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('checkAccess - blocklist mode', () => {
    test('allows when no rules match', async () => {
      const db = createMockDb([]);
      const service = new AccessService(db, null);

      const result = await service.checkAccess(createInstance('blocklist'), '+5511999@s.whatsapp.net', 'whatsapp');

      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('blocklist');
    });

    test('denies when deny rule matches', async () => {
      const denyRule = createRule({
        ruleType: 'deny',
        phonePattern: '+55*',
      });
      const db = createMockDb([denyRule]);
      const service = new AccessService(db, null);

      const result = await service.checkAccess(createInstance('blocklist'), '+5511999@s.whatsapp.net', 'whatsapp');

      expect(result.allowed).toBe(false);
      expect(result.mode).toBe('blocklist');
      expect(result.rule?.id).toBe('rule-1');
    });

    test('allows when allow rule matches with higher priority over deny', async () => {
      const rules = [
        createRule({ id: 'allow-1', ruleType: 'allow', platformUserId: '+5511999@s.whatsapp.net', priority: 10 }),
        createRule({ id: 'deny-1', ruleType: 'deny', phonePattern: '+55*', priority: 5 }),
      ];
      const db = createMockDb(rules);
      const service = new AccessService(db, null);

      const result = await service.checkAccess(createInstance('blocklist'), '+5511999@s.whatsapp.net', 'whatsapp');

      expect(result.allowed).toBe(true);
      expect(result.rule?.id).toBe('allow-1');
    });
  });

  describe('checkAccess - allowlist mode', () => {
    test('denies when no rules match', async () => {
      const db = createMockDb([]);
      const service = new AccessService(db, null);

      const result = await service.checkAccess(createInstance('allowlist'), '+5511999@s.whatsapp.net', 'whatsapp');

      expect(result.allowed).toBe(false);
      expect(result.mode).toBe('allowlist');
      expect(result.reason).toContain('default deny');
    });

    test('allows when allow rule matches', async () => {
      const allowRule = createRule({
        ruleType: 'allow',
        phonePattern: '+5511999*',
      });
      const db = createMockDb([allowRule]);
      const service = new AccessService(db, null);

      const result = await service.checkAccess(createInstance('allowlist'), '+5511999@s.whatsapp.net', 'whatsapp');

      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('allowlist');
    });

    test('denies non-matching users even with allow rules present', async () => {
      const allowRule = createRule({
        ruleType: 'allow',
        phonePattern: '+5511999*',
      });
      const db = createMockDb([allowRule]);
      const service = new AccessService(db, null);

      const result = await service.checkAccess(createInstance('allowlist'), '+5521888@s.whatsapp.net', 'whatsapp');

      expect(result.allowed).toBe(false);
      expect(result.mode).toBe('allowlist');
    });

    test('denies when deny rule has higher priority than allow rule for same user', async () => {
      const rules = [
        createRule({ id: 'deny-1', ruleType: 'deny', platformUserId: '+5511999@s.whatsapp.net', priority: 10 }),
        createRule({ id: 'allow-1', ruleType: 'allow', phonePattern: '+55*', priority: 5 }),
      ];
      const db = createMockDb(rules);
      const service = new AccessService(db, null);

      const result = await service.checkAccess(createInstance('allowlist'), '+5511999@s.whatsapp.net', 'whatsapp');

      expect(result.allowed).toBe(false);
      expect(result.rule?.id).toBe('deny-1');
    });
  });

  // ============================================================================
  // Pattern Matching Tests
  // ============================================================================

  describe('pattern matching', () => {
    test('exact platformUserId match', async () => {
      const rule = createRule({ ruleType: 'deny', platformUserId: '+5511999@s.whatsapp.net' });
      const db = createMockDb([rule]);
      const service = new AccessService(db, null);

      const result = await service.checkAccess(createInstance('blocklist'), '+5511999@s.whatsapp.net', 'whatsapp');
      expect(result.allowed).toBe(false);
    });

    test('wildcard +55* matches Brazilian numbers', async () => {
      const rule = createRule({ ruleType: 'deny', phonePattern: '+55*' });
      const db = createMockDb([rule]);
      const service = new AccessService(db, null);

      const result = await service.checkAccess(
        createInstance('blocklist'),
        '+5511999001234@s.whatsapp.net',
        'whatsapp',
      );
      expect(result.allowed).toBe(false);
    });

    test('wildcard *@g.us matches groups', async () => {
      const rule = createRule({ ruleType: 'deny', phonePattern: '*@g.us' });
      const db = createMockDb([rule]);
      const service = new AccessService(db, null);

      const result = await service.checkAccess(createInstance('blocklist'), '120363025@g.us', 'whatsapp');
      expect(result.allowed).toBe(false);
    });

    test('non-matching pattern returns false', async () => {
      const rule = createRule({ ruleType: 'deny', phonePattern: '+1*' });
      const db = createMockDb([rule]);
      const service = new AccessService(db, null);

      const result = await service.checkAccess(createInstance('blocklist'), '+5511999@s.whatsapp.net', 'whatsapp');
      expect(result.allowed).toBe(true);
    });
  });

  // ============================================================================
  // Priority & Tie-breaking Tests
  // ============================================================================

  describe('priority and tie-breaking', () => {
    test('higher priority rule wins', async () => {
      const rules = [
        createRule({ id: 'high', ruleType: 'allow', platformUserId: 'user1', priority: 10 }),
        createRule({ id: 'low', ruleType: 'deny', platformUserId: 'user1', priority: 5 }),
      ];
      const db = createMockDb(rules);
      const service = new AccessService(db, null);

      const result = await service.checkAccess(createInstance('blocklist'), 'user1', 'discord');
      expect(result.allowed).toBe(true);
      expect(result.rule?.id).toBe('high');
    });

    test('same priority: newer rule wins (first in desc createdAt order)', async () => {
      const rules = [
        createRule({
          id: 'newer',
          ruleType: 'deny',
          platformUserId: 'user1',
          priority: 5,
          createdAt: new Date('2026-02-01'),
        }),
        createRule({
          id: 'older',
          ruleType: 'allow',
          platformUserId: 'user1',
          priority: 5,
          createdAt: new Date('2026-01-01'),
        }),
      ];
      const db = createMockDb(rules);
      const service = new AccessService(db, null);

      const result = await service.checkAccess(createInstance('blocklist'), 'user1', 'discord');
      // The "newer" rule is first in the array (as DB returns desc createdAt), so it wins
      expect(result.rule?.id).toBe('newer');
      expect(result.allowed).toBe(false);
    });
  });

  // ============================================================================
  // Cache Tests
  // ============================================================================

  describe('caching', () => {
    test('second call returns cached result (no DB query)', async () => {
      const rule = createRule({ ruleType: 'deny', platformUserId: 'user1' });
      const db = createMockDb([rule]);
      const cache = createMockCache();
      const service = new AccessService(db, null, cache);
      const instance = createInstance('blocklist');

      // First call: hits DB
      const result1 = await service.checkAccess(instance, 'user1', 'whatsapp');
      expect(result1.allowed).toBe(false);

      // Reset mock to track second call
      const selectCallCount = (db.select as ReturnType<typeof mock>).mock.calls.length;

      // Second call: should come from cache
      const result2 = await service.checkAccess(instance, 'user1', 'whatsapp');
      expect(result2.allowed).toBe(false);
      expect((db.select as ReturnType<typeof mock>).mock.calls.length).toBe(selectCallCount); // No new DB calls
    });

    test('create() clears cache', async () => {
      const cache = createMockCache();
      const db = createMockDb([]);
      const service = new AccessService(db, null, cache);

      // Populate cache
      cache._store.set('access:inst-1:user1', { allowed: true, reason: 'cached', mode: 'blocklist' as const });

      await service.create({
        instanceId: 'inst-1',
        ruleType: 'deny',
        priority: 0,
        enabled: true,
        action: 'block',
      });

      expect(cache.clear).toHaveBeenCalled();
    });

    test('update() clears cache', async () => {
      const cache = createMockCache();
      const rule = createRule();
      const db = createMockDb([rule]);
      // Make update return a rule
      (db.update as ReturnType<typeof mock>).mockReturnValue({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(() => Promise.resolve([rule])),
          })),
        })),
      });
      const service = new AccessService(db, null, cache);

      await service.update('rule-1', { priority: 10 });

      expect(cache.clear).toHaveBeenCalled();
    });

    test('delete() clears cache', async () => {
      const cache = createMockCache();
      const db = createMockDb([]);
      // Make delete return something
      (db.delete as ReturnType<typeof mock>).mockReturnValue({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([createRule()])),
        })),
      });
      const service = new AccessService(db, null, cache);

      await service.delete('rule-1');

      expect(cache.clear).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Event Publishing Tests
  // ============================================================================

  describe('event publishing', () => {
    test('publishes access.denied on deny', async () => {
      const rule = createRule({ ruleType: 'deny', platformUserId: 'user1' });
      const db = createMockDb([rule]);
      const eventBus = createMockEventBus();
      const service = new AccessService(db, eventBus);

      await service.checkAccess(createInstance('blocklist'), 'user1', 'whatsapp');

      expect(eventBus.publish).toHaveBeenCalledWith(
        'access.denied',
        expect.objectContaining({
          instanceId: 'inst-1',
          platformUserId: 'user1',
          ruleId: 'rule-1',
        }),
      );
    });

    test('publishes access.allowed on allow rule', async () => {
      const rule = createRule({ ruleType: 'allow', platformUserId: 'user1' });
      const db = createMockDb([rule]);
      const eventBus = createMockEventBus();
      const service = new AccessService(db, eventBus);

      await service.checkAccess(createInstance('blocklist'), 'user1', 'whatsapp');

      expect(eventBus.publish).toHaveBeenCalledWith(
        'access.allowed',
        expect.objectContaining({
          instanceId: 'inst-1',
          platformUserId: 'user1',
          ruleId: 'rule-1',
        }),
      );
    });

    test('publishes default deny for allowlist with no matching rules', async () => {
      const db = createMockDb([]);
      const eventBus = createMockEventBus();
      const service = new AccessService(db, eventBus);

      await service.checkAccess(createInstance('allowlist'), 'unknown-user', 'whatsapp');

      expect(eventBus.publish).toHaveBeenCalledWith(
        'access.denied',
        expect.objectContaining({
          instanceId: 'inst-1',
          platformUserId: 'unknown-user',
          reason: 'Not in allowlist',
        }),
      );
    });

    test('does not publish events when eventBus is null', async () => {
      const rule = createRule({ ruleType: 'deny', platformUserId: 'user1' });
      const db = createMockDb([rule]);
      const service = new AccessService(db, null);

      // Should not throw
      const result = await service.checkAccess(createInstance('blocklist'), 'user1', 'whatsapp');
      expect(result.allowed).toBe(false);
    });
  });

  // ============================================================================
  // Result shape tests
  // ============================================================================

  describe('result shape', () => {
    test('includes mode in result', async () => {
      const db = createMockDb([]);
      const service = new AccessService(db, null);

      const blocklist = await service.checkAccess(createInstance('blocklist'), 'u', 'w');
      expect(blocklist.mode).toBe('blocklist');

      const allowlist = await service.checkAccess(createInstance('allowlist'), 'u', 'w');
      expect(allowlist.mode).toBe('allowlist');

      const disabled = await service.checkAccess(createInstance('disabled'), 'u', 'w');
      expect(disabled.mode).toBe('disabled');
    });
  });
});
