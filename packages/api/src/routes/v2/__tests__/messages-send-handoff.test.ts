import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

const INSTANCE_ID = '66666666-6666-4666-8666-666666666666';
const CHAT_ID = '77777777-7777-4777-8777-777777777777';

type PluginResult = Record<string, unknown>;

function mountHandoffRoute(channel: string, result: PluginResult) {
  const sendMessage = mock(async (_instanceId: string, _message: unknown) => result);
  const chatUpdates: Record<string, unknown>[] = [];
  const disarm = mock(async (_input: unknown) => undefined);
  const insert = mock(() => ({ values: () => Promise.resolve(undefined) }));

  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: { getById: mock(async (id: string) => ({ id, channel, agentId: null })) },
      persons: { getIdentityForChannel: mock(async () => null) },
      chats: {
        getById: mock(async () => ({ id: CHAT_ID, settings: {} })),
        update: mock(async (_id: string, patch: Record<string, unknown>) => {
          chatUpdates.push(patch);
        }),
      },
      followUpLifecycle: { disarm },
    } as never);
    c.set('db', { insert } as never);
    c.set('channelRegistry', {
      get: mock(() => ({ capabilities: { canHandoff: true }, sendMessage })),
    } as never);
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/messages', messagesRoutes);
  return { app, sendMessage, chatUpdates, disarm, insert };
}

function postHandoff(app: Hono<{ Variables: AppVariables }>) {
  return app.request('/messages/send/handoff', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      instanceId: INSTANCE_ID,
      chatId: CHAT_ID,
      to: '15550001111',
      text: 'Connecting you to a person.',
      handoffFields: { queue: 'queue-a' },
    }),
  });
}

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describe('POST /messages/send/handoff - a definitive channel refusal is a 4xx', () => {
  test('a rejected send answers 422 CHANNEL_SEND_REJECTED with the channel message and no side effects', async () => {
    const { app, chatUpdates, disarm, insert } = mountHandoffRoute('zenvia', {
      success: false,
      error: 'no destination for this handoff',
      errorCode: 'ZENVIA_INVALID_REQUEST',
      retryable: false,
      rejected: true,
      timestamp: 1,
    });

    const res = await postHandoff(app);

    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('CHANNEL_SEND_REJECTED');
    expect(body.error.message).toBe('no destination for this handoff');
    expect(body.error.details).toMatchObject({ channelType: 'zenvia', errorCode: 'ZENVIA_INVALID_REQUEST' });
    expect(chatUpdates).toEqual([]);
    expect(disarm).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  test('a failed send without the rejected flag stays 502 CHANNEL_SEND_FAILED on every channel', async () => {
    for (const channel of ['gupshup', 'zenvia', 'asc-flow']) {
      const { app } = mountHandoffRoute(channel, {
        success: false,
        error: 'upstream timeout',
        retryable: true,
        timestamp: 1,
      });

      const res = await postHandoff(app);

      expect(res.status).toBe(502);
      expect(((await res.json()) as ErrorBody).error.code).toBe('CHANNEL_SEND_FAILED');
    }
  });

  test('rejected: false is the same as absent and stays 502', async () => {
    const { app } = mountHandoffRoute('gupshup', {
      success: false,
      error: 'bad gateway',
      rejected: false,
      timestamp: 1,
    });

    const res = await postHandoff(app);

    expect(res.status).toBe(502);
    expect(((await res.json()) as ErrorBody).error.code).toBe('CHANNEL_SEND_FAILED');
  });

  test('a successful send is unchanged: 201, messageId passed through, agent paused', async () => {
    const { app, chatUpdates, insert } = mountHandoffRoute('zenvia', {
      success: true,
      messageId: 'MSG-1',
      timestamp: 9,
    });

    const res = await postHandoff(app);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { messageId: string | null; status: string } };
    expect(body.data.messageId).toBe('MSG-1');
    expect(body.data.status).toBe('sent');
    expect(chatUpdates).toEqual([{ settings: { agentPaused: true } }]);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  test('success without messageId answers 201 with messageId null', async () => {
    const { app } = mountHandoffRoute('zenvia', { success: true, timestamp: 9 });

    const res = await postHandoff(app);

    expect(res.status).toBe(201);
    expect(((await res.json()) as { data: { messageId: string | null } }).data.messageId).toBeNull();
  });
});
