/**
 * Regression test for automagik-dev/omni#487
 *
 * Contract:
 *   POST /event-ops/replay MUST return HTTP 400 (not 500) when
 *   `since` (required) or `until` (optional) body fields are present
 *   but not parseable dates. Valid ISO 8601 input must reach the
 *   service as a real `Date` instance.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { eventOpsRoutes } from '../event-ops';

type ReplayCall = { options: Record<string, unknown> };

function mountEventOpsRoutes(calls: ReplayCall[]): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      eventOps: {
        startReplay: mock(async (options: Record<string, unknown>) => {
          calls.push({ options });
          return { id: 'replay-1', status: 'queued' };
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
  app.route('/event-ops', eventOpsRoutes);
  return app;
}

describe('POST /event-ops/replay — date validation (#487)', () => {
  test('returns 400 when `since` is a UUID', async () => {
    const calls: ReplayCall[] = [];
    const app = mountEventOpsRoutes(calls);

    const res = await app.request('/event-ops/replay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since: '550e8400-e29b-41d4-a716-446655440000' }),
    });

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 400 when `until` is arbitrary garbage', async () => {
    const calls: ReplayCall[] = [];
    const app = mountEventOpsRoutes(calls);

    const res = await app.request('/event-ops/replay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        since: '2024-01-01T00:00:00.000Z',
        until: 'not-a-date-at-all',
      }),
    });

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 400 when `since` is missing entirely', async () => {
    const calls: ReplayCall[] = [];
    const app = mountEventOpsRoutes(calls);

    const res = await app.request('/event-ops/replay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 202 and passes Date instances for valid ISO 8601', async () => {
    const calls: ReplayCall[] = [];
    const app = mountEventOpsRoutes(calls);

    const res = await app.request('/event-ops/replay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        since: '2024-01-01T00:00:00.000Z',
        until: '2024-02-01T00:00:00.000Z',
      }),
    });

    expect(res.status).toBe(202);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options.since).toBeInstanceOf(Date);
    expect(calls[0]?.options.until).toBeInstanceOf(Date);
    expect((calls[0]?.options.since as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect((calls[0]?.options.until as Date).toISOString()).toBe('2024-02-01T00:00:00.000Z');
  });
});
