import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { auditRoutes } from '../audit';

function mount(rows: Record<string, unknown>[]) {
  const seen: { limit?: number; where?: unknown } = {};
  const chain = {
    from: () => chain,
    where: (w: unknown) => {
      seen.where = w;
      return chain;
    },
    orderBy: () => chain,
    limit: async (n: number) => {
      seen.limit = n;
      return rows.slice(0, n);
    },
  };
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('db', { select: () => chain } as never);
    await next();
  });
  app.route('/audit', auditRoutes);
  return { app, seen };
}

describe('GET /audit', () => {
  test('lists entries with filters and paginates', async () => {
    const createdAt = new Date('2026-09-14T00:00:00Z');
    const rows = [1, 2, 3].map((i) => ({ id: `id-${i}`, targetId: 'inst', actor: 'cli:alice', createdAt }));
    const { app, seen } = mount(rows);

    const res = await app.request('/audit?target=inst&actor=cli:alice&limit=2');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; meta: { hasMore: boolean; cursor: string | null } };
    expect(seen.limit).toBe(3);
    expect(seen.where).toBeDefined();
    expect(body.items).toHaveLength(2);
    expect(body.meta).toEqual({ hasMore: true, cursor: createdAt.toISOString() });
  });

  test('rejects an unparseable since', async () => {
    const { app } = mount([]);
    expect((await app.request('/audit?since=garbage')).status).toBe(400);
  });
});
