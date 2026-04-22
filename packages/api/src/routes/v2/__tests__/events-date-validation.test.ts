/**
 * Regression test for automagik-dev/omni#487
 *
 * Contract:
 *   GET /events, GET /events/analytics, and GET /events/timeline/:personId
 *   MUST return HTTP 400 (not 500) when `since` or `until` query
 *   parameters are present but not parseable as a date. Valid ISO 8601
 *   input must reach the service as a real `Date` instance.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { eventsRoutes } from '../events';

type ListCall = { query: Record<string, unknown> };
type AnalyticsCall = { input: Record<string, unknown> };
type TimelineCall = { personId: string; input: Record<string, unknown> };

function mountEventsRoutes(captures: {
  list?: ListCall[];
  analytics?: AnalyticsCall[];
  timeline?: TimelineCall[];
}): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      events: {
        list: mock(async (query: Record<string, unknown>) => {
          captures.list?.push({ query });
          return { items: [], hasMore: false, cursor: null, total: 0 };
        }),
        getAnalytics: mock(async (input: Record<string, unknown>) => {
          captures.analytics?.push({ input });
          return { totals: {}, breakdown: [] };
        }),
        getTimeline: mock(async (personId: string, input: Record<string, unknown>) => {
          captures.timeline?.push({ personId, input });
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
  app.route('/events', eventsRoutes);
  return app;
}

describe('GET /events — list date validation (#487)', () => {
  test('returns 400 when `since` is a UUID', async () => {
    const list: ListCall[] = [];
    const app = mountEventsRoutes({ list });
    const res = await app.request('/events?since=550e8400-e29b-41d4-a716-446655440000');
    expect(res.status).toBe(400);
    expect(list).toHaveLength(0);
  });

  test('returns 400 when `until` is garbage', async () => {
    const list: ListCall[] = [];
    const app = mountEventsRoutes({ list });
    const res = await app.request('/events?until=not-a-date-at-all');
    expect(res.status).toBe(400);
    expect(list).toHaveLength(0);
  });

  test('returns 200 and passes Date instances for valid ISO 8601', async () => {
    const list: ListCall[] = [];
    const app = mountEventsRoutes({ list });
    const res = await app.request('/events?since=2024-01-01T00:00:00.000Z&until=2024-02-01T00:00:00.000Z');
    expect(res.status).toBe(200);
    expect(list).toHaveLength(1);
    expect(list[0]?.query.since).toBeInstanceOf(Date);
    expect(list[0]?.query.until).toBeInstanceOf(Date);
  });
});

describe('GET /events/analytics — date validation (#487)', () => {
  test('returns 400 when `since` is a UUID', async () => {
    const analytics: AnalyticsCall[] = [];
    const app = mountEventsRoutes({ analytics });
    const res = await app.request('/events/analytics?since=550e8400-e29b-41d4-a716-446655440000');
    expect(res.status).toBe(400);
    expect(analytics).toHaveLength(0);
  });

  test('returns 400 when `until` is garbage', async () => {
    const analytics: AnalyticsCall[] = [];
    const app = mountEventsRoutes({ analytics });
    const res = await app.request('/events/analytics?until=not-a-date-at-all');
    expect(res.status).toBe(400);
    expect(analytics).toHaveLength(0);
  });

  test('returns 200 and passes Date instances for valid ISO 8601', async () => {
    const analytics: AnalyticsCall[] = [];
    const app = mountEventsRoutes({ analytics });
    const res = await app.request('/events/analytics?since=2024-01-01T00:00:00.000Z&until=2024-02-01T00:00:00.000Z');
    expect(res.status).toBe(200);
    expect(analytics).toHaveLength(1);
    expect(analytics[0]?.input.since).toBeInstanceOf(Date);
    expect(analytics[0]?.input.until).toBeInstanceOf(Date);
  });
});

describe('GET /events/timeline/:personId — date validation (#487)', () => {
  const personId = '550e8400-e29b-41d4-a716-446655440000';

  test('returns 400 when `since` is a UUID', async () => {
    const timeline: TimelineCall[] = [];
    const app = mountEventsRoutes({ timeline });
    const res = await app.request(`/events/timeline/${personId}?since=550e8400-e29b-41d4-a716-446655440000`);
    expect(res.status).toBe(400);
    expect(timeline).toHaveLength(0);
  });

  test('returns 400 when `until` is garbage', async () => {
    const timeline: TimelineCall[] = [];
    const app = mountEventsRoutes({ timeline });
    const res = await app.request(`/events/timeline/${personId}?until=not-a-date-at-all`);
    expect(res.status).toBe(400);
    expect(timeline).toHaveLength(0);
  });

  test('returns 200 and passes Date instances for valid ISO 8601', async () => {
    const timeline: TimelineCall[] = [];
    const app = mountEventsRoutes({ timeline });
    const res = await app.request(
      `/events/timeline/${personId}?since=2024-01-01T00:00:00.000Z&until=2024-02-01T00:00:00.000Z`,
    );
    expect(res.status).toBe(200);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.input.since).toBeInstanceOf(Date);
    expect(timeline[0]?.input.until).toBeInstanceOf(Date);
  });
});
