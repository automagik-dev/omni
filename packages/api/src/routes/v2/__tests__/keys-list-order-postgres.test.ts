/**
 * `GET /keys` lists newest first and pages with `offset` (real PostgreSQL).
 *
 * Before this, `ApiKeyService.list()` sorted by `createdAt` ascending and the route only cut the
 * first `limit` rows, so past 50 keys a key paired just now was missing from `omni keys list`, and
 * nothing past the first 100 could be reached at all.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type Database, apiKeys, createDbHandle } from '@omni/db';
import { pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { dropDatabaseOrThrow } from '@omni/db/pg-testing';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { ApiKeyService } from '../../../services/api-keys';
import type { AppVariables } from '../../../types';
import { keysRoutes } from '../keys';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

postgresDescribe('GET /keys order (real PostgreSQL)', () => {
  const database = `omni_keys_order_${crypto.randomUUID().replaceAll('-', '')}`;
  const closers: (() => Promise<void>)[] = [];
  let db: Database;
  let keys: ApiKeyService;
  let app: Hono<{ Variables: AppVariables }>;
  /** Key ids in creation order: [0] is the oldest. */
  const created: string[] = [];
  const TOTAL = 5;

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, database);
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, database), maxConnections: 3 });
    closers.push(handle.close);
    db = handle.db;
    keys = new ApiKeyService(db);

    for (let i = 0; i < TOTAL; i++) {
      const { key } = await keys.create({ name: `order-${i}`, scopes: ['*'] });
      // Distinct, explicit timestamps: the order under test must not hang on clock resolution.
      await db
        .update(apiKeys)
        .set({ createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)) })
        .where(eq(apiKeys.id, key.id));
      created.push(key.id);
    }

    app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('apiKey', { id: 'operator', name: 'operator', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
      c.set('services', { apiKeys: keys } as never);
      await next();
    });
    app.route('/keys', keysRoutes);
  }, 180_000);

  afterAll(async () => {
    for (const close of closers.reverse()) await close();
    dropDatabaseOrThrow({ superUrl, psqlBin }, database);
  });

  const newestFirst = () => [...created].reverse();
  const ids = async (query: string) => {
    const res = await app.request(`/keys${query}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: { id: string }[] }).items.map((k) => k.id);
  };

  test('the service lists newest first; the ascending order is gone', async () => {
    const listed = (await keys.list()).map((k) => k.id);
    expect(listed).toEqual(newestFirst());
    expect(listed).not.toEqual(created);
  });

  test('the default and a limited list start at the newest key', async () => {
    expect(await ids('')).toEqual(newestFirst());
    expect(await ids('?limit=2')).toEqual(newestFirst().slice(0, 2));
  });

  test('offset pages through every key with no gap or repeat', async () => {
    const pages = [await ids('?limit=2&offset=0'), await ids('?limit=2&offset=2'), await ids('?limit=2&offset=4')];
    expect(pages.flat()).toEqual(newestFirst());
    expect(await ids('?limit=2&offset=6')).toEqual([]);
  });

  test('a negative offset is refused', async () => {
    expect((await app.request('/keys?offset=-1')).status).toBe(400);
  });
});
