/**
 * `plugins/instance-monitor.ts::instances` worker-context boundary
 * (G5; ADR-0008).
 *
 * The monitor is a 30-second INTERVAL plus a 5-second reconnect drain: no
 * request, no credential, no envelope. Before this conversion every tick read
 * the WHOLE `instances` table (`fetchActiveInstances`), and the reconnect queue
 * then re-read single rows (`fetchInstanceById`) and DEACTIVATED instances
 * (`markInstanceInactive`) — all on the ambient pool. Under RLS enforcement the
 * whole-table scan is not even expressible, so a cron must ENUMERATE whose work
 * exists rather than scan and sort out ownership afterwards.
 *
 * The tick adopts `runForEachActiveTenantRow` (the daily-sync / turn-monitor
 * precedent): only the discrete `listActive` READ is scoped, and the per-row
 * plugin `getStatus`/`connect` calls — network work — run outside it. The
 * single-row paths derive their tenant from the instance-owner registry, the
 * same trusted persisted-ownership derivation the publish path uses.
 *
 * This file is the enforcement the static guard cannot provide (run12's
 * FIX-FIRST lesson: the guard sees the FILE, never the CALL SITE).
 *
 * WHY THE FAKE TRANSACTION IS A DISTINCT OBJECT
 * ---------------------------------------------
 * An earlier revision of this probe had `transaction: (cb) => cb(db)`, so the
 * transaction handle and the ambient pool were the SAME object. Every assertion
 * then read `currentTenantScope()` — AsyncLocalStorage presence — which is set
 * whether the query was issued on the tenant transaction or on the pool. A
 * converted site that opens the scope and then queries the raw pool was
 * indistinguishable from one that queries the transaction, and that is exactly
 * the defect this file exists to catch: only `scopedHandle(db)` returns the
 * transaction that carries `set_config('app.tenant_id', …, true)`, so a raw-pool
 * query inside a worker scope runs on a DIFFERENT pooled connection — unstamped
 * before enforcement, fail-closed under RLS.
 *
 * So the fake `transaction` yields its OWN handle and every observation records
 * WHICH handle issued the statement. `scope` alone is not evidence; `handle` is.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import type { ChannelRegistry } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import { MULTITENANCY_FLAG_ENV } from '../../tenancy/feature-flag';
import {
  __resetInstanceOwnerRegistry,
  lookupInstanceOwner,
  rememberInstanceOwners,
} from '../../tenancy/instance-owner-registry';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { InstanceMonitor, reconnectWithPool } from '../instance-monitor';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';

const FLAG_ON: NodeJS.ProcessEnv = { [MULTITENANCY_FLAG_ENV]: 'true' };
const FLAG_OFF: NodeJS.ProcessEnv = {};

function scope(): string | null {
  return currentTenantScope()?.tenantId ?? null;
}

/** Drizzle-shaped chain stub: builder methods return self; awaiting yields `result`. */
function chain<T>(result: T): T {
  const self: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (onOk: (v: T) => unknown, onErr?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onOk, onErr);
        }
        return () => self;
      },
    },
  );
  return self as T;
}

interface Observed {
  op: string;
  scope: string | null;
  /** Which handle issued the statement: the ambient pool or the tenant tx. */
  handle: 'POOL' | 'TX';
}

function fakeAuthPlaneDb(ids: string[], counter: { selects: number }): Database {
  return {
    select: () => {
      counter.selects += 1;
      return { from: () => ({ where: async () => ids.map((id) => ({ id })) }) };
    },
  } as unknown as Database;
}

function makeDb(observed: Observed[], rows: unknown[], counters: { transactions: number }): Database {
  const record = (op: string, handle: 'POOL' | 'TX') => {
    observed.push({ op, scope: scope(), handle });
  };
  // The tenant transaction is its OWN object — see the header. `withTenantTransaction`
  // hands this to `runInTenantScope`, so `scopedHandle(db)` returns THIS and a
  // site that queries the injected pool instead is visible as `handle: 'POOL'`.
  const tx = {
    select: () => {
      record('select', 'TX');
      return chain(rows);
    },
    update: () => {
      record('update', 'TX');
      return chain([]);
    },
    execute: async () => [],
  };
  const db = {
    select: () => {
      record('select', 'POOL');
      return chain(rows);
    },
    update: () => {
      record('update', 'POOL');
      return chain([]);
    },
    transaction: async <T>(cb: (handle: unknown) => Promise<T>): Promise<T> => {
      counters.transactions += 1;
      return cb(tx);
    },
    execute: async () => [],
  };
  return db as unknown as Database;
}

function makeRegistry(statusScopes: Array<string | null>): ChannelRegistry {
  return {
    get: () => ({
      getStatus: async () => {
        statusScopes.push(scope());
        return { state: 'disconnected' as const };
      },
      connect: async () => {},
    }),
  } as unknown as ChannelRegistry;
}

/**
 * A registry whose `connect` records the tenant scope it observed and an
 * ordered start/end log, so the boot reconnect's concurrency shape is
 * observable rather than asserted.
 */
function makeConnectRegistry(connects: {
  scopes: Array<string | null>;
  events: string[];
}): ChannelRegistry {
  return {
    get: () => ({
      getStatus: async () => ({ state: 'disconnected' as const }),
      connect: async (instanceId: string) => {
        connects.scopes.push(scope());
        connects.events.push(`start:${instanceId}`);
        await new Promise((r) => setTimeout(r, 1));
        connects.events.push(`end:${instanceId}`);
      },
    }),
  } as unknown as ChannelRegistry;
}

function instanceRow(id: string, tenantId: string | null) {
  return { id, name: id, channel: 'telegram', ownerIdentifier: 'owner', tenantId, isActive: true };
}

afterEach(() => {
  __resetInstanceOwnerRegistry();
});

describe('instance-monitor — legacy world is byte-identical', () => {
  test('no auth plane wired: one ambient scan, no enumeration, no transaction', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const authCounter = { selects: 0 };
    const statusScopes: Array<string | null> = [];
    const monitor = new InstanceMonitor(
      makeDb(observed, [instanceRow('i1', null)], counters),
      makeRegistry(statusScopes),
    );

    await monitor.runHealthCheck();

    expect(observed.filter((o) => o.op === 'select').length).toBe(1);
    expect(observed.every((o) => o.scope === null)).toBe(true);
    // Byte-identical to pre-G5: the ambient pool issued it, not a transaction.
    expect(observed.every((o) => o.handle === 'POOL')).toBe(true);
    expect(counters.transactions).toBe(0);
    expect(authCounter.selects).toBe(0);
    // The per-instance health probe still ran — this is behaviour-preserving.
    expect(statusScopes.length).toBe(1);
  });

  test('auth plane wired but flag OFF: still one ambient pass and NO auth-plane query', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const authCounter = { selects: 0 };
    const monitor = new InstanceMonitor(makeDb(observed, [instanceRow('i1', null)], counters), makeRegistry([]));
    monitor.setAuthPlane(fakeAuthPlaneDb([TENANT_A], authCounter), FLAG_OFF);

    await monitor.runHealthCheck();

    expect(observed.filter((o) => o.op === 'select').length).toBe(1);
    expect(authCounter.selects).toBe(0);
    expect(observed.every((o) => o.scope === null)).toBe(true);
    expect(observed.every((o) => o.handle === 'POOL')).toBe(true);
    expect(counters.transactions).toBe(0);
  });
});

describe('instance-monitor — tenant world', () => {
  test('the active-instance read is ENUMERATED per tenant and runs inside that tenant scope', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const authCounter = { selects: 0 };
    const monitor = new InstanceMonitor(makeDb(observed, [], counters), makeRegistry([]));
    monitor.setAuthPlane(fakeAuthPlaneDb([TENANT_A, TENANT_B], authCounter), FLAG_ON);

    await monitor.runHealthCheck();

    expect(authCounter.selects).toBe(1);
    // One scoped read per tenant plus the transitional NULL-tenant pass, which
    // only exists outside enforcement.
    const selects = observed.filter((o) => o.op === 'select');
    expect(selects.map((o) => o.scope)).toEqual([TENANT_A, TENANT_B, null]);
    // …and each scoped read is issued ON that tenant's transaction. Asserting
    // the ALS scope alone would pass for a site that opens the scope and then
    // queries the ambient pool — the connection that never sees `app.tenant_id`.
    expect(selects.map((o) => o.handle)).toEqual(['TX', 'TX', 'POOL']);
  });

  test('the plugin health probe runs OUTSIDE the scope — no transaction spans a network call', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const statusScopes: Array<string | null> = [];
    const monitor = new InstanceMonitor(
      makeDb(observed, [instanceRow('i1', TENANT_A)], counters),
      makeRegistry(statusScopes),
    );
    monitor.setAuthPlane(fakeAuthPlaneDb([TENANT_A], { selects: 0 }), FLAG_ON);

    await monitor.runHealthCheck();

    expect(statusScopes.length).toBeGreaterThan(0);
    expect(statusScopes.every((s) => s === null)).toBe(true);
  });

  test('an instance owned by tenant B is never probed in tenant A’s pass', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const statusScopes: Array<string | null> = [];
    const monitor = new InstanceMonitor(
      makeDb(observed, [instanceRow('i-b', TENANT_B)], counters),
      makeRegistry(statusScopes),
    );
    // Flag on AND enforced, so the transitional NULL-tenant pass is skipped and
    // tenant A's pass is the only one that could see the row. `'on'` is the
    // literal `resolveEnforcementMode` accepts — any other value resolves to the
    // NON-enforced mode and this test would pass for the wrong reason.
    monitor.setAuthPlane(fakeAuthPlaneDb([TENANT_A], { selects: 0 }), {
      ...FLAG_ON,
      OMNI_DB_ENFORCEMENT: 'on',
    });

    await monitor.runHealthCheck();

    expect(statusScopes.length).toBe(0);
  });

  test('the single-row reconnect read and the DEACTIVATION run in the instance’s own tenant scope', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const monitor = new InstanceMonitor(makeDb(observed, [instanceRow('i1', TENANT_A)], counters), makeRegistry([]), {
      maxReconnectAttempts: 1,
      backoffBaseMs: 1,
    });
    monitor.setAuthPlane(fakeAuthPlaneDb([TENANT_A], { selects: 0 }), FLAG_ON);
    // The registry is the trusted instance→tenant derivation; the sweep seeds it
    // from loaded rows exactly like this.
    rememberInstanceOwners([{ id: 'i1', tenantId: TENANT_A }]);

    // `forceReconnect` → `fetchInstanceById`: the single-row READ.
    await monitor.forceReconnect('i1');
    const reads = observed.filter((o) => o.op === 'select');
    expect(reads.length).toBe(1);
    expect(reads[0]?.scope).toBe(TENANT_A);
    expect(reads[0]?.handle).toBe('TX');

    observed.length = 0;

    // Drive the queue past the retry ceiling so the DEACTIVATION write fires.
    await new Promise((r) => setTimeout(r, 5));
    monitor.scheduleReconnect('i1', 'telegram', 'boom');
    await new Promise((r) => setTimeout(r, 5));

    const writes = observed.filter((o) => o.op === 'update');
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write.scope).toBe(TENANT_A);
      // The DEACTIVATION is the sweep's only write; it must land on the
      // tenant-stamped transaction, never on the ambient pool.
      expect(write.handle).toBe('TX');
    }
  });

  test('an instance the registry never observed stays ambient (fail-closed under enforcement)', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const monitor = new InstanceMonitor(makeDb(observed, [instanceRow('i9', TENANT_A)], counters), makeRegistry([]));
    monitor.setAuthPlane(fakeAuthPlaneDb([TENANT_A], { selects: 0 }), FLAG_ON);

    await monitor.forceReconnect('i9');

    // No ownership was ever loaded for `i9`, so no tenant could be derived and
    // the read is NOT smuggled into some other tenant's scope.
    expect(observed.filter((o) => o.op === 'select').map((o) => o.scope)).toEqual([null]);
    expect(observed.filter((o) => o.op === 'select').map((o) => o.handle)).toEqual(['POOL']);
    expect(counters.transactions).toBe(0);
  });
});

/**
 * The ONCE-PER-BOOT sweep (`reconnectWithPool`).
 *
 * It is a module-level function, not a monitor method, and until this block it
 * had no executable coverage anywhere in the repository — while the db-access
 * guard's `instance-monitor.ts::instances` justification named this file as
 * what pins its flag-off behaviour. These probes make that citation true and
 * pin the three things the health-check probes above cannot reach: the boot
 * read's handle, the registry seeding that precedes any plugin emit, and the
 * batching/accounting the tenant fan-out feeds.
 */
describe('reconnectWithPool — the once-per-boot sweep', () => {
  test('no auth plane: ONE ambient scan, no transaction, pre-G5 results', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const connects = { scopes: [] as Array<string | null>, events: [] as string[] };
    const db = makeDb(observed, [instanceRow('i1', null), instanceRow('i2', null)], counters);

    const results = await reconnectWithPool(db, makeConnectRegistry(connects), { delayBetweenMs: 0 });

    expect(results).toEqual({ attempted: 2, succeeded: 2, failed: 0, errors: [] });
    const selects = observed.filter((o) => o.op === 'select');
    expect(selects.length).toBe(1);
    expect(selects.map((o) => o.handle)).toEqual(['POOL']);
    expect(selects.every((o) => o.scope === null)).toBe(true);
    expect(counters.transactions).toBe(0);
  });

  test('auth plane wired but flag OFF: still one ambient pass and NO auth-plane query', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const authCounter = { selects: 0 };
    const connects = { scopes: [] as Array<string | null>, events: [] as string[] };
    const db = makeDb(observed, [instanceRow('i1', null), instanceRow('i2', null)], counters);

    const results = await reconnectWithPool(db, makeConnectRegistry(connects), {
      delayBetweenMs: 0,
      authPlaneDb: fakeAuthPlaneDb([TENANT_A], authCounter),
      env: FLAG_OFF,
    });

    // Byte-identical to the no-auth-plane world above: same statements, same
    // handle, same results. The auth plane is never consulted.
    expect(results).toEqual({ attempted: 2, succeeded: 2, failed: 0, errors: [] });
    expect(authCounter.selects).toBe(0);
    const selects = observed.filter((o) => o.op === 'select');
    expect(selects.length).toBe(1);
    expect(selects.map((o) => o.handle)).toEqual(['POOL']);
    expect(counters.transactions).toBe(0);
  });

  test('tenant world: the row READ is enumerated per tenant and issued ON that tenant transaction', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const authCounter = { selects: 0 };
    const connects = { scopes: [] as Array<string | null>, events: [] as string[] };
    const db = makeDb(observed, [instanceRow('a1', TENANT_A), instanceRow('b1', TENANT_B)], counters);

    const results = await reconnectWithPool(db, makeConnectRegistry(connects), {
      delayBetweenMs: 0,
      authPlaneDb: fakeAuthPlaneDb([TENANT_A, TENANT_B], authCounter),
      env: FLAG_ON,
    });

    expect(authCounter.selects).toBe(1);
    const selects = observed.filter((o) => o.op === 'select');
    // One scoped read per tenant, then the transitional NULL-tenant pass.
    expect(selects.map((o) => o.scope)).toEqual([TENANT_A, TENANT_B, null]);
    expect(selects.map((o) => o.handle)).toEqual(['TX', 'TX', 'POOL']);
    // `attempted` is the fan-out's own row count: each tenant contributed its
    // own row and neither saw the other's.
    expect(results.attempted).toBe(2);
    expect(results.succeeded).toBe(2);
  });

  test('every plugin.connect runs OUTSIDE the scope — no transaction spans the network call', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const connects = { scopes: [] as Array<string | null>, events: [] as string[] };
    const db = makeDb(observed, [instanceRow('a1', TENANT_A)], counters);

    await reconnectWithPool(db, makeConnectRegistry(connects), {
      delayBetweenMs: 0,
      authPlaneDb: fakeAuthPlaneDb([TENANT_A], { selects: 0 }),
      env: FLAG_ON,
    });

    expect(connects.scopes.length).toBeGreaterThan(0);
    expect(connects.scopes.every((s) => s === null)).toBe(true);
  });

  test('the boot read SEEDS the instance-owner registry before any plugin can emit', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const connects = { scopes: [] as Array<string | null>, events: [] as string[] };
    const db = makeDb(observed, [instanceRow('a1', TENANT_A)], counters);

    expect(lookupInstanceOwner('a1')).toBeNull();
    await reconnectWithPool(db, makeConnectRegistry(connects), {
      delayBetweenMs: 0,
      authPlaneDb: fakeAuthPlaneDb([TENANT_A], { selects: 0 }),
      env: FLAG_ON,
    });
    // This is what makes the very first `message.received` of a boot carry a
    // trusted tenant rather than a legacy envelope.
    expect(lookupInstanceOwner('a1')).toBe(TENANT_A);
  });

  test('the concurrency ceiling is GLOBAL across the enumerated tenants, not per tenant', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const connects = { scopes: [] as Array<string | null>, events: [] as string[] };
    const db = makeDb(
      observed,
      [
        instanceRow('a1', TENANT_A),
        instanceRow('a2', TENANT_A),
        instanceRow('b1', TENANT_B),
        instanceRow('b2', TENANT_B),
      ],
      counters,
    );

    const results = await reconnectWithPool(db, makeConnectRegistry(connects), {
      maxConcurrent: 3,
      delayBetweenMs: 0,
      authPlaneDb: fakeAuthPlaneDb([TENANT_A, TENANT_B], { selects: 0 }),
      env: FLAG_ON,
    });

    expect(results.attempted).toBe(4);
    // The fan-out collects every tenant's rows into ONE pending list and batches
    // that list, so the first wave is tenant-MIXED and `maxConcurrent` is the
    // process-wide ceiling. Pinned deliberately: the function's own comment once
    // claimed a per-tenant ceiling, which the code has never implemented.
    expect(connects.events.slice(0, 3)).toEqual(['start:a1', 'start:a2', 'start:b1']);
  });
});
