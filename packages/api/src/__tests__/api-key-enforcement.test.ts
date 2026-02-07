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
import { apiKeyAuditLogs, apiKeys, instances } from '@omni/db';
import { eq } from 'drizzle-orm';
import { filterByInstanceAccess } from '../middleware/auth';
import { ApiKeyService } from '../services/api-keys';
import { AuditService } from '../services/audit';
import type { ApiKeyData } from '../types';
import { describeWithDb, getTestDb } from './db-helper';

describeWithDb('API Key Enforcement', () => {
  let db: Database;
  let apiKeyService: ApiKeyService;
  let auditService: AuditService;
  const cleanupIds: { keys: string[]; instances: string[]; auditLogs: string[] } = {
    keys: [],
    instances: [],
    auditLogs: [],
  };

  beforeAll(async () => {
    db = getTestDb();
    apiKeyService = new ApiKeyService(db);
    auditService = new AuditService(db);
  });

  afterAll(async () => {
    // Clean up in reverse dependency order
    for (const id of cleanupIds.auditLogs) {
      await db
        .delete(apiKeyAuditLogs)
        .where(eq(apiKeyAuditLogs.id, id))
        .catch(() => {});
    }
    for (const id of cleanupIds.keys) {
      await db
        .delete(apiKeys)
        .where(eq(apiKeys.id, id))
        .catch(() => {});
    }
    for (const id of cleanupIds.instances) {
      await db
        .delete(instances)
        .where(eq(instances.id, id))
        .catch(() => {});
    }
  });

  // ============================================================================
  // Static method tests (no DB needed)
  // ============================================================================

  describe('ApiKeyService.instanceAllowed()', () => {
    test('null instanceIds allows access to any instance', () => {
      expect(ApiKeyService.instanceAllowed(null, 'any-id')).toBe(true);
    });

    test('matching instanceId allows access', () => {
      expect(ApiKeyService.instanceAllowed(['id-1', 'id-2'], 'id-1')).toBe(true);
    });

    test('non-matching instanceId denies access', () => {
      expect(ApiKeyService.instanceAllowed(['id-1', 'id-2'], 'id-3')).toBe(false);
    });

    test('empty array denies access to everything', () => {
      expect(ApiKeyService.instanceAllowed([], 'any-id')).toBe(false);
    });
  });

  describe('ApiKeyService.scopeAllows()', () => {
    test('wildcard scope allows everything', () => {
      expect(ApiKeyService.scopeAllows(['*'], 'instances:read')).toBe(true);
    });

    test('exact match allows access', () => {
      expect(ApiKeyService.scopeAllows(['instances:read'], 'instances:read')).toBe(true);
    });

    test('namespace wildcard allows sub-scopes', () => {
      expect(ApiKeyService.scopeAllows(['instances:*'], 'instances:read')).toBe(true);
      expect(ApiKeyService.scopeAllows(['instances:*'], 'instances:write')).toBe(true);
    });

    test('mismatched scope denies access', () => {
      expect(ApiKeyService.scopeAllows(['instances:read'], 'messages:read')).toBe(false);
    });
  });

  // ============================================================================
  // filterByInstanceAccess tests
  // ============================================================================

  describe('filterByInstanceAccess()', () => {
    test('null instanceIds returns all items', () => {
      const apiKey: ApiKeyData = { id: 'k1', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null };
      const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      const result = filterByInstanceAccess(items, (i) => i.id, apiKey);
      expect(result).toHaveLength(3);
    });

    test('filters to allowed instances only', () => {
      const apiKey: ApiKeyData = {
        id: 'k1',
        name: 'test',
        scopes: ['*'],
        instanceIds: ['a', 'c'],
        expiresAt: null,
      };
      const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      const result = filterByInstanceAccess(items, (i) => i.id, apiKey);
      expect(result).toHaveLength(2);
      expect(result.map((i) => i.id)).toEqual(['a', 'c']);
    });

    test('empty instanceIds returns no items', () => {
      const apiKey: ApiKeyData = { id: 'k1', name: 'test', scopes: ['*'], instanceIds: [], expiresAt: null };
      const items = [{ id: 'a' }, { id: 'b' }];
      const result = filterByInstanceAccess(items, (i) => i.id, apiKey);
      expect(result).toHaveLength(0);
    });
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
      cleanupIds.keys.push(testKeyId);
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

      // Track for cleanup
      for (const item of result.items) {
        cleanupIds.auditLogs.push(item.id);
      }
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

      for (const item of result.items) {
        cleanupIds.auditLogs.push(item.id);
      }
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

      for (const item of result.items) {
        cleanupIds.auditLogs.push(item.id);
      }
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

      for (const item of [...page1.items, ...page2.items]) {
        cleanupIds.auditLogs.push(item.id);
      }
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
      cleanupIds.keys.push(result.key.id);

      // Validate with IP
      await apiKeyService.validate(result.plainTextKey, '192.168.1.1');

      // Wait for async update
      await new Promise((resolve) => setTimeout(resolve, 200));

      const updated = await apiKeyService.getById(result.key.id);
      expect(updated?.lastUsedIp).toBe('192.168.1.1');
    });
  });
});
