/**
 * #1163: DLQ depth on /health — a queue that is too deep or too old degrades
 * health instead of accumulating behind a green probe.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { DEAD_LETTER_MAX_AGE_SECONDS, DEAD_LETTER_PENDING_THRESHOLD, getHealth } from '../routes/health';
import { HealthCheckSchema } from '../schemas/openapi/health';
import type { AppVariables, HealthResponse } from '../types';

function appWith(row: { pending: number; oldest: string | null }, readError?: Error) {
  const db = { execute: async () => [] } as unknown as AppVariables['db'];
  const services = {
    deadLetters: {
      getPendingSummary: async () => {
        if (readError) throw readError;
        return {
          pending: row.pending,
          oldestPendingAt: row.oldest ? new Date(row.oldest) : null,
        };
      },
    },
  } as unknown as AppVariables['services'];
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('eventBus', null);
    c.set('channelRegistry', null);
    c.set('services', services);
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

  for (const wrapped of [false, true]) {
    test(`an ${wrapped ? 'ORM-wrapped' : 'unwrapped'} RLS denial degrades only the dead-letter check`, async () => {
      const denied = Object.assign(new Error('permission denied for private_queue'), { code: '42501' });
      const error = wrapped ? new Error('query with private parameters', { cause: denied }) : denied;
      const res = await appWith({ pending: 0, oldest: null }, error).request('/health');
      const body = (await res.json()) as HealthResponse;
      expect(res.status).toBe(200);
      expect(body.status).toBe('healthy');
      expect(body.checks.database.status).toBe('ok');
      expect(body.checks.deadLetters).toEqual({ status: 'degraded', details: { available: false } });
      expect(HealthCheckSchema.safeParse(body.checks.deadLetters).success).toBe(true);
      expect(JSON.stringify(body)).not.toContain('private');
      expect(JSON.stringify(body)).not.toContain('42501');
    });
  }

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
