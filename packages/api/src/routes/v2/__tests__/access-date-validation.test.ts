/**
 * Regression test for automagik-dev/omni#487
 *
 * Contract:
 *   POST /access/rules MUST return HTTP 400 (not 500) when the
 *   `expiresAt` body field is present but not a parseable date.
 *   The previous handler used `.string().datetime().transform(new Date)`,
 *   which already rejected most malformed input — but after the
 *   migration to `optionalDateParam` we keep the contract: bad date
 *   in → 400 out, valid date in → 201 + Date instance reaches the service.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { accessRoutes } from '../access';

type CreateCall = { data: Record<string, unknown> };

function mountAccessRoutes(calls: CreateCall[]): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      access: {
        create: mock(async (data: Record<string, unknown>) => {
          calls.push({ data });
          return { id: 'rule-1', ...data };
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
  app.route('/access', accessRoutes);
  return app;
}

describe('POST /access/rules — expiresAt validation (#487)', () => {
  test('returns 400 when expiresAt is a UUID', async () => {
    const calls: CreateCall[] = [];
    const app = mountAccessRoutes(calls);

    const res = await app.request('/access/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ruleType: 'allow',
        phonePattern: '+55*',
        expiresAt: '550e8400-e29b-41d4-a716-446655440000',
      }),
    });

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 400 when expiresAt is arbitrary garbage', async () => {
    const calls: CreateCall[] = [];
    const app = mountAccessRoutes(calls);

    const res = await app.request('/access/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ruleType: 'allow',
        phonePattern: '+55*',
        expiresAt: 'not-a-date-at-all',
      }),
    });

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 201 and passes a Date when expiresAt is valid ISO 8601', async () => {
    const calls: CreateCall[] = [];
    const app = mountAccessRoutes(calls);

    const res = await app.request('/access/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ruleType: 'allow',
        phonePattern: '+55*',
        expiresAt: '2024-01-01T00:00:00.000Z',
      }),
    });

    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
    const expiresAt = calls[0]?.data.expiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    expect((expiresAt as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });
});
