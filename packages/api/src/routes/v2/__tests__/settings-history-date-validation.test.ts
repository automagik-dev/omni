/**
 * Regression test for automagik-dev/omni#494
 *
 * Contract:
 *   GET /settings/:key/history MUST return HTTP 400 (not 500) when the
 *   `since` query parameter is present but not parseable as a date.
 *   Valid ISO 8601 input must reach the settings service as a real
 *   `Date` instance (never `Invalid Date`).
 *
 * @see packages/api/src/schemas/date-query.ts — shared helper
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { settingsRoutes } from '../settings';

type HistoryCall = { key: string; options: Record<string, unknown> };

const SETTING_KEY = 'example.setting';

function mountSettingsRoutes(calls: HistoryCall[]): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      settings: {
        getHistory: mock(async (key: string, options: Record<string, unknown>) => {
          calls.push({ key, options });
          return [];
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
  app.route('/settings', settingsRoutes);
  return app;
}

describe('GET /settings/:key/history — date parameter validation (#494)', () => {
  test('returns 400 when `since` is a UUID', async () => {
    const calls: HistoryCall[] = [];
    const app = mountSettingsRoutes(calls);

    const res = await app.request(`/settings/${SETTING_KEY}/history?since=550e8400-e29b-41d4-a716-446655440000`);

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 400 when `since` is arbitrary garbage', async () => {
    const calls: HistoryCall[] = [];
    const app = mountSettingsRoutes(calls);

    const res = await app.request(`/settings/${SETTING_KEY}/history?since=not-a-date-at-all`);

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 200 and passes a real Date instance to settings.getHistory for valid ISO 8601', async () => {
    const calls: HistoryCall[] = [];
    const app = mountSettingsRoutes(calls);

    const res = await app.request(`/settings/${SETTING_KEY}/history?since=2024-01-01T00:00:00.000Z`);

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options.since).toBeInstanceOf(Date);
  });
});
