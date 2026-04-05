/**
 * Tests for root-level /health redirect (#335)
 *
 * External health checkers (k8s probes, genie providers) hit GET /health
 * which should redirect to /api/v2/health.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';

describe('GET /health redirect', () => {
  function createTestApp() {
    const app = new Hono();

    // Root-level health redirect (mirrors app.ts)
    app.get('/health', (c) => c.redirect('/api/v2/health', 307));

    // Stub /api/v2/health so we can verify it still works
    app.get('/api/v2/health', (c) => c.json({ status: 'healthy' }));

    return app;
  }

  test('GET /health returns 307 redirect to /api/v2/health', async () => {
    const app = createTestApp();
    const res = await app.request('/health', { redirect: 'manual' });

    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toBe('/api/v2/health');
  });

  test('GET /api/v2/health still returns 200', async () => {
    const app = createTestApp();
    const res = await app.request('/api/v2/health');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('healthy');
  });
});
