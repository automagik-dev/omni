/**
 * GET /events/consumers/:name/stream — route contract with a mocked service.
 *
 * Start-position precedence and validation, JSON errors before the stream
 * opens (404 / shared 400), the SSE wire format, and disconnect cleanup. The
 * scan loop itself is covered in services/__tests__/event-consumer-stream.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { NotFoundError, ValidationError } from '@omni/core';
import type { DurableConsumer, OmniEvent } from '@omni/db';
import { Hono } from 'hono';
import { SCOPE_MAP } from '../../../constants/scopes';
import { errorHandler } from '../../../middleware/error';
import type { ConsumerCaller, StreamAccess, StreamScanResult } from '../../../services/event-consumers';
import type { AppVariables } from '../../../types';
import { eventConsumersRoutes } from '../event-consumers';

const CONSUMER = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'vox',
  eventType: 'message.received',
  excludeTypes: null,
  filters: null,
  cursor: 10,
  shared: false,
  waitForReady: false,
  leaseState: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as DurableConsumer;

function row(seq: number, instanceId = 'inst-a'): OmniEvent {
  return {
    id: `evt-${seq}`,
    journalSeq: seq,
    eventType: 'message.received',
    instanceId,
    rawPayload: { seq },
  } as unknown as OmniEvent;
}

function buildApp(
  options: {
    journal?: OmniEvent[];
    getStreamable?: (name: string, caller?: ConsumerCaller) => Promise<DurableConsumer>;
    instanceIds?: string[] | null;
    keyId?: string;
  } = {},
) {
  const journal = options.journal ?? [];
  const scans: number[] = [];
  const accesses: StreamAccess[] = [];
  const touched: string[] = [];
  const forbidden = (method: string) => async () => {
    touched.push(method);
    throw new Error(`${method} must not be called by the stream`);
  };
  const services = {
    eventConsumers: {
      getStreamable: options.getStreamable ?? (async () => CONSUMER),
      scanForStream: async (_name: string, after: number, access: StreamAccess): Promise<StreamScanResult> => {
        scans.push(after);
        accesses.push(access);
        const allowed = access.caller.instanceIds;
        const scanned = journal.filter((r) => r.journalSeq > after);
        const rows = scanned.filter((r) => allowed === null || allowed.includes(r.instanceId ?? ''));
        const last = scanned[scanned.length - 1]; // `through` covers filtered-out rows, as the real scan
        return { items: rows, through: last ? last.journalSeq : null, held: false, full: false };
      },
      pull: forbidden('pull'),
      ack: forbidden('ack'),
    },
  } as unknown as AppVariables['services'];

  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', services);
    if (options.instanceIds !== undefined) {
      c.set('apiKey', { id: options.keyId, instanceIds: options.instanceIds } as unknown as AppVariables['apiKey']);
    }
    await next();
  });
  app.route('/api/v2', eventConsumersRoutes);
  return { app, scans, touched, accesses };
}

/** Read SSE text until `until` matches (or the body ends), then cancel the body (client disconnect). */
async function readUntil(response: Response, until: RegExp): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('no body');
  const decoder = new TextDecoder();
  let text = '';
  while (!until.test(text)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  await reader.cancel();
  return text;
}

const ENV_KEYS = [
  'EVENT_STREAM_MAX_PER_KEY',
  'EVENT_STREAM_HEARTBEAT_MS',
  'STREAM_POLL_FALLBACK_MS',
  'EVENT_STREAM_MAX_LIFETIME_MS',
  'EVENT_STREAM_MAX_PER_PROCESS',
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
beforeEach(() => {
  process.env.EVENT_STREAM_HEARTBEAT_MS = '20';
  process.env.STREAM_POLL_FALLBACK_MS = '10';
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('GET /api/v2/events/consumers/:name/stream', () => {
  test('streams matching rows as SSE events after a connected event, from the stored cursor', async () => {
    const { app, scans, touched } = buildApp({ journal: [row(9), row(11), row(12)] });
    const res = await app.request('/api/v2/events/consumers/vox/stream');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await readUntil(res, /id: 12\n/);

    expect(text).toContain(`event: connected\ndata: ${JSON.stringify({ consumer: 'vox', after: 10 })}\n`);
    expect(text).toContain(`event: message.received\ndata: ${JSON.stringify(row(11))}\nid: 11\n\n`);
    expect(text).toContain('id: 12\n');
    expect(text).not.toContain('id: 9\n');
    expect(scans[0]).toBe(10);
    expect(touched).toEqual([]); // never pulls, never acks
  });

  test('?after overrides the stored cursor', async () => {
    const { app, scans } = buildApp({ journal: [row(11), row(12)] });
    const text = await readUntil(await app.request('/api/v2/events/consumers/vox/stream?after=11'), /id: 12\n/);
    expect(scans[0]).toBe(11);
    expect(text).not.toContain('id: 11\n');
  });

  test('Last-Event-ID overrides ?after', async () => {
    const { app, scans } = buildApp({ journal: [row(11), row(12), row(13)] });
    const res = await app.request('/api/v2/events/consumers/vox/stream?after=11', {
      headers: { 'Last-Event-ID': '12' },
    });
    const text = await readUntil(res, /id: 13\n/);
    expect(scans[0]).toBe(12);
    expect(text).not.toContain('id: 12\n');
  });

  test('a malformed ?after or Last-Event-ID is a 400 before the stream opens', async () => {
    const { app, scans } = buildApp();
    for (const after of ['-1', 'abc', '1.5', '1e3', '']) {
      const res = await app.request(`/api/v2/events/consumers/vox/stream?after=${after}`);
      expect(res.status).toBe(400);
    }
    const header = await app.request('/api/v2/events/consumers/vox/stream', { headers: { 'Last-Event-ID': 'x' } });
    expect(header.status).toBe(400);
    expect(scans).toEqual([]);
  });

  test('an unknown consumer is a 404 JSON error', async () => {
    const { app } = buildApp({
      getStreamable: async (name) => {
        throw new NotFoundError('DurableConsumer', name);
      },
    });
    const res = await app.request('/api/v2/events/consumers/nope/stream');
    expect(res.status).toBe(404);
  });

  test('a shared consumer is refused with a 400 JSON error', async () => {
    const { app } = buildApp({
      getStreamable: async (name) => {
        throw new ValidationError(`consumer '${name}' is shared — streams serve fan-out consumers only`);
      },
    });
    const res = await app.request('/api/v2/events/consumers/vox/stream');
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('shared');
  });

  test('sends heartbeat comments and stops scanning once the client disconnects', async () => {
    const { app, scans } = buildApp();
    const text = await readUntil(await app.request('/api/v2/events/consumers/vox/stream'), /: heartbeat \d+\n\n/);
    expect(text).toMatch(/: heartbeat \d+\n\n/);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const after = scans.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scans.length).toBe(after);
  });

  test('an instance-restricted key only receives its instances; a full-access key receives all', async () => {
    const journal = [row(11, 'inst-a'), row(12, 'inst-b'), row(13, 'inst-a')];
    const restricted = buildApp({ journal, instanceIds: ['inst-a'] });
    const mine = await readUntil(await restricted.app.request('/api/v2/events/consumers/vox/stream'), /id: 13\n/);
    expect(restricted.accesses[0]).toEqual({ tenantId: null, caller: { keyId: null, instanceIds: ['inst-a'] } });
    expect(mine).toContain('id: 11\n');
    expect(mine).not.toContain('id: 12\n');

    const full = buildApp({ journal, instanceIds: null });
    const all = await readUntil(await full.app.request('/api/v2/events/consumers/vox/stream'), /id: 13\n/);
    expect(full.accesses[0]).toEqual({ tenantId: null, caller: { keyId: null, instanceIds: null } });
    expect(all).toContain('id: 12\n');
  });

  test('the stream ends at its lifetime with a reconnect event and an SSE retry hint', async () => {
    process.env.EVENT_STREAM_MAX_LIFETIME_MS = '60';
    const { app } = buildApp({ journal: [row(11)] });
    const res = await app.request('/api/v2/events/consumers/vox/stream');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    let text = '';
    for (;;) {
      const { value, done } = await reader.read(); // the server closes the body itself
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    expect(text).toContain('id: 11\n');
    expect(text).toMatch(/event: reconnect\ndata: \{"consumer":"vox","reason":"lifetime"\}\nid: 11\nretry: 1000\n\n$/);
    expect(text).toMatch(/^event: connected\ndata: [^\n]*\n\n/); // `connected` carries no id
  });

  test('the reconnect id is the scanned position, past rows the filter dropped', async () => {
    process.env.EVENT_STREAM_MAX_LIFETIME_MS = '60';
    // The inst-a key receives only 11, yet the scan covers 12 and 13.
    const { app } = buildApp({ journal: [row(11), row(12, 'inst-b'), row(13, 'inst-b')], instanceIds: ['inst-a'] });
    const res = await app.request('/api/v2/events/consumers/vox/stream');
    const text = await res.text();
    expect(text).not.toContain('id: 12\n');
    expect(text).toMatch(/event: reconnect\ndata: [^\n]*\nid: 13\nretry: 1000\n\n$/);
    expect(text).toMatch(/^event: connected\ndata: [^\n]*\n\n/);
  });

  test('past EVENT_STREAM_MAX_PER_PROCESS a new stream is refused with 429', async () => {
    process.env.EVENT_STREAM_MAX_PER_PROCESS = '1';
    const { app } = buildApp();
    const open = await app.request('/api/v2/events/consumers/vox/stream');
    const reader = open.body?.getReader();
    await reader?.read(); // connected
    const refused = await app.request('/api/v2/events/consumers/vox/stream');
    expect(refused.status).toBe(429);
    expect(JSON.stringify(await refused.json())).toContain('RATE_LIMITED');
    await reader?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const again = await app.request('/api/v2/events/consumers/vox/stream');
    expect(again.status).toBe(200);
    await again.body?.cancel();
  });

  test('requires events:write, the same scope as pull (an events:read key cannot stream)', () => {
    expect(SCOPE_MAP['GET /events/consumers/:name/stream']).toBe('events:write');
    expect(SCOPE_MAP['GET /events/consumers/:name/stream']).toBe(SCOPE_MAP['POST /events/consumers/:name/pull']);
  });

  test('the route resolves the consumer with the pull caller (scoped and not visible -> 404, nothing streamed)', async () => {
    const seen: (ConsumerCaller | undefined)[] = [];
    const { app, scans } = buildApp({
      keyId: 'key-other',
      instanceIds: ['inst-z'],
      getStreamable: async (name, caller) => {
        seen.push(caller);
        throw new NotFoundError('DurableConsumer', name);
      },
    });
    const res = await app.request('/api/v2/events/consumers/vox/stream');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('connected');
    expect(seen).toEqual([{ keyId: 'key-other', instanceIds: ['inst-z'] }]);
    expect(scans).toEqual([]);
  });

  test('past EVENT_STREAM_MAX_PER_KEY a key gets 429 while another key still streams', async () => {
    process.env.EVENT_STREAM_MAX_PER_KEY = '1';
    const one = buildApp({ keyId: 'key-1', instanceIds: null });
    const open = await one.app.request('/api/v2/events/consumers/vox/stream');
    const reader = open.body?.getReader();
    await reader?.read(); // connected
    const refused = await one.app.request('/api/v2/events/consumers/vox/stream');
    expect(refused.status).toBe(429);
    expect(JSON.stringify(await refused.json())).toContain('"scope":"key"');
    const other = await buildApp({ keyId: 'key-2', instanceIds: null }).app.request(
      '/api/v2/events/consumers/vox/stream',
    );
    expect(other.status).toBe(200);
    await other.body?.cancel();
    await reader?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const again = await one.app.request('/api/v2/events/consumers/vox/stream');
    expect(again.status).toBe(200); // released on disconnect
    await again.body?.cancel();
  });
});
