/**
 * WRITE/READ TENANT SYMMETRY on the sealed `instances.*` surface
 * (G5 deliverable (g); ADR-0008).
 *
 * `sealed-credential-surfaces.test.ts` proves the four surfaces seal and open.
 * It cannot prove the property that actually decides whether a credential
 * survives a round trip, because every one of its instance probes smuggles
 * `tenantId: TENANT_A` into `create()` through an `as never` cast — a shape
 * production cannot produce (`NewInstance` is `Omit<..., 'tenantId'>`, the v2
 * route passes the validated body, and `instances` is the ownership ROOT so no
 * derivation trigger and no column default stamps it either).
 *
 * The property is: THE TENANT A WRITE SEALS UNDER MUST BE THE TENANT THE
 * PERSISTED ROW WILL PRESENT ON READ. `openInstanceCredentials` opens with
 * `row.tenantId`; if a write sealed under the ACTIVE SCOPE while the row lands
 * with `tenant_id` NULL, `openCredentialField(null, sealed)` fails closed to
 * `null` and the credential is irrecoverable through every service read path —
 * a silent, permanent loss on the very first rotation.
 *
 * Both halves are probed here:
 *   1. the additive phase (row `tenant_id` NULL — every row production writes
 *      today): the write must NOT seal, so create/rotate round-trip byte for
 *      byte, exactly as they did pre-G5;
 *   2. the owned phase (row carries its tenant): the write seals under THAT
 *      tenant, and only that tenant opens it.
 *
 * Plus the read-side derivation itself, which no test in the leg pinned: every
 * existing read probe runs with the active scope EQUAL to the row's owner, so
 * `row.tenantId` and `currentTenantScope()` are indistinguishable there. The
 * out-of-scope read below is the one shape that tells them apart.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { setTenantSecretMasterKey } from '@omni/core';
import type { Database } from '@omni/db';
import { isSealedCredentialField, sealCredentialField } from '../../tenancy/sealed-credentials';
import { runInTenantScope } from '../../tenancy/tenant-scope';
import { buildWorkerTenantContext } from '../../tenancy/worker-tenant-context';
import { InstanceService } from '../instances';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const MASTER_KEY = Buffer.alloc(32, 5);

afterEach(() => setTenantSecretMasterKey(null));

/** One-row stand-in for `instances`; stores whatever the service writes. */
function makeInstancesDb(seed?: Record<string, unknown>) {
  const rows: Array<Record<string, unknown>> = seed ? [seed] : [];
  const db: Record<string, unknown> = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    execute: async () => undefined,
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const row = { id: 'inst-1', channel: 'discord', ...v };
          rows.push(row);
          return [row];
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const row = rows[0];
            if (!row) return [];
            Object.assign(row, v);
            return [row];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        // `where(...)` is awaited directly by `listActive()` and `.limit()`-ed by
        // the by-id reads, so it must be both a promise and a builder.
        where: () =>
          Object.assign(Promise.resolve([...rows]), {
            limit: async () => (rows[0] ? [rows[0]] : []),
          }),
      }),
    }),
  };
  return { db: db as unknown as Database, rows };
}

function inTenantScope<T>(db: Database, tenantId: string, fn: () => Promise<T>): Promise<T> {
  return runInTenantScope(db, buildWorkerTenantContext(tenantId), fn);
}

describe('(g) instances.* — the write seals under the tenant the ROW will present', () => {
  test('a production-shaped create (no tenantId) under a scope does NOT seal — it stays readable', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeInstancesDb();
    const svc = new InstanceService(db, null);

    // Exactly what `routes/v2/instances.ts` produces: the validated body. There
    // is no `tenantId` here and there cannot be one — `NewInstance` omits it.
    const created = await inTenantScope(db, TENANT_A, () =>
      svc.create({ name: 'i', channel: 'discord', discordBotToken: 'MTIz.bot.token' } as never),
    );

    // The row lands with tenant_id NULL (no trigger, no default on the root),
    // so a seal here would be unopenable by every later read.
    expect(rows[0]?.tenantId ?? null).toBeNull();
    expect(isSealedCredentialField(rows[0]?.discordBotToken)).toBe(false);
    expect(rows[0]?.discordBotToken).toBe('MTIz.bot.token');
    expect(created.discordBotToken).toBe('MTIz.bot.token');

    const read = await inTenantScope(db, TENANT_A, () => svc.getById('inst-1'));
    expect(read.discordBotToken).toBe('MTIz.bot.token');
  });

  test('rotating a token on an additive-phase row (tenant_id NULL) keeps the credential recoverable', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeInstancesDb({
      id: 'inst-1',
      channel: 'discord',
      tenantId: null,
      discordBotToken: 'MTIz.working.token',
    });
    const svc = new InstanceService(db, null);

    const updated = await inTenantScope(db, TENANT_A, () =>
      svc.update('inst-1', { discordBotToken: 'MTIz.rotated.token' }),
    );

    expect(isSealedCredentialField(rows[0]?.discordBotToken)).toBe(false);
    expect(rows[0]?.discordBotToken).toBe('MTIz.rotated.token');
    expect(updated.discordBotToken).toBe('MTIz.rotated.token');

    const read = await inTenantScope(db, TENANT_A, () => svc.getById('inst-1'));
    expect(read.discordBotToken).toBe('MTIz.rotated.token');
  });

  test('a rotation from a scope that does NOT own the row never seals under the writer', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeInstancesDb({
      id: 'inst-1',
      channel: 'discord',
      tenantId: TENANT_A,
      discordBotToken: 'MTIz.working.token',
    });
    const svc = new InstanceService(db, null);

    // Under enforcement RLS refuses this write outright; the fake db has no RLS,
    // which is precisely why the SERVICE must not seal under B either.
    await inTenantScope(db, TENANT_B, () => svc.update('inst-1', { discordBotToken: 'MTIz.rotated.token' }));

    expect(isSealedCredentialField(rows[0]?.discordBotToken)).toBe(false);
    // The owner can still read it — nothing was sealed under a key it lacks.
    const read = await inTenantScope(db, TENANT_A, () => svc.getById('inst-1'));
    expect(read.discordBotToken).toBe('MTIz.rotated.token');
  });

  test('when the row DOES carry its tenant, the write seals under exactly that tenant', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeInstancesDb({
      id: 'inst-1',
      channel: 'discord',
      tenantId: TENANT_A,
      discordBotToken: 'MTIz.working.token',
    });
    const svc = new InstanceService(db, null);

    const updated = await inTenantScope(db, TENANT_A, () =>
      svc.update('inst-1', { discordBotToken: 'MTIz.rotated.token' }),
    );

    expect(isSealedCredentialField(rows[0]?.discordBotToken)).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain('MTIz.rotated.token');
    expect(updated.discordBotToken).toBe('MTIz.rotated.token');

    const asOwner = await inTenantScope(db, TENANT_A, () => svc.getById('inst-1'));
    expect(asOwner.discordBotToken).toBe('MTIz.rotated.token');
  });
});

describe('(g) instances.* — the READ tenant is the row, not the scope', () => {
  test('a sealed row opens with NO active scope at all (the row carries the tenant)', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db } = makeInstancesDb({
      id: 'inst-1',
      channel: 'discord',
      tenantId: TENANT_A,
      // Sealed for A by construction — this probe is about the READ derivation,
      // so it does not depend on any write path.
      discordBotToken: sealCredentialField(TENANT_A, 'MTIz.bot.token'),
    });
    const svc = new InstanceService(db, null);

    // No `runInTenantScope`: the legacy/worker/CLI read shape (media-processor's
    // `runMediaDb(ctx, undefined, ...)`, session-cleaner, automation-actions).
    // Deriving the tenant from `currentTenantScope()` here would yield null and
    // fail closed on a row this caller is entitled to read.
    const read = await svc.getById('inst-1');
    expect(read.discordBotToken).toBe('MTIz.bot.token');

    const listed = await svc.listActive();
    expect(listed[0]?.discordBotToken).toBe('MTIz.bot.token');
  });

  // NOTE, deliberately NOT probed here: reading tenant A's row while scoped to
  // tenant B. At the service level the row-derived tenant does open it, but
  // asserting that would codify cross-tenant plaintext disclosure as a contract.
  // What actually stops B is that RLS never hands B the row (proven against real
  // PostgreSQL in `sealed-credentials-two-tenant-postgres.test.ts`), and the
  // relabelled-row case is already pinned in `sealed-credential-surfaces.test.ts`.
});
