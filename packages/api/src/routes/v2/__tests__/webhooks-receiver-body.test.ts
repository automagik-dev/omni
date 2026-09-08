/**
 * Authenticated webhook receiver — body contract (issue #928 follow-up).
 *
 * `POST /api/v2/webhooks/:source` used to turn malformed JSON into `{}` and
 * let arrays/scalars through as the event payload. It now shares the public
 * ingress's rule: empty body → `{}`, anything else that is not a JSON object
 * → 400, nothing published.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { WebhookReceiveOptions } from '../../../services/webhooks';
import type { AppVariables } from '../../../types';
import { webhooksRoutes } from '../webhooks';

interface ReceivedCall {
  source: string;
  payload: Record<string, unknown>;
  options: WebhookReceiveOptions | undefined;
}

function buildApp() {
  const received: ReceivedCall[] = [];
  const services = {
    webhooks: {
      receive: async (
        source: string,
        payload: Record<string, unknown>,
        _headers: Record<string, string>,
        options?: WebhookReceiveOptions,
      ) => {
        received.push({ source, payload, options });
        return { received: true, eventId: 'evt-1', source, eventType: `custom.webhook.${source}` };
      },
    },
  } as unknown as AppVariables['services'];

  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', services);
    await next();
  });
  app.route('/api/v2', webhooksRoutes);
  return { app, received };
}

function post(app: Hono<{ Variables: AppVariables }>, body: string) {
  return app.request('/api/v2/webhooks/github', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/v2/webhooks/:source body contract', () => {
  test('a JSON object body is passed through with its raw bytes', async () => {
    const { app, received } = buildApp();
    const body = JSON.stringify({ action: 'push', ref: 'refs/heads/main' });

    const res = await post(app, body);

    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.payload).toEqual({ action: 'push', ref: 'refs/heads/main' });
    expect(received[0]?.options?.rawBody).toBe(body);
  });

  test('an empty body is received as an empty payload', async () => {
    const { app, received } = buildApp();

    const res = await post(app, '');

    expect(res.status).toBe(200);
    expect(received[0]?.payload).toEqual({});
  });

  test('malformed JSON is a 400 and nothing is published', async () => {
    const { app, received } = buildApp();

    const res = await post(app, '{"action": "push"');

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toBe('Request body must be a JSON object');
    expect(received).toHaveLength(0);
  });

  test('a form-encoded body is a 400, not silently emptied', async () => {
    const { app, received } = buildApp();

    const res = await post(app, 'a=1&b=2');

    expect(res.status).toBe(400);
    expect(received).toHaveLength(0);
  });

  test.each([
    ['array', '[{"action":"push"}]'],
    ['string', '"push"'],
    ['number', '42'],
    ['null', 'null'],
  ])('a JSON %s body is a 400 (payload must be an object)', async (_kind, body) => {
    const { app, received } = buildApp();

    const res = await post(app, body);

    expect(res.status).toBe(400);
    expect(received).toHaveLength(0);
  });
});
