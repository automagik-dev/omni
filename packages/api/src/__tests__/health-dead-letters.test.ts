/**
 * #1163: DLQ depth on /health — a queue that is too deep or too old degrades
 * health instead of accumulating behind a green probe.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { DEAD_LETTER_MAX_AGE_SECONDS, DEAD_LETTER_PENDING_THRESHOLD, getHealth } from '../routes/health';
import type { AppVariables, HealthResponse } from '../types';

function appWith(row: { pending: number; oldest: string | null }) {
  const db = {
    execute: async () => [],
    select: () => ({ from: () => ({ where: async () => [row] }) }),
  } as unknown as AppVariables['db'];
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('eventBus', null);
    c.set('channelRegistry', null);
    await next();
  });
  app.get('/health', getHealth);
  return app;
}

async function health(row: { pending: number; oldest: string | null }) {
  const res = await appWith(row).request('/health');
  return { res, body: (await res.json()) as HealthResponse };
}

describe('GET /health dead letter check', () => {
  test('healthy with an empty DLQ', async () => {
    const { res, body } = await health({ pending: 0, oldest: null });
    expect(res.status).toBe(200);
    expect(body.checks.deadLetters).toEqual({ status: 'ok', details: { pending: 0, oldestPendingAgeSeconds: null } });
  });

  test('degraded when pending exceeds the threshold', async () => {
    const { res, body } = await health({ pending: DEAD_LETTER_PENDING_THRESHOLD, oldest: new Date().toISOString() });
    expect(res.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.deadLetters?.status).toBe('error');
  });

  test('degraded when the oldest pending row is too old', async () => {
    const oldest = new Date(Date.now() - (DEAD_LETTER_MAX_AGE_SECONDS + 60) * 1000).toISOString();
    const { res, body } = await health({ pending: 3, oldest });
    expect(res.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.deadLetters?.details?.pending).toBe(3);
    expect(body.checks.deadLetters?.details?.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(
      DEAD_LETTER_MAX_AGE_SECONDS,
    );
  });
});
