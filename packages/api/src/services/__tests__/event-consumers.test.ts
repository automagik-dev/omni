/**
 * Durable event consumers — pure-logic units (#989).
 *
 * The DB-bound contract (paging, ack monotonicity against real rows, RLS
 * containment) lives in `__tests__/event-consumers-postgres.test.ts`; these
 * cover the pure pieces: the payload matcher (which MUST be the events-wait /
 * automation matcher), initial-cursor resolution, and lag math.
 */

import { describe, expect, test } from 'bun:test';
import type { SharedLeaseState } from '@omni/db';
import {
  DEFAULT_CONSUMER_SETTLE_MS,
  claimLease,
  computeLag,
  matchesConsumerPayload,
  planSharedPull,
  releaseLease,
  resolveConsumerSettleMs,
  resolveInitialCursor,
  truncateAtUnready,
} from '../event-consumers';

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
