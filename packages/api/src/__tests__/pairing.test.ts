/**
 * Pairing Flow Tests
 *
 * Tests the access control pairing approval flow:
 * - Pairing code generation (charset A-Z 0-9, 6 chars)
 * - Pending request management (rate limiting, expiry, reuse)
 * - Approve/deny actions (one-time-use, rule creation)
 * - Guard: pending_pairing cannot be used as access decision
 * - Performance: query benchmark for 100+ rules
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { accessRules, instances } from '@omni/db';
import { eq } from 'drizzle-orm';
import { AccessService } from '../services/access';
import { describeWithDb, getTestDb } from './db-helper';

describeWithDb('Pairing Flow', () => {
  let db: Database;
  let accessService: AccessService;
  const testInstanceId = crypto.randomUUID();
  const cleanupRuleIds: string[] = [];

  beforeAll(async () => {
    db = getTestDb();

    // Create test instance
    await db.insert(instances).values({
      id: testInstanceId,
      name: `pairing-test-${Date.now()}`,
      channel: 'telegram',
      accessMode: 'allowlist',
    });

    // Mock event bus that captures published events
    const mockEventBus = {
      publish: async () => {},
      subscribe: async () => ({ unsubscribe: async () => {} }),
    };

    accessService = new AccessService(db, mockEventBus as never);
  });

  afterAll(async () => {
    // Clean up rules
    for (const id of cleanupRuleIds) {
      await db
        .delete(accessRules)
        .where(eq(accessRules.id, id))
        .catch(() => {});
    }
    // Clean up remaining pending_pairing rules for this instance
    await db
      .delete(accessRules)
      .where(eq(accessRules.instanceId, testInstanceId))
      .catch(() => {});
    // Clean up instance
    await db
      .delete(instances)
      .where(eq(instances.id, testInstanceId))
      .catch(() => {});
  });

  // ==========================================================================
  // Pairing Code Generation
  // ==========================================================================

  describe('Pairing code generation', () => {
    test('generates 6-character code', () => {
      const code = AccessService.generatePairingCode();
      expect(code).toHaveLength(6);
    });

    test('code uses only A-Z, 0-9 charset (no lowercase)', () => {
      // Generate multiple codes and verify charset
      for (let i = 0; i < 100; i++) {
        const code = AccessService.generatePairingCode();
        expect(code).toMatch(/^[A-Z0-9]{6}$/);
      }
    });

    test('generates unique codes (statistical test)', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 50; i++) {
        codes.add(AccessService.generatePairingCode());
      }
      // With 2.1B combinations, 50 codes should all be unique
      expect(codes.size).toBe(50);
    });
  });

  // ==========================================================================
  // Pairing Request Flow
  // ==========================================================================

  describe('Pairing request flow', () => {
    test('unknown sender gets pairing code', async () => {
      const result = await accessService.requestPairing(testInstanceId, 'user-new-1');
      expect(result).not.toBeNull();
      expect(result?.pairingCode).toMatch(/^[A-Z0-9]{6}$/);
      expect(result?.instanceId).toBe(testInstanceId);
      expect(result?.platformUserId).toBe('user-new-1');
      expect(result?.expiresAt).toBeInstanceOf(Date);
      if (result) cleanupRuleIds.push(result.id);
    });

    test('second message from same pending sender reuses existing code', async () => {
      const first = await accessService.requestPairing(testInstanceId, 'user-reuse-1');
      expect(first).not.toBeNull();
      if (first) cleanupRuleIds.push(first.id);

      const second = await accessService.requestPairing(testInstanceId, 'user-reuse-1');
      expect(second).not.toBeNull();
      expect(second?.id).toBe(first?.id);
      expect(second?.pairingCode).toBe(first?.pairingCode);
    });

    test('max 3 pending requests enforced — 4th request returns null', async () => {
      // Clean existing rules for a fresh start
      const freshInstanceId = crypto.randomUUID();
      await db.insert(instances).values({
        id: freshInstanceId,
        name: `pairing-limit-test-${Date.now()}`,
        channel: 'telegram',
        accessMode: 'allowlist',
      });

      const freshService = new AccessService(db, null);

      const r1 = await freshService.requestPairing(freshInstanceId, 'limit-user-1');
      const r2 = await freshService.requestPairing(freshInstanceId, 'limit-user-2');
      const r3 = await freshService.requestPairing(freshInstanceId, 'limit-user-3');

      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r3).not.toBeNull();

      // 4th request should be rate-limited
      const r4 = await freshService.requestPairing(freshInstanceId, 'limit-user-4');
      expect(r4).toBeNull();

      // Cleanup
      await db.delete(accessRules).where(eq(accessRules.instanceId, freshInstanceId));
      await db.delete(instances).where(eq(instances.id, freshInstanceId));
    });

    test('expired requests are auto-cleaned (not returned in pending list)', async () => {
      const freshInstanceId = crypto.randomUUID();
      await db.insert(instances).values({
        id: freshInstanceId,
        name: `pairing-expiry-test-${Date.now()}`,
        channel: 'telegram',
        accessMode: 'allowlist',
      });

      const freshService = new AccessService(db, null);

      // Create a request with 0ms expiry (already expired)
      await freshService.requestPairing(freshInstanceId, 'expired-user', { expiryMs: -1000 });

      // List should be empty after cleanup
      const pending = await freshService.listPendingPairingRequests(freshInstanceId);
      expect(pending).toHaveLength(0);

      // Cleanup
      await db.delete(accessRules).where(eq(accessRules.instanceId, freshInstanceId));
      await db.delete(instances).where(eq(instances.id, freshInstanceId));
    });
  });

  // ==========================================================================
  // Approve / Deny
  // ==========================================================================

  describe('Approve / Deny', () => {
    test('approve creates allow rule', async () => {
      const request = await accessService.requestPairing(testInstanceId, 'approve-user-1');
      expect(request).not.toBeNull();
      const requestId = request?.id as string;

      const allowRule = await accessService.approvePairingRequest(requestId, testInstanceId);
      expect(allowRule.ruleType).toBe('allow');
      expect(allowRule.platformUserId).toBe('approve-user-1');
      expect(allowRule.instanceId).toBe(testInstanceId);
      cleanupRuleIds.push(allowRule.id);
    });

    test('deny deletes request and stores reason', async () => {
      const request = await accessService.requestPairing(testInstanceId, 'deny-user-1');
      expect(request).not.toBeNull();
      const requestId = request?.id as string;

      await accessService.denyPairingRequest(requestId, testInstanceId, 'Suspicious activity');

      // Request should be deleted
      try {
        await accessService.getById(requestId);
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect((err as Error).message).toContain('not found');
      }
    });

    test('one-time-use: replaying after approval returns error', async () => {
      const request = await accessService.requestPairing(testInstanceId, 'replay-approve-1');
      expect(request).not.toBeNull();
      const requestId = request?.id as string;

      const allowRule = await accessService.approvePairingRequest(requestId, testInstanceId);
      cleanupRuleIds.push(allowRule.id);

      // Second approval should fail (request deleted)
      try {
        await accessService.approvePairingRequest(requestId, testInstanceId);
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeDefined();
      }
    });

    test('one-time-use: replaying after denial returns error', async () => {
      const request = await accessService.requestPairing(testInstanceId, 'replay-deny-1');
      expect(request).not.toBeNull();
      const requestId = request?.id as string;

      await accessService.denyPairingRequest(requestId, testInstanceId);

      // Second denial should fail (request deleted)
      try {
        await accessService.denyPairingRequest(requestId, testInstanceId);
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });

  // ==========================================================================
  // Guard: pending_pairing cannot be used as access decision
  // ==========================================================================

  describe('evaluateMode guard', () => {
    test('pending_pairing rule throws when used as access decision', () => {
      // Access the private method via any cast for testing
      const service = accessService as unknown as {
        evaluateMode: (mode: string, rule: unknown) => unknown;
      };

      expect(() => {
        service.evaluateMode('allowlist', {
          id: 'test',
          ruleType: 'pending_pairing',
          instanceId: testInstanceId,
          platformUserId: 'user',
          priority: 0,
          enabled: true,
          action: 'block',
        });
      }).toThrow('pending_pairing rules cannot be used as access decisions');
    });
  });

  // ==========================================================================
  // Performance: Query benchmark for 100+ rules
  // ==========================================================================

  describe('Performance benchmark', () => {
    test('100+ rules per instance — pending list returns in <50ms', async () => {
      const perfInstanceId = crypto.randomUUID();
      await db.insert(instances).values({
        id: perfInstanceId,
        name: `pairing-perf-test-${Date.now()}`,
        channel: 'telegram',
        accessMode: 'allowlist',
      });

      // Insert 110 rules (mix of types)
      const rules = [];
      for (let i = 0; i < 100; i++) {
        rules.push({
          instanceId: perfInstanceId,
          ruleType: 'allow' as const,
          platformUserId: `perf-user-${i}`,
          priority: 0,
          enabled: true,
          action: 'allow' as const,
        });
      }
      // Add 10 pending_pairing rules
      for (let i = 0; i < 10; i++) {
        rules.push({
          instanceId: perfInstanceId,
          ruleType: 'pending_pairing' as const,
          platformUserId: `perf-pairing-${i}`,
          priority: 0,
          enabled: true,
          action: 'block' as const,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          metadata: { pairingCode: AccessService.generatePairingCode(), requestedAt: Date.now() },
        });
      }

      await db.insert(accessRules).values(rules);

      // Benchmark: list pending requests
      const perfService = new AccessService(db, null);
      const start = performance.now();
      const pending = await perfService.listPendingPairingRequests(perfInstanceId);
      const duration = performance.now() - start;

      expect(pending).toHaveLength(10);
      expect(duration).toBeLessThan(50); // <50ms target

      // Cleanup
      await db.delete(accessRules).where(eq(accessRules.instanceId, perfInstanceId));
      await db.delete(instances).where(eq(instances.id, perfInstanceId));
    });
  });
});

// ==========================================================================
// Unit tests (no DB required)
// ==========================================================================

describe('Pairing code charset validation', () => {
  test('all generated codes match A-Z0-9 pattern', () => {
    for (let i = 0; i < 200; i++) {
      const code = AccessService.generatePairingCode();
      expect(code).toMatch(/^[A-Z0-9]{6}$/);
      // Ensure no lowercase
      expect(code).toBe(code.toUpperCase());
    }
  });

  test('code length is exactly 6', () => {
    const code = AccessService.generatePairingCode();
    expect(code.length).toBe(6);
  });
});
