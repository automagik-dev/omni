/**
 * Public generic webhook ingress tests (issue #928).
 *
 * POST /api/v2/webhooks/ingress/:source is auth-exempt: authenticity comes
 * from the per-source signature config, verified over the raw body before
 * anything is published. These tests pin the surface's contract:
 *   - a correctly signed request for a configured source is accepted;
 *   - unknown, unconfigured, and badly signed requests all yield the SAME
 *     401 shape (no source-name existence oracle);
 *   - the authenticated /api/v2/webhooks/:source route still demands a key.
 */

import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import type { Database, WebhookSource } from '@omni/db';
import { createApp } from '../app';

const SECRET = 'ingress-test-secret';

function makeSource(overrides: Partial<WebhookSource> = {}): WebhookSource {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: null,
    name: 'github',
    description: null,
    expectedHeaders: null,
    signatureConfig: { algorithm: 'hmac-sha256', header: 'X-Hub-Signature-256', prefix: 'sha256=' },
    signatureSecret: SECRET,
    enabled: true,
    lastReceivedAt: null,
    totalReceived: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Minimal DB stub: source lookups resolve to `sources`, the stats update is a
 * no-op, and anything else throws so the surface can't quietly grow DB use.
 */
function buildApp(sources: WebhookSource[]) {
  const db = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'select') {
          return () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(sources) }) }) });
        }
        if (prop === 'update') {
          return () => ({ set: () => ({ where: () => Promise.resolve([]) }) });
        }
        return () => {
          throw new Error(`db.${String(prop)} must not be touched by ingress tests`);
        };
      },
    },
  ) as unknown as Database;

  const { app } = createApp(db);
  return app;
}

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

function post(app: ReturnType<typeof buildApp>, path: string, body: string, headers: Record<string, string> = {}) {
  return app.request(path, { method: 'POST', body, headers });
}

describe('public webhook ingress', () => {
  test('accepts a correctly signed request without any API key', async () => {
    const app = buildApp([makeSource()]);
    const body = JSON.stringify({ action: 'push' });

    const res = await post(app, '/api/v2/webhooks/ingress/github', body, { 'X-Hub-Signature-256': sign(body) });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { received: boolean; eventType: string };
    expect(json.received).toBe(true);
    expect(json.eventType).toBe('custom.webhook.github');
  });

  test('rejects a bad signature with the uniform 401', async () => {
    const app = buildApp([makeSource()]);
    const body = JSON.stringify({ action: 'push' });

    const res = await post(app, '/api/v2/webhooks/ingress/github', body, {
      'X-Hub-Signature-256': 'sha256=deadbeef',
    });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.message).toBe('Webhook verification failed');
  });

  test('unknown source yields the same 401 shape, not a 404', async () => {
    const app = buildApp([]);

    const res = await post(app, '/api/v2/webhooks/ingress/does-not-exist', '{}');

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe('Webhook verification failed');
  });

  test('a source without signature config is unreachable on the public surface', async () => {
    const app = buildApp([makeSource({ signatureConfig: null, signatureSecret: null })]);

    const res = await post(app, '/api/v2/webhooks/ingress/github', '{}');

    expect(res.status).toBe(401);
  });

  test('a disabled source is rejected with the same 401 shape', async () => {
    const app = buildApp([makeSource({ enabled: false })]);
    const body = '{}';

    const res = await post(app, '/api/v2/webhooks/ingress/github', body, { 'X-Hub-Signature-256': sign(body) });

    expect(res.status).toBe(401);
  });

  test('a signed non-JSON body is rejected with 400, not silently emptied', async () => {
    const app = buildApp([makeSource()]);
    const body = 'a=1&b=2';

    const res = await post(app, '/api/v2/webhooks/ingress/github', body, { 'X-Hub-Signature-256': sign(body) });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION');
  });

  test('a signed request missing an expected header is a 400, not a 500', async () => {
    const app = buildApp([makeSource({ expectedHeaders: { 'X-GitHub-Event': true } })]);
    const body = JSON.stringify({ action: 'push' });

    const res = await post(app, '/api/v2/webhooks/ingress/github', body, { 'X-Hub-Signature-256': sign(body) });

    expect(res.status).toBe(400);
  });

  test('the authenticated receiver route still requires an API key', async () => {
    const app = buildApp([makeSource()]);

    const res = await post(app, '/api/v2/webhooks/github', '{}');

    expect(res.status).toBe(401);
  });
});
