/**
 * Durable event consumers — pure-logic units (#989).
 *
 * The DB-bound contract (paging, ack monotonicity against real rows, RLS
 * containment) lives in `__tests__/event-consumers-postgres.test.ts`; these
 * cover the pure pieces: the payload matcher (which MUST be the events-wait /
 * automation matcher), initial-cursor resolution, and lag math.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ValidationError } from '@omni/core';
import type { EventBus } from '@omni/core';
import type { ConsumerAccessFilter, Database, DurableConsumer, OmniEvent, SharedLeaseState } from '@omni/db';
import { durableConsumers, omniEvents } from '@omni/db';
import { type SQL, and, gt } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  type ConsumerCaller,
  DEFAULT_CONSUMER_SETTLE_MS,
  EventConsumerService,
  accessFilterClause,
  canAccessConsumer,
  claimLease,
  computeLag,
  matchesConsumerAccess,
  matchesConsumerPayload,
  narrowToCaller,
  planSharedPull,
  releaseLease,
  resolveConsumerScope,
  resolveConsumerSettleMs,
  resolveInitialCursor,
  truncateAtUnready,
} from '../event-consumers';
import { eventTypeFilterClause } from '../events';

describe('matchesConsumerPayload', () => {
  test('no filters = always match (and null filters too)', () => {
    expect(matchesConsumerPayload({ rawPayload: { a: 1 } }, undefined)).toBe(true);
    expect(matchesConsumerPayload({ rawPayload: { a: 1 } }, null)).toBe(true);
    expect(matchesConsumerPayload({ rawPayload: null }, [])).toBe(true);
  });

  test('conditions run through the automation matcher (nested dot paths)', () => {
    const row = { rawPayload: { user: { id: 42 }, status: 'open' } };
    expect(matchesConsumerPayload(row, [{ field: 'user.id', operator: 'eq', value: 42 }])).toBe(true);
    expect(matchesConsumerPayload(row, [{ field: 'user.id', operator: 'eq', value: 43 }])).toBe(false);
    expect(
      matchesConsumerPayload(row, [
        { field: 'status', operator: 'eq', value: 'open' },
        { field: 'user.id', operator: 'gte', value: 40 },
      ]),
    ).toBe(true);
    expect(
      matchesConsumerPayload(row, [
        { field: 'status', operator: 'eq', value: 'closed' },
        { field: 'user.id', operator: 'eq', value: 42 },
      ]),
    ).toBe(false);
  });

  test('a null rawPayload matches only payload-independent conditions', () => {
    expect(matchesConsumerPayload({ rawPayload: null }, [{ field: 'status', operator: 'exists' }])).toBe(false);
    expect(matchesConsumerPayload({ rawPayload: null }, [{ field: 'status', operator: 'not_exists' }])).toBe(true);
  });
});

describe('resolveInitialCursor', () => {
  test("'now' starts at the journal head, 'beginning' at 0", () => {
    expect(resolveInitialCursor('now', 123)).toBe(123);
    expect(resolveInitialCursor('beginning', 123)).toBe(0);
    expect(resolveInitialCursor('now', 0)).toBe(0);
  });
});

describe('computeLag', () => {
  test('lag = head - cursor, floored at 0', () => {
    expect(computeLag(10, 4)).toBe(6);
    expect(computeLag(10, 10)).toBe(0);
    // A cursor past the head (journal pruned/reset) must not report negative lag.
    expect(computeLag(3, 10)).toBe(0);
  });
});

describe('shared consumer leases (#1188)', () => {
  /** Simulated journal seqs 1..n; a pull leases up to `limit` rows after the plan's position. */
  function pull(state: SharedLeaseState, journal: number[], limit: number, now: number, id: string) {
    const plan = planSharedPull(state, now);
    const rows = plan.reclaim
      ? journal.filter((seq) => seq > plan.reclaim.from && seq <= plan.reclaim.to)
      : journal.filter((seq) => seq > plan.after).slice(0, limit);
    if (rows.length === 0) return { state, rows, id: null };
    const from = plan.reclaim ? plan.reclaim.from : plan.after;
    const lease = { id, from, to: rows[rows.length - 1] as number, expiresAt: now + 1000 };
    return { state: claimLease(state, lease, plan.reclaim?.id), rows, id };
  }

  test('two pullers on one shared consumer receive each event exactly once between them', () => {
    const journal = Array.from({ length: 10 }, (_, i) => i + 1);
    let state: SharedLeaseState = { claimed: 0, leases: [] };
    const seen: Record<string, number[]> = { a: [], b: [] };
    let cursor = 0;
    for (let round = 0; round < 10; round++) {
      // Both pull before either acks — the concurrent case.
      const a = pull(state, journal, 2, 0, `a${round}`);
      state = a.state;
      const b = pull(state, journal, 2, 0, `b${round}`);
      state = b.state;
      seen.a?.push(...a.rows);
      seen.b?.push(...b.rows);
      // Ack out of order: b first.
      for (const id of [b.id, a.id]) {
        if (!id) continue;
        const released = releaseLease(state, id);
        if (!released) throw new Error('lease vanished');
        state = released.state;
        cursor = released.cursor;
      }
    }
    expect([...(seen.a ?? []), ...(seen.b ?? [])].sort((x, y) => x - y)).toEqual(journal);
    expect(seen.a?.length).toBeGreaterThan(0);
    expect(seen.b?.length).toBeGreaterThan(0);
    expect(cursor).toBe(10);
  });

  test('cursor waits for the oldest outstanding lease', () => {
    let state: SharedLeaseState = { claimed: 0, leases: [] };
    state = claimLease(state, { id: 'a', from: 0, to: 5, expiresAt: 1 });
    state = claimLease(state, { id: 'b', from: 5, to: 9, expiresAt: 1 });
    const afterB = releaseLease(state, 'b');
    expect(afterB?.cursor).toBe(0);
    expect(afterB && releaseLease(afterB.state, 'a')?.cursor).toBe(9);
  });

  test('an unacked lease is redelivered after expiry and the stale ack is refused', () => {
    const journal = [1, 2, 3];
    let state: SharedLeaseState = { claimed: 0, leases: [] };
    const first = pull(state, journal, 10, 0, 'crashed');
    state = first.state;
    expect(pull(state, journal, 10, 500, 'early').rows).toEqual([]); // still leased
    const retry = pull(state, journal, 10, 1000, 'retry');
    expect(retry.rows).toEqual([1, 2, 3]);
    expect(releaseLease(retry.state, 'crashed')).toBeNull();
    expect(releaseLease(retry.state, 'retry')?.cursor).toBe(3);
  });
});

// ============================================================================
// Opt-in access filter (0083): SQL predicate inside scanPage, gated create
// ============================================================================

const ENV = 'OMNI_JOURNAL_ACCESS_DECISION';

function render(clause: SQL | undefined): { sql: string; params: unknown[] } {
  if (!clause) throw new Error('expected a clause');
  const q = new PgDialect().sqlToQuery(clause);
  return { sql: q.sql.replace(/\s+/g, ' '), params: q.params };
}

function consumerRow(overrides: Partial<DurableConsumer> = {}): DurableConsumer {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'c1',
    eventType: 'message.received',
    excludeTypes: null,
    filters: null,
    cursor: 0,
    shared: false,
    waitForReady: false,
    leaseState: null,
    accessFilter: 'all',
    scoped: false,
    instanceIds: null,
    ownerKeyId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/**
 * DB-free pool: getByName returns `consumer`, head() returns `head`, the
 * journal scan returns `journal` (no rows by default) — the rows the SQL
 * WHERE would have returned; the mock does not evaluate it. Every
 * journal-scan WHERE and every cursor update is captured.
 */
function mockPool(consumer: DurableConsumer, head = 0, journal: OmniEvent[] = []) {
  const scanWheres: SQL[] = [];
  const inserted: unknown[] = [];
  const cursorUpdates: unknown[] = [];
  const select = mock((fields?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      const rows = table === durableConsumers ? [consumer] : fields && 'head' in fields ? [{ head }] : journal;
      const chain = {
        where: (cond: SQL) => {
          if (table === omniEvents) scanWheres.push(cond);
          return chain;
        },
        orderBy: () => chain,
        limit: () => chain,
        // biome-ignore lint/suspicious/noThenProperty: drizzle query builders are thenables
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    },
  }));
  const insert = mock(() => ({
    values: (v: Record<string, unknown>) => {
      inserted.push(v);
      return {
        onConflictDoNothing: () => ({
          returning: () =>
            Promise.resolve([consumerRow({ ...v, cursor: Number(v.cursor) } as Partial<DurableConsumer>)]),
        }),
      };
    },
  }));
  const update = mock(() => ({
    set: (v: Record<string, unknown>) => {
      cursorUpdates.push(v.cursor);
      return { where: () => Promise.resolve() };
    },
  }));
  return { db: { select, insert, update } as unknown as Database, select, insert, scanWheres, inserted, cursorUpdates };
}

describe('accessFilterClause', () => {
  test("'all' (and a missing filter) adds no predicate", () => {
    expect(accessFilterClause('all')).toBeUndefined();
    expect(accessFilterClause(undefined)).toBeUndefined();
    expect(accessFilterClause(null)).toBeUndefined();
  });

  test("'allowed' / 'denied' produce access_decision = <filter>", () => {
    for (const filter of ['allowed', 'denied'] as const) {
      const { sql, params } = render(accessFilterClause(filter));
      expect(sql).toBe('"omni_events"."access_decision" = $1');
      expect(params).toEqual([filter]);
    }
  });
});

describe('scanPage access predicate (via pull)', () => {
  function todaysWhere(): { sql: string; params: unknown[] } {
    // The pre-0083 scanPage WHERE: journal_seq bound + type clause, nothing else.
    return render(
      and(gt(omniEvents.journalSeq, 0), undefined, eventTypeFilterClause(['message.received'], undefined)) as SQL,
    );
  }

  test("an 'all' consumer scans with exactly the unfiltered WHERE", async () => {
    const pool = mockPool(consumerRow({ accessFilter: 'all' }));
    await new EventConsumerService(pool.db).pull('c1');
    expect(pool.scanWheres).toHaveLength(1);
    expect(render(pool.scanWheres[0])).toEqual(todaysWhere());
  });

  test("an 'allowed' / 'denied' consumer gets the eq predicate in SQL", async () => {
    for (const filter of ['allowed', 'denied'] as ConsumerAccessFilter[]) {
      const pool = mockPool(consumerRow({ accessFilter: filter }));
      await new EventConsumerService(pool.db).pull('c1');
      const { sql, params } = render(pool.scanWheres[0]);
      expect(sql).toContain('"omni_events"."access_decision" = $');
      expect(sql.startsWith(todaysWhere().sql.slice(0, -1))).toBe(true);
      expect(params).toEqual([...todaysWhere().params, filter]);
    }
  });
});

describe('create() access option', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[ENV];
    delete process.env[ENV];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  function bus() {
    return { publishGeneric: mock(async () => {}) } as unknown as EventBus & {
      publishGeneric: ReturnType<typeof mock>;
    };
  }

  test('access != all with the env off is a ValidationError naming the env var, before any DB call', async () => {
    for (const access of ['allowed', 'denied'] as const) {
      const pool = mockPool(consumerRow());
      const service = new EventConsumerService(pool.db, bus());
      const error = await service.create({ name: 'c1', eventType: 'message.received', access }).catch((e) => e);
      expect(error).toBeInstanceOf(ValidationError);
      expect(String(error.message)).toContain(ENV);
      expect(pool.select).not.toHaveBeenCalled();
      expect(pool.insert).not.toHaveBeenCalled();
    }
    process.env[ENV] = 'false';
    const pool = mockPool(consumerRow());
    const error = await new EventConsumerService(pool.db)
      .create({ name: 'c1', eventType: 'x', access: 'denied' })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
  });

  test("default and 'all' store accessFilter 'all' with the env off; created event payload unchanged", async () => {
    for (const access of [undefined, 'all'] as const) {
      const pool = mockPool(consumerRow(), 5);
      const eventBus = bus();
      const created = await new EventConsumerService(pool.db, eventBus).create({
        name: 'c1',
        eventType: 'message.received',
        ...(access ? { access } : {}),
      });
      expect(pool.inserted[0]).toMatchObject({ accessFilter: 'all', cursor: 5 });
      expect(created.accessFilter).toBe('all');
      expect(eventBus.publishGeneric).toHaveBeenCalledWith('system.consumer.created', {
        consumerId: created.id,
        name: 'c1',
        eventType: 'message.received',
        cursor: 5,
        shared: false,
      });
    }
  });

  test("with the env on, 'allowed' is stored", async () => {
    process.env[ENV] = 'true';
    const pool = mockPool(consumerRow(), 5);
    const created = await new EventConsumerService(pool.db).create({
      name: 'c1',
      eventType: 'message.received',
      access: 'allowed',
    });
    expect(pool.inserted[0]).toMatchObject({ accessFilter: 'allowed' });
    expect(created.accessFilter).toBe('allowed');
  });
});

describe('truncateAtUnready (opt-in journal readiness gate)', () => {
  const NOW = 1_000_000;
  const SETTLE = 5_000;
  const row = (seq: number, journalReady: boolean, ageMs = 0) => ({
    journalSeq: seq,
    journalReady,
    receivedAt: new Date(NOW - ageMs),
  });
  const seqs = (page: Array<{ journalSeq: number }>) => page.map((r) => r.journalSeq);

  test('cuts the page just before the first young not-ready row', () => {
    const page = [row(1, true), row(2, true), row(3, false, 100), row(4, true), row(5, false, 100)];
    expect(seqs(truncateAtUnready(page, true, SETTLE, NOW))).toEqual([1, 2]);
  });

  test('a not-ready row older than the settle window counts as ready', () => {
    const page = [row(1, true), row(2, false, SETTLE + 1), row(3, true), row(4, false, SETTLE)];
    expect(seqs(truncateAtUnready(page, true, SETTLE, NOW))).toEqual([1, 2, 3, 4]);
    expect(seqs(truncateAtUnready([row(1, false, SETTLE - 1)], true, SETTLE, NOW))).toEqual([]);
  });

  test('truncates to empty when the first row is held', () => {
    const page = [row(7, false, 10), row(8, true)];
    expect(truncateAtUnready(page, true, SETTLE, NOW)).toEqual([]);
  });

  test("returns the page unchanged when waitForReady is false (today's behaviour)", () => {
    const page = [row(1, true), row(2, false, 0), row(3, true)];
    const out = truncateAtUnready(page, false, SETTLE, NOW);
    expect(out).toBe(page);
    expect(seqs(out)).toEqual([1, 2, 3]);
  });

  test('an all-ready page is unchanged with the gate on', () => {
    const page = [row(1, true), row(2, true)];
    expect(truncateAtUnready(page, true, SETTLE, NOW)).toEqual(page);
  });
});

describe('resolveConsumerSettleMs', () => {
  test('defaults to 5000 ms when unset, blank or invalid', () => {
    expect(DEFAULT_CONSUMER_SETTLE_MS).toBe(5_000);
    expect(resolveConsumerSettleMs(undefined)).toBe(5_000);
    expect(resolveConsumerSettleMs('')).toBe(5_000);
    expect(resolveConsumerSettleMs('soon')).toBe(5_000);
    expect(resolveConsumerSettleMs('-1')).toBe(5_000);
  });

  test('honours a numeric EVENT_CONSUMER_SETTLE_MS', () => {
    expect(resolveConsumerSettleMs('250')).toBe(250);
    expect(resolveConsumerSettleMs('0')).toBe(0);
  });
});

describe('instance-scoped consumers (opt-in, 0082)', () => {
  const INST_A = '11111111-1111-4111-8111-1111111111aa';
  const INST_B = '11111111-1111-4111-8111-1111111111bb';
  const INST_C = '11111111-1111-4111-8111-1111111111cc';
  const KEY_RESTRICTED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const KEY_ADMIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const restricted: ConsumerCaller = { keyId: KEY_RESTRICTED, instanceIds: [INST_A, INST_B] };
  const otherRestricted: ConsumerCaller = { keyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', instanceIds: [INST_A] };
  const unrestricted: ConsumerCaller = { keyId: KEY_ADMIN, instanceIds: null };
  const callers = { restricted, otherRestricted, unrestricted, keyless: { keyId: null, instanceIds: null } };

  /** Run `fn` and return the thrown error's code (or 'ok'). */
  function codeOf(fn: () => unknown): string {
    try {
      fn();
      return 'ok';
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  }

  test('no new option: identical behaviour — an unscoped create resolves to the legacy columns for every key', () => {
    for (const caller of [...Object.values(callers), undefined]) {
      expect(resolveConsumerScope({}, caller)).toEqual({ scoped: false, instanceIds: null, ownerKeyId: null });
      expect(resolveConsumerScope({ scoped: false }, caller)).toEqual({
        scoped: false,
        instanceIds: null,
        ownerKeyId: null,
      });
    }
  });

  test('no new option: identical behaviour — an unscoped consumer is accessible to every caller', () => {
    const consumer = { scoped: false, ownerKeyId: null };
    for (const caller of [...Object.values(callers), undefined]) {
      expect(canAccessConsumer(consumer, caller)).toBe(true);
    }
  });

  test('no new option: instanceIds without scoped: true is ignored, as an unknown field was before', () => {
    const unscoped = { scoped: false, instanceIds: null, ownerKeyId: null } as const;
    expect(resolveConsumerScope({ instanceIds: [INST_A] }, restricted)).toEqual(unscoped);
    expect(resolveConsumerScope({ scoped: false, instanceIds: [INST_A] }, unrestricted)).toEqual(unscoped);
    expect(resolveConsumerScope({ instanceIds: ['not-a-uuid', 42] }, undefined)).toEqual(unscoped);
    expect(resolveConsumerScope({ instanceIds: 'anything' }, restricted)).toEqual(unscoped);
  });

  test('scoped: malformed instanceIds is a 400', () => {
    expect(codeOf(() => resolveConsumerScope({ scoped: true, instanceIds: ['not-a-uuid'] }, restricted))).toBe(
      'VALIDATION',
    );
    expect(codeOf(() => resolveConsumerScope({ scoped: true, instanceIds: INST_A }, unrestricted))).toBe('VALIDATION');
  });

  test('narrowToCaller: a restricted owner pages only the stored instances its key still has', () => {
    const base = { scoped: true, instanceIds: [INST_A, INST_B], ownerKeyId: KEY_RESTRICTED } as DurableConsumer;
    expect(narrowToCaller(base, { keyId: KEY_RESTRICTED, instanceIds: [INST_B, INST_C] }).instanceIds).toEqual([
      INST_B,
    ]);
    expect(narrowToCaller(base, { keyId: KEY_RESTRICTED, instanceIds: [INST_C] }).instanceIds).toEqual([]);
    expect(narrowToCaller(base, unrestricted)).toBe(base);
    expect(narrowToCaller(base, undefined)).toBe(base);
    const unscopedConsumer = { scoped: false, instanceIds: null, ownerKeyId: null } as DurableConsumer;
    expect(narrowToCaller(unscopedConsumer, restricted)).toBe(unscopedConsumer);
  });

  test('restricted key: omitted instanceIds = all of the key instances; owner = calling key', () => {
    expect(resolveConsumerScope({ scoped: true }, restricted)).toEqual({
      scoped: true,
      instanceIds: [INST_A, INST_B],
      ownerKeyId: KEY_RESTRICTED,
    });
  });

  test('restricted key: requested subset is kept (deduplicated)', () => {
    expect(resolveConsumerScope({ scoped: true, instanceIds: [INST_B, INST_B] }, restricted)).toEqual({
      scoped: true,
      instanceIds: [INST_B],
      ownerKeyId: KEY_RESTRICTED,
    });
  });

  test('restricted key: an instance outside the key is 403, an empty intersection is 400', () => {
    expect(codeOf(() => resolveConsumerScope({ scoped: true, instanceIds: [INST_A, INST_C] }, restricted))).toBe(
      'FORBIDDEN',
    );
    expect(codeOf(() => resolveConsumerScope({ scoped: true, instanceIds: [] }, restricted))).toBe('VALIDATION');
    // A UUID owner key, so the zero-instance branch (not the owner check) is what refuses it.
    expect(codeOf(() => resolveConsumerScope({ scoped: true }, { keyId: KEY_RESTRICTED, instanceIds: [] }))).toBe(
      'VALIDATION',
    );
  });

  test('restricted key: instance ids match case-insensitively and are stored lowercase', () => {
    const upper = resolveConsumerScope({ scoped: true, instanceIds: [INST_A.toUpperCase()] }, restricted);
    expect(upper).toMatchObject({ scoped: true, instanceIds: [INST_A] });
    const mixedKey: ConsumerCaller = { keyId: KEY_RESTRICTED, instanceIds: [INST_A.toUpperCase()] };
    expect(resolveConsumerScope({ scoped: true, instanceIds: [INST_A] }, mixedKey)).toMatchObject({
      instanceIds: [INST_A],
    });
    expect(resolveConsumerScope({ scoped: true, instanceIds: [INST_B.toUpperCase()] }, unrestricted)).toMatchObject({
      instanceIds: [INST_B],
    });
  });

  test('unrestricted key: instanceIds is required and non-empty', () => {
    expect(codeOf(() => resolveConsumerScope({ scoped: true }, unrestricted))).toBe('VALIDATION');
    expect(codeOf(() => resolveConsumerScope({ scoped: true, instanceIds: [] }, unrestricted))).toBe('VALIDATION');
    expect(resolveConsumerScope({ scoped: true, instanceIds: [INST_C] }, unrestricted)).toEqual({
      scoped: true,
      instanceIds: [INST_C],
      ownerKeyId: KEY_ADMIN,
    });
  });

  test('a scoped consumer needs a calling key (with a uuid id) to own it', () => {
    expect(
      codeOf(() =>
        resolveConsumerScope({ scoped: true, instanceIds: [INST_A] }, { keyId: 'worker-x', instanceIds: null }),
      ),
    ).toBe('VALIDATION');
    expect(codeOf(() => resolveConsumerScope({ scoped: true, instanceIds: [INST_A] }, callers.keyless))).toBe(
      'VALIDATION',
    );
    expect(codeOf(() => resolveConsumerScope({ scoped: true, instanceIds: [INST_A] }, undefined))).toBe('VALIDATION');
  });

  test('a scoped consumer is visible to its owner and unrestricted keys only', () => {
    const consumer = { scoped: true, ownerKeyId: KEY_RESTRICTED };
    expect(canAccessConsumer(consumer, restricted)).toBe(true);
    expect(canAccessConsumer(consumer, unrestricted)).toBe(true);
    expect(canAccessConsumer(consumer, otherRestricted)).toBe(false);
    expect(canAccessConsumer(consumer, { keyId: null, instanceIds: [INST_A] })).toBe(false);
    // An orphaned scoped consumer (owner key gone) stays reachable by unrestricted keys only.
    expect(canAccessConsumer({ scoped: true, ownerKeyId: null }, unrestricted)).toBe(true);
    expect(canAccessConsumer({ scoped: true, ownerKeyId: null }, { keyId: null, instanceIds: [] })).toBe(false);
  });
});

// ============================================================================
// Access filter x readiness gate: a claimed-but-unfilled row has no verdict
// yet, so an access-filtered waitForReady consumer widens the SQL predicate,
// truncates, then filters access in JS (review finding on #1299).
// ============================================================================

describe('accessFilterClause with waitForReady', () => {
  test("'allowed' / 'denied' widen to access_decision = <filter> OR journal_ready = false", () => {
    for (const filter of ['allowed', 'denied'] as const) {
      const { sql, params } = render(accessFilterClause(filter, true));
      expect(sql).toBe('("omni_events"."access_decision" = $1 or "omni_events"."journal_ready" = $2)');
      expect(params).toEqual([filter, false]);
    }
  });

  test("'all' still adds no predicate; without waitForReady the plain eq stays", () => {
    expect(accessFilterClause('all', true)).toBeUndefined();
    expect(render(accessFilterClause('allowed', false)).sql).toBe('"omni_events"."access_decision" = $1');
  });

  test('scanPage (via pull) carries the widened predicate only for access + waitForReady', async () => {
    const gated = mockPool(consumerRow({ accessFilter: 'allowed', waitForReady: true }));
    await new EventConsumerService(gated.db).pull('c1');
    expect(render(gated.scanWheres[0]).sql).toContain('"omni_events"."journal_ready" = $');

    const plain = mockPool(consumerRow({ accessFilter: 'allowed', waitForReady: false }));
    await new EventConsumerService(plain.db).pull('c1');
    expect(render(plain.scanWheres[0]).sql).not.toContain('journal_ready');

    const all = mockPool(consumerRow({ accessFilter: 'all', waitForReady: true }));
    await new EventConsumerService(all.db).pull('c1');
    expect(render(all.scanWheres[0]).sql).not.toContain('journal_ready');
    expect(render(all.scanWheres[0]).sql).not.toContain('access_decision');
  });
});

describe('matchesConsumerAccess', () => {
  test("'all' (and a missing filter) matches every row, decided or not", () => {
    for (const accessDecision of [null, 'allowed', 'denied', 'disabled'] as const) {
      expect(matchesConsumerAccess({ accessDecision }, 'all')).toBe(true);
      expect(matchesConsumerAccess({ accessDecision }, undefined)).toBe(true);
    }
  });

  test('a filter matches only its own verdict; NULL (unfilled) and disabled never match', () => {
    expect(matchesConsumerAccess({ accessDecision: 'allowed' }, 'allowed')).toBe(true);
    expect(matchesConsumerAccess({ accessDecision: 'denied' }, 'denied')).toBe(true);
    expect(matchesConsumerAccess({ accessDecision: 'denied' }, 'allowed')).toBe(false);
    expect(matchesConsumerAccess({ accessDecision: null }, 'allowed')).toBe(false);
    expect(matchesConsumerAccess({ accessDecision: 'disabled' }, 'denied')).toBe(false);
  });
});

describe('pull: access filter + waitForReady over a claimed-but-unfilled row', () => {
  const SETTLE_ENV = 'EVENT_CONSUMER_SETTLE_MS';
  let savedSettle: string | undefined;
  beforeEach(() => {
    savedSettle = process.env[SETTLE_ENV];
    delete process.env[SETTLE_ENV]; // default 5000 ms window
  });
  afterEach(() => {
    if (savedSettle === undefined) delete process.env[SETTLE_ENV];
    else process.env[SETTLE_ENV] = savedSettle;
  });

  /** A journal row as the scan returns it; `ageMs` back-dates receivedAt. */
  function journalRow(seq: number, fields: Partial<OmniEvent> & { ageMs?: number } = {}): OmniEvent {
    const { ageMs = 0, ...rest } = fields;
    return {
      id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
      eventType: 'message.received',
      journalSeq: seq,
      journalReady: true,
      accessDecision: null,
      rawPayload: null,
      receivedAt: new Date(Date.now() - ageMs),
      ...rest,
    } as OmniEvent;
  }
  const unfilled = (seq: number, ageMs = 0) => journalRow(seq, { journalReady: false, ageMs });
  const filled = (seq: number, accessDecision: 'allowed' | 'denied') => journalRow(seq, { accessDecision });
  const seqs = (items: OmniEvent[]) => items.map((r) => Number(r.journalSeq));
  const gated = (overrides: Partial<DurableConsumer> = {}) =>
    consumerRow({ accessFilter: 'allowed', waitForReady: true, ...overrides });

  test('an unfilled row ahead of a filled allowed row: nothing delivered, cursor not moved past it', async () => {
    const pool = mockPool(gated(), 2, [unfilled(1), filled(2, 'allowed')]);
    const page = await new EventConsumerService(pool.db).pull('c1');
    expect(page.items).toEqual([]);
    expect(page.cursor).toBe(0);
    expect(pool.cursorUpdates).toEqual([]);
  });

  test("after the fill writes 'allowed', both rows are delivered in order", async () => {
    const pool = mockPool(gated(), 2, [filled(1, 'allowed'), filled(2, 'allowed')]);
    const page = await new EventConsumerService(pool.db).pull('c1');
    expect(seqs(page.items)).toEqual([1, 2]);
    expect(page.cursor).toBe(2);
  });

  test("a row that fills as 'denied' is skipped and the cursor advances past it", async () => {
    // The widened SQL no longer returns the now-ready denied row 1.
    const pool = mockPool(gated(), 2, [filled(2, 'allowed')]);
    const page = await new EventConsumerService(pool.db).pull('c1');
    expect(seqs(page.items)).toEqual([2]);
    expect(page.cursor).toBe(2);
  });

  test("a 'denied' consumer delivers the denied fill and skips the allowed one", async () => {
    const held = mockPool(gated({ accessFilter: 'denied' }), 2, [unfilled(1), filled(2, 'denied')]);
    expect((await new EventConsumerService(held.db).pull('c1')).items).toEqual([]);
    const pool = mockPool(gated({ accessFilter: 'denied' }), 2, [filled(2, 'denied')]);
    expect(seqs((await new EventConsumerService(pool.db).pull('c1')).items)).toEqual([2]);
  });

  test('a dead unfilled row older than the settle window is skipped (not delivered) and does not stall', async () => {
    const alone = mockPool(gated(), 1, [unfilled(1, 60_000)]);
    const skipped = await new EventConsumerService(alone.db).pull('c1');
    expect(skipped.items).toEqual([]);
    expect(skipped.cursor).toBe(1);
    expect(alone.cursorUpdates).toEqual([1]);

    const before = mockPool(gated(), 2, [unfilled(1, 60_000), filled(2, 'allowed')]);
    const page = await new EventConsumerService(before.db).pull('c1');
    expect(seqs(page.items)).toEqual([2]);
    expect(page.cursor).toBe(2);
  });

  test("access 'all' + waitForReady holds the hollow row as before; 'all' without the gate delivers it", async () => {
    const held = mockPool(consumerRow({ waitForReady: true }), 2, [unfilled(1), filled(2, 'allowed')]);
    const page = await new EventConsumerService(held.db).pull('c1');
    expect(page.items).toEqual([]);
    expect(page.cursor).toBe(0);

    const open = mockPool(consumerRow(), 2, [unfilled(1), filled(2, 'allowed')]);
    expect(seqs((await new EventConsumerService(open.db).pull('c1')).items)).toEqual([1, 2]);
  });

  test('access without waitForReady: no truncation, the SQL-filtered rows are delivered as before', async () => {
    // Plain predicate: the unfilled row 1 is excluded in SQL, so the page is row 2 and the cursor
    // moves past row 1 — the documented late-fill gap that waitForReady closes.
    const pool = mockPool(consumerRow({ accessFilter: 'allowed' }), 2, [filled(2, 'allowed')]);
    const page = await new EventConsumerService(pool.db).pull('c1');
    expect(seqs(page.items)).toEqual([2]);
    expect(page.cursor).toBe(2);
  });
});
