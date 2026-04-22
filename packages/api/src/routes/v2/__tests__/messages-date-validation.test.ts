/**
 * Regression test for automagik-dev/omni#494
 *
 * Contract:
 *   GET /messages MUST return HTTP 400 (not 500) when the `since` or
 *   `until` query parameters are present but not parseable as a date.
 *   Valid ISO 8601 input must reach the messages service as a real
 *   `Date` instance (never `Invalid Date`).
 *
 * @see packages/api/src/schemas/date-query.ts — shared helper
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

type ListCall = { query: Record<string, unknown> };

function mountMessagesRoutes(calls: ListCall[]): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      messages: {
        list: mock(async (query: Record<string, unknown>) => {
          calls.push({ query });
          return { items: [], hasMore: false, cursor: null };
        }),
        count: mock(async () => 0),
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
  app.route('/messages', messagesRoutes);
  return app;
}

describe('GET /messages — date parameter validation (#494)', () => {
  test('returns 400 when `since` is a UUID', async () => {
    const calls: ListCall[] = [];
    const app = mountMessagesRoutes(calls);

    const res = await app.request('/messages?since=550e8400-e29b-41d4-a716-446655440000');

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 400 when `until` is arbitrary garbage', async () => {
    const calls: ListCall[] = [];
    const app = mountMessagesRoutes(calls);

    const res = await app.request('/messages?until=not-a-date-at-all');

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 200 and passes real Date instances to the service for valid ISO 8601', async () => {
    const calls: ListCall[] = [];
    const app = mountMessagesRoutes(calls);

    const res = await app.request('/messages?since=2024-01-01T00:00:00.000Z&until=2024-02-01T00:00:00.000Z');

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query.since).toBeInstanceOf(Date);
    expect(calls[0]?.query.until).toBeInstanceOf(Date);
  });
});
