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
        capabilities: {
          canSendText: true,
          canSendMedia: true,
          canSendSticker: true,
          canSendContact: true,
          canSendLocation: true,
          canSendPoll: true,
        },
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
    // Response echoes the resolved attribution so callers can verify it
    const body = (await res.json()) as { data: { senderAgentId?: string | null } };
    expect(body.data.senderAgentId).toBe(AGENT_ID);
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

  test("sentBy: 'agent' on an instance without an agent stays unattributed — response reports null", async () => {
    const { app, sendMessage } = mountMessagesRoutes({ agentId: null });

    const res = await postJson(app, '/messages/send', { ...textBody, sentBy: 'agent' });

    expect(res.status).toBe(201);
    expect('senderAgentId' in sentMetadata(sendMessage)).toBe(false);
    // The caller can detect that attribution did not happen (#912 review)
    const body = (await res.json()) as { data: { senderAgentId?: string | null } };
    expect(body.data.senderAgentId).toBeNull();
  });

  test('response omits senderAgentId entirely when sentBy was not requested', async () => {
    const { app } = mountMessagesRoutes();

    const res = await postJson(app, '/messages/send', textBody);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect('senderAgentId' in body.data).toBe(false);
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

describe('sentBy on the remaining send routes (#912 review)', () => {
  const base = { instanceId: INSTANCE_ID, to: '5511999998888', sentBy: 'agent' };

  const cases: Array<{ path: string; body: Record<string, unknown> }> = [
    { path: '/messages/send/sticker', body: { ...base, url: 'https://example.com/sticker.webp' } },
    { path: '/messages/send/contact', body: { ...base, contact: { name: 'Ada Lovelace' } } },
    { path: '/messages/send/location', body: { ...base, latitude: -23.55, longitude: -46.63 } },
    {
      path: '/messages/send/poll',
      body: { ...base, question: 'Best slot?', answers: ['10:00', '11:00'] },
    },
  ];

  for (const { path, body } of cases) {
    test(`${path} threads senderAgentId and echoes it in the response`, async () => {
      const { app, sendMessage } = mountMessagesRoutes();

      const res = await postJson(app, path, body);

      expect(res.status).toBe(201);
      expect(sentMetadata(sendMessage).senderAgentId).toBe(AGENT_ID);
      const parsed = (await res.json()) as { data: { senderAgentId?: string | null } };
      expect(parsed.data.senderAgentId).toBe(AGENT_ID);
    });
  }
});
