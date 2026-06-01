import { describe, expect, mock, test } from 'bun:test';
import { NotFoundError } from '@omni/core';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const CHAT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CHAT_ID = '44444444-4444-4444-8444-444444444444';
const OMNI_MESSAGE_ID = '33333333-3333-4333-8333-333333333333';
const CHAT_EXTERNAL_ID = '51961151926407@lid';
const MESSAGE_EXTERNAL_ID = '2A0726AEA0EE1EB26093';

type MountOptions = {
  sendMessage?: ReturnType<typeof mock>;
  chatFound?: boolean;
  messageChatId?: string;
  getByIdThrows?: boolean;
  getByIdError?: Error;
};

function mountMessagesRoutes(options: MountOptions = {}): Hono<{ Variables: AppVariables }> {
  const sendMessage =
    options.sendMessage ??
    mock(async (_instanceId: string, _message: unknown) => ({
      success: true,
      messageId: 'REACTION-MSG-ID',
      timestamp: 123,
    }));

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel: 'whatsapp-baileys' })),
      },
      persons: {
        getIdentityForChannel: mock(async () => null),
      },
      chats: {
        getById: mock(async (id: string) => ({ id, externalId: CHAT_EXTERNAL_ID })),
        findByExternalIdSmart: mock(async () =>
          options.chatFound === false
            ? null
            : {
                id: CHAT_ID,
                externalId: CHAT_EXTERNAL_ID,
              },
        ),
      },
      messages: {
        getById: mock(async (id: string) => {
          if (options.getByIdError) throw options.getByIdError;
          if (options.getByIdThrows) throw new NotFoundError('Message', id);
          return {
            id,
            chatId: options.messageChatId ?? CHAT_ID,
            externalId: MESSAGE_EXTERNAL_ID,
            isFromMe: false,
            rawPayload: {
              key: {
                id: MESSAGE_EXTERNAL_ID,
                remoteJid: CHAT_EXTERNAL_ID,
                fromMe: false,
              },
            },
          };
        }),
        getByExternalId: mock(async (_chatId: string, externalId: string) =>
          externalId === MESSAGE_EXTERNAL_ID
            ? {
                id: OMNI_MESSAGE_ID,
                chatId: CHAT_ID,
                externalId: MESSAGE_EXTERNAL_ID,
                isFromMe: false,
                rawPayload: {
                  key: {
                    id: MESSAGE_EXTERNAL_ID,
                    remoteJid: CHAT_EXTERNAL_ID,
                    fromMe: false,
                  },
                },
              }
            : null,
        ),
      },
    } as never);
    c.set('channelRegistry', {
      get: mock(() => ({
        capabilities: { canSendReaction: true },
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
  return app;
}

async function postReaction(app: Hono<{ Variables: AppVariables }>, messageId: string) {
  return app.request('/messages/send/reaction', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      instanceId: INSTANCE_ID,
      to: CHAT_ID,
      messageId,
      emoji: '👍',
    }),
  });
}

describe('POST /messages/send/reaction', () => {
  test('resolves an Omni message UUID to the channel-native external ID before sending', async () => {
    const sendMessage = mock(async (_instanceId: string, _message: unknown) => ({
      success: true,
      messageId: 'REACTION-MSG-ID',
      timestamp: 123,
    }));
    const app = mountMessagesRoutes({ sendMessage });

    const res = await postReaction(app, OMNI_MESSAGE_ID);

    expect(res.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[1]).toMatchObject({
      to: CHAT_EXTERNAL_ID,
      content: {
        type: 'reaction',
        emoji: '👍',
        targetMessageId: MESSAGE_EXTERNAL_ID,
      },
      metadata: {
        fromMe: false,
      },
    });
  });

  test('fails closed for an Omni message UUID when the chat cannot be resolved', async () => {
    const sendMessage = mock(async () => ({ success: true }));
    const app = mountMessagesRoutes({ sendMessage, chatFound: false });

    const res = await postReaction(app, OMNI_MESSAGE_ID);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('fails closed for an Omni message UUID that belongs to another chat', async () => {
    const sendMessage = mock(async () => ({ success: true }));
    const app = mountMessagesRoutes({ sendMessage, messageChatId: OTHER_CHAT_ID });

    const res = await postReaction(app, OMNI_MESSAGE_ID);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('fails closed for an unknown Omni message UUID', async () => {
    const sendMessage = mock(async () => ({ success: true }));
    const app = mountMessagesRoutes({ sendMessage, getByIdThrows: true });

    const res = await postReaction(app, OMNI_MESSAGE_ID);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('does not mask unexpected message lookup errors as not found', async () => {
    const sendMessage = mock(async () => ({ success: true }));
    const app = mountMessagesRoutes({ sendMessage, getByIdError: new Error('database unavailable') });

    const res = await postReaction(app, OMNI_MESSAGE_ID);

    expect(res.status).toBe(500);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('preserves external message IDs for plugin fallback when DB lookup misses', async () => {
    const sendMessage = mock(async (_instanceId: string, _message: unknown) => ({
      success: true,
      messageId: 'REACTION-MSG-ID',
      timestamp: 123,
    }));
    const app = mountMessagesRoutes({ sendMessage });
    const externalMessageId = 'EXTERNAL-NOT-IN-DB';

    const res = await postReaction(app, externalMessageId);

    expect(res.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[1]).toMatchObject({
      content: {
        type: 'reaction',
        emoji: '👍',
        targetMessageId: externalMessageId,
      },
      metadata: {},
    });
  });
});
