/**
 * POST /messages/send — `buttons` passthrough.
 *
 * The send-text endpoint accepts an optional `buttons` array and must thread
 * it into `OutgoingMessage.content.buttons` untouched, where each channel
 * plugin maps it natively (WhatsApp Cloud interactive, Telegram inline
 * keyboard). Also covers schema rejection for malformed button entries.
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

async function postSend(app: Hono<{ Variables: AppVariables }>, body: Record<string, unknown>) {
  return app.request('/messages/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: INSTANCE_ID, to: '5511999998888', text: 'Pick one', ...body }),
  });
}

describe('POST /messages/send with buttons', () => {
  test('threads buttons into content.buttons untouched', async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postSend(app, {
      buttons: [
        { text: 'Yes', data: 'opt_yes' },
        { text: 'Docs', url: 'https://khal.ai/docs' },
      ],
    });

    expect(res.status).toBe(201);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, message] = sendMessage.mock.calls[0] as [string, { content: { type: string; buttons?: unknown } }];
    expect(message.content.type).toBe('text');
    expect(message.content.buttons).toEqual([
      { text: 'Yes', data: 'opt_yes' },
      { text: 'Docs', url: 'https://khal.ai/docs' },
    ]);
  });

  test('omits content.buttons entirely when not provided', async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postSend(app, {});

    expect(res.status).toBe(201);
    const [, message] = sendMessage.mock.calls[0] as [string, { content: Record<string, unknown> }];
    expect('buttons' in message.content).toBe(false);
  });

  test('rejects a button with an invalid url', async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postSend(app, { buttons: [{ text: 'Bad', url: 'not-a-url' }] });

    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('requestLocation flips content.type to location_request', async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postSend(app, { requestLocation: true });

    expect(res.status).toBe(201);
    const [, message] = sendMessage.mock.calls[0] as [string, { content: { type: string } }];
    expect(message.content.type).toBe('location_request');
  });

  test('rejects more than 10 buttons', async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postSend(app, {
      buttons: Array.from({ length: 11 }, (_, i) => ({ text: `Option ${i + 1}` })),
    });

    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
