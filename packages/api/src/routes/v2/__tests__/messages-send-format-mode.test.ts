/**
 * POST /messages/send — instance `messageFormatMode` threading (#894).
 *
 * Channel plugins read `metadata.messageFormatMode` and default to 'convert'
 * (markdown → channel syntax) when it is absent. The agent-responder and
 * agent-dispatcher paths resolve the mode from the instance row, but the
 * direct send route never did — so an instance configured with
 * `messageFormatMode: 'passthrough'` still had its text converted on direct
 * API sends ("*bold*" arriving as italic on WhatsApp Cloud).
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

const INSTANCE_ID = '44444444-4444-4444-8444-444444444444';

function mountMessagesRoutes(instanceOverrides: Record<string, unknown> = {}): {
  app: Hono<{ Variables: AppVariables }>;
  sendMessage: ReturnType<typeof mock>;
} {
  const sendMessage = mock(async (_instanceId: string, _message: unknown) => ({
    success: true,
    messageId: 'SENT-MSG-ID',
    timestamp: 123,
  }));

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel: 'whatsapp-business', ...instanceOverrides })),
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
        capabilities: { canSendText: true },
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

async function postSend(app: Hono<{ Variables: AppVariables }>, body: Record<string, unknown> = {}) {
  return app.request('/messages/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: INSTANCE_ID, to: '5511999998888', text: '*bold*', ...body }),
  });
}

describe('POST /messages/send — messageFormatMode from the instance row', () => {
  test('threads passthrough into metadata so the plugin skips conversion', async () => {
    const { app, sendMessage } = mountMessagesRoutes({ messageFormatMode: 'passthrough' });

    const res = await postSend(app);

    expect(res.status).toBe(201);
    const [, message] = sendMessage.mock.calls[0] as [string, { metadata?: Record<string, unknown> }];
    expect(message.metadata?.messageFormatMode).toBe('passthrough');
  });

  test('threads an explicit convert mode too', async () => {
    const { app, sendMessage } = mountMessagesRoutes({ messageFormatMode: 'convert' });

    await postSend(app);

    const [, message] = sendMessage.mock.calls[0] as [string, { metadata?: Record<string, unknown> }];
    expect(message.metadata?.messageFormatMode).toBe('convert');
  });

  test('omits the key when the instance has no mode set (plugin defaults to convert)', async () => {
    const { app, sendMessage } = mountMessagesRoutes({ messageFormatMode: null });

    await postSend(app);

    const [, message] = sendMessage.mock.calls[0] as [string, { metadata?: Record<string, unknown> }];
    expect('messageFormatMode' in (message.metadata ?? {})).toBe(false);
  });

  test('still applies on interactive (buttons) bodies — same route, same metadata', async () => {
    const { app, sendMessage } = mountMessagesRoutes({ messageFormatMode: 'passthrough' });

    const res = await postSend(app, { buttons: [{ text: 'Yes', data: 'opt_yes' }] });

    expect(res.status).toBe(201);
    const [, message] = sendMessage.mock.calls[0] as [
      string,
      { content: { buttons?: unknown }; metadata?: Record<string, unknown> },
    ];
    expect(message.content.buttons).toEqual([{ text: 'Yes', data: 'opt_yes' }]);
    expect(message.metadata?.messageFormatMode).toBe('passthrough');
  });
});
