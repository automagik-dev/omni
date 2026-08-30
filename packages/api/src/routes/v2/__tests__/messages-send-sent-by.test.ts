/**
 * POST /messages/send + /messages/send/media — `sentBy: 'agent'` authorship (#912).
 *
 * Agent integrations that answer a turn out-of-band (interactive lists, media)
 * previously had no way to mark their outbound as agent-authored: the routes
 * never set `metadata.senderAgentId`, the row landed with
 * `sender_agent_id = NULL`, and follow-up scheduling never armed. `sentBy:
 * 'agent'` resolves the instance's configured agent SERVER-SIDE (the column is
 * an FK — caller-provided ids are not accepted) and threads it into
 * `OutgoingMessage.metadata.senderAgentId`, which channel plugins echo into
 * the `message.sent` payload for persistence.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';

type MountOptions = {
  agentId?: string | null;
};

function mountMessagesRoutes(options: MountOptions = {}): {
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
        getById: mock(async (id: string) => ({
          id,
          channel: 'whatsapp-business',
          agentId: options.agentId === undefined ? AGENT_ID : options.agentId,
        })),
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
        capabilities: { canSendText: true, canSendMedia: true },
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

async function postJson(app: Hono<{ Variables: AppVariables }>, path: string, body: Record<string, unknown>) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function sentMetadata(sendMessage: ReturnType<typeof mock>): Record<string, unknown> {
  const [, message] = sendMessage.mock.calls[0] as [string, { metadata?: Record<string, unknown> }];
  return message.metadata ?? {};
}

describe('POST /messages/send with sentBy', () => {
  const textBody = { instanceId: INSTANCE_ID, to: '5511999998888', text: 'Pick one' };

  test("sentBy: 'agent' resolves the instance agent into metadata.senderAgentId", async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postJson(app, '/messages/send', { ...textBody, sentBy: 'agent' });

    expect(res.status).toBe(201);
    expect(sentMetadata(sendMessage).senderAgentId).toBe(AGENT_ID);
  });

  test('omitted sentBy leaves metadata unattributed', async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postJson(app, '/messages/send', textBody);

    expect(res.status).toBe(201);
    expect('senderAgentId' in sentMetadata(sendMessage)).toBe(false);
  });

  test("sentBy: 'user' leaves metadata unattributed", async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postJson(app, '/messages/send', { ...textBody, sentBy: 'user' });

    expect(res.status).toBe(201);
    expect('senderAgentId' in sentMetadata(sendMessage)).toBe(false);
  });

  test("sentBy: 'agent' on an instance without an agent stays unattributed", async () => {
    const { app, sendMessage } = mountMessagesRoutes({ agentId: null });

    const res = await postJson(app, '/messages/send', { ...textBody, sentBy: 'agent' });

    expect(res.status).toBe(201);
    expect('senderAgentId' in sentMetadata(sendMessage)).toBe(false);
  });

  test('rejects an unknown sentBy value', async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postJson(app, '/messages/send', { ...textBody, sentBy: 'operator' });

    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('POST /messages/send/media with sentBy', () => {
  const mediaBody = {
    instanceId: INSTANCE_ID,
    to: '5511999998888',
    type: 'image',
    url: 'https://example.com/photo.jpg',
  };

  test("sentBy: 'agent' resolves the instance agent into metadata.senderAgentId", async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postJson(app, '/messages/send/media', { ...mediaBody, sentBy: 'agent' });

    expect(res.status).toBe(201);
    expect(sentMetadata(sendMessage).senderAgentId).toBe(AGENT_ID);
  });

  test('omitted sentBy leaves metadata unattributed', async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postJson(app, '/messages/send/media', mediaBody);

    expect(res.status).toBe(201);
    expect('senderAgentId' in sentMetadata(sendMessage)).toBe(false);
  });
});
