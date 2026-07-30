/**
 * Pure-logic tests for legacy API-key classification (Group G6). No server.
 */

import { describe, expect, test } from 'bun:test';
import { type LegacyKeyFacts, classifyKey, isUnrestricted } from './key-classification';
import type { InstanceTenantMap } from './mapping-engine';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INST_A1 = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const INST_A2 = 'aaaaaaaa-0000-4000-8000-0000000000a2';
const INST_B1 = 'aaaaaaaa-0000-4000-8000-0000000000b1';
const INST_UNMAPPED = 'aaaaaaaa-0000-4000-8000-0000000000ff';

const map: InstanceTenantMap = new Map([
  [INST_A1, TENANT_A],
  [INST_A2, TENANT_A],
  [INST_B1, TENANT_B],
]);

function key(over: Partial<LegacyKeyFacts>): LegacyKeyFacts {
  return {
    id: 'k1',
    name: 'key',
    keyPrefix: 'omni_sk_ab',
    scopes: ['messages:read'],
    instanceIds: null,
    instanceAllowlist: null,
    status: 'active',
    ...over,
  };
}

describe('key classification', () => {
  test('god scope (*) -> platform-credential, owner+purpose required', () => {
    const c = classifyKey(key({ scopes: ['*'], instanceIds: [INST_A1] }), map);
    expect(c.classification).toBe('platform-credential');
    expect(c.requiresOwnerAndPurpose).toBe(true);
  });

  test('no instance restriction -> platform-credential', () => {
    expect(isUnrestricted(key({ instanceIds: [], instanceAllowlist: [] }))).toBe(true);
    const c = classifyKey(key({ instanceIds: null, instanceAllowlist: null }), map);
    expect(c.classification).toBe('platform-credential');
  });

  test('all restricted instances map to ONE tenant -> tenant-key candidate', () => {
    const c = classifyKey(key({ instanceIds: [INST_A1, INST_A2] }), map);
    expect(c.classification).toBe('tenant-key-candidate');
    expect(c.tenants).toEqual([TENANT_A]);
    expect(c.requiresOwnerAndPurpose).toBe(false);
  });

  test('instances spanning tenants -> multi-tenant worklist, never auto-converted', () => {
    const c = classifyKey(key({ instanceIds: [INST_A1, INST_B1] }), map);
    expect(c.classification).toBe('multi-tenant');
    expect([...c.tenants].sort()).toEqual([TENANT_A, TENANT_B].sort());
  });

  test('an unmapped instance -> unresolved (quarantine), never a tenant key', () => {
    const c = classifyKey(key({ instanceIds: [INST_A1, INST_UNMAPPED] }), map);
    expect(c.classification).toBe('unresolved');
    expect(c.unmappedInstances).toEqual([INST_UNMAPPED]);
  });

  test('classification output carries no hash field', () => {
    const c = classifyKey(key({ instanceIds: [INST_A1] }), map);
    expect(Object.keys(c)).not.toContain('keyHash');
    expect(JSON.stringify(c)).not.toMatch(/hash/i);
  });
});
