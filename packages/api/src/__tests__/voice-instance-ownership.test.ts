/**
 * The voice upgrade's ownership read — G5 deliverable (e).
 *
 * Pins the two properties `authorizeVoiceUpgrade` depends on: the read happens
 * INSIDE a worker tenant scope for the credential's tenant (so RLS polices it
 * under enforcement, and it is detached from any inherited request scope), and a
 * miss resolves to `null` — never to "owned".
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { currentTenantScope } from '../tenancy/tenant-scope';
import { resolveInstanceTenantId } from '../ws/voice-instance-ownership';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';

/**
 * A Database whose `transaction` runs the callback against a handle that
 * answers the select chain from `rows`, recording the tenant scope in force at
 * the moment of the read.
 */
function fakeDb(rows: { tenantId: string }[], observed: { tenantId?: string | null }): Database {
  const handle = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            observed.tenantId = currentTenantScope()?.tenantId ?? null;
            return Promise.resolve(rows);
          },
        }),
      }),
    }),
    execute: async () => [] as unknown,
  };
  return {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(handle),
    ...handle,
  } as unknown as Database;
}

describe('resolveInstanceTenantId', () => {
  test('reads inside a worker tenant scope for the credential tenant', async () => {
    const observed: { tenantId?: string | null } = {};
    const result = await resolveInstanceTenantId(fakeDb([{ tenantId: TENANT_A }], observed), 'inst-1', TENANT_A);

    expect(observed.tenantId).toBe(TENANT_A);
    expect(result).toBe(TENANT_A);
  });

  test('a row the scope cannot see resolves to null, never to owned', async () => {
    const observed: { tenantId?: string | null } = {};
    const result = await resolveInstanceTenantId(fakeDb([], observed), 'inst-foreign', TENANT_A);

    expect(result).toBeNull();
  });

  test('a malformed tenant is refused before any transaction opens', async () => {
    const observed: { tenantId?: string | null } = {};
    await expect(resolveInstanceTenantId(fakeDb([], observed), 'inst-1', 'not-a-uuid')).rejects.toThrow(
      /worker-tenant-context/,
    );
    expect(observed.tenantId).toBeUndefined();
  });

  test('the scope closes when the read completes — nothing outlives the work item', async () => {
    const observed: { tenantId?: string | null } = {};
    await resolveInstanceTenantId(fakeDb([{ tenantId: TENANT_A }], observed), 'inst-1', TENANT_A);
    expect(currentTenantScope()).toBeNull();
  });
});
