/**
 * Tenant transaction boundary — fail-closed contract
 * (wish: omni-full-multitenancy, Group G3; ADR-0004, ADR-0005).
 *
 * The live behaviour (transaction-local setting, pooled-connection reset,
 * policy denial) is proven in `packages/db/src/rls-postgres.test.ts`. These
 * tests cover the half that must hold BEFORE a connection is ever touched: a
 * bad context must be rejected without opening a transaction, so a context bug
 * cannot execute a single statement.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import type { PlatformAuthContext, TenantAuthContext } from '../auth-context';
import { bindPlatformOperation, freezeContext } from '../auth-context';
import { TenantContextError, resolveTransactionTenantId, withTenantTransaction } from '../tenant-transaction';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

/** Records whether a transaction was ever opened. Fails loudly if one is. */
function spyDb(): { db: Database; opened: () => number } {
  let opened = 0;
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      opened += 1;
      return fn({ execute: async () => [] });
    },
  } as unknown as Database;
  return { db, opened: () => opened };
}

function tenantContext(overrides: Partial<TenantAuthContext> = {}): TenantAuthContext {
  return freezeContext({
    credentialClass: 'tenant',
    requestId: 'req-1',
    principalId: 'p-1',
    credentialId: 'c-1',
    tenantId: TENANT_A,
    actorRole: 'tenant-admin',
    scopes: ['messages:read'],
    membershipId: 'm-1',
    resourceConstraints: {},
    expiresAt: null,
    rateLimit: null,
    budget: null,
    delegationDepth: 0,
    rootKeyId: 'root-1',
    policyVersion: 1,
    revocationEpoch: 1,
    tenantKeyLineageId: 'l-1',
    ...overrides,
  }) as TenantAuthContext;
}

function platformContext(overrides: Partial<PlatformAuthContext> = {}): PlatformAuthContext {
  return freezeContext({
    credentialClass: 'platform',
    requestId: 'req-1',
    principalId: 'p-plat',
    credentialId: 'c-plat',
    scopes: ['platform:tenants:write'],
    platformApiKeyId: 'pk-1',
    platformAction: null,
    targetTenantId: null,
    ...overrides,
  }) as PlatformAuthContext;
}

describe('tenant context resolution', () => {
  test('a tenant context resolves to its own tenant', () => {
    expect(resolveTransactionTenantId(tenantContext())).toBe(TENANT_A);
  });

  test('a missing context is denied', () => {
    expect(() => resolveTransactionTenantId(null)).toThrow(TenantContextError);
    expect(() => resolveTransactionTenantId(undefined)).toThrow(/missing_context/);
  });

  test('a context that is not one of the two known classes is denied', () => {
    expect(() => resolveTransactionTenantId({ credentialClass: 'root' } as never)).toThrow(/malformed_context/);
  });

  test('a tenant context with a non-UUID tenant is denied', () => {
    for (const bad of ['', 'not-a-uuid', 'DROP TABLE', '11111111-1111-4111-8111', null, 42]) {
      expect(() => resolveTransactionTenantId(tenantContext({ tenantId: bad as never }))).toThrow(/invalid_tenant/);
    }
  });
});

describe('platform contexts (ADR-0005)', () => {
  test('an unbound platform context has no tenant and is denied — there is no BYPASSRLS path', () => {
    expect(() => resolveTransactionTenantId(platformContext())).toThrow(/platform_target_tenant_required/);
  });

  test('a platform context bound to one target tenant is admissible through the same boundary', () => {
    const bound = bindPlatformOperation(platformContext(), 'tenant.instance.suspend', TENANT_B);
    expect(resolveTransactionTenantId(bound)).toBe(TENANT_B);
  });

  test('a target tenant with no audited action is denied', () => {
    const unaudited = freezeContext({ ...platformContext(), targetTenantId: TENANT_B }) as PlatformAuthContext;
    expect(() => resolveTransactionTenantId(unaudited)).toThrow(/platform_action_required/);
  });

  test('binding an operation does not mutate the original context', () => {
    const original = platformContext();
    bindPlatformOperation(original, 'tenant.read', TENANT_B);
    expect(original.targetTenantId).toBeNull();
    expect(original.platformAction).toBeNull();
  });
});

describe('immutability', () => {
  test('a constructed context cannot be re-tenanted', () => {
    const context = tenantContext();
    expect(() => {
      (context as { tenantId: string }).tenantId = TENANT_B;
    }).toThrow();
    expect(context.tenantId).toBe(TENANT_A);
  });

  test('the scopes array is frozen too, so authority cannot be widened in place', () => {
    const context = tenantContext();
    expect(Object.isFrozen(context.scopes)).toBe(true);
    expect(() => (context.scopes as string[]).push('*')).toThrow();
  });

  test('nested constraint objects are frozen', () => {
    const context = tenantContext({ resourceConstraints: { instanceIds: ['i-1'] } });
    expect(Object.isFrozen(context.resourceConstraints)).toBe(true);
    expect(Object.isFrozen(context.resourceConstraints.instanceIds)).toBe(true);
  });
});

describe('withTenantTransaction', () => {
  test('a denied context opens NO transaction — not one statement executes', async () => {
    for (const bad of [null, undefined, platformContext(), tenantContext({ tenantId: 'nope' as never })]) {
      const { db, opened } = spyDb();
      await expect(withTenantTransaction(db, bad as never, async () => 'unreachable')).rejects.toThrow(
        TenantContextError,
      );
      expect(opened()).toBe(0);
    }
  });

  test('an admissible context opens exactly one transaction and reports the tenant', async () => {
    const { db, opened } = spyDb();
    const seen: string[] = [];
    const result = await withTenantTransaction(db, tenantContext(), async (_tx, tenantId) => `ran:${tenantId}`, {
      onTenantResolved: (id) => seen.push(id),
    });
    expect(result).toBe(`ran:${TENANT_A}`);
    expect(opened()).toBe(1);
    expect(seen).toEqual([TENANT_A]);
  });

  test('the callback receives the resolved tenant, never a caller-supplied one', async () => {
    const { db } = spyDb();
    const bound = bindPlatformOperation(platformContext(), 'tenant.export', TENANT_B);
    const tenant = await withTenantTransaction(db, bound, async (_tx, tenantId) => tenantId);
    expect(tenant).toBe(TENANT_B);
  });
});
