/**
 * Regression test for automagik-dev/omni#494
 *
 * Contract:
 *   GET /persons/:id/timeline MUST return HTTP 400 (not 500) when the
 *   `since` or `until` query parameters are present but not parseable
 *   as a date. Valid ISO 8601 input must reach the events service as
 *   a real `Date` instance (never `Invalid Date`).
 *
 * @see packages/api/src/schemas/date-query.ts — shared helper
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { personsRoutes } from '../persons';

type TimelineCall = { personId: string; input: Record<string, unknown> };

const PERSON_ID = '11111111-1111-1111-1111-111111111111';

function mountPersonsRoutes(calls: TimelineCall[]): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      events: {
        getTimeline: mock(async (personId: string, input: Record<string, unknown>) => {
          calls.push({ personId, input });
          return { items: [], hasMore: false, cursor: null };
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
  app.route('/persons', personsRoutes);
  return app;
}

describe('GET /persons/:id/timeline — date parameter validation (#494)', () => {
  test('returns 400 when `since` is a UUID', async () => {
    const calls: TimelineCall[] = [];
    const app = mountPersonsRoutes(calls);

    const res = await app.request(`/persons/${PERSON_ID}/timeline?since=550e8400-e29b-41d4-a716-446655440000`);

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 400 when `until` is arbitrary garbage', async () => {
    const calls: TimelineCall[] = [];
    const app = mountPersonsRoutes(calls);

    const res = await app.request(`/persons/${PERSON_ID}/timeline?until=not-a-date-at-all`);

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 200 and passes real Date instances to events.getTimeline for valid ISO 8601', async () => {
    const calls: TimelineCall[] = [];
    const app = mountPersonsRoutes(calls);

    const res = await app.request(
      `/persons/${PERSON_ID}/timeline?since=2024-01-01T00:00:00.000Z&until=2024-02-01T00:00:00.000Z`,
    );

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input.since).toBeInstanceOf(Date);
    expect(calls[0]?.input.until).toBeInstanceOf(Date);
  });
});
