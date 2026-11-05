/** Invalid Slack mention IDs are caller errors, never upstream send failures. */
import { expect, mock, test } from 'bun:test';
import type { PluginContext } from '@omni/channel-sdk';
import { SlackPlugin } from '@omni/channel-slack';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

const INSTANCE_ID = '44444444-4444-4444-8444-444444444444';

test('POST /messages/send rejects malformed Slack mentions with a clean 400 before sending', async () => {
  const plugin = new SlackPlugin();
  const noop = () => {};
  const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  await plugin.initialize({
    eventBus: { publish: async () => {}, subscribe: () => {} },
    storage: {},
    logger,
    config: {},
    db: {},
  } as unknown as PluginContext);
  const postMessage = mock(async () => ({ ok: true, ts: '123.456' }));
  const internals = plugin as unknown as { attachments: Map<string, unknown> };
  internals.attachments.set(INSTANCE_ID, {
    instanceId: INSTANCE_ID,
    actingClient: { chat: { postMessage } },
  });
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: { getById: async () => ({ id: INSTANCE_ID, channel: 'slack' }) },
    } as never);
    c.set('channelRegistry', { get: () => plugin } as never);
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/messages', messagesRoutes);

  const response = await app.request('/messages/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      instanceId: INSTANCE_ID,
      to: 'C123',
      text: 'hello',
      mentions: [{ id: 'U123> <!everyone', type: 'user' }],
    }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid Slack mentions: use U/W user IDs, C/G channel IDs or S user-group IDs',
    },
  });
  expect(postMessage).not.toHaveBeenCalled();
});
