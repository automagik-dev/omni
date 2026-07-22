/**
 * Worker-context tenant boundary — ALS detachment, per-item scope, fail-closed
 * derivation (wish: omni-full-multitenancy, Group G5; ADR-0008).
 *
 * These probes fix the two invariants the G4 leg-2 review made non-negotiable:
 *
 *   1. a background/worker path must NEVER inherit a request's ALS tenant scope
 *      — it establishes its own from the trusted envelope tenant;
 *   2. a worker derivation refuses a caller-claimed tenant — only a well-formed,
 *      producer-derived tenant is admitted.
 *
 * The DB is faked here (a transaction that runs its callback against a no-op
 * handle) so these can assert the SCOPE semantics with no PostgreSQL. The real
 * two-tenant isolation is proven separately under the pg-gate.
 */

import { describe, expect, test } from 'bun:test';
import { classifyEnvelope } from '@omni/core';
import type { Database } from '@omni/db';
import { type TenantAuthContext, freezeContext } from '../auth-context';
import { currentTenantScope, requireTenantScope, runInTenantScope } from '../tenant-scope';
import { buildWorkerTenantContext, runInWorkerTenantScope } from '../worker-tenant-context';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';

/** A Database whose `transaction` just runs the callback with a no-op tx. */
function fakeDb(): Database {
  return {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb({ execute: async () => [] as unknown }),
  } as unknown as Database;
}

function requestContext(tenantId: string): TenantAuthContext {
  return freezeContext({
    credentialClass: 'tenant',
    requestId: `req-${tenantId}`,
    principalId: '33333333-3333-4333-8333-333333333331',
    credentialId: '99999999-9999-4999-8999-999999999992',
    tenantId,
    actorRole: 'tenant-admin',
    scopes: [],
    membershipId: '44444444-4444-4444-8444-444444444441',
    resourceConstraints: {},
    expiresAt: null,
    rateLimit: null,
    budget: null,
    delegationDepth: 0,
    rootKeyId: 'root-1',
    policyVersion: 1,
    revocationEpoch: 0,
    tenantKeyLineageId: 'lin-1',
  }) as TenantAuthContext;
}

describe('runInWorkerTenantScope establishes a per-item tenant scope', () => {
  test('the work item runs inside a scope stamped with the trusted tenant', async () => {
    const seen = await runInWorkerTenantScope(fakeDb(), TENANT_A, async () => requireTenantScope().tenantId);
    expect(seen).toBe(TENANT_A);
  });

  test('the scope is torn down when the work item completes (does not outlive it)', async () => {
    await runInWorkerTenantScope(fakeDb(), TENANT_A, async () => undefined);
    expect(currentTenantScope()).toBeNull();
  });
});

describe('a worker NEVER inherits a request scope (G4 leg-2 trap)', () => {
  test('called from inside tenant A request scope, a worker for B sees B — not A', async () => {
    const observed = await runInTenantScope(fakeDb(), requestContext(TENANT_A), async () => {
      // We are now inside tenant A's request scope.
      expect(requireTenantScope().tenantId).toBe(TENANT_A);
      // A worker spawned here must detach and establish B, never inherit A.
      return runInWorkerTenantScope(fakeDb(), TENANT_B, async () => requireTenantScope().tenantId);
    });
    expect(observed).toBe(TENANT_B);
  });

  test('after the worker returns, the outer request scope is intact', async () => {
    const outerAfter = await runInTenantScope(fakeDb(), requestContext(TENANT_A), async () => {
      await runInWorkerTenantScope(fakeDb(), TENANT_B, async () => undefined);
      return requireTenantScope().tenantId;
    });
    expect(outerAfter).toBe(TENANT_A);
  });
});

describe('worker derivation is fail-closed — a caller-claimed tenant is refused', () => {
  test('a non-UUID tenant is rejected before any transaction opens', async () => {
    await expect(runInWorkerTenantScope(fakeDb(), 'tenant-a', async () => 1)).rejects.toThrow();
  });

  test('an empty tenant is rejected', async () => {
    await expect(runInWorkerTenantScope(fakeDb(), '', async () => 1)).rejects.toThrow();
  });

  test('buildWorkerTenantContext mints a fresh internal requestId, not a caller value', () => {
    const a = buildWorkerTenantContext(TENANT_A);
    const b = buildWorkerTenantContext(TENANT_A);
    expect(a.credentialClass).toBe('tenant');
    expect(a.tenantId).toBe(TENANT_A);
    // Internally minted and unique per work item — never a caller-supplied id.
    expect(a.requestId).not.toBe(b.requestId);
  });
});

describe('the trusted tenant comes from the envelope, not the payload', () => {
  test('a validated tenant envelope drives the worker scope', async () => {
    const classification = classifyEnvelope({ correlationId: 'c', envelopeVersion: 1, tenantId: TENANT_A });
    expect(classification.world).toBe('tenant');
    if (classification.world !== 'tenant') throw new Error('unreachable');
    const seen = await runInWorkerTenantScope(
      fakeDb(),
      classification.tenantId,
      async () => requireTenantScope().tenantId,
    );
    expect(seen).toBe(TENANT_A);
  });
});
