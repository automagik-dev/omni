/**
 * Regression test for automagik-dev/omni#494
 *
 * Contract:
 *   GET /keys/:id/audit MUST return HTTP 400 (not 500) when `since` or
 *   `until` query parameters are present but not parseable as a date.
 *   Valid ISO 8601 input must reach the audit service as a real `Date`
 *   instance (never `Invalid Date`).
 *
 * @see packages/api/src/schemas/date-query.ts — shared helper
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { keysRoutes } from '../keys';

type AuditCall = { id: string; options: Record<string, unknown> };

const KEY_ID = '11111111-1111-1111-1111-111111111111';

function mountKeysRoutes(calls: AuditCall[]): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      apiKeys: {
        getById: mock(async (id: string) => ({ id, name: 'test', status: 'active' })),
      },
      audit: {
        listByKeyId: mock(async (id: string, options: Record<string, unknown>) => {
          calls.push({ id, options });
          return { items: [], total: 0, hasMore: false, cursor: null };
        }),
      },
    } as never);
    c.set('apiKey', {
      id: 'test',
      name: 'test',
      scopes: ['*'],
      instanceIds: null,
      expiresAt: null,
    } as never);
    await next();
  });
  app.route('/keys', keysRoutes);
  return app;
}

describe('GET /keys/:id/audit — date parameter validation (#494)', () => {
  test('returns 400 when `since` is a UUID', async () => {
    const calls: AuditCall[] = [];
    const app = mountKeysRoutes(calls);

    const res = await app.request(`/keys/${KEY_ID}/audit?since=550e8400-e29b-41d4-a716-446655440000`);

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 400 when `until` is arbitrary garbage', async () => {
    const calls: AuditCall[] = [];
    const app = mountKeysRoutes(calls);

    const res = await app.request(`/keys/${KEY_ID}/audit?until=not-a-date-at-all`);

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 200 and passes real Date instances to audit service for valid ISO 8601', async () => {
    const calls: AuditCall[] = [];
    const app = mountKeysRoutes(calls);

    const res = await app.request(
      `/keys/${KEY_ID}/audit?since=2024-01-01T00:00:00.000Z&until=2024-02-01T00:00:00.000Z`,
    );

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options.since).toBeInstanceOf(Date);
    expect(calls[0]?.options.until).toBeInstanceOf(Date);
  });
});
