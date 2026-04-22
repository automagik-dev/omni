/**
 * Regression test for automagik-dev/omni#487
 *
 * Contract:
 *   GET /dead-letters MUST return HTTP 400 (not 500) when the
 *   `since` or `until` query parameters are present but not parseable
 *   as a date. Valid ISO 8601 input must reach the service as a real
 *   `Date` instance (never `Invalid Date`).
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { deadLettersRoutes } from '../dead-letters';

type ListCall = { query: Record<string, unknown> };

function mountDeadLettersRoutes(calls: ListCall[]): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      deadLetters: {
        list: mock(async (query: Record<string, unknown>) => {
          calls.push({ query });
          return { items: [], hasMore: false, cursor: null };
        }),
      },
    } as never);
    await next();
  });
  app.route('/dead-letters', deadLettersRoutes);
  return app;
}

describe('GET /dead-letters — date parameter validation (#487)', () => {
  test('returns 400 when `since` is a UUID', async () => {
    const calls: ListCall[] = [];
    const app = mountDeadLettersRoutes(calls);

    const res = await app.request('/dead-letters?since=550e8400-e29b-41d4-a716-446655440000');

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 400 when `until` is arbitrary garbage', async () => {
    const calls: ListCall[] = [];
    const app = mountDeadLettersRoutes(calls);

    const res = await app.request('/dead-letters?until=not-a-date-at-all');

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 200 and passes Date instances for valid ISO 8601', async () => {
    const calls: ListCall[] = [];
    const app = mountDeadLettersRoutes(calls);

    const res = await app.request('/dead-letters?since=2024-01-01T00:00:00.000Z&until=2024-02-01T00:00:00.000Z');

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query.since).toBeInstanceOf(Date);
    expect(calls[0]?.query.until).toBeInstanceOf(Date);
    expect((calls[0]?.query.since as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect((calls[0]?.query.until as Date).toISOString()).toBe('2024-02-01T00:00:00.000Z');
  });
});
