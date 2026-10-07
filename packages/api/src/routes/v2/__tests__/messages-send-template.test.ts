/**
 * POST /messages/send/template forwards the canonical template descriptor and
 * attribution to the plugin and rejects malformed descriptors before sending.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';

type MountOptions = {
  sendMessage?: ReturnType<typeof mock>;
};

function mountMessagesRoutes(options: MountOptions = {}): {
  app: Hono<{ Variables: AppVariables }>;
  sendMessage: ReturnType<typeof mock>;
} {
  const sendMessage =
    options.sendMessage ??
    mock(async (_instanceId: string, _message: unknown) => ({
      success: true,
      messageId: 'SENT-MSG-ID',
      timestamp: 123,
    }));

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel: 'whatsapp-business' })),
      },
      persons: {
        getIdentityForChannel: mock(async () => null),
      },
      chats: {
        findByExternalIdSmart: mock(async () => null),
      },
    } as never);
    c.set('channelRegistry', {
      get: mock(() => ({
        capabilities: { canSendTemplate: true },
        sendMessage,
      })),
    } as never);
    c.set('apiKey', {
      id: 'test',
      name: 'test',
      scopes: ['*'],
      instanceIds: null,
      expiresAt: null,
    } as never);
    await next();
  });
  app.route('/messages', messagesRoutes);
  return { app, sendMessage };
}

describe('POST /messages/send/template', () => {
  test('passes the canonical template descriptor and agent attribution to the plugin', async () => {
    const { app, sendMessage } = mountMessagesRoutes();
    const template = { name: 'order_update', language: 'pt_BR', bodyParameters: ['Kelvin'] };
    const res = await app.request('/messages/send/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: INSTANCE_ID, to: '5511999998888', template }),
    });
    expect(res.status).toBe(201);
    expect(sendMessage.mock.calls[0]?.[1]).toMatchObject({ content: { type: 'template' }, metadata: { template } });
    expect(((await res.json()) as { data: Record<string, unknown> }).data.messageId).toBe('SENT-MSG-ID');
  });
  test('rejects malformed descriptors before calling a plugin', async () => {
    const { app, sendMessage } = mountMessagesRoutes();
    const res = await app.request('/messages/send/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: INSTANCE_ID, to: '5511999998888', template: { name: '', language: 'pt_BR' } }),
    });
    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
