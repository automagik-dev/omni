/**
 * POST /messages/send/close-contact — farewell text is optional.
 *
 * A system-initiated close (no reply for a long time, a closed sale) may need
 * to classify the conversation without sending anything to the contact. The
 * route must then still emit the native close event where the channel can
 * carry it without text, never push an empty text to channels that cannot,
 * and keep every channel-agnostic side effect (audit row, chat state,
 * follow-up disarm, chat.closed).
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

const INSTANCE_ID = '44444444-4444-4444-8444-444444444444';
const CHAT_ID = '55555555-5555-4555-8555-555555555555';

interface MountOptions {
  capabilities?: Record<string, boolean>;
}

function mountCloseContactRoute(options: MountOptions = {}) {
  const sendMessage = mock(async (_instanceId: string, _message: unknown) => ({
    success: true,
    messageId: 'CLOSE-MSG-ID',
    timestamp: 123,
  }));
  const auditValues: Record<string, unknown>[] = [];
  const chatUpdates: Record<string, unknown>[] = [];
  const disarm = mock(async (_input: unknown) => undefined);
  const publish = mock(async (_type: string, _payload: unknown, _metadata: unknown) => undefined);

  const db = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        auditValues.push(values);
        return { returning: async () => [{ id: 'audit-row-1' }] };
      },
    }),
  };

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel: 'gupshup', agentId: null })),
      },
      persons: {
        getIdentityForChannel: mock(async () => null),
      },
      chats: {
        getById: mock(async () => ({ id: CHAT_ID, settings: { keep: true } })),
        update: mock(async (_id: string, patch: Record<string, unknown>) => {
          chatUpdates.push(patch);
        }),
      },
      followUpLifecycle: { disarm },
      eventBus: { publish },
    } as never);
    c.set('db', db as never);
    c.set('channelRegistry', {
      get: mock(() => ({
        capabilities: options.capabilities ?? { canCloseContact: true, canCloseContactWithoutText: true },
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
  return { app, sendMessage, auditValues, chatUpdates, disarm, publish };
}

async function postCloseContact(app: Hono<{ Variables: AppVariables }>, body: Record<string, unknown>) {
  return app.request('/messages/send/close-contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: INSTANCE_ID, chatId: CHAT_ID, to: '15550001111', outcome: 'won', ...body }),
  });
}

type SentMessage = { content: { text?: string }; metadata?: Record<string, unknown> };

describe('POST /messages/send/close-contact — farewell text', () => {
  test('with text: sends the native close with the farewell and close metadata', async () => {
    const { app, sendMessage, auditValues } = mountCloseContactRoute();

    const res = await postCloseContact(app, {
      text: 'Goodbye',
      reason: 'sale completed',
      closeFields: { plan: 'basic' },
    });

    expect(res.status).toBe(201);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, message] = sendMessage.mock.calls[0] as [string, SentMessage];
    expect(message.content.text).toBe('Goodbye');
    expect(message.metadata).toMatchObject({
      isCloseContact: true,
      closeReason: 'sale completed',
      closeOutcome: 'won',
      closeFields: { plan: 'basic' },
    });
    expect(auditValues[0]?.text).toBe('Goodbye');
  });

  test('without text: sends the native close with empty text and keeps every side effect', async () => {
    const { app, sendMessage, auditValues, chatUpdates, disarm, publish } = mountCloseContactRoute();

    const res = await postCloseContact(app, { reason: 'sale completed' });

    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: Record<string, unknown> };
    expect(json.data.status).toBe('closed');
    expect(json.data.terminal).toBe(true);
    expect(json.data.messageId).toBe('CLOSE-MSG-ID');

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, message] = sendMessage.mock.calls[0] as [string, SentMessage];
    expect(message.content.text).toBe('');
    expect(message.metadata?.isCloseContact).toBe(true);

    expect(auditValues[0]?.text).toBe('');
    expect(auditValues[0]?.metadata).toMatchObject({ channelCloseSent: true, withoutFarewell: true });
    expect(chatUpdates[0]?.settings).toMatchObject({ keep: true, closed: true, closeOutcome: 'won' });
    expect(disarm).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls.map((call) => call[0])).toContain('chat.closed');
  });

  test('empty or whitespace-only text is treated as no farewell', async () => {
    for (const text of ['', '   ']) {
      const { app, sendMessage, auditValues } = mountCloseContactRoute();

      const res = await postCloseContact(app, { text });

      expect(res.status).toBe(201);
      const [, message] = sendMessage.mock.calls[0] as [string, SentMessage];
      expect(message.content.text).toBe('');
      expect(auditValues[0]?.text).toBe('');
    }
  });

  test('without text on a channel that cannot close without text: skips the channel send only', async () => {
    const { app, sendMessage, auditValues, disarm, publish } = mountCloseContactRoute({
      capabilities: { canCloseContact: true },
    });

    const res = await postCloseContact(app, {});

    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: Record<string, unknown> };
    expect(json.data.messageId).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(auditValues[0]?.text).toBe('');
    expect(auditValues[0]?.metadata).toMatchObject({ channelCloseSupported: true, channelCloseSent: false });
    expect(disarm).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls.map((call) => call[0])).toContain('chat.closed');
  });

  test('with text on a channel that cannot close without text: still sends as before', async () => {
    const { app, sendMessage } = mountCloseContactRoute({ capabilities: { canCloseContact: true } });

    const res = await postCloseContact(app, { text: 'Goodbye' });

    expect(res.status).toBe(201);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
