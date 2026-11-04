import { describe, expect, mock, test } from 'bun:test';
import { NotFoundError } from '@omni/core';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import { scopeEnforcerMiddleware } from '../../../middleware/scope-enforcer';
import type { ApiKeyData, AppVariables } from '../../../types';
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
  storedParticipant?: string;
  channel?: string;
  withErrorHandler?: boolean;
  /** Runs the request through the real scope lock with this key instead of a wildcard one. */
  lockedKey?: ApiKeyData;
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
  if (options.withErrorHandler) app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel: options.channel ?? 'whatsapp-baileys' })),
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
                    ...(options.storedParticipant ? { participant: options.storedParticipant } : {}),
                  },
                },
              }
            : null,
        ),
      },
    } as never);
    c.set('channelRegistry', {
      get: mock(() => ({
        capabilities: { canSendReaction: true, canForwardMessage: true },
        sendMessage,
      })),
    } as never);
    c.set(
      'apiKey',
      options.lockedKey ??
        ({
          id: 'test',
          name: 'test',
          scopes: ['*'],
          instanceIds: null,
          expiresAt: null,
        } as never),
    );
    await next();
  });
  if (options.lockedKey) app.use('*', scopeEnforcerMiddleware);
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

async function postReactionBody(app: Hono<{ Variables: AppVariables }>, body: Record<string, unknown>) {
  return app.request('/messages/send/reaction', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: INSTANCE_ID, to: CHAT_ID, messageId: MESSAGE_EXTERNAL_ID, ...body }),
  });
}

function okReactionSend() {
  return mock(async (_instanceId: string, _message: unknown) => ({
    success: true,
    messageId: 'REACTION-MSG-ID',
    timestamp: 123,
  }));
}

describe('POST /messages/send/reaction additive inputs (remove, targetKey)', () => {
  test('no new input: a non-empty emoji without targetKey sends today message and metadata', async () => {
    const sendMessage = okReactionSend();
    const app = mountMessagesRoutes({ sendMessage, storedParticipant: '178035101794451@lid' });

    const res = await postReactionBody(app, { emoji: '👍' });

    expect(res.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toBe(INSTANCE_ID);
    expect(sendMessage.mock.calls[0]?.[1]).toEqual({
      to: CHAT_EXTERNAL_ID,
      content: { type: 'reaction', emoji: '👍', targetMessageId: MESSAGE_EXTERNAL_ID },
      metadata: { fromMe: false, targetParticipant: '178035101794451@lid' },
    });
  });

  test("emoji '' is rejected with 400 as before, and nothing is sent", async () => {
    const sendMessage = okReactionSend();
    const res = await postReactionBody(mountMessagesRoutes({ sendMessage }), { emoji: '' });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { issues: unknown[] } }).error.issues).toEqual([
      {
        code: 'too_small',
        minimum: 1,
        type: 'string',
        inclusive: true,
        exact: false,
        message: 'String must contain at least 1 character(s)',
        path: ['emoji'],
      },
    ]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('emoji is required when remove is not true', async () => {
    const sendMessage = okReactionSend();
    const res = await postReactionBody(mountMessagesRoutes({ sendMessage }), {});

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { issues: unknown[] } }).error.issues).toEqual([
      { code: 'invalid_type', expected: 'string', received: 'undefined', path: ['emoji'], message: 'Required' },
    ]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('remove: true without emoji sends a removal on WhatsApp', async () => {
    const sendMessage = okReactionSend();
    const res = await postReactionBody(mountMessagesRoutes({ sendMessage }), { remove: true });

    expect(res.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[1]).toEqual({
      to: CHAT_EXTERNAL_ID,
      content: { type: 'reaction', emoji: '', targetMessageId: MESSAGE_EXTERNAL_ID },
      metadata: { fromMe: false },
    });
  });

  for (const emoji of ['👍', '', 42]) {
    test(`remove: true sends a removal whatever emoji is given (${JSON.stringify(emoji)})`, async () => {
      const sendMessage = okReactionSend();
      const res = await postReactionBody(mountMessagesRoutes({ sendMessage }), { emoji, remove: true });

      expect(res.status).toBe(200);
      expect((sendMessage.mock.calls[0]?.[1] as { content: { emoji: string } }).content.emoji).toBe('');
    });
  }

  for (const channel of ['discord', 'slack', 'telegram']) {
    test(`remove: true on ${channel} (no removal support) is refused and nothing is sent`, async () => {
      const sendMessage = okReactionSend();
      const app = mountMessagesRoutes({ sendMessage, channel, withErrorHandler: true });

      const res = await postReactionBody(app, { emoji: '👍', remove: true });
      const body = (await res.json()) as { error: { code: string; message: string } };

      expect(body.error.code).toBe('CAPABILITY_NOT_SUPPORTED');
      expect(body.error.message).toBe(`Channel ${channel} does not support removing reactions`);
      expect(sendMessage).not.toHaveBeenCalled();
    });
  }

  for (const channel of ['whatsapp-business', 'hermes']) {
    test(`remove: true on ${channel} sends a removal`, async () => {
      const sendMessage = okReactionSend();
      const res = await postReactionBody(mountMessagesRoutes({ sendMessage, channel }), { remove: true });

      expect(res.status).toBe(200);
      expect((sendMessage.mock.calls[0]?.[1] as { content: { emoji: string } }).content.emoji).toBe('');
    });
  }

  test('remove: false leaves a non-empty emoji untouched', async () => {
    const sendMessage = okReactionSend();
    await postReactionBody(mountMessagesRoutes({ sendMessage }), { emoji: '👍', remove: false });

    expect((sendMessage.mock.calls[0]?.[1] as { content: { emoji: string } }).content.emoji).toBe('👍');
  });

  test("remove: false with emoji '' is still a 400", async () => {
    const sendMessage = okReactionSend();
    const res = await postReactionBody(mountMessagesRoutes({ sendMessage }), { emoji: '', remove: false });

    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('a non-removal reaction on a channel without removal support is unaffected', async () => {
    const sendMessage = okReactionSend();
    const res = await postReactionBody(mountMessagesRoutes({ sendMessage, channel: 'discord' }), { emoji: '👍' });

    expect(res.status).toBe(200);
    expect((sendMessage.mock.calls[0]?.[1] as { content: { emoji: string } }).content.emoji).toBe('👍');
  });

  for (const emoji of ['⏳', '✅', '❌', '✋']) {
    test(`accepts the status emoji ${emoji}`, async () => {
      const sendMessage = okReactionSend();
      const res = await postReactionBody(mountMessagesRoutes({ sendMessage }), { emoji });

      expect(res.status).toBe(200);
      expect((sendMessage.mock.calls[0]?.[1] as { content: { emoji: string } }).content.emoji).toBe(emoji);
    });
  }

  test('targetKey overrides the stored fromMe and participant', async () => {
    const sendMessage = okReactionSend();
    const app = mountMessagesRoutes({ sendMessage, storedParticipant: '178035101794451@lid' });

    await postReactionBody(app, {
      emoji: '✅',
      targetKey: { fromMe: false, participant: '5511777777777@s.whatsapp.net' },
    });

    expect((sendMessage.mock.calls[0]?.[1] as { metadata: unknown }).metadata).toEqual({
      fromMe: false,
      targetParticipant: '5511777777777@s.whatsapp.net',
    });
  });

  test('targetKey without participant drops the stored targetParticipant', async () => {
    const sendMessage = okReactionSend();
    const app = mountMessagesRoutes({ sendMessage, storedParticipant: '178035101794451@lid' });

    await postReactionBody(app, { emoji: '✅', targetKey: { fromMe: true } });

    expect((sendMessage.mock.calls[0]?.[1] as { metadata: unknown }).metadata).toEqual({ fromMe: true });
  });

  test('targetKey overrides the plugin default when the target is not stored', async () => {
    const sendMessage = okReactionSend();
    await postReactionBody(mountMessagesRoutes({ sendMessage }), {
      messageId: 'EXTERNAL-NOT-IN-DB',
      emoji: '⏳',
      targetKey: { fromMe: false, participant: '178035101794451@lid' },
    });

    expect(sendMessage.mock.calls[0]?.[1]).toMatchObject({
      content: { targetMessageId: 'EXTERNAL-NOT-IN-DB' },
      metadata: { fromMe: false, targetParticipant: '178035101794451@lid' },
    });
  });
});

// ---------------------------------------------------------------------------
// Through the real scope lock: a chat key (a `cs` child locked to one chat)
// ---------------------------------------------------------------------------

const OTHER_CHAT_JID = '5511888880000@s.whatsapp.net';

function chatKey(): ApiKeyData {
  return {
    id: 'chat-key',
    name: `chat:${CHAT_ID}`,
    scopes: ['messages:send', 'chats:read', 'context:write', 'turns:close'],
    instanceIds: [INSTANCE_ID],
    expiresAt: null,
    profile: 'cs',
    chatAllowlist: [CHAT_ID, CHAT_EXTERNAL_ID],
    instanceAllowlist: [INSTANCE_ID],
    outboundRecipientAllowlist: [CHAT_EXTERNAL_ID],
  };
}

function postJson(app: Hono<{ Variables: AppVariables }>, path: string, body: Record<string, unknown>) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('chat key — reactions and forwards stay in its own chat', () => {
  test('a reaction in its own chat, addressed by JID, is sent', async () => {
    const sendMessage = okReactionSend();
    const app = mountMessagesRoutes({ sendMessage, lockedKey: chatKey() });

    const res = await postJson(app, '/messages/send/reaction', {
      instanceId: INSTANCE_ID,
      to: CHAT_EXTERNAL_ID,
      messageId: OMNI_MESSAGE_ID,
      emoji: '👍',
    });

    expect(res.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  test('a reaction to another chat is refused by the lock and nothing is sent', async () => {
    const sendMessage = okReactionSend();
    const app = mountMessagesRoutes({ sendMessage, lockedKey: chatKey() });

    const res = await postJson(app, '/messages/send/reaction', {
      instanceId: INSTANCE_ID,
      to: OTHER_CHAT_JID,
      messageId: MESSAGE_EXTERNAL_ID,
      emoji: '👍',
    });

    expect(res.status).toBe(403);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("a reaction in its own chat to another chat's Omni message id is refused and nothing is sent", async () => {
    const sendMessage = okReactionSend();
    const app = mountMessagesRoutes({ sendMessage, lockedKey: chatKey(), messageChatId: OTHER_CHAT_ID });

    const res = await postJson(app, '/messages/send/reaction', {
      instanceId: INSTANCE_ID,
      to: CHAT_EXTERNAL_ID,
      messageId: OMNI_MESSAGE_ID,
      emoji: '👍',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("a send addressed by the chat's UUID is refused: the recipient lock holds the JID (plan Decision 14)", async () => {
    const sendMessage = okReactionSend();
    const app = mountMessagesRoutes({ sendMessage, lockedKey: chatKey() });

    const res = await postJson(app, '/messages/send/reaction', {
      instanceId: INSTANCE_ID,
      to: CHAT_ID,
      messageId: MESSAGE_EXTERNAL_ID,
      emoji: '👍',
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { lock: string } }).error.lock).toBe('outboundRecipientAllowlist');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('a forward from another chat into its own chat is refused and nothing is sent', async () => {
    const sendMessage = okReactionSend();
    const app = mountMessagesRoutes({ sendMessage, lockedKey: chatKey() });

    const res = await postJson(app, '/messages/send/forward', {
      instanceId: INSTANCE_ID,
      to: CHAT_EXTERNAL_ID,
      messageId: MESSAGE_EXTERNAL_ID,
      fromChatId: OTHER_CHAT_JID,
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { lock: string; attempted: string } }).error).toMatchObject({
      lock: 'chatAllowlist',
      attempted: OTHER_CHAT_JID,
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('a forward inside its own chat is sent', async () => {
    const sendMessage = okReactionSend();
    const app = mountMessagesRoutes({ sendMessage, lockedKey: chatKey() });

    const res = await postJson(app, '/messages/send/forward', {
      instanceId: INSTANCE_ID,
      to: CHAT_EXTERNAL_ID,
      messageId: MESSAGE_EXTERNAL_ID,
      fromChatId: CHAT_EXTERNAL_ID,
    });

    expect(res.status).toBe(201);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
