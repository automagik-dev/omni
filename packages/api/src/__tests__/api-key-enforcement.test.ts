/** API key scope enforcement without a database connection. */
import { describe, expect, test } from 'bun:test';
import { filterByInstanceAccess } from '../middleware/auth';
import { ApiKeyService } from '../services/api-keys';
import type { ApiKeyData } from '../types';

describe('API Key Enforcement', () => {
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
});
