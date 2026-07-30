/**
 * Periodic-work tenant fan-out — enumeration gating, per-tenant scope, failure
 * isolation (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0003).
 *
 * The DB is faked (a select chain returning canned tenant rows; a transaction
 * that runs its callback) so these assert the FAN-OUT semantics with no
 * PostgreSQL:
 *
 *   1. flag-off runs NO query and enumerates nothing — the legacy cron path
 *      must not gain a single statement;
 *   2. flag-on enumerates exactly the ACTIVE tenants from the auth-plane read;
 *   3. every per-tenant pass runs inside ITS OWN worker tenant scope;
 *   4. one tenant's failure never aborts a sibling's pass.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { MULTITENANCY_FLAG_ENV } from '../feature-flag';
import { enumerateActiveWorkTenants, runForEachActiveWorkTenant } from '../periodic-tenant-work';
import { requireTenantScope } from '../tenant-scope';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';

const FLAG_ON: NodeJS.ProcessEnv = { [MULTITENANCY_FLAG_ENV]: 'true' };
const FLAG_OFF: NodeJS.ProcessEnv = {};

/** Auth-plane Database fake: records whether a select ran, returns `rows`. */
function fakeAuthPlaneDb(rows: Array<{ id: string }>, counter: { selects: number }): Database {
  return {
    select: () => {
      counter.selects += 1;
      return { from: () => ({ where: async () => rows }) };
    },
  } as unknown as Database;
}

/** Worker-scope Database fake: `transaction` runs the callback with a no-op tx. */
function fakeScopeDb(): Database {
  return {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb({ execute: async () => [] as unknown }),
  } as unknown as Database;
}

describe('enumerateActiveWorkTenants', () => {
  test('flag-off enumerates nothing and issues NO query', async () => {
    const counter = { selects: 0 };
    const authPlane = fakeAuthPlaneDb([{ id: TENANT_A }], counter);
    expect(await enumerateActiveWorkTenants(authPlane, FLAG_OFF)).toEqual([]);
    expect(counter.selects).toBe(0);
  });

  test('flag-on returns the active tenants from the auth-plane read', async () => {
    const counter = { selects: 0 };
    const authPlane = fakeAuthPlaneDb([{ id: TENANT_A }, { id: TENANT_B }], counter);
    expect(await enumerateActiveWorkTenants(authPlane, FLAG_ON)).toEqual([TENANT_A, TENANT_B]);
    expect(counter.selects).toBe(1);
  });
});

describe('runForEachActiveWorkTenant', () => {
  test('flag-off runs no pass at all', async () => {
    const counter = { selects: 0 };
    const seen: string[] = [];
    const stats = await runForEachActiveWorkTenant(
      fakeScopeDb(),
      fakeAuthPlaneDb([{ id: TENANT_A }], counter),
      'test-job',
      async (tenantId) => {
        seen.push(tenantId);
      },
      FLAG_OFF,
    );
    expect(seen).toEqual([]);
    expect(counter.selects).toBe(0);
    expect(stats).toEqual({ tenants: 0, succeeded: 0, failed: 0 });
  });

  test('each pass runs inside its own worker scope stamped with THAT tenant', async () => {
    const counter = { selects: 0 };
    const scoped: Array<{ arg: string; scope: string }> = [];
    const stats = await runForEachActiveWorkTenant(
      fakeScopeDb(),
      fakeAuthPlaneDb([{ id: TENANT_A }, { id: TENANT_B }], counter),
      'test-job',
      async (tenantId) => {
        scoped.push({ arg: tenantId, scope: requireTenantScope().tenantId });
      },
      FLAG_ON,
    );
    expect(scoped).toEqual([
      { arg: TENANT_A, scope: TENANT_A },
      { arg: TENANT_B, scope: TENANT_B },
    ]);
    expect(stats).toEqual({ tenants: 2, succeeded: 2, failed: 0 });
  });

  test("one tenant's failure is isolated — the sibling pass still runs", async () => {
    const counter = { selects: 0 };
    const seen: string[] = [];
    const stats = await runForEachActiveWorkTenant(
      fakeScopeDb(),
      fakeAuthPlaneDb([{ id: TENANT_A }, { id: TENANT_B }], counter),
      'test-job',
      async (tenantId) => {
        if (tenantId === TENANT_A) throw new Error('tenant A pass exploded');
        seen.push(tenantId);
      },
      FLAG_ON,
    );
    expect(seen).toEqual([TENANT_B]);
    expect(stats).toEqual({ tenants: 2, succeeded: 1, failed: 1 });
  });
});
