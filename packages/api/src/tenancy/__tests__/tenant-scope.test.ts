/**
 * Tenant scope semantics (wish: omni-full-multitenancy, Group G4).
 *
 * These are the properties the whole conversion rests on. If any one of them
 * regresses, every "converted" service silently reverts to unscoped access
 * while still looking converted at the call site — so they are asserted
 * directly rather than inferred from a route test.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import type { AuthContext } from '../auth-context';
import { currentTenantScope, requireTenantScope, runInTenantScope, scopedHandle } from '../tenant-scope';
import { TenantContextError } from '../tenant-transaction';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function tenantContext(tenantId: string): AuthContext {
  return {
    credentialClass: 'tenant',
    requestId: `req-${tenantId}`,
    principalId: 'principal-1',
    credentialId: 'credential-1',
    tenantId,
    actorRole: 'tenant-admin',
    scopes: [],
    membershipId: 'membership-1',
    resourceConstraints: {},
    expiresAt: null,
    rateLimit: null,
    budget: null,
    delegationDepth: 0,
    rootKeyId: 'root-1',
    policyVersion: 1,
    revocationEpoch: 1,
    tenantKeyLineageId: 'lineage-1',
  } as AuthContext;
}

/**
 * A `Database` stand-in whose `transaction` hands back a recognisable handle and
 * records the statements the boundary issued. Real-PostgreSQL behaviour is
 * covered by the RLS suites under the pg-gate; what matters here is the scope
 * plumbing, which is pure runtime mechanics.
 */
function fakeDb(): { db: Database; statements: string[] } {
  const statements: string[] = [];
  const tx = {
    __handle: 'tx',
    execute: async (query: unknown) => {
      statements.push(String((query as { queryChunks?: unknown[] })?.queryChunks ? 'set_config' : query));
      return [] as unknown;
    },
  };
  const db = {
    __handle: 'pool',
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  };
  return { db: db as unknown as Database, statements };
}

describe('tenant scope — legacy world', () => {
  test('with no scope established, the ambient pool is returned unchanged', () => {
    const { db } = fakeDb();
    // This IS the flag-off contract: a legacy request touches the same handle
    // the service used before G4, so its SQL and side effects are identical.
    expect(scopedHandle(db)).toBe(db);
    expect(currentTenantScope()).toBeNull();
  });

  test('requireTenantScope throws outside a scope rather than defaulting', () => {
    expect(() => requireTenantScope()).toThrow('expected an active tenant scope');
  });
});

describe('tenant scope — tenant world', () => {
  test('inside a scope, the transaction handle replaces the pool', async () => {
    const { db } = fakeDb();
    await runInTenantScope(db, tenantContext(TENANT_A), async () => {
      const handle = scopedHandle(db) as unknown as { __handle: string };
      expect(handle.__handle).toBe('tx');
      expect(handle).not.toBe(db);
      expect(currentTenantScope()?.tenantId).toBe(TENANT_A);
    });
  });

  test('the scope propagates across await boundaries', async () => {
    const { db } = fakeDb();
    await runInTenantScope(db, tenantContext(TENANT_A), async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      // A service method is always several awaits deep from the edge; if the
      // scope did not survive them the conversion would silently fail open.
      expect(currentTenantScope()?.tenantId).toBe(TENANT_A);
    });
  });

  test('the scope is torn down when the request completes', async () => {
    const { db } = fakeDb();
    await runInTenantScope(db, tenantContext(TENANT_A), async () => TENANT_A);
    expect(currentTenantScope()).toBeNull();
  });

  test('the scope is torn down when the handler throws', async () => {
    const { db } = fakeDb();
    await expect(
      runInTenantScope(db, tenantContext(TENANT_A), async () => {
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');
    expect(currentTenantScope()).toBeNull();
  });

  test('concurrent requests do not observe each other’s tenant', async () => {
    const { db } = fakeDb();
    const observed: string[] = [];
    const request = async (tenantId: string) =>
      runInTenantScope(db, tenantContext(tenantId), async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        observed.push(requireTenantScope().tenantId);
      });
    // Interleaved on purpose: this is the pooled-connection bleed that a
    // session-level SET would produce, expressed at the application layer.
    await Promise.all([request(TENANT_A), request(TENANT_B), request(TENANT_A)]);
    expect(observed.filter((id) => id === TENANT_A)).toHaveLength(2);
    expect(observed.filter((id) => id === TENANT_B)).toHaveLength(1);
  });
});

describe('tenant scope — fail closed', () => {
  test('a context with no tenant never opens a scope', async () => {
    const { db } = fakeDb();
    await expect(runInTenantScope(db, null as unknown as AuthContext, async () => 'reached')).rejects.toBeInstanceOf(
      TenantContextError,
    );
    expect(currentTenantScope()).toBeNull();
  });

  test('an unbound platform context is refused (ADR-0005)', async () => {
    const { db } = fakeDb();
    const platform = {
      credentialClass: 'platform',
      requestId: 'req-p',
      principalId: null,
      credentialId: 'c',
      scopes: [],
      platformApiKeyId: 'p',
      platformAction: null,
      targetTenantId: null,
    } as AuthContext;
    await expect(runInTenantScope(db, platform, async () => 'reached')).rejects.toBeInstanceOf(TenantContextError);
  });

  test('nesting a second scope is an error, not a silent re-tenant', async () => {
    const { db } = fakeDb();
    await runInTenantScope(db, tenantContext(TENANT_A), async () => {
      await expect(runInTenantScope(db, tenantContext(TENANT_B), async () => 'reached')).rejects.toThrow(
        'already active',
      );
      // The outer identity must be intact after the refusal.
      expect(requireTenantScope().tenantId).toBe(TENANT_A);
    });
  });
});
