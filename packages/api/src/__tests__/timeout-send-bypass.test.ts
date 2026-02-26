/**
 * Regression tests for global timeout middleware — GET-only enforcement.
 *
 * Promise.race timeout is only safe for reads (GETs) — abandoning a read
 * result is harmless. For writes (POST/PUT/DELETE/PATCH), the handler keeps
 * running after timeout, orphaning mutexes and corrupting state.
 *
 * See: #72, #70
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { timeoutMiddleware } from '../middleware/timeout';
import type { AppVariables } from '../types';

function createTestApp(timeoutMs: number) {
  const app = new Hono<{ Variables: AppVariables }>();
  const timeout = timeoutMiddleware({ timeoutMs });
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET') return next();
    return timeout(c, next);
  });

  const slow = async () => {
    await new Promise((r) => setTimeout(r, timeoutMs + 50));
    return new Response('ok');
  };

  app.get('/slow', slow);
  app.get('/fast', () => new Response('ok'));
  app.post('/slow', slow);

  return app;
}

describe('timeout middleware – GET-only enforcement (#72)', () => {
  const T = 80;

  test('slow GET → 408', async () => {
    const res = await createTestApp(T).request('/slow');
    expect(res.status).toBe(408);
  });

  test('fast GET → 200', async () => {
    const res = await createTestApp(T).request('/fast');
    expect(res.status).toBe(200);
  });

  test('slow POST bypasses timeout → 200', async () => {
    const res = await createTestApp(T).request('/slow', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
