/**
 * CLI `omni events consumers ...` + `omni events follow` (#989).
 *
 * The consumer commands go through the API like every other CLI surface (the
 * CLI never queries the DB directly — schemaApiRequest precedent). This suite
 * round-trips the exact request helper and follow loop the commands use
 * against an in-process server speaking the consumers API contract:
 *  - create/ls/inspect/rm round-trip;
 *  - `followConsumer` resumes from the stored cursor, prints JSON lines,
 *    acks the SCANNED cursor as it goes, and exits when idle (--until-idle);
 *  - `--no-ack` peeks one page without advancing the cursor.
 *
 * Native fetch is pinned per test — same hermetic rationale as
 * events-schema.test.ts (#967): another suite's leaked fetch stub must not
 * swallow these requests.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumersApiRequest, followConsumer, summarizeConsumerRow } from '../events';

let priorFetch: typeof globalThis.fetch;
beforeEach(() => {
  priorFetch = globalThis.fetch;
  globalThis.fetch = Bun.fetch as unknown as typeof globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = priorFetch;
});

interface StoredConsumer {
  id: string;
  name: string;
  eventType: string;
  filters: Array<{ field: string; operator: string; value?: unknown }> | null;
  cursor: number;
  createdAt: string;
  updatedAt: string;
}

interface JournalRow {
  seq: number;
  id: string;
  eventType: string;
  rawPayload: Record<string, unknown>;
}

/** In-memory journal + registry speaking the /api/v2/events/consumers contract. */
function startConsumerServer() {
  const consumers = new Map<string, StoredConsumer>();
  const journal: JournalRow[] = [];
  const acks: number[] = [];

  const withLag = (row: StoredConsumer) => {
    const head = journal.length ? journal[journal.length - 1].seq : 0;
    return { ...row, head, lag: Math.max(0, head - row.cursor) };
  };

  const notFound = (message: string): Response =>
    Response.json({ error: { code: 'NOT_FOUND', message } }, { status: 404 });

  const matchesType = (row: JournalRow, consumer: StoredConsumer): boolean =>
    consumer.eventType.endsWith('*')
      ? row.eventType.startsWith(consumer.eventType.slice(0, -1))
      : row.eventType === consumer.eventType;

  const matchesFilters = (row: JournalRow, consumer: StoredConsumer): boolean =>
    (consumer.filters ?? []).every((f) => row.rawPayload[f.field] === f.value);

  const handlePull = (consumer: StoredConsumer, limit: number): Response => {
    const typeScanned = journal.filter((r) => r.seq > consumer.cursor && matchesType(r, consumer)).slice(0, limit);
    const items = typeScanned.filter((r) => matchesFilters(r, consumer));
    const last = typeScanned[typeScanned.length - 1];
    return Response.json({
      consumer: consumer.name,
      items: items.map((r) => ({ id: r.id, eventType: r.eventType, rawPayload: r.rawPayload, journalSeq: r.seq })),
      cursor: last ? last.seq : consumer.cursor,
      head: journal.length ? journal[journal.length - 1].seq : 0,
      hasMore: typeScanned.length === limit,
    });
  };

  const handleCreate = async (req: Request): Promise<Response> => {
    const body = (await req.json()) as {
      name: string;
      eventType: string;
      filters?: StoredConsumer['filters'];
      startFrom?: string;
    };
    if (consumers.has(body.name)) {
      return Response.json({ error: { code: 'CONFLICT', message: 'exists' } }, { status: 409 });
    }
    const head = journal.length ? journal[journal.length - 1].seq : 0;
    const row: StoredConsumer = {
      id: crypto.randomUUID(),
      name: body.name,
      eventType: body.eventType,
      filters: body.filters ?? null,
      cursor: body.startFrom === 'beginning' ? 0 : head,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    consumers.set(body.name, row);
    return Response.json({ data: withLag(row) }, { status: 201 });
  };

  const handleAck = async (req: Request, consumer: StoredConsumer): Promise<Response> => {
    const { cursor } = (await req.json()) as { cursor: number };
    if (cursor < consumer.cursor) {
      return Response.json({ error: { code: 'VALIDATION', message: 'monotonic' } }, { status: 400 });
    }
    consumer.cursor = cursor;
    acks.push(cursor);
    return Response.json({ data: withLag(consumer) });
  };

  const handleConsumerRoute = (
    req: Request,
    url: URL,
    consumer: StoredConsumer,
    action?: string,
  ): Promise<Response> | Response => {
    if (req.method === 'GET' && !action) return Response.json({ data: withLag(consumer) });
    if (req.method === 'DELETE' && !action) {
      consumers.delete(consumer.name);
      return Response.json({ success: true });
    }
    if (req.method === 'POST' && action === 'pull') {
      return handlePull(consumer, Number(url.searchParams.get('limit') ?? '100'));
    }
    if (req.method === 'POST' && action === 'ack') return handleAck(req, consumer);
    return notFound('unknown route');
  };

  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const prefix = '/api/v2/events/consumers';
      if (!url.pathname.startsWith(prefix)) return notFound('unknown route');
      const rest = decodeURIComponent(url.pathname.slice(prefix.length).replace(/^\//, ''));

      if (rest === '') {
        if (req.method === 'POST') return handleCreate(req);
        return Response.json({ items: [...consumers.values()].map(withLag) });
      }

      const [name, action] = rest.split('/');
      const consumer = name ? consumers.get(name) : undefined;
      if (!consumer) return notFound(`not found: ${name}`);
      return handleConsumerRoute(req, url, consumer, action);
    },
  });

  let nextSeq = 0;
  const append = (eventType: string, rawPayload: Record<string, unknown> = {}): JournalRow => {
    nextSeq += 1;
    const row: JournalRow = { seq: nextSeq, id: crypto.randomUUID(), eventType, rawPayload };
    journal.push(row);
    return row;
  };

  return { server, consumers, journal, acks, append };
}

describe('omni events consumers + follow', () => {
  const { server, consumers, acks, append } = startConsumerServer();
  const configDir = mkdtempSync(join(tmpdir(), 'omni-cli-events-consumers-'));
  const hostConfigDir = process.env.OMNI_CONFIG_DIR;
  const printed: string[] = [];

  beforeAll(() => {
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ apiUrl: `http://127.0.0.1:${server.port}` }));
    process.env.OMNI_CONFIG_DIR = configDir;
  });

  afterAll(() => {
    if (hostConfigDir === undefined) Reflect.deleteProperty(process.env, 'OMNI_CONFIG_DIR');
    else process.env.OMNI_CONFIG_DIR = hostConfigDir;
    server.stop(true);
    rmSync(configDir, { recursive: true, force: true });
  });

  test('create → ls → inspect → rm round-trips through the API', async () => {
    const created = await consumersApiRequest<{ data: StoredConsumer & { lag: number } }>('', {
      method: 'POST',
      body: JSON.stringify({ name: 'deploy-tracker', eventType: 'custom.deploy.*', startFrom: 'beginning' }),
    });
    expect(created.data.name).toBe('deploy-tracker');
    expect(created.data.cursor).toBe(0);

    const listed = await consumersApiRequest<{ items: Array<StoredConsumer & { lag: number; head: number }> }>('');
    expect(listed.items.map((r) => summarizeConsumerRow(r as Parameters<typeof summarizeConsumerRow>[0]))).toEqual([
      {
        name: 'deploy-tracker',
        eventType: 'custom.deploy.*',
        excludeTypes: '-',
        filters: '-',
        cursor: 0,
        lag: 0,
        updatedAt: created.data.updatedAt,
      },
    ]);

    const inspected = await consumersApiRequest<{ data: StoredConsumer }>('/deploy-tracker');
    expect(inspected.data.eventType).toBe('custom.deploy.*');

    await consumersApiRequest('/deploy-tracker', { method: 'DELETE' });
    await expect(consumersApiRequest('/deploy-tracker')).rejects.toThrow(/API returned 404/);
  });

  test('followConsumer drains the backlog, acks as it goes, and exits on idle', async () => {
    await consumersApiRequest('', {
      method: 'POST',
      body: JSON.stringify({ name: 'drainer', eventType: 'custom.drain.*', startFrom: 'beginning' }),
    });
    const a = append('custom.drain.one');
    const b = append('custom.drain.two');
    append('custom.other.skipme');
    const c = append('custom.drain.three');

    await followConsumer({
      consumer: 'drainer',
      limit: 2,
      waitMs: 0,
      ack: true,
      untilIdle: true,
      emit: (line) => printed.push(line),
    });

    const emitted = printed.map((line) => (JSON.parse(line) as { id: string }).id);
    expect(emitted).toEqual([a.id, b.id, c.id]);
    // The cursor committed through to the last SCANNED row.
    expect(consumers.get('drainer')?.cursor).toBe(c.seq);
    expect(acks[acks.length - 1]).toBe(c.seq);
  });

  test('a re-follow resumes exactly-after-cursor (no re-delivery)', async () => {
    printed.length = 0;
    const d = append('custom.drain.four');

    await followConsumer({
      consumer: 'drainer',
      limit: 10,
      waitMs: 0,
      ack: true,
      untilIdle: true,
      emit: (line) => printed.push(line),
    });

    expect(printed.map((line) => (JSON.parse(line) as { id: string }).id)).toEqual([d.id]);
  });

  test('--no-ack peeks one page without advancing the cursor', async () => {
    printed.length = 0;
    const before = consumers.get('drainer')?.cursor;
    const e = append('custom.drain.five');

    await followConsumer({
      consumer: 'drainer',
      limit: 10,
      waitMs: 0,
      ack: false,
      untilIdle: false,
      emit: (line) => printed.push(line),
    });

    expect(printed.map((line) => (JSON.parse(line) as { id: string }).id)).toEqual([e.id]);
    expect(consumers.get('drainer')?.cursor).toBe(before as number);
  });

  test('a dropped long-poll socket reconnects and resumes from the cursor (issue #1029)', async () => {
    printed.length = 0;
    const f = append('custom.drain.six');
    const realFetch = globalThis.fetch;
    let drops = 2;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (drops > 0 && String(input).includes('/pull?')) {
        drops--;
        return Promise.reject(new Error('The socket connection was closed unexpectedly.'));
      }
      return realFetch(input, init);
    }) as typeof globalThis.fetch;
    try {
      await followConsumer({
        consumer: 'drainer',
        limit: 10,
        waitMs: 0,
        ack: true,
        untilIdle: true,
        retryBaseMs: 1,
        emit: (line) => printed.push(line),
      });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(drops).toBe(0);
    // Resumes from the stored cursor: the un-acked peek row (five) plus the new one, nothing re-delivered.
    const ids = printed.map((line) => (JSON.parse(line) as { id: string }).id);
    expect(ids[ids.length - 1]).toBe(f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(consumers.get('drainer')?.cursor).toBe(f.seq);
  });

  test('exhausted reconnects rethrow the transport error', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error('socket closed'))) as typeof globalThis.fetch;
    try {
      await expect(
        followConsumer({
          consumer: 'drainer',
          limit: 10,
          waitMs: 0,
          ack: true,
          untilIdle: true,
          maxRetries: 2,
          retryBaseMs: 1,
        }),
      ).rejects.toThrow(/socket closed/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('an unknown consumer surfaces the API 404', async () => {
    await expect(
      followConsumer({ consumer: 'ghost', limit: 10, waitMs: 0, ack: true, untilIdle: true }),
    ).rejects.toThrow(/API returned 404/);
  });
});
