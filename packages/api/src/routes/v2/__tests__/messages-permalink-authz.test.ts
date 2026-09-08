import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

// Instance the API key is scoped to.
const ALLOWED_INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
// Instance the API key must NOT be able to read — a different tenant's instance.
const OTHER_INSTANCE_ID = '99999999-9999-4999-8999-999999999999';
const CHANNEL_ID = 'C0000000000';
const MESSAGE_EXTERNAL_ID = 'p1700000000.000100';
const OMNI_CHAT_ID = '22222222-2222-4222-8222-222222222222';
const LEAKED_PERMALINK = 'https://acme.slack.com/archives/C0000000000/p1700000000000100';

/**
 * Mount the messages routes with an API key scoped ONLY to ALLOWED_INSTANCE_ID.
 * The channel plugin resolves a permalink for any instance — the route is
 * responsible for refusing to call it for an instance the key cannot access.
 */
function mountMessagesRoutes(getPermalink: ReturnType<typeof mock>): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel: 'slack' })),
      },
      chats: {
        // Chat exists for the (other) instance.
        getByExternalId: mock(async (_instanceId: string, _channelId: string) => ({
          id: OMNI_CHAT_ID,
          externalId: CHANNEL_ID,
        })),
      },
      messages: {
        // No cached permalink → route proceeds to the plugin.
        getByExternalId: mock(async () => null),
        setPermalink: mock(async () => {}),
      },
    } as never);
    c.set('channelRegistry', {
      get: mock(() => ({ getPermalink })),
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
  app.route('/messages', messagesRoutes);
  return app;
}

describe('GET /messages/:id/permalink cross-instance authorization', () => {
  test('rejects reading a permalink for an instance the API key cannot access', async () => {
    const getPermalink = mock(async () => LEAKED_PERMALINK);
    const app = mountMessagesRoutes(getPermalink);

    const res = await app.request(
      `/messages/${MESSAGE_EXTERNAL_ID}/permalink?instanceId=${OTHER_INSTANCE_ID}&channelId=${CHANNEL_ID}`,
    );

    // The key is scoped to ALLOWED_INSTANCE_ID, so a permalink for
    // OTHER_INSTANCE_ID must be refused before the plugin is ever consulted.
    expect(res.status).toBe(403);
    expect(getPermalink).not.toHaveBeenCalled();
  });

  test('allows reading a permalink for an instance the API key can access', async () => {
    const getPermalink = mock(async () => LEAKED_PERMALINK);
    const app = mountMessagesRoutes(getPermalink);

    const res = await app.request(
      `/messages/${MESSAGE_EXTERNAL_ID}/permalink?instanceId=${ALLOWED_INSTANCE_ID}&channelId=${CHANNEL_ID}`,
    );

    expect(res.status).toBe(200);
    expect(getPermalink).toHaveBeenCalledTimes(1);
  });
});
