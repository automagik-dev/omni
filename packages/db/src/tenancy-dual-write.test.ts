/**
 * Trusted dual-write derivation contract (wish: omni-full-multitenancy, G2).
 *
 * These pin the derivation PRECEDENCE and the trust boundary. The same rules are
 * proved end to end against real PostgreSQL in `tenancy-postgres.test.ts`; here
 * they are exercised directly so a regression names the exact rule it broke.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  CrossTenantOwnershipError,
  UNTRUSTED_TENANT_SOURCES,
  acceptsTrustedOwnership,
  deriveTenantOwnership,
  owningParentsOf,
  trustedInstanceOwnership,
} from './tenancy-dual-write';
import { OWNERSHIP_ROOT_TABLES } from './tenancy-ownership';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

describe('derivation precedence', () => {
  test('no applicable parents -> NULL', () => {
    expect(deriveTenantOwnership('chats', [])).toBeNull();
    expect(deriveTenantOwnership('chats', [{ column: 'instance_id', parentId: null, tenantId: null }])).toBeNull();
  });

  test('a NULL parent id is not applicable even when other parents are owned', () => {
    expect(
      deriveTenantOwnership('chats', [
        { column: 'instance_id', parentId: 'i1', tenantId: TENANT_A },
        { column: 'conversation_id', parentId: null, tenantId: TENANT_B },
      ]),
    ).toBe(TENANT_A);
  });

  test('a single owned parent propagates exactly', () => {
    expect(deriveTenantOwnership('chats', [{ column: 'instance_id', parentId: 'i1', tenantId: TENANT_A }])).toBe(
      TENANT_A,
    );
  });

  test('equal non-null parents propagate exactly', () => {
    expect(
      deriveTenantOwnership('agent_routes', [
        { column: 'instance_id', parentId: 'i1', tenantId: TENANT_A },
        { column: 'chat_id', parentId: 'c1', tenantId: TENANT_A },
        { column: 'agent_id', parentId: 'a1', tenantId: TENANT_A },
      ]),
    ).toBe(TENANT_A);
  });

  test('mixed known/NULL parents stay NULL — ownership is never written above a NULL-owner parent', () => {
    expect(
      deriveTenantOwnership('agent_routes', [
        { column: 'instance_id', parentId: 'i1', tenantId: TENANT_A },
        { column: 'chat_id', parentId: 'c1', tenantId: null },
      ]),
    ).toBeNull();
  });

  test('a legacy NULL-owner parent yields NULL regardless of parent order', () => {
    expect(
      deriveTenantOwnership('agent_routes', [
        { column: 'chat_id', parentId: 'c1', tenantId: null },
        { column: 'instance_id', parentId: 'i1', tenantId: TENANT_A },
      ]),
    ).toBeNull();
  });

  test('disagreeing non-null parents are rejected', () => {
    expect(() =>
      deriveTenantOwnership('agent_routes', [
        { column: 'instance_id', parentId: 'i1', tenantId: TENANT_A },
        { column: 'chat_id', parentId: 'c1', tenantId: TENANT_B },
      ]),
    ).toThrow(CrossTenantOwnershipError);
  });

  test('rejection wins over NULL propagation when both conditions are present', () => {
    expect(() =>
      deriveTenantOwnership('omni_events', [
        { column: 'instance_id', parentId: 'i1', tenantId: TENANT_A },
        { column: 'person_id', parentId: 'p1', tenantId: null },
        { column: 'chat_uuid', parentId: 'c1', tenantId: TENANT_B },
      ]),
    ).toThrow(CrossTenantOwnershipError);
  });
});

describe('trust boundary', () => {
  test('instances is the only table that may accept a caller-provided tenant id', () => {
    expect(OWNERSHIP_ROOT_TABLES).toEqual(['instances']);
    expect(acceptsTrustedOwnership('instances')).toBe(true);
    for (const table of ['chats', 'messages', 'persons', 'agent_routes', 'processed_events']) {
      expect(acceptsTrustedOwnership(table)).toBe(false);
    }
  });

  test('no context -> no ownership, so an old-shaped write behaves exactly as at HEAD', () => {
    expect(trustedInstanceOwnership(undefined)).toBeUndefined();
  });

  test('an auth-plane context establishes root ownership', () => {
    expect(trustedInstanceOwnership({ tenantId: TENANT_A, source: 'auth-plane' })).toEqual({ tenantId: TENANT_A });
  });

  test('a tenant id from any request-derived source is rejected, not silently used', () => {
    for (const source of UNTRUSTED_TENANT_SOURCES) {
      expect(() =>
        trustedInstanceOwnership({ tenantId: TENANT_B, source } as unknown as Parameters<
          typeof trustedInstanceOwnership
        >[0]),
      ).toThrow(TypeError);
    }
  });

  test('an empty or non-string tenant id is rejected', () => {
    expect(() => trustedInstanceOwnership({ tenantId: '', source: 'auth-plane' })).toThrow(TypeError);
    expect(() => trustedInstanceOwnership({ tenantId: 42 as unknown as string, source: 'auth-plane' })).toThrow(
      TypeError,
    );
  });

  test('owning parents come from the frozen spec, not from a caller', () => {
    expect(owningParentsOf('chats').map((p) => p.column)).toEqual(['instance_id', 'conversation_id']);
    expect(owningParentsOf('instances')).toEqual([]);
    expect(owningParentsOf('not_a_table')).toEqual([]);
  });
});

describe('the feature flag does not gate dual-write', () => {
  const original = process.env.OMNI_MULTITENANCY_ENABLED;
  afterEach(() => {
    // biome-ignore lint/performance/noDelete: env-var cleanup must remove the key, not set it to "undefined" (string)
    if (original === undefined) delete process.env.OMNI_MULTITENANCY_ENABLED;
    else process.env.OMNI_MULTITENANCY_ENABLED = original;
  });

  for (const flag of [undefined, 'false', 'true']) {
    test(`derivation and root ownership are identical with the flag ${flag ?? 'unset'}`, () => {
      // biome-ignore lint/performance/noDelete: env-var cleanup must remove the key, not set it to "undefined" (string)
      if (flag === undefined) delete process.env.OMNI_MULTITENANCY_ENABLED;
      else process.env.OMNI_MULTITENANCY_ENABLED = flag;

      expect(deriveTenantOwnership('chats', [{ column: 'instance_id', parentId: 'i1', tenantId: TENANT_A }])).toBe(
        TENANT_A,
      );
      expect(deriveTenantOwnership('chats', [{ column: 'instance_id', parentId: 'i1', tenantId: null }])).toBeNull();
      expect(trustedInstanceOwnership({ tenantId: TENANT_A, source: 'auth-plane' })).toEqual({ tenantId: TENANT_A });
      expect(trustedInstanceOwnership(undefined)).toBeUndefined();
    });
  }
});

describe('no untrusted source is referenced by the derivation module', () => {
  test('the module never reads request, header, or quarantined env tenant surfaces', async () => {
    const source = await Bun.file(new URL('./tenancy-dual-write.ts', import.meta.url)).text();
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n')
      // The quarantined surfaces are NAMED in UNTRUSTED_TENANT_SOURCES as data.
      // Strip string literals so only real code references can match.
      .replace(/'[^']*'/g, "''");
    expect(code).not.toContain('process.env.OMNI_TENANT_ID');
    expect(code).not.toMatch(/req(uest)?\.(body|headers|query)/);
    expect(code).not.toContain('customer.tenantId');
  });
});

describe('flag-off legacy behavior is exact', () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.OMNI_MULTITENANCY_ENABLED;
    // biome-ignore lint/performance/noDelete: env-var cleanup must remove the key, not set it to "undefined" (string)
    delete process.env.OMNI_MULTITENANCY_ENABLED;
  });
  afterEach(() => {
    if (previous !== undefined) process.env.OMNI_MULTITENANCY_ENABLED = previous;
  });

  test('an old-shaped write (no context, unowned parents) leaves ownership NULL', () => {
    expect(trustedInstanceOwnership()).toBeUndefined();
    expect(
      deriveTenantOwnership('messages', [
        { column: 'chat_id', parentId: 'c1', tenantId: null },
        { column: 'sender_person_id', parentId: 'p1', tenantId: null },
      ]),
    ).toBeNull();
  });
});
