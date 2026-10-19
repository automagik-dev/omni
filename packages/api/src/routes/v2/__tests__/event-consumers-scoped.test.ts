/**
 * Durable consumer routes — opt-in instance scoping (0082), DB-free.
 *
 * Two halves:
 *  - every route hands the service the caller derived from the request's key
 *    (id + instance restriction, read like the /events routes), and a request
 *    without the new options reaches the service exactly as before;
 *  - the create-time scope rules run before any database access, so the real
 *    service over a database that throws on touch proves the HTTP mapping:
 *    malformed scoped instanceIds -> 400 VALIDATION_ERROR, an instance outside
 *    the key -> 403 FORBIDDEN, nothing resolvable -> 400;
 *  - a scoped create whose ids pass those rules is checked for existence with
 *    one instances read (fake database): an unknown id -> 400 naming it, all
 *    known -> 201, and an unscoped create never reads instances.
 *
 * The SQL instance predicate and the owner/non-owner 404s against real rows
 * live in `__tests__/event-consumers-postgres.test.ts`.
 */

import { describe, expect, mock, test } from 'bun:test';
import { type Database, instances } from '@omni/db';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import { CreateConsumerSchema } from '../../../schemas/openapi/event-consumers';
import { EventConsumerService } from '../../../services/event-consumers';
import type { ApiKeyData, AppVariables } from '../../../types';
import { eventConsumersRoutes } from '../event-consumers';

const INST_A = '11111111-1111-4111-8111-1111111111aa';
const INST_B = '11111111-1111-4111-8111-1111111111bb';
const INST_C = '11111111-1111-4111-8111-1111111111cc';

const RESTRICTED_KEY: ApiKeyData = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'restricted',
  scopes: ['*'],
  instanceIds: [INST_A, INST_B],
  expiresAt: null,
};
const UNRESTRICTED_KEY: ApiKeyData = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'unrestricted',
  scopes: ['*'],
  instanceIds: null,
  expiresAt: null,
};

function mount(services: unknown, apiKey?: ApiKeyData): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', { eventConsumers: services } as never);
    if (apiKey) c.set('apiKey', apiKey);
    await next();
  });
  app.route('/', eventConsumersRoutes);
  return app;
}

function mockService() {
  return {
    list: mock(async () => []),
    create: mock(async (input: unknown) => ({ input })),
    inspect: mock(async (name: string) => ({ name })),
    delete: mock(async () => undefined),
    pull: mock(async (name: string) => ({ consumer: name, items: [] })),
    ack: mock(async (name: string) => ({ name })),
  };
}

/** Exercise every consumer route once. */
async function hitEveryRoute(app: Hono<{ Variables: AppVariables }>): Promise<number[]> {
  const json = { 'Content-Type': 'application/json' };
  const responses = await Promise.all([
    app.request('/events/consumers'),
    app.request('/events/consumers', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ name: 'legacy', eventType: 'custom.*' }),
    }),
    app.request('/events/consumers/legacy'),
    app.request('/events/consumers/legacy/pull?limit=5', { method: 'POST' }),
    app.request('/events/consumers/legacy/ack', { method: 'POST', headers: json, body: JSON.stringify({ cursor: 3 }) }),
    app.request('/events/consumers/legacy', { method: 'DELETE' }),
  ]);
  return responses.map((r) => r.status);
}

describe('consumer routes forward the caller (no new option: identical behaviour)', () => {
  for (const [label, key, expected] of [
    ['restricted key', RESTRICTED_KEY, { keyId: RESTRICTED_KEY.id, instanceIds: [INST_A, INST_B] }],
    ['unrestricted key', UNRESTRICTED_KEY, { keyId: UNRESTRICTED_KEY.id, instanceIds: null }],
    ['no key context', undefined, { keyId: null, instanceIds: null }],
  ] as const) {
    test(`${label}: every route reaches the service with the original arguments plus the caller`, async () => {
      const service = mockService();
      const statuses = await hitEveryRoute(mount(service, key));
      expect(statuses).toEqual([200, 201, 200, 200, 200, 200]);

      expect(service.list).toHaveBeenCalledWith(expected);
      // The create body is passed through untouched: no scoped/instanceIds appear unless the client sent them
      // (`access: 'all'` is #1299's schema default, the unfiltered behaviour).
      expect(service.create).toHaveBeenCalledWith({ name: 'legacy', eventType: 'custom.*', access: 'all' }, expected);
      expect(service.inspect).toHaveBeenCalledWith('legacy', expected);
      expect(service.pull).toHaveBeenCalledWith(
        'legacy',
        { limit: 5, waitMs: undefined, leaseMs: undefined },
        expected,
      );
      expect(service.ack).toHaveBeenCalledWith('legacy', 3, undefined, expected);
      expect(service.delete).toHaveBeenCalledWith('legacy', expected);
    });
  }
});

describe('POST /events/consumers scope rules (real service, no database)', () => {
  /** A database that fails the test if the service touches it. */
  const untouchable = new Proxy(
    {},
    {
      get() {
        throw new Error('database must not be touched by a refused create');
      },
    },
  ) as Database;

  async function create(body: Record<string, unknown>, key?: ApiKeyData) {
    const app = mount(new EventConsumerService(untouchable, null), key);
    const res = await app.request('/events/consumers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'scoped-one', eventType: 'message.*', ...body }),
    });
    return { status: res.status, body: (await res.json()) as { error?: { code?: string } } };
  }

  test('no new option: instanceIds without scoped: true still passes request validation (ignored, as before)', () => {
    for (const body of [
      { instanceIds: [INST_A] },
      { scoped: false, instanceIds: ['not-a-uuid'] },
      { instanceIds: 'anything' },
    ]) {
      expect(CreateConsumerSchema.safeParse({ name: 'legacy-one', eventType: 'message.*', ...body }).success).toBe(
        true,
      );
    }
  });

  test('scoped create with malformed instanceIds -> 400 VALIDATION_ERROR', async () => {
    const res = await create({ scoped: true, instanceIds: ['not-a-uuid'] }, RESTRICTED_KEY);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });

  test('scoped create naming an instance outside the restricted key -> 403 FORBIDDEN', async () => {
    const res = await create({ scoped: true, instanceIds: [INST_A, INST_C] }, RESTRICTED_KEY);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  test('scoped create with an empty intersection -> 400', async () => {
    const res = await create({ scoped: true, instanceIds: [] }, RESTRICTED_KEY);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });

  test('scoped create on an unrestricted key without instanceIds -> 400', async () => {
    const res = await create({ scoped: true }, UNRESTRICTED_KEY);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });

  test('non-uuid instanceIds are refused by the schema (400)', async () => {
    const res = await create({ scoped: true, instanceIds: ['not-a-uuid'] }, UNRESTRICTED_KEY);
    expect(res.status).toBe(400);
  });
});

describe('POST /events/consumers resolves scoped instance ids (fake database)', () => {
  /**
   * Just enough of the drizzle surface `create` uses: `select().from(t)` is
   * awaitable (head) and `.where()`-able (instance lookup), and insert returns
   * the row. `instances` reads answer from `known` and are counted.
   */
  function fakeDb(known: string[]) {
    const calls = { instanceReads: 0, inserts: 0 };
    const db = {
      select: () => ({
        from: (table: unknown) => {
          if (table === instances) {
            calls.instanceReads++;
            return { where: async () => known.map((id) => ({ id })) };
          }
          return Promise.resolve([{ head: 0 }]);
        },
      }),
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              calls.inserts++;
              return [{ id: 'c1', cursor: 0, shared: false, scoped: false, instanceIds: null, ...values }];
            },
          }),
        }),
      }),
    };
    return { db: db as unknown as Database, calls };
  }

  async function create(db: Database, body: Record<string, unknown>, key: ApiKeyData) {
    const app = mount(new EventConsumerService(db, null), key);
    const res = await app.request('/events/consumers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'scoped-one', eventType: 'message.*', ...body }),
    });
    return {
      status: res.status,
      body: (await res.json()) as {
        data?: { instanceIds?: string[] };
        error?: { code?: string; message?: string; details?: unknown };
      },
    };
  }

  test('an unrestricted key naming an unknown instance -> 400 naming it, nothing inserted', async () => {
    const { db, calls } = fakeDb([INST_A]);
    const res = await create(db, { scoped: true, instanceIds: [INST_A, INST_C] }, UNRESTRICTED_KEY);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error)).toContain(INST_C);
    expect(JSON.stringify(res.body.error)).not.toContain(INST_A);
    expect(calls).toEqual({ instanceReads: 1, inserts: 0 });
  });

  test("a restricted key's stale instance (gone from the table) -> 400", async () => {
    const { db, calls } = fakeDb([INST_A]);
    const res = await create(db, { scoped: true }, RESTRICTED_KEY);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error)).toContain(INST_B);
    expect(calls.inserts).toBe(0);
  });

  test('every instance resolves -> 201 with the scope stored', async () => {
    const { db, calls } = fakeDb([INST_A, INST_B]);
    const res = await create(db, { scoped: true, instanceIds: [INST_B] }, RESTRICTED_KEY);
    expect(res.status).toBe(201);
    expect(res.body.data?.instanceIds).toEqual([INST_B]);
    expect(calls).toEqual({ instanceReads: 1, inserts: 1 });
  });

  test('an uppercase id still resolves against the lowercase column value', async () => {
    const { db } = fakeDb([INST_C]);
    const res = await create(db, { scoped: true, instanceIds: [INST_C.toUpperCase()] }, UNRESTRICTED_KEY);
    expect(res.status).toBe(201);
  });

  test('no new option: an unscoped create never reads instances', async () => {
    for (const body of [{}, { instanceIds: [INST_C] }, { scoped: false, instanceIds: ['not-a-uuid'] }]) {
      const { db, calls } = fakeDb([]);
      const res = await create(db, body, UNRESTRICTED_KEY);
      expect(res.status).toBe(201);
      expect(calls).toEqual({ instanceReads: 0, inserts: 1 });
    }
  });
});
