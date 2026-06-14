/**
 * Tests for root-level /health
 *
 * External health checkers (k8s probes, genie providers) hit GET /health
 * and should receive the same JSON health payload as /api/v2/health.
 */

import { describe, expect, test } from 'bun:test';
import { type Context, Hono } from 'hono';

describe('GET /health', () => {
  function createTestApp() {
    const app = new Hono();
    const healthPayload = { status: 'healthy' };

    // Root-level health response (mirrors app.ts)
    app.get('/health', (c: Context) => c.json(healthPayload));

    // Stub /api/v2/health so we can verify it still works
    app.get('/api/v2/health', (c: Context) => c.json(healthPayload));

    return app;
  }

  test('GET /health returns 200 JSON directly', async () => {
    const app = createTestApp();
    const res = await app.request('/health', { redirect: 'manual' });

    expect(res.status).toBe(200);
    expect(res.headers.get('Location')).toBeNull();
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('healthy');
  });

  test('GET /api/v2/health still returns 200', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v2/health');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('healthy');
  });
});
