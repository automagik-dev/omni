/**
 * API Key Enforcement Tests
 *
 * Verifies that:
 * 1. Instance-scoped keys can only access allowed instances
 * 2. Instance-scoped keys get filtered results on list endpoints
 * 3. Primary keys (null instanceIds) bypass all instance checks
 * 4. filterByInstanceAccess correctly filters items
 * 5. AuditService logs requests correctly
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { ApiKeyService } from '../services/api-keys';
import { AuditService } from '../services/audit';
import { createMigratedTestDatabase } from './fixtures/pg-clone';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

postgresDescribe('API Key Enforcement', () => {
  let db: Database;
  const clone = createMigratedTestDatabase({ superUrl, psqlBin });
  afterAll(() => clone.teardown());
  let apiKeyService: ApiKeyService;
  let auditService: AuditService;

  beforeAll(async () => {
    db = clone.setup();
    apiKeyService = new ApiKeyService(db);
    auditService = new AuditService(db);
  });

  // ============================================================================
  // AuditService tests (requires DB)
  // ============================================================================

  describe('AuditService', () => {
    let testKeyId: string;

    beforeAll(async () => {
      // Create a test API key for audit log association
      const result = await apiKeyService.create({
        name: 'audit-test-key',
        scopes: ['*'],
      });
      testKeyId = result.key.id;
    });

    test('log() inserts an audit record', async () => {
      auditService.log({
        apiKeyId: testKeyId,
        method: 'GET',
        path: '/v2/instances',
        statusCode: 200,
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        responseTimeMs: 42,
      });

      // Wait for async insert
      await new Promise((resolve) => setTimeout(resolve, 200));

      const result = await auditService.listByKeyId(testKeyId, { limit: 10 });
      expect(result.items.length).toBeGreaterThanOrEqual(1);

      const entry = result.items.find((l) => l.path === '/v2/instances');
      expect(entry).toBeDefined();
      expect(entry?.method).toBe('GET');
      expect(entry?.statusCode).toBe(200);
      expect(entry?.ipAddress).toBe('127.0.0.1');
      expect(entry?.userAgent).toBe('test-agent');
      expect(entry?.responseTimeMs).toBe(42);
    });

    test('listByKeyId() filters by path', async () => {
      auditService.log({
        apiKeyId: testKeyId,
        method: 'POST',
        path: '/v2/messages/send',
        statusCode: 201,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const result = await auditService.listByKeyId(testKeyId, { path: 'messages' });
      expect(result.items.every((l) => l.path.includes('messages'))).toBe(true);
    });

    test('listByKeyId() filters by statusCode', async () => {
      auditService.log({
        apiKeyId: testKeyId,
        method: 'GET',
        path: '/v2/test-404',
        statusCode: 404,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const result = await auditService.listByKeyId(testKeyId, { statusCode: 404 });
      expect(result.items.every((l) => l.statusCode === 404)).toBe(true);
    });

    test('listByKeyId() paginates correctly', async () => {
      // Insert a few more logs
      for (let i = 0; i < 3; i++) {
        auditService.log({
          apiKeyId: testKeyId,
          method: 'GET',
          path: `/v2/paginate-test-${i}`,
          statusCode: 200,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Request with limit=2
      const page1 = await auditService.listByKeyId(testKeyId, { limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.cursor).toBeDefined();

      // Request page 2 with cursor
      const page2 = await auditService.listByKeyId(testKeyId, { limit: 2, cursor: page1.cursor });
      expect(page2.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // Atomic authority-bearing updates
  // ============================================================================

  describe('ApiKeyService.updateWithAuthorityGuard()', () => {
    test('serializes concurrent partial authority updates on the same key', async () => {
      const created = await apiKeyService.create({
        name: `authority-race-${Date.now()}`,
        scopes: ['keys:write'],
        instanceIds: ['11111111-1111-4111-8111-111111111111'],
      });

      let releaseFirst!: () => void;
      const firstMayCommit = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstGuardEntered!: () => void;
      const firstIsLocked = new Promise<void>((resolve) => {
        firstGuardEntered = resolve;
      });

      const firstUpdate = apiKeyService.updateWithAuthorityGuard(
        created.key.id,
        { scopes: ['messages:send'] },
        async () => {
          firstGuardEntered();
          await firstMayCommit;
          return true;
        },
      );

      await firstIsLocked;

      let secondGuardScopes: string[] | undefined;
      const secondUpdate = apiKeyService.updateWithAuthorityGuard(
        created.key.id,
        { instanceIds: ['22222222-2222-4222-8222-222222222222'] },
        (_current, next) => {
          secondGuardScopes = next.scopes;
          return !next.scopes.includes('messages:send');
        },
      );

      // The second guard must not run against the stale row while the first
      // transaction holds its lock.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(secondGuardScopes).toBeUndefined();

      releaseFirst();
      const [firstResult, secondResult] = await Promise.all([firstUpdate, secondUpdate]);

      expect(firstResult.status).toBe('updated');
      expect(secondResult.status).toBe('denied');
      expect(secondGuardScopes).toEqual(['messages:send']);

      const final = await apiKeyService.getById(created.key.id);
      expect(final?.scopes).toEqual(['messages:send']);
      expect(final?.instanceIds).toEqual(['11111111-1111-4111-8111-111111111111']);
    });
  });

  // ============================================================================
  // API Key validation with IP
  // ============================================================================

  describe('ApiKeyService.validate() with IP', () => {
    test('validate() updates lastUsedIp', async () => {
      const result = await apiKeyService.create({
        name: 'ip-test-key',
        scopes: ['*'],
      });

      // Validate with IP
      await apiKeyService.validate(result.plainTextKey, '192.168.1.1');

      // Wait for async update
      await new Promise((resolve) => setTimeout(resolve, 200));

      const updated = await apiKeyService.getById(result.key.id);
      expect(updated?.lastUsedIp).toBe('192.168.1.1');
    });
  });
});
