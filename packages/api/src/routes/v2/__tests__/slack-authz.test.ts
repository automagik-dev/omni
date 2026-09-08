import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { slackRoutes } from '../slack';

// Instance the API key is scoped to.
const ALLOWED_INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
// A different tenant's Slack instance the key must NOT reach.
const OTHER_INSTANCE_ID = '99999999-9999-4999-8999-999999999999';

/**
 * Mount the Slack routes with an API key scoped ONLY to ALLOWED_INSTANCE_ID.
 * Both plugin methods succeed for any instance — the routes are responsible
 * for refusing an instance the key cannot access.
 */
function mountSlackRoutes(plugin: Record<string, unknown>): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel: 'slack' })),
      },
    } as never);
    c.set('channelRegistry', {
      get: mock(() => plugin),
    } as never);
    c.set('apiKey', {
      id: 'test',
      name: 'test',
      scopes: ['*'],
      instanceIds: [ALLOWED_INSTANCE_ID],
      expiresAt: null,
    } as never);
    await next();
  });
  app.route('/slack', slackRoutes);
  return app;
}

describe('Slack routes cross-instance authorization', () => {
  test('GET /slack/search rejects an instance the API key cannot access', async () => {
    const searchMessages = mock(async () => [{ text: 'secret cross-tenant message' }]);
    const app = mountSlackRoutes({ searchMessages });

    const res = await app.request(`/slack/search?instanceId=${OTHER_INSTANCE_ID}&query=secret`);

    expect(res.status).toBe(403);
    expect(searchMessages).not.toHaveBeenCalled();
  });

  test('POST /slack/dm/open rejects an instance the API key cannot access', async () => {
    const openDirectMessage = mock(async () => 'D0000000000');
    const app = mountSlackRoutes({ openDirectMessage });

    const res = await app.request('/slack/dm/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: OTHER_INSTANCE_ID, userId: 'U0000000000' }),
    });

    expect(res.status).toBe(403);
    expect(openDirectMessage).not.toHaveBeenCalled();
  });

  test('GET /slack/search allows an instance the API key can access', async () => {
    const searchMessages = mock(async () => [{ text: 'ok' }]);
    const app = mountSlackRoutes({ searchMessages });

    const res = await app.request(`/slack/search?instanceId=${ALLOWED_INSTANCE_ID}&query=hello`);

    expect(res.status).toBe(200);
    expect(searchMessages).toHaveBeenCalledTimes(1);
  });

  test('POST /slack/dm/open allows an instance the API key can access', async () => {
    const openDirectMessage = mock(async () => 'D0000000000');
    const app = mountSlackRoutes({ openDirectMessage });

    const res = await app.request('/slack/dm/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: ALLOWED_INSTANCE_ID, userId: 'U0000000000' }),
    });

    expect(res.status).toBe(200);
    expect(openDirectMessage).toHaveBeenCalledTimes(1);
  });
});
