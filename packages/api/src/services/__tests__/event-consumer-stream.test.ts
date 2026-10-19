/**
 * SSE consumer stream — DB-free units.
 *
 * Covers the stream loop (catch-up, held rows, wake, heartbeat, disconnect
 * cleanup), the wake hub, start-position precedence, and the service's
 * read-only stream scan against a fake handle that refuses every write. The
 * real-PostgreSQL case (catch-up + held hollow row) lives in
 * `__tests__/event-consumers-postgres.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import { NotFoundError } from '@omni/core';
import { type Database, type DurableConsumer, type OmniEvent, durableConsumers } from '@omni/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  type ConsumerStreamOptions,
  ConsumerStreamWakeHub,
  STREAM_MAX_LIFETIME_CEILING_MS,
  type StreamEndReason,
  type WakeConnection,
  acquireConsumerStreamSlot,
  closeAllConsumerStreams,
  liveConsumerStreamCount,
  resolveStreamIntervalMs,
  resolveStreamMaxLifetimeMs,
  resolveStreamMaxPerKey,
  resolveStreamMaxPerProcess,
  resolveStreamStart,
  runConsumerStream,
  wakePrefixesFor,
} from '../event-consumer-stream';
import { EventConsumerService, type StreamScanResult, streamInstanceClause } from '../event-consumers';

const FULL_ACCESS = { tenantId: null, caller: { keyId: null, instanceIds: null } };

const SETTLE_MS = 5_000;

function row(seq: number, extra: Partial<OmniEvent> = {}): OmniEvent {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    journalSeq: seq,
    eventType: 'message.received',
    journalReady: true,
    receivedAt: new Date(),
    rawPayload: { n: seq },
    ...extra,
  } as OmniEvent;
}

function consumer(extra: Partial<DurableConsumer> = {}): DurableConsumer {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'vox',
    eventType: 'message.received',
    excludeTypes: null,
    filters: null,
    cursor: 7,
    shared: false,
    waitForReady: false,
    leaseState: null,
    accessFilter: 'all',
    scoped: false,
    instanceIds: null,
    ownerKeyId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  } as DurableConsumer;
}

/** A handle that answers the two read chains and throws on any write. */
function fakePool(registered: DurableConsumer, page: () => OmniEvent[], wheres: unknown[] = []): Database {
  const refuse = () => {
    throw new Error('the stream must never write');
  };
  return {
    select: () => ({
      from: (table: unknown) => {
        const query = {
          where: (clause: unknown) => {
            if (table !== durableConsumers) wheres.push(clause);
            return query;
          },
          orderBy: () => query,
          limit: async (n: number) => (table === durableConsumers ? [registered] : page().slice(0, n)),
        };
        return query;
      },
    }),
    insert: refuse,
    update: refuse,
    delete: refuse,
    transaction: refuse,
  } as unknown as Database;
}

describe('resolveStreamStart', () => {
  test('Last-Event-ID wins over ?after, which wins over the stored cursor', () => {
    expect(resolveStreamStart({ lastEventId: 30, after: 20, cursor: 10 })).toBe(30);
    expect(resolveStreamStart({ after: 20, cursor: 10 })).toBe(20);
    expect(resolveStreamStart({ cursor: 10 })).toBe(10);
    expect(resolveStreamStart({ lastEventId: 0, after: 20, cursor: 10 })).toBe(0);
  });
});

describe('resolveStreamIntervalMs', () => {
  test('defaults when unset, blank, non-numeric, zero or negative', () => {
    for (const raw of [undefined, '', '  ', 'abc', '0', '-5'])
      expect(resolveStreamIntervalMs(raw, 15_000)).toBe(15_000);
  });
  test('honours a positive value', () => {
    expect(resolveStreamIntervalMs('2500', 15_000)).toBe(2500);
  });
});

describe('wakePrefixesFor', () => {
  test('exact type → "<type>." subject prefix; trailing-* glob → its prefix; * → everything', () => {
    expect(wakePrefixesFor('message.received')).toEqual(['message.received.']);
    expect(wakePrefixesFor('custom.github.*')).toEqual(['custom.github.']);
    expect(wakePrefixesFor('*')).toEqual(['']);
  });
});

describe('ConsumerStreamWakeHub', () => {
  function fakeConnection() {
    const subs = new Map<string, (err: unknown, msg: { subject: string }) => void>();
    let unsubscribed = 0;
    const connection: WakeConnection = {
      subscribe(subject, opts) {
        subs.set(subject, opts.callback);
        return {
          unsubscribe() {
            unsubscribed++;
            subs.delete(subject);
          },
        };
      },
    };
    const publish = (subject: string) => {
      for (const callback of subs.values()) callback(null, { subject });
    };
    return { connection, subs, publish, unsubscribed: () => unsubscribed };
  }

  test('one shared subscription set, fanned out by prefix, released with the last stream', () => {
    const nats = fakeConnection();
    const hub = new ConsumerStreamWakeHub(() => nats.connection, ['message.>']);
    const woke: string[] = [];
    const offA = hub.register(['message.received.'], () => woke.push('a'));
    const offB = hub.register(['custom.'], () => woke.push('b'));
    expect(hub.subscriptionCount).toBe(1);

    nats.publish('message.received.whatsapp-baileys.inst-1');
    nats.publish('message.sent.whatsapp-baileys.inst-1');
    expect(woke).toEqual(['a']);

    offA();
    expect(hub.subscriptionCount).toBe(1);
    offB();
    expect(hub.subscriptionCount).toBe(0);
    expect(nats.unsubscribed()).toBe(1);
  });

  test('without NATS it is polling-only, and attaches once a connection appears', () => {
    const nats = fakeConnection();
    let available = false;
    const hub = new ConsumerStreamWakeHub(() => (available ? nats.connection : null), ['message.>', 'custom.>']);
    const offA = hub.register([''], () => undefined);
    expect(hub.subscriptionCount).toBe(0);
    available = true;
    const offB = hub.register([''], () => undefined);
    expect(hub.subscriptionCount).toBe(2);
    offA();
    offB();
    expect(hub.subscriptionCount).toBe(0);
  });
});

/** A fake journal the loop scans; matching is the scan's job, so the fake filters by `match`. */
function harness(options: { journal: OmniEvent[]; match?: (r: OmniEvent) => boolean; pageSize?: number }) {
  const journal = options.journal;
  const match = options.match ?? (() => true);
  const pageSize = options.pageSize ?? 100;
  const scans: number[] = [];
  const sent: OmniEvent[] = [];
  let heartbeats = 0;
  let wake: (() => void) | null = null;
  let unsubscribed = false;
  let held: ((r: OmniEvent) => boolean) | null = null;
  const closed: Error[] = [];
  const expired: StreamEndReason[] = [];
  const endPositions: number[] = [];
  const errors: unknown[] = [];
  let failNext: Error | null = null;

  const scan = async (after: number): Promise<StreamScanResult> => {
    scans.push(after);
    if (failNext) {
      const error = failNext;
      failNext = null;
      throw error;
    }
    const page = journal.filter((r) => r.journalSeq > after).slice(0, pageSize);
    const cut = held ? page.findIndex(held) : -1;
    const rows = cut === -1 ? page : page.slice(0, cut);
    const last = rows[rows.length - 1];
    return {
      items: rows.filter(match),
      through: last ? last.journalSeq : null,
      held: cut !== -1,
      full: cut === -1 && page.length === pageSize,
    };
  };

  const controller = new AbortController();
  const base: ConsumerStreamOptions = {
    start: 0,
    scan,
    send: async (r) => {
      sent.push(r);
    },
    heartbeat: async () => {
      heartbeats++;
    },
    close: async (error) => {
      closed.push(error);
    },
    expire: async (reason, position) => {
      expired.push(reason);
      endPositions.push(position);
    },
    maxLifetimeMs: 60_000,
    subscribeWake: (w) => {
      wake = w;
      return () => {
        unsubscribed = true;
        wake = null;
      };
    },
    signal: controller.signal,
    heartbeatMs: 60_000,
    fallbackMs: 60_000,
    heldRescanMs: 10,
    wakeFollowUpMs: [],
    onError: (error) => errors.push(error),
  };

  return {
    run: (overrides: Partial<ConsumerStreamOptions> = {}) => runConsumerStream({ ...base, ...overrides }),
    abort: () => controller.abort(),
    wake: () => wake?.(),
    hold: (fn: ((r: OmniEvent) => boolean) | null) => {
      held = fn;
    },
    failNextScan: (error: Error) => {
      failNext = error;
    },
    scans,
    sent,
    closed,
    expired,
    endPositions,
    errors,
    heartbeats: () => heartbeats,
    unsubscribed: () => unsubscribed,
    hasWake: () => wake !== null,
  };
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const seqs = (rows: OmniEvent[]) => rows.map((r) => r.journalSeq);

describe('runConsumerStream', () => {
  test('catch-up sends matching rows in order, pages through full pages, and skips non-matches while advancing', async () => {
    const journal = Array.from({ length: 7 }, (_, i) => row(i + 1, { rawPayload: { even: (i + 1) % 2 === 0 } }));
    const h = harness({ journal, pageSize: 3, match: (r) => (r.rawPayload as { even: boolean }).even });
    const done = h.run({ start: 0 });
    await settle();
    expect(seqs(h.sent)).toEqual([2, 4, 6]);
    // Pages after 0, 3, 6 (full pages chain immediately), then 7 is drained.
    expect(h.scans).toEqual([0, 3, 6]);

    // Next scan starts past the last SCANNED row (7, a non-match), not the last sent (6).
    h.wake();
    await settle();
    expect(h.scans[h.scans.length - 1]).toBe(7);
    h.abort();
    await done;
  });

  test('starts strictly after the given position', async () => {
    const h = harness({ journal: [row(1), row(2), row(3)] });
    const done = h.run({ start: 2 });
    await settle();
    expect(seqs(h.sent)).toEqual([3]);
    h.abort();
    await done;
  });

  test('a held row is not sent and is re-scanned fast until it fills', async () => {
    const journal = [row(1), row(2, { journalReady: false })];
    const h = harness({ journal });
    h.hold((r) => !r.journalReady);
    const done = h.run();
    await settle(15);
    expect(seqs(h.sent)).toEqual([1]);
    const scansWhileHeld = h.scans.length;
    await settle(40);
    expect(h.scans.length).toBeGreaterThan(scansWhileHeld); // held re-scan, not the 60 s fallback
    expect(h.scans.every((after) => after <= 1)).toBe(true);

    journal[1] = row(2, { journalReady: true, rawPayload: { filled: true } });
    await settle(40);
    expect(seqs(h.sent)).toEqual([1, 2]);
    expect(h.sent[1]?.rawPayload).toEqual({ filled: true });
    h.abort();
    await done;
  });

  test('a wake triggers a re-scan before the fallback interval', async () => {
    const journal = [row(1)];
    const h = harness({ journal });
    const done = h.run();
    await settle();
    expect(seqs(h.sent)).toEqual([1]);
    journal.push(row(2));
    await settle();
    expect(seqs(h.sent)).toEqual([1]); // nothing without a wake (fallback is 60 s)
    h.wake();
    await settle();
    expect(seqs(h.sent)).toEqual([1, 2]);
    h.abort();
    await done;
  });

  test('a wake schedules quick follow-up scans for a fill that lands after the NATS message', async () => {
    const journal = [row(1)];
    const h = harness({ journal });
    const done = h.run({ wakeFollowUpMs: [20] });
    await settle();
    h.wake(); // the event row is not in the journal yet
    await settle(5);
    journal.push(row(2));
    await settle(50);
    expect(seqs(h.sent)).toEqual([1, 2]);
    h.abort();
    await done;
  });

  test('the fallback interval re-scans without any wake', async () => {
    const journal = [row(1)];
    const h = harness({ journal });
    const done = h.run({ fallbackMs: 20 });
    await settle();
    journal.push(row(2));
    await settle(60);
    expect(seqs(h.sent)).toEqual([1, 2]);
    h.abort();
    await done;
  });

  test('emits heartbeats on the configured interval', async () => {
    const h = harness({ journal: [] });
    const done = h.run({ heartbeatMs: 10 });
    await settle(55);
    expect(h.heartbeats()).toBeGreaterThanOrEqual(2);
    h.abort();
    await done;
  });

  test('disconnect releases the wake registration and every timer', async () => {
    const h = harness({ journal: [] });
    const done = h.run({ heartbeatMs: 10, fallbackMs: 10 });
    await settle();
    expect(h.hasWake()).toBe(true);
    h.abort();
    await done;
    expect(h.unsubscribed()).toBe(true);
    const scans = h.scans.length;
    const beats = h.heartbeats();
    await settle(50);
    expect(h.scans.length).toBe(scans);
    expect(h.heartbeats()).toBe(beats);
  });

  test('a consumer deleted mid-stream ends the stream with a close event', async () => {
    const h = harness({ journal: [row(1)] });
    const done = h.run({ fallbackMs: 10 });
    await settle();
    h.failNextScan(new NotFoundError('DurableConsumer', 'vox'));
    await done; // resolves on its own: no abort needed
    expect(h.closed).toHaveLength(1);
    expect(h.unsubscribed()).toBe(true);
  });

  test('a transient scan failure is reported and retried on the fallback interval', async () => {
    const h = harness({ journal: [row(1)] });
    h.failNextScan(new Error('connection reset'));
    const done = h.run({ fallbackMs: 15 });
    await settle(50);
    expect(h.errors).toHaveLength(1);
    expect(seqs(h.sent)).toEqual([1]);
    h.abort();
    await done;
  });
});

describe('EventConsumerService.scanForStream (read-only, gate always on)', () => {
  test('a hollow row younger than the settle window is held even when the consumer has no waitForReady', async () => {
    const page = [row(8), row(9, { journalReady: false }), row(10)];
    const service = new EventConsumerService(fakePool(consumer({ waitForReady: false }), () => page));
    const result = await service.scanForStream('vox', 7, FULL_ACCESS);
    expect(seqs(result.items)).toEqual([8]);
    expect(result).toMatchObject({ through: 8, held: true, full: false });
  });

  test('a dead hollow row older than the settle window does not stall the stream', async () => {
    const page = [row(8, { journalReady: false, receivedAt: new Date(Date.now() - SETTLE_MS - 1_000) }), row(9)];
    const service = new EventConsumerService(fakePool(consumer(), () => page));
    const result = await service.scanForStream('vox', 7, FULL_ACCESS);
    expect(seqs(result.items)).toEqual([8, 9]);
    expect(result).toMatchObject({ through: 9, held: false });
  });

  test('payload filters drop non-matches but `through` covers every scanned row', async () => {
    const page = [row(8, { rawPayload: { kind: 'a' } }), row(9, { rawPayload: { kind: 'b' } })];
    const filtered = consumer({ filters: [{ field: 'kind', operator: 'eq', value: 'a' }] });
    const service = new EventConsumerService(fakePool(filtered, () => page));
    const result = await service.scanForStream('vox', 7, FULL_ACCESS);
    expect(seqs(result.items)).toEqual([8]);
    expect(result.through).toBe(9);
  });

  test('a full uncut page reports full; an empty page reports nothing scanned', async () => {
    const rows = [row(8), row(9)];
    const full = await new EventConsumerService(fakePool(consumer(), () => rows)).scanForStream(
      'vox',
      7,
      FULL_ACCESS,
      2,
    );
    expect(full).toMatchObject({ through: 9, held: false, full: true });
    const empty = await new EventConsumerService(fakePool(consumer(), () => [])).scanForStream('vox', 9, FULL_ACCESS);
    expect(empty).toEqual({ items: [], through: null, held: false, full: false });
  });

  test('a shared consumer is refused (leases are the pull path)', async () => {
    const service = new EventConsumerService(fakePool(consumer({ shared: true }), () => []));
    await expect(service.getStreamable('vox')).rejects.toThrow(/shared/);
    await expect(service.scanForStream('vox', 0, FULL_ACCESS)).rejects.toThrow(/shared/);
  });

  test('never writes: the fake handle throws on insert/update/delete and the scan still succeeds', async () => {
    const service = new EventConsumerService(fakePool(consumer(), () => [row(8)]));
    await expect(service.scanForStream('vox', 7, FULL_ACCESS)).resolves.toMatchObject({ through: 8 });
  });
});

describe('stream lifetime cap (revocation ceiling)', () => {
  test('EVENT_STREAM_MAX_LIFETIME_MS defaults to, and is clamped at, the 30 s termination ceiling', () => {
    expect(STREAM_MAX_LIFETIME_CEILING_MS).toBe(30_000);
    expect(resolveStreamMaxLifetimeMs(undefined)).toBe(30_000);
    expect(resolveStreamMaxLifetimeMs('999999')).toBe(30_000);
    expect(resolveStreamMaxLifetimeMs('0')).toBe(30_000);
    expect(resolveStreamMaxLifetimeMs('5000')).toBe(5_000);
  });

  test('a stream ends itself within its lifetime with a reconnect event and releases everything', async () => {
    const h = harness({ journal: [row(1)] });
    const started = Date.now();
    await h.run({ maxLifetimeMs: 40, heartbeatMs: 10, fallbackMs: 10 }); // resolves with no abort
    expect(Date.now() - started).toBeLessThan(200);
    expect(h.expired).toEqual(['lifetime']);
    expect(h.unsubscribed()).toBe(true);
    expect(liveConsumerStreamCount()).toBe(0);
    const scans = h.scans.length;
    await settle(40);
    expect(h.scans.length).toBe(scans);
  });

  test('reconnecting with Last-Event-ID after a lifetime end resumes with no duplicates and no gaps', async () => {
    const journal = [row(1), row(2), row(3)];
    const match = (r: OmniEvent) => r.journalSeq % 2 === 1 || r.journalSeq > 4; // a sparse filter
    const first = harness({ journal, match });
    const appender = setInterval(() => journal.push(row(journal.length + 1)), 5);
    await first.run({ maxLifetimeMs: 40, fallbackMs: 5 });
    const lastEventId = first.endPositions[0] ?? -1; // the reconnect event's id

    const second = harness({ journal, match });
    const done = second.run({ start: lastEventId, fallbackMs: 5 });
    await settle(40);
    clearInterval(appender);
    await settle(30);
    second.abort();
    await done;

    const delivered = [...seqs(first.sent), ...seqs(second.sent)];
    const expected = seqs(journal.filter(match));
    expect(delivered).toEqual(expected);
    expect(new Set(delivered).size).toBe(delivered.length);
  });

  test('shutdown ends every open stream with a reconnect event', async () => {
    const a = harness({ journal: [] });
    const b = harness({ journal: [] });
    const runs = [a.run(), b.run()];
    await settle(10);
    expect(liveConsumerStreamCount()).toBe(2);
    await closeAllConsumerStreams();
    await Promise.all(runs);
    expect(a.expired).toEqual(['shutdown']);
    expect(b.expired).toEqual(['shutdown']);
    expect(liveConsumerStreamCount()).toBe(0);
  });
});

describe('stream slot caps (per process and per API key)', () => {
  const release = (slot: ReturnType<typeof acquireConsumerStreamSlot>) => {
    if (!('release' in slot)) throw new Error(`refused by the ${slot.refused} cap`);
    return slot.release;
  };

  test('process slots are refused past the cap and freed on release (idempotently)', () => {
    const limits = { perProcess: 2, perKey: 10 };
    const one = release(acquireConsumerStreamSlot('key-a', limits));
    const two = release(acquireConsumerStreamSlot(null, limits));
    expect(acquireConsumerStreamSlot('key-b', limits)).toEqual({ refused: 'process', limit: 2 });
    one();
    one();
    const three = release(acquireConsumerStreamSlot('key-b', limits));
    expect(acquireConsumerStreamSlot('key-c', limits)).toEqual({ refused: 'process', limit: 2 });
    two();
    three();
  });

  test('a key is refused past its own cap while other keys (and keyless requests) still open streams', () => {
    const limits = { perProcess: 100, perKey: 2 };
    const a1 = release(acquireConsumerStreamSlot('key-a', limits));
    const a2 = release(acquireConsumerStreamSlot('key-a', limits));
    expect(acquireConsumerStreamSlot('key-a', limits)).toEqual({ refused: 'key', limit: 2 });
    const b1 = release(acquireConsumerStreamSlot('key-b', limits));
    const anon = release(acquireConsumerStreamSlot(null, limits));
    a1();
    a1(); // idempotent: frees exactly one of key-a's slots
    const a3 = release(acquireConsumerStreamSlot('key-a', limits));
    expect(acquireConsumerStreamSlot('key-a', limits)).toEqual({ refused: 'key', limit: 2 });
    for (const free of [a2, a3, b1, anon]) free();
  });

  test('EVENT_STREAM_MAX_PER_KEY defaults to 5', () => {
    expect(resolveStreamMaxPerKey(undefined)).toBe(5);
    expect(resolveStreamMaxPerKey('0')).toBe(5);
    expect(resolveStreamMaxPerKey('1.5')).toBe(5);
    expect(resolveStreamMaxPerKey('3')).toBe(3);
  });

  test('EVENT_STREAM_MAX_PER_PROCESS defaults to 100', () => {
    expect(resolveStreamMaxPerProcess(undefined)).toBe(100);
    expect(resolveStreamMaxPerProcess('abc')).toBe(100);
    expect(resolveStreamMaxPerProcess('2.5')).toBe(100);
    expect(resolveStreamMaxPerProcess('7')).toBe(7);
  });
});

describe('wake debounce', () => {
  test('a burst of wakes costs a bounded number of scans, not one per event', async () => {
    const journal = [row(1)];
    const h = harness({ journal });
    const done = h.run({ minWakeGapMs: 25 });
    await settle();
    const before = h.scans.length;
    for (let i = 0; i < 50; i++) h.wake();
    await settle(60);
    expect(h.scans.length - before).toBeLessThanOrEqual(3);
    expect(h.scans.length - before).toBeGreaterThanOrEqual(1);
    h.abort();
    await done;
  });
});

describe('instance restriction (B1)', () => {
  const render = (clause: Parameters<PgDialect['sqlToQuery']>[0]) => new PgDialect().sqlToQuery(clause);

  test('a full-access key adds no predicate; a restricted key adds instance_id IN (...); [] matches nothing', () => {
    expect(streamInstanceClause(null)).toBeUndefined();
    const restricted = streamInstanceClause(['inst-a', 'inst-b']);
    if (!restricted) throw new Error('expected a clause');
    const query = render(restricted);
    expect(query.sql).toContain('"instance_id" in');
    expect(query.params).toEqual(['inst-a', 'inst-b']);
    const none = streamInstanceClause([]);
    if (!none) throw new Error('expected a clause');
    expect(render(none).sql).toBe('false');
  });

  test("the stream scan carries the key's instance predicate; a full key's scan does not", async () => {
    const wheres: unknown[] = [];
    const service = new EventConsumerService(fakePool(consumer(), () => [row(8)], wheres));
    await service.scanForStream('vox', 7, { tenantId: null, caller: { keyId: null, instanceIds: ['inst-a'] } });
    await service.scanForStream('vox', 7, FULL_ACCESS);
    const [restricted, full] = wheres.map((w) => render(w as Parameters<PgDialect['sqlToQuery']>[0]));
    expect(restricted?.sql).toContain('"instance_id" in');
    expect(restricted?.params).toContain('inst-a');
    expect(full?.sql).not.toContain('instance_id');
  });
});

describe('lifetime cap stops row delivery at once', () => {
  test('rows of a scan still in flight when the lifetime fires are dropped, and reconnect is not delayed', async () => {
    let release: (() => void) | null = null;
    const sent: number[] = [];
    let expiredAt = 0;
    const controller = new AbortController();
    const started = Date.now();
    await runConsumerStream({
      start: 0,
      scan: (after) =>
        after > 0
          ? new Promise<StreamScanResult>(() => undefined)
          : new Promise<StreamScanResult>((resolve) => {
              // A slow page: it resolves only after the lifetime has fired.
              release = () => resolve({ items: [row(1), row(2)], through: 2, held: false, full: false });
              setTimeout(() => release?.(), 80);
            }),
      send: async (r) => {
        sent.push(r.journalSeq);
      },
      heartbeat: async () => undefined,
      close: async () => undefined,
      expire: async () => {
        expiredAt = Date.now() - started;
      },
      subscribeWake: () => () => undefined,
      signal: controller.signal,
      heartbeatMs: 60_000,
      fallbackMs: 60_000,
      maxLifetimeMs: 20,
    });
    expect(expiredAt).toBeLessThan(70); // sent at the cap, not after the slow scan
    expect(sent).toEqual([]); // the late page is dropped; Last-Event-ID resumes it
  });
});

describe('reconnect carries the scanned position as its id', () => {
  test('a sparse filter on a busy journal resumes past the non-matching rows instead of re-scanning them', async () => {
    const journal = Array.from({ length: 250 }, (_, i) => row(i + 1));
    const match = (r: OmniEvent) => r.journalSeq === 3; // one match, then 247 non-matching rows
    const first = harness({ journal, match, pageSize: 50 });
    await first.run({ maxLifetimeMs: 40 });
    expect(seqs(first.sent)).toEqual([3]);
    expect(first.expired).toEqual(['lifetime']);
    expect(first.endPositions).toEqual([250]); // last SCANNED, not last sent (3)

    journal.push(row(251), row(252));
    const second = harness({ journal, match: (r) => r.journalSeq === 3 || r.journalSeq === 252, pageSize: 50 });
    const done = second.run({ start: first.endPositions[0] });
    await settle();
    second.abort();
    await done;
    expect(second.scans[0]).toBe(250); // no re-scan of the backlog
    expect(seqs(second.sent)).toEqual([252]);
  });

  test('rows dropped at the lifetime cap mid-page are not covered by the reconnect id; resume delivers them', async () => {
    const journal = Array.from({ length: 10 }, (_, i) => row(i + 1));
    const match = (r: OmniEvent) => r.journalSeq % 3 === 0; // 3, 6, 9
    const sent: number[] = [];
    const positions: number[] = [];
    let release: (() => void) | null = null;
    const scanPage = (after: number): StreamScanResult => {
      const rows = journal.filter((r) => r.journalSeq > after);
      return {
        items: rows.filter(match),
        through: rows[rows.length - 1]?.journalSeq ?? null,
        held: false,
        full: false,
      };
    };
    await runConsumerStream({
      start: 0,
      scan: async (after) => scanPage(after),
      send: async (r) => {
        sent.push(r.journalSeq);
        // The first row's write lands just after the cap: the rest of the page is dropped.
        if (r.journalSeq === 3) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
      },
      heartbeat: async () => undefined,
      close: async () => undefined,
      expire: async (_reason, position) => {
        positions.push(position);
        release?.();
      },
      subscribeWake: () => () => undefined,
      signal: new AbortController().signal,
      heartbeatMs: 60_000,
      fallbackMs: 60_000,
      maxLifetimeMs: 20,
    });
    expect(sent).toEqual([3]); // 6 and 9 were dropped
    // 1 and 2 were filtered out; 3's write had not landed at the cap, so the id
    // stops below it: not the page end (10), and nothing past a dropped row.
    expect(positions).toEqual([2]);

    const resumed = harness({ journal, match });
    const done = resumed.run({ start: positions[0] });
    await settle();
    resumed.abort();
    await done;
    expect(resumed.scans[0]).toBe(2);
    expect(seqs(resumed.sent)).toEqual([3, 6, 9]); // the dropped rows arrive; 3 again (at-least-once)
  });

  test('a page landing after the cap leaves the reconnect id at the pre-page position', async () => {
    const positions: number[] = [];
    await runConsumerStream({
      start: 5,
      scan: (after) =>
        after > 5
          ? new Promise<StreamScanResult>(() => undefined)
          : new Promise<StreamScanResult>((resolve) =>
              setTimeout(() => resolve({ items: [row(6), row(7)], through: 20, held: false, full: false }), 60),
            ),
      send: async () => undefined,
      heartbeat: async () => undefined,
      close: async () => undefined,
      expire: async (_reason, position) => {
        positions.push(position);
      },
      subscribeWake: () => () => undefined,
      signal: new AbortController().signal,
      heartbeatMs: 60_000,
      fallbackMs: 60_000,
      maxLifetimeMs: 20,
    });
    expect(positions).toEqual([5]);
  });

  test('shutdown carries the scanned position too', async () => {
    const h = harness({ journal: [row(1), row(2), row(3)], match: (r) => r.journalSeq === 1 });
    const done = h.run();
    await settle();
    await closeAllConsumerStreams();
    await done;
    expect(h.expired).toEqual(['shutdown']);
    expect(h.endPositions).toEqual([3]);
  });
});

describe('stream scan x access filter (#1299) x readiness gate', () => {
  const settled = () => new Date(Date.now() - SETTLE_MS - 1_000);
  const render = (w: unknown) => new PgDialect().sqlToQuery(w as Parameters<PgDialect['sqlToQuery']>[0]);

  for (const waitForReady of [false, true]) {
    describe(`consumer waitForReady=${waitForReady}`, () => {
      const filtered = () => consumer({ accessFilter: 'allowed', waitForReady });

      test('the SQL admits unfilled rows (gate forced on widens the access predicate)', async () => {
        const wheres: unknown[] = [];
        await new EventConsumerService(fakePool(filtered(), () => [], wheres)).scanForStream('vox', 7, FULL_ACCESS);
        const query = render(wheres[0]);
        expect(query.sql).toContain('"access_decision" =');
        expect(query.sql).toContain('"journal_ready" =');
      });

      test('an unfilled row is held, then delivered after an allowed fill', async () => {
        let page = [row(8, { journalReady: false, accessDecision: null }), row(9, { accessDecision: 'allowed' })];
        const service = new EventConsumerService(fakePool(filtered(), () => page));
        const held = await service.scanForStream('vox', 7, FULL_ACCESS);
        expect(held).toEqual({ items: [], through: null, held: true, full: false });
        page = [row(8, { accessDecision: 'allowed' }), row(9, { accessDecision: 'allowed' })];
        const filled = await service.scanForStream('vox', 7, FULL_ACCESS);
        expect(seqs(filled.items)).toEqual([8, 9]);
      });

      test('a denied fill and a dead unfilled row are skipped, and the position moves past them', async () => {
        const page = [
          row(8, { accessDecision: 'denied' }),
          row(9, { journalReady: false, accessDecision: null, receivedAt: settled() }),
          row(10, { accessDecision: 'allowed' }),
        ];
        const result = await new EventConsumerService(fakePool(filtered(), () => page)).scanForStream(
          'vox',
          7,
          FULL_ACCESS,
        );
        expect(seqs(result.items)).toEqual([10]);
        expect(result).toMatchObject({ through: 10, held: false });
      });
    });
  }
});

describe('stream scan x instance-scoped consumers (#1298)', () => {
  const INST_A = '11111111-1111-4111-8111-1111111111aa';
  const INST_B = '11111111-1111-4111-8111-1111111111bb';
  const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const scoped = () => consumer({ scoped: true, instanceIds: [INST_A, INST_B], ownerKeyId: OWNER });
  const render = (w: unknown) => new PgDialect().sqlToQuery(w as Parameters<PgDialect['sqlToQuery']>[0]);

  test('a restricted non-owner key gets 404 (getStreamable and every page)', async () => {
    const service = new EventConsumerService(fakePool(scoped(), () => [row(8)]));
    const stranger = { keyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', instanceIds: [INST_A] };
    await expect(service.getStreamable('vox', stranger)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.scanForStream('vox', 7, { tenantId: null, caller: stranger })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test('a restricted owner is narrowed to the stored instances its key still has, as in pull', async () => {
    const wheres: unknown[] = [];
    const service = new EventConsumerService(fakePool(scoped(), () => [row(8)], wheres));
    const owner = { keyId: OWNER, instanceIds: [INST_A] };
    expect((await service.getStreamable('vox', owner)).instanceIds).toEqual([INST_A]);
    await service.scanForStream('vox', 7, { tenantId: null, caller: owner });
    const query = render(wheres[0]);
    expect(query.params).toContain(INST_A);
    expect(query.params).not.toContain(INST_B);
  });

  test('an unrestricted key sees the scoped consumer with its full instance set', async () => {
    const service = new EventConsumerService(fakePool(scoped(), () => []));
    const admin = { keyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', instanceIds: null };
    expect((await service.getStreamable('vox', admin)).instanceIds).toEqual([INST_A, INST_B]);
  });
});
