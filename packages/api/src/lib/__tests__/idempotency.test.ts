/**
 * Unit tests for withIdempotency() — the durable-subscriber side-effect guard.
 *
 * Acceptance criterion (from #411): "5 inflight `message.received` events +
 * SIGTERM at T+100ms → on next boot, zero duplicate `send_message` or Agno
 * calls observed." We simulate that here with a stateful in-memory fake of
 * the `processed_events` table — the same SQL semantics drizzle would emit
 * (`ON CONFLICT DO NOTHING ... RETURNING`).
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { withIdempotency } from '../idempotency';

// ---------------------------------------------------------------------------
// Fake `Database` with the minimal Drizzle insert builder surface used by the
// helper. Stateful — claims survive across calls within a test, mimicking the
// real PG table that survives across NATS redeliveries.
// ---------------------------------------------------------------------------

interface FakeDb {
  db: Parameters<typeof withIdempotency>[0];
  /** Inspect what's been claimed (for assertions). */
  claimed: Set<string>;
  /** Insert builder call counter (for asserting no extra DB chatter). */
  insertCalls: { count: number };
}

function makeFakeDb(): FakeDb {
  const claimed = new Set<string>();
  const insertCalls = { count: 0 };

  // Drizzle pattern: db.insert(table).values(row).onConflictDoNothing().returning(cols)
  const insert = () => {
    insertCalls.count++;
    return {
      values: (row: { eventId: string; handler: string }) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            const key = `${row.eventId}::${row.handler}`;
            if (claimed.has(key)) return [];
            claimed.add(key);
            return [{ eventId: row.eventId }];
          },
        }),
      }),
    };
  };

  return {
    db: { insert } as unknown as Parameters<typeof withIdempotency>[0],
    claimed,
    insertCalls,
  };
}

// ---------------------------------------------------------------------------

describe('withIdempotency', () => {
  afterEach(() => {
    mock.restore();
  });

  it('runs fn on first delivery and returns executed:true', async () => {
    const fake = makeFakeDb();
    const fn = mock(async () => undefined);

    const result = await withIdempotency(fake.db, 'evt-1', 'session-cleaner', fn);

    expect(result.executed).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fake.claimed.has('evt-1::session-cleaner')).toBe(true);
  });

  it('skips fn on replay and returns executed:false', async () => {
    const fake = makeFakeDb();
    const fn = mock(async () => undefined);

    // First delivery — claims the row.
    await withIdempotency(fake.db, 'evt-1', 'session-cleaner', fn);
    // Second delivery (NATS redelivery after restart) — must skip.
    const replay = await withIdempotency(fake.db, 'evt-1', 'session-cleaner', fn);

    expect(replay.executed).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs fn EXACTLY ONCE across N replays (the #411 incident shape)', async () => {
    const fake = makeFakeDb();
    let sideEffectCount = 0;
    const fn = async () => {
      sideEffectCount++;
    };

    // Simulate the incident: a single trash-emoji event redelivered 5x across
    // two PM2 restarts. Without the guard, sideEffectCount would be 5.
    for (let i = 0; i < 5; i++) {
      await withIdempotency(fake.db, 'evt-trash-1', 'session-cleaner', fn);
    }

    expect(sideEffectCount).toBe(1);
  });

  it('separately tracks (eventId, handler) — same event, different handlers BOTH run once', async () => {
    const fake = makeFakeDb();
    const sessionCleanerFn = mock(async () => undefined);
    const dispatcherFn = mock(async () => undefined);

    // Same event.id seen by two independent durable consumers.
    await withIdempotency(fake.db, 'evt-1', 'session-cleaner', sessionCleanerFn);
    await withIdempotency(fake.db, 'evt-1', 'agent-dispatcher-msg', dispatcherFn);
    // Replays of both.
    await withIdempotency(fake.db, 'evt-1', 'session-cleaner', sessionCleanerFn);
    await withIdempotency(fake.db, 'evt-1', 'agent-dispatcher-msg', dispatcherFn);

    expect(sessionCleanerFn).toHaveBeenCalledTimes(1);
    expect(dispatcherFn).toHaveBeenCalledTimes(1);
  });

  it('different event ids are independent', async () => {
    const fake = makeFakeDb();
    const fn = mock(async () => undefined);

    await withIdempotency(fake.db, 'evt-1', 'h', fn);
    await withIdempotency(fake.db, 'evt-2', 'h', fn);
    await withIdempotency(fake.db, 'evt-3', 'h', fn);

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('propagates errors from fn so the subscription wrapper can NAK', async () => {
    const fake = makeFakeDb();
    const fn = async () => {
      throw new Error('side-effect blew up');
    };

    await expect(withIdempotency(fake.db, 'evt-1', 'h', fn)).rejects.toThrow('side-effect blew up');
  });

  it('does NOT release the claim on fn failure (at-most-once on side-effect)', async () => {
    const fake = makeFakeDb();
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error('boom');
    };

    // First delivery throws.
    await expect(withIdempotency(fake.db, 'evt-1', 'h', fn)).rejects.toThrow('boom');
    // Replay must skip (we'd rather lose a retry than re-fire a partial side-effect).
    const replay = await withIdempotency(fake.db, 'evt-1', 'h', fn);

    expect(replay.executed).toBe(false);
    expect(calls).toBe(1);
  });

  it('falls through to fn when eventId is empty (with warning) — no silent drop', async () => {
    const fake = makeFakeDb();
    const fn = mock(async () => undefined);

    const result = await withIdempotency(fake.db, '', 'h', fn);

    expect(result.executed).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fake.insertCalls.count).toBe(0); // no DB write attempted
  });
});
