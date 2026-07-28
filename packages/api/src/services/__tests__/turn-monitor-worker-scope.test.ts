/**
 * Turn-monitor worker-context boundary (G5; ADR-0008).
 *
 * The monitor is a 10-second INTERVAL: no request, no credential, no envelope.
 * Every tick it read whole-table (`turns.getStale`) and then, per stale turn,
 * called `instanceService.getById` for the live stalled-timeout config plus
 * `incrementNudge` / `close`. All of it on the ambient pool — which is why it
 * was the worker caller keeping BOTH `services/instances.ts::instances` and
 * `services/turns.ts::turns` in `pending-G5-conversion`.
 *
 * This file is the enforcement the static guard cannot provide (run12's
 * FIX-FIRST lesson: the guard sees the SERVICE, never the CALL SITE). It probes
 * every helper the tick reaches under a live tenant:
 *
 *   1. LEGACY WORLD IS BYTE-IDENTICAL — with no `db`/`authPlaneDb` wired, or
 *      with the flag off, the tick is the pre-G5 one: one ambient `getStale`, no
 *      enumeration, no scope, no extra query.
 *   2. ENUMERATED, NOT SCANNED — flag-on, the stale read runs once per ACTIVE
 *      tenant inside that tenant's worker scope. Under RLS enforcement the
 *      global scan is not expressible, so a cron must discover whose work exists.
 *   3. EVERY DB HELPER IS SCOPED — `getById`, `incrementNudge` and `close` each
 *      observe the turn's own tenant scope, not merely the first one.
 *   4. NO CROSS-TENANT BLEED — a turn owned by tenant B is never processed in
 *      tenant A's pass.
 *   5. THE SCOPE DOES NOT SPAN THE PUBLISH — `publishTurnNudge` and friends emit
 *      events; a worker transaction held across a publish would make the event a
 *      pre-commit side effect (a phantom on rollback).
 */

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { Database } from '@omni/db';
import { MULTITENANCY_FLAG_ENV } from '../../tenancy/feature-flag';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import * as turnEvents from '../turn-events';
import { TurnMonitor } from '../turn-monitor';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';

const FLAG_ON: NodeJS.ProcessEnv = { [MULTITENANCY_FLAG_ENV]: 'true' };
const FLAG_OFF: NodeJS.ProcessEnv = {};

const IDLE_15_MIN = () => new Date(Date.now() - 15 * 60_000);
const IDLE_40_MIN = () => new Date(Date.now() - 40 * 60_000);

interface StubTurn {
  id: string;
  instanceId: string;
  chatId: string;
  lastActivityAt: Date;
  nudgeCount: number;
  tenantId: string | null;
  startedAt?: Date;
  closedAt?: Date | null;
  messagesSent?: number;
}

/** Auth-plane fake: returns the active tenants, counting its reads. */
function fakeAuthPlaneDb(ids: string[], counter: { selects: number }): Database {
  return {
    select: () => {
      counter.selects += 1;
      return { from: () => ({ where: async () => ids.map((id) => ({ id })) }) };
    },
  } as unknown as Database;
}

/** Worker-scope fake: `transaction` runs the callback, counting openings. */
function fakeScopeDb(counter: { transactions: number }): Database {
  return {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      counter.transactions += 1;
      return cb({ execute: async () => [] as unknown });
    },
  } as unknown as Database;
}

function makeMonitor(opts: {
  turns: StubTurn[];
  tenants?: string[];
  env?: NodeJS.ProcessEnv;
  wireDb?: boolean;
}) {
  const observed: Array<{ helper: string; turnId?: string; scope: string | null }> = [];
  const counters = { selects: 0, transactions: 0 };
  let staleReads = 0;

  const db = fakeScopeDb(counters);
  const monitor = new TurnMonitor({
    turnService: {
      getStale: async () => {
        staleReads += 1;
        observed.push({ helper: 'getStale', scope: currentTenantScope()?.tenantId ?? null });
        return opts.turns;
      },
      incrementNudge: async (id: string) => {
        observed.push({ helper: 'incrementNudge', turnId: id, scope: currentTenantScope()?.tenantId ?? null });
      },
      close: async (id: string) => {
        observed.push({ helper: 'close', turnId: id, scope: currentTenantScope()?.tenantId ?? null });
        return { id, startedAt: new Date(Date.now() - 60_000), closedAt: new Date(), messagesSent: 1 };
      },
    } as unknown as never,
    instanceService: {
      getById: async (id: string) => {
        observed.push({ helper: 'getById', turnId: id, scope: currentTenantScope()?.tenantId ?? null });
        return { id, agentStalledTimeoutMs: 600_000 };
      },
    } as unknown as never,
    ...(opts.wireDb === false
      ? {}
      : { db, authPlaneDb: fakeAuthPlaneDb(opts.tenants ?? [], counters), env: opts.env ?? FLAG_OFF }),
  });

  const tick = () => (monitor as unknown as { tick: () => Promise<void> }).tick();
  return { tick, observed, counters, staleReads: () => staleReads };
}

describe('turn-monitor — legacy world is byte-identical', () => {
  test('no db wired: one ambient getStale, no enumeration, no scope', async () => {
    const { tick, observed, counters, staleReads } = makeMonitor({
      wireDb: false,
      turns: [
        { id: 't1', instanceId: 'i1', chatId: 'c1', lastActivityAt: IDLE_15_MIN(), nudgeCount: 0, tenantId: null },
      ],
    });
    await tick();

    expect(staleReads()).toBe(1);
    expect(counters.selects).toBe(0);
    expect(counters.transactions).toBe(0);
    expect(observed.every((o) => o.scope === null)).toBe(true);
    // The per-turn work still happened — this is a behaviour-preserving path.
    expect(observed.map((o) => o.helper)).toContain('incrementNudge');
  });

  test('db wired but flag OFF: still one ambient pass and NO auth-plane query', async () => {
    const { tick, observed, counters, staleReads } = makeMonitor({
      env: FLAG_OFF,
      tenants: [TENANT_A],
      turns: [
        { id: 't1', instanceId: 'i1', chatId: 'c1', lastActivityAt: IDLE_15_MIN(), nudgeCount: 0, tenantId: null },
      ],
    });
    await tick();

    expect(staleReads()).toBe(1);
    expect(counters.selects).toBe(0);
    expect(observed.every((o) => o.scope === null)).toBe(true);
  });
});

describe('turn-monitor — tenant world', () => {
  test('the stale read is enumerated per ACTIVE tenant and runs inside that tenant scope', async () => {
    const { tick, observed, counters, staleReads } = makeMonitor({
      env: FLAG_ON,
      tenants: [TENANT_A, TENANT_B],
      turns: [],
    });
    await tick();

    expect(counters.selects).toBe(1);
    // One scoped read per tenant, plus the transitional NULL-tenant pass that
    // only exists outside enforcement.
    expect(staleReads()).toBe(3);
    const scopes = observed.filter((o) => o.helper === 'getStale').map((o) => o.scope);
    expect(scopes).toEqual([TENANT_A, TENANT_B, null]);
  });

  test('EVERY per-turn DB helper observes the turn’s own tenant scope', async () => {
    const { tick, observed } = makeMonitor({
      env: FLAG_ON,
      tenants: [TENANT_A],
      turns: [
        {
          id: 't-nudge',
          instanceId: 'i1',
          chatId: 'c1',
          lastActivityAt: IDLE_15_MIN(),
          nudgeCount: 0,
          tenantId: TENANT_A,
        },
        {
          // The STALLED branch: `nudgeCount === 2` AND idle past the instance's
          // stalled threshold (600s default; the stub instance keeps the
          // default). It is a FOURTH scoped DB block — `handleStalled`'s own
          // `incrementNudge` — that no other case in this file or in
          // turn-monitor-fallback.test.ts reaches under a wired db, so without
          // this stub deleting its `runTenantWorkDb` wrapper changes nothing
          // any test can see.
          id: 't-stalled',
          instanceId: 'i3',
          chatId: 'c3',
          lastActivityAt: IDLE_15_MIN(),
          nudgeCount: 2,
          tenantId: TENANT_A,
        },
        {
          id: 't-timeout',
          instanceId: 'i2',
          chatId: 'c2',
          lastActivityAt: IDLE_40_MIN(),
          nudgeCount: 1,
          tenantId: TENANT_A,
        },
      ],
    });
    await tick();

    const scopedHelpers = observed.filter((o) => o.helper !== 'getStale');
    expect(scopedHelpers.length).toBeGreaterThan(0);
    for (const entry of scopedHelpers) {
      expect(entry.scope).toBe(TENANT_A);
    }
    // The stalled-timeout config read is the `instances` site this leg converts.
    expect(scopedHelpers.some((o) => o.helper === 'getById')).toBe(true);
    expect(scopedHelpers.some((o) => o.helper === 'close')).toBe(true);
    // Both `incrementNudge` CALL SITES — the nudge branch and the stalled
    // branch — each inside their own scope, named so a miss is legible.
    expect(
      scopedHelpers
        .filter((o) => o.helper === 'incrementNudge')
        .map((o) => o.turnId)
        .sort(),
    ).toEqual(['t-nudge', 't-stalled']);
  });

  test('a turn owned by tenant B is not processed in tenant A’s pass', async () => {
    const { tick, observed } = makeMonitor({
      env: FLAG_ON,
      tenants: [TENANT_A],
      turns: [
        {
          id: 't-b',
          instanceId: 'i-b',
          chatId: 'c-b',
          lastActivityAt: IDLE_15_MIN(),
          nudgeCount: 0,
          tenantId: TENANT_B,
        },
      ],
    });
    await tick();

    expect(observed.filter((o) => o.helper === 'incrementNudge')).toEqual([]);
  });

  test('the worker scope does NOT span the event publish', async () => {
    // CAPTURE, then assert in the test body. An `expect` thrown INSIDE this mock
    // would be swallowed on its way back: `periodic-tenant-work.ts`'s per-tenant
    // catch logs `periodic tenant pass failed` and `turn-monitor.ts`'s tick catch
    // logs `Turn monitor tick failed`, and Bun does not fail a test for a caught
    // assertion — the probe for the spec's CRITICAL TRAP ("a worker transaction
    // must never outlive its work item") would pass no matter what the code did.
    // Same technique as agent-dispatcher-worker-scope.test.ts.
    const scopesAtPublish: Array<string | null> = [];
    const spy = spyOn(turnEvents, 'publishTurnNudge').mockImplementation(() => {
      scopesAtPublish.push(currentTenantScope()?.tenantId ?? null);
    });
    try {
      const { tick } = makeMonitor({
        env: FLAG_ON,
        tenants: [TENANT_A],
        turns: [
          {
            id: 't1',
            instanceId: 'i1',
            chatId: 'c1',
            lastActivityAt: IDLE_15_MIN(),
            nudgeCount: 0,
            tenantId: TENANT_A,
          },
        ],
      });
      await tick();
      expect(spy).toHaveBeenCalledTimes(1);
      // One publish, and the scope was already closed when it happened.
      expect(scopesAtPublish).toEqual([null]);
    } finally {
      spy.mockRestore();
    }
  });

  test('one tenant’s failing pass does not starve the sibling', async () => {
    const counters = { selects: 0, transactions: 0 };
    const seen: string[] = [];
    let first = true;
    const monitor = new TurnMonitor({
      turnService: {
        getStale: async () => {
          const tenantId = currentTenantScope()?.tenantId ?? null;
          if (tenantId === TENANT_A && first) {
            first = false;
            throw new Error('tenant A read exploded');
          }
          if (tenantId) seen.push(tenantId);
          return [];
        },
        incrementNudge: async () => {},
        close: async () => null,
      } as unknown as never,
      instanceService: { getById: async () => ({}) } as unknown as never,
      db: fakeScopeDb(counters),
      authPlaneDb: fakeAuthPlaneDb([TENANT_A, TENANT_B], counters),
      env: FLAG_ON,
    });

    await (monitor as unknown as { tick: () => Promise<void> }).tick();
    expect(seen).toEqual([TENANT_B]);
  });
});

afterEach(() => {
  // Nothing global to reset — the monitor holds no module state — but keep the
  // hook so a future addition has an obvious home.
});
