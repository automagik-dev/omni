/**
 * `omni events wait` — one-shot blocking subscription (#966).
 *
 * Covers the whole contract at the function level (the command action is a
 * thin option-parsing shell around `waitForEvent`):
 *  - `--filter k=v` entries become automation trigger conditions and are
 *    evaluated by the SAME matcher automations use (`evaluateConditions`);
 *  - the poll loop resolves with the FIRST matching event;
 *  - the deadline resolves null (→ exit non-zero, empty stdout).
 *
 * The integration tests talk to a real in-process Bun.serve speaking the
 * GET /events contract, so they pin the native fetch for each test — same
 * hermetic pattern (and rationale) as events-schema.test.ts: another suite's
 * leaked `globalThis.fetch` stub must not swallow these requests (#967).
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type Event, createOmniClient } from '@omni/sdk';
import { matchesWaitEvent, parseWaitFilters, waitForEvent } from '../commands/events';

let priorFetch: typeof globalThis.fetch;
beforeEach(() => {
  priorFetch = globalThis.fetch;
  globalThis.fetch = Bun.fetch as unknown as typeof globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = priorFetch;
});

type WaitRow = Event & { rawPayload?: Record<string, unknown> | null };

function makeRow(overrides: Partial<WaitRow> = {}): WaitRow {
  return {
    id: crypto.randomUUID(),
    eventType: 'custom.deploy.finished',
    contentType: null,
    instanceId: '00000000-0000-0000-0000-0000000000aa',
    personId: null,
    direction: 'inbound',
    textContent: null,
    transcription: null,
    imageDescription: null,
    chatUuid: null,
    agentId: null,
    conversationId: null,
    receivedAt: '2026-09-06T10:00:00.000Z',
    processedAt: null,
    rawPayload: { status: 'ok' },
    ...overrides,
  };
}

describe('parseWaitFilters', () => {
  test('k=v becomes an eq condition; values parse as JSON when valid', () => {
    expect(parseWaitFilters(['count=5'])).toEqual([{ field: 'count', operator: 'eq', value: 5 }]);
    expect(parseWaitFilters(['ok=true'])).toEqual([{ field: 'ok', operator: 'eq', value: true }]);
    expect(parseWaitFilters(['id="5"'])).toEqual([{ field: 'id', operator: 'eq', value: '5' }]);
  });

  test('non-JSON values fall back to the raw string', () => {
    expect(parseWaitFilters(['status=open'])).toEqual([{ field: 'status', operator: 'eq', value: 'open' }]);
  });

  test('dot paths stay on the field; = inside the value survives', () => {
    expect(parseWaitFilters(['user.id=42', 'note=a=b'])).toEqual([
      { field: 'user.id', operator: 'eq', value: 42 },
      { field: 'note', operator: 'eq', value: 'a=b' },
    ]);
  });
});

describe('matchesWaitEvent', () => {
  test('payload conditions run through the automation matcher (nested paths)', () => {
    const row = makeRow({ rawPayload: { user: { id: 42 }, status: 'open' } });
    expect(matchesWaitEvent(row, { all: true }, parseWaitFilters(['user.id=42']))).toBe(true);
    expect(matchesWaitEvent(row, { all: true }, parseWaitFilters(['user.id=43']))).toBe(false);
    expect(matchesWaitEvent(row, { all: true }, parseWaitFilters(['status=open', 'user.id=42']))).toBe(true);
    expect(matchesWaitEvent(row, { all: true }, parseWaitFilters(['status=closed', 'user.id=42']))).toBe(false);
  });

  test('a row without rawPayload only matches an empty condition set', () => {
    const row = makeRow({ rawPayload: null });
    expect(matchesWaitEvent(row, { all: true }, [])).toBe(true);
    expect(matchesWaitEvent(row, { all: true }, parseWaitFilters(['status=ok']))).toBe(false);
  });

  test('envelope filters apply too, including type globs', () => {
    const row = makeRow({ eventType: 'custom.deploy.finished' });
    expect(matchesWaitEvent(row, { type: 'custom.*', all: true }, [])).toBe(true);
    expect(matchesWaitEvent(row, { type: 'custom.build.*', all: true }, [])).toBe(false);
    expect(matchesWaitEvent(row, { type: 'custom.deploy.finished', all: true }, [])).toBe(true);
  });
});

describe('waitForEvent against an in-process API', () => {
  // Mutable batches: each GET /events shifts the next canned response.
  let batches: WaitRow[][] = [];
  let requests = 0;

  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (req.method === 'GET' && url.pathname.endsWith('/events')) {
        requests++;
        const items = batches.length > 1 ? batches.shift() : batches[0];
        return Response.json({ items: items ?? [], meta: { hasMore: false } });
      }
      return Response.json({ error: { code: 'NOT_FOUND', message: 'unknown route' } }, { status: 404 });
    },
  });

  const client = createOmniClient({ baseUrl: `http://127.0.0.1:${server.port}`, apiKey: 'test-key' });

  afterAll(() => {
    server.stop(true);
  });

  beforeEach(() => {
    batches = [];
    requests = 0;
  });

  test('resolves with the first event matching envelope filters + payload conditions', async () => {
    const miss = makeRow({ rawPayload: { status: 'failed' }, receivedAt: '2026-09-06T10:00:00.000Z' });
    const hit = makeRow({ rawPayload: { status: 'ok' }, receivedAt: '2026-09-06T10:00:01.000Z' });
    batches = [[hit, miss]]; // out of order on purpose — the loop sorts ascending

    const found = await waitForEvent(client, {
      filters: { type: 'custom.deploy.*', all: true },
      conditions: parseWaitFilters(['status=ok']),
      sinceIso: '2026-09-06T00:00:00.000Z',
      pollMs: 250,
      timeoutMs: 5000,
    });

    expect(found?.id).toBe(hit.id);
    expect(found?.rawPayload).toEqual({ status: 'ok' });
  });

  test('keeps polling until a matching event appears', async () => {
    const hit = makeRow();
    batches = [[], [], [hit]];

    const found = await waitForEvent(client, {
      filters: { all: true },
      conditions: [],
      sinceIso: '2026-09-06T00:00:00.000Z',
      pollMs: 50,
      timeoutMs: 5000,
    });

    expect(found?.id).toBe(hit.id);
    expect(requests).toBeGreaterThanOrEqual(3);
  });

  test('resolves null once the deadline passes with nothing matching', async () => {
    batches = [[]];

    const found = await waitForEvent(client, {
      filters: { all: true },
      conditions: [],
      sinceIso: '2026-09-06T00:00:00.000Z',
      pollMs: 50,
      timeoutMs: 200,
    });

    expect(found).toBeNull();
  });

  test('a non-matching event never resolves the wait, even before the deadline', async () => {
    batches = [[makeRow({ rawPayload: { status: 'failed' } })]];

    const found = await waitForEvent(client, {
      filters: { all: true },
      conditions: parseWaitFilters(['status=ok']),
      sinceIso: '2026-09-06T00:00:00.000Z',
      pollMs: 50,
      timeoutMs: 200,
    });

    expect(found).toBeNull();
  });
});
