/**
 * POST /messages/send — replyTo quoting and the additive replyToKey hint.
 * replyToKey only fills the quoted key when the replied-to row is not stored.
 */
import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const CHAT_JID = '120363000000000000@g.us';
const STORED_REPLY_ID = 'STORED-QUOTED-ID';
const STORED_RAW_PAYLOAD = {
  key: { id: STORED_REPLY_ID, remoteJid: CHAT_JID, fromMe: false, participant: '5511888888888@s.whatsapp.net' },
};

function mountMessagesRoutes(
  sendMessage: ReturnType<typeof mock>,
  options: { chatFound?: boolean } = {},
): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel: 'whatsapp-baileys' })),
      },
      chats: {
        findByExternalIdSmart: mock(async () =>
          options.chatFound === false ? null : { id: 'chat-row', externalId: CHAT_JID },
        ),
      },
      messages: {
        getByExternalId: mock(async (_chatId: string, externalId: string) =>
          externalId === STORED_REPLY_ID
            ? { isFromMe: false, rawPayload: STORED_RAW_PAYLOAD, textContent: 'stored text' }
            : null,
        ),
      },
    } as never);
    c.set('channelRegistry', {
      get: mock(() => ({ capabilities: { canSendText: true }, sendMessage })),
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

function okSend() {
  return mock(async (_instanceId: string, _message: unknown) => ({
    success: true,
    messageId: 'TEXT-MSG-ID',
    timestamp: 123,
  }));
}

function postText(app: Hono<{ Variables: AppVariables }>, body: Record<string, unknown>) {
  return app.request('/messages/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: INSTANCE_ID, to: CHAT_JID, text: 'reply text', ...body }),
  });
}

function sentMetadata(sendMessage: ReturnType<typeof mock>): Record<string, unknown> {
  return (sendMessage.mock.calls[0]?.[1] as { metadata: Record<string, unknown> }).metadata;
}

describe('POST /messages/send replyTo / replyToKey', () => {
  test('no new input: a text send with replyTo and a stored row keeps today metadata', async () => {
    const sendMessage = okSend();
    const res = await postText(mountMessagesRoutes(sendMessage), { replyTo: STORED_REPLY_ID });

    expect(res.status).toBe(201);
    expect((sendMessage.mock.calls[0]?.[1] as { replyTo?: string }).replyTo).toBe(STORED_REPLY_ID);
    expect(sentMetadata(sendMessage)).toEqual({
      replyToFromMe: false,
      replyToRawPayload: STORED_RAW_PAYLOAD,
      replyToText: 'stored text',
    });
  });

  test('a stored row keeps today metadata even when replyToKey is given', async () => {
    const sendMessage = okSend();
    await postText(mountMessagesRoutes(sendMessage), {
      replyTo: STORED_REPLY_ID,
      replyToKey: { fromMe: true, participant: '100000000000001@lid' },
    });

    expect(sentMetadata(sendMessage)).toEqual({
      replyToFromMe: false,
      replyToRawPayload: STORED_RAW_PAYLOAD,
      replyToText: 'stored text',
    });
  });

  test('no new input: a missing row without replyToKey yields no reply metadata (plugin fallback fromMe=false)', async () => {
    const sendMessage = okSend();
    await postText(mountMessagesRoutes(sendMessage), { replyTo: 'NOT-STORED-YET' });

    expect(sentMetadata(sendMessage)).toEqual({});
  });

  test('replyToKey is used when the row is missing', async () => {
    const sendMessage = okSend();
    await postText(mountMessagesRoutes(sendMessage), {
      replyTo: 'NOT-STORED-YET',
      replyToKey: { fromMe: false, participant: '100000000000001@lid' },
    });

    expect(sentMetadata(sendMessage)).toEqual({
      replyToFromMe: false,
      replyToParticipant: '100000000000001@lid',
    });
  });

  test('replyToKey is used when the chat itself is not stored yet', async () => {
    const sendMessage = okSend();
    await postText(mountMessagesRoutes(sendMessage, { chatFound: false }), {
      replyTo: 'NOT-STORED-YET',
      replyToKey: { fromMe: true },
    });

    expect(sentMetadata(sendMessage)).toEqual({ replyToFromMe: true });
  });

  test('replyToKey without replyTo has no effect', async () => {
    const sendMessage = okSend();
    await postText(mountMessagesRoutes(sendMessage), { replyToKey: { fromMe: true, participant: 'x@lid' } });

    const message = sendMessage.mock.calls[0]?.[1] as { replyTo?: string };
    expect(message.replyTo).toBeUndefined();
    expect(sentMetadata(sendMessage)).toEqual({});
  });
});
