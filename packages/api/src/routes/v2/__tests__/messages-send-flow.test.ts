/**
 * POST /messages/send — `flow` (a WhatsApp Flow sent with the send-text key).
 *
 * The endpoint hands the plugin the same message `POST
 * /instances/:id/whatsapp-flows/send` does — `content.type: 'flow'` plus the
 * descriptor in `metadata.flow` — with the message `text` as the body when
 * `bodyText` is missing and the caller's `flowToken` kept and echoed in the 201.
 * A flow stands alone (no buttons, list or location request) and only goes out
 * on a channel with a flow sender.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const FLOW = { flowId: '1234567890', screen: 'PROFILE', cta: 'Escolher', flowToken: 'offer-0a1b2c3d4e5f' };

type SentMessage = {
  to: string;
  content: Record<string, unknown> & { type: string; text?: string };
  metadata?: Record<string, unknown> & { flow?: Record<string, unknown> };
};

function mountMessagesRoutes(channel = 'whatsapp-business') {
  const sendMessage = mock(async (_instanceId: string, _message: unknown) => ({
    success: true,
    messageId: 'SENT-MSG-ID',
    timestamp: 123,
  }));

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel })),
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
      scopes: ['messages:send'],
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
    body: JSON.stringify({ instanceId: INSTANCE_ID, to: '5511999998888', text: 'Qual é o seu curso?', ...body }),
  });
}

function sentMessage(sendMessage: ReturnType<typeof mock>): SentMessage {
  const [, message] = sendMessage.mock.calls[0] as [string, SentMessage];
  return message;
}

async function errorOf(
  res: Response,
): Promise<{ code: string; message?: string; issues?: Array<{ path: unknown[] }> }> {
  return ((await res.json()) as { error: { code: string; message?: string; issues?: Array<{ path: unknown[] }> } })
    .error;
}

describe('POST /messages/send with flow', () => {
  test('sends content.type flow with metadata.flow, the body from text and the caller flowToken echoed', async () => {
    const { app, sendMessage } = mountMessagesRoutes();
    const data = { levels: [{ id: 'level_a', title: 'Nível A' }] };

    const res = await postSend(app, { flow: { ...FLOW, data, flowAction: 'navigate' } });

    expect(res.status).toBe(201);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const message = sentMessage(sendMessage);
    expect(message.content).toEqual({ type: 'flow', text: 'Qual é o seu curso?' });
    expect(message.metadata?.flow).toEqual({
      ...FLOW,
      data,
      flowAction: 'navigate',
      bodyText: 'Qual é o seu curso?',
    });
    const json = (await res.json()) as { data: Record<string, unknown> };
    expect(json.data).toMatchObject({ messageId: 'SENT-MSG-ID', status: 'sent', flowToken: FLOW.flowToken });
  });

  test('keeps an explicit bodyText as the body', async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postSend(app, { flow: { ...FLOW, bodyText: 'Toque para escolher' } });

    expect(res.status).toBe(201);
    const message = sentMessage(sendMessage);
    expect(message.content.text).toBe('Toque para escolher');
    expect(message.metadata?.flow?.bodyText).toBe('Toque para escolher');
  });

  test('generates a flowToken when the caller sends none, and returns it', async () => {
    const { app, sendMessage } = mountMessagesRoutes();
    const { flowToken: _omitted, ...withoutToken } = FLOW;

    const res = await postSend(app, { flow: withoutToken });

    expect(res.status).toBe(201);
    const token = sentMessage(sendMessage).metadata?.flow?.flowToken;
    expect(token).toMatch(/^omni\.1234567890\.[0-9a-f-]{36}$/);
    const json = (await res.json()) as { data: { flowToken?: string } };
    expect(json.data.flowToken).toBe(token as string);
  });

  test('asc-flow takes the flow by flowId', async () => {
    const { app, sendMessage } = mountMessagesRoutes('asc-flow');

    const res = await postSend(app, { flow: FLOW });

    expect(res.status).toBe(201);
    expect(sentMessage(sendMessage).content.type).toBe('flow');
  });

  test('asc-flow refuses a flow by flowName', async () => {
    const { app, sendMessage } = mountMessagesRoutes('asc-flow');
    const { flowId: _id, ...byName } = FLOW;

    const res = await postSend(app, { flow: { ...byName, flowName: 'perfil' } });

    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('VALIDATION_ERROR');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  for (const channel of ['telegram', 'whatsapp-baileys', 'hermes']) {
    test(`a ${channel} instance answers 400 WRONG_CHANNEL and sends nothing`, async () => {
      const { app, sendMessage } = mountMessagesRoutes(channel);

      const res = await postSend(app, { flow: FLOW });

      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe('WRONG_CHANNEL');
      expect(sendMessage).not.toHaveBeenCalled();
    });
  }

  const combinations: Array<[string, Record<string, unknown>]> = [
    ['buttons', { buttons: [{ text: 'Sim', data: 'yes' }] }],
    ['list', { list: { forceList: true } }],
    ['requestLocation', { requestLocation: true }],
  ];
  for (const [field, extra] of combinations) {
    test(`refuses flow together with ${field}`, async () => {
      const { app, sendMessage } = mountMessagesRoutes();

      const res = await postSend(app, { flow: FLOW, ...extra });

      expect(res.status).toBe(400);
      const error = await errorOf(res);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.issues?.map((i) => i.path)).toEqual([[field]]);
      expect(sendMessage).not.toHaveBeenCalled();
    });
  }

  test('requestLocation: false and an empty buttons array do not count as combined', async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postSend(app, { flow: FLOW, requestLocation: false, buttons: [] });

    expect(res.status).toBe(201);
    expect(sentMessage(sendMessage).content.type).toBe('flow');
  });

  test('refuses a flow naming both flowId and flowName', async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postSend(app, { flow: { ...FLOW, flowName: 'perfil' } });

    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('refuses a flow without cta', async () => {
    const { app, sendMessage } = mountMessagesRoutes();
    const { cta: _cta, ...noCta } = FLOW;

    const res = await postSend(app, { flow: noCta });

    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('refuses a text above the flow body limit when bodyText is missing, and accepts it with bodyText', async () => {
    const long = 'x'.repeat(1025);
    const refused = mountMessagesRoutes();
    const res = await postSend(refused.app, { text: long, flow: FLOW });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('VALIDATION_ERROR');
    expect(refused.sendMessage).not.toHaveBeenCalled();

    const accepted = mountMessagesRoutes();
    const ok = await postSend(accepted.app, { text: long, flow: { ...FLOW, bodyText: 'Toque para escolher' } });
    expect(ok.status).toBe(201);
  });

  test('a send without flow keeps its shape: no metadata.flow, no flowToken', async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postSend(app, {});

    expect(res.status).toBe(201);
    const message = sentMessage(sendMessage);
    expect(message.content.type).toBe('text');
    expect(message.metadata && 'flow' in message.metadata).toBe(false);
    const json = (await res.json()) as { data: Record<string, unknown> };
    expect('flowToken' in json.data).toBe(false);
  });
});
