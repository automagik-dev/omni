/**
 * Tenant-bound sealing of session secrets at rest (G5; ADR-0008;
 * OWNERSHIP_MANIFEST `filesystem_session_state`).
 *
 * Proves the deliverable-(g) contract end-to-end at the session-storage layer:
 *
 *   * DUAL WORLD — with no tenant resolver (the production default) or no master
 *     key, the persisted `provider_session_data` is legacy plaintext
 *     `{ sessionId }`, byte-identical to pre-G5, and round-trips.
 *   * SEALED AT REST — with a resolver + key, the persisted blob is a
 *     `SealedSecret` (no plaintext session id in the stored bytes), yet the
 *     owning tenant reads its session back.
 *   * CROSS-TENANT REFUSAL — a store whose resolver returns tenant B cannot read
 *     a session sealed for tenant A; it fails closed to "no session" (null),
 *     never a plaintext leak or a crash. This is the manifest's verification
 *     target, "session state cannot be decrypted/exported under another tenant".
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { isSealedSecret, setTenantSecretMasterKey } from '@omni/core';
import type { Database } from '@omni/db';
import { createSessionStorage } from '../session-storage';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const MASTER_KEY = Buffer.alloc(32, 9);

afterEach(() => setTenantSecretMasterKey(null));

/**
 * A one-row in-memory stand-in for the `agent_sessions` table. Captures the
 * persisted `providerSessionData` verbatim so a test can inspect the bytes at
 * rest, and serves it back to `getSession` unchanged — exactly the storage
 * fidelity the sealing contract depends on.
 *
 * TOUCHED BY THE LATER G5 LEG that scoped this store's DB access. Supplying a
 * `resolveTenantId` now opens a worker tenant TRANSACTION around each discrete
 * DB block (ADR-0008), so the stub has to model that boundary or the
 * resolver-present cases below cannot run at all. The `transaction` here is the
 * minimum honest model — it hands the same handle to the callback, which is what
 * a real Drizzle transaction does from the query builder's point of view — and
 * it does NOT weaken any assertion: the sealing/cross-tenant expectations are
 * unchanged, and real transactional isolation is proven separately against
 * PostgreSQL in `session-cluster-two-tenant-postgres.test.ts`.
 */
function makeFakeDb() {
  const rows = new Map<string, { providerSessionData: unknown; lastUsedAt: Date; expiresAt: Date | null }>();
  let pendingValues: { instanceId: string; sessionKey: string; providerSessionData: unknown } | null = null;
  const db = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    execute: async () => undefined,
    insert: () => ({
      values: (v: { instanceId: string; sessionKey: string; providerSessionData: unknown }) => {
        pendingValues = v;
        return {
          onConflictDoUpdate: async () => {
            if (pendingValues) {
              rows.set(`${pendingValues.instanceId}::${pendingValues.sessionKey}`, {
                providerSessionData: pendingValues.providerSessionData,
                lastUsedAt: new Date(),
                expiresAt: null,
              });
            }
          },
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const [only] = [...rows.values()];
            return only ? [only] : [];
          },
        }),
      }),
    }),
    delete: () => ({ where: async () => rows.clear() }),
  };
  return { db: db as unknown as Database, rows };
}

describe('session-storage sealing — dual world (default = plaintext)', () => {
  test('no resolver: provider_session_data is legacy plaintext and round-trips', async () => {
    const { db, rows } = makeFakeDb();
    const store = createSessionStorage(db, 'p');
    await store.upsertSession('inst-1', 'k', 'sess-123', null);

    const stored = [...rows.values()][0];
    if (!stored) throw new Error('expected a persisted session row');
    expect(isSealedSecret(stored.providerSessionData)).toBe(false);
    expect(stored.providerSessionData).toEqual({ sessionId: 'sess-123' });

    const got = await store.getSession('inst-1', 'k');
    expect(got?.sessionId).toBe('sess-123');
  });

  test('resolver present but no master key: still plaintext (byte-identical)', async () => {
    setTenantSecretMasterKey(null);
    const { db, rows } = makeFakeDb();
    const store = createSessionStorage(db, 'p', undefined, { resolveTenantId: () => TENANT_A });
    await store.upsertSession('inst-1', 'k', 'sess-123', null);
    const stored = [...rows.values()][0];
    if (!stored) throw new Error('expected a persisted session row');
    expect(isSealedSecret(stored.providerSessionData)).toBe(false);
  });
});

describe('session-storage sealing — sealed at rest', () => {
  test('resolver + key: blob is sealed (no plaintext session id) and owner reads it back', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeFakeDb();
    const store = createSessionStorage(db, 'p', undefined, { resolveTenantId: () => TENANT_A });
    await store.upsertSession('inst-1', 'k', 'sess-abc', null);

    const stored = [...rows.values()][0];
    if (!stored) throw new Error('expected a persisted session row');
    expect(isSealedSecret(stored.providerSessionData)).toBe(true);
    expect(JSON.stringify(stored.providerSessionData)).not.toContain('sess-abc');

    const got = await store.getSession('inst-1', 'k');
    expect(got?.sessionId).toBe('sess-abc');
  });
});

describe('session-storage sealing — cross-tenant refusal', () => {
  test('tenant B store cannot read a session sealed for tenant A (fails closed to null)', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db } = makeFakeDb();
    const storeA = createSessionStorage(db, 'p', undefined, { resolveTenantId: () => TENANT_A });
    await storeA.upsertSession('inst-1', 'k', 'sess-secret', null);

    const storeB = createSessionStorage(db, 'p', undefined, { resolveTenantId: () => TENANT_B });
    const got = await storeB.getSession('inst-1', 'k');
    expect(got).toBeNull();
  });

  test('a sealed row is unreadable when the tenant cannot be resolved', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db } = makeFakeDb();
    const storeA = createSessionStorage(db, 'p', undefined, { resolveTenantId: () => TENANT_A });
    await storeA.upsertSession('inst-1', 'k', 'sess-secret', null);

    // A reader with a key but no resolver cannot open a sealed row.
    const storeNoResolver = createSessionStorage(db, 'p');
    expect(await storeNoResolver.getSession('inst-1', 'k')).toBeNull();
  });
});
