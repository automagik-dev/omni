import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { contextRoutes } from '../context';

const KEY_ID = '99999999-9999-4999-8999-999999999999';
const INSTANCE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTANCE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHAT_ID = '11111111-1111-4111-8111-111111111111';

function mountHarness(
  chatInstanceId: string | null,
  context: { activeInstanceId?: string | null; contextInstanceId?: string | null } = {},
) {
  const updates: Array<Record<string, unknown>> = [];
  const getById = mock(async (id: string) => (chatInstanceId ? { id, instanceId: chatInstanceId } : null));

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('apiKey', {
      id: KEY_ID,
      name: 'test',
      scopes: ['*'],
      instanceIds: null,
      expiresAt: null,
    } as never);
    c.set('services', {
      chats: { getById },
    } as never);
    c.set('db', {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                activeInstanceId: context.activeInstanceId ?? null,
                contextInstanceId: context.contextInstanceId ?? null,
              },
            ],
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return { where: async () => undefined };
        },
      }),
    } as never);
    await next();
  });
  app.route('/context', contextRoutes);
  return { app, getById, updates };
}

describe('POST /context', () => {
  test('rejects context when chat UUID belongs to a different instance', async () => {
    const { app, getById, updates } = mountHarness(INSTANCE_A);

    const res = await app.request('/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: INSTANCE_B, chatId: CHAT_ID }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { message?: string; details?: Record<string, unknown> } };
    expect(json.error?.message).toBe('Chat does not belong to the requested instance');
    expect(json.error?.details?.chatInstanceId).toBe(INSTANCE_A);
    expect(getById).toHaveBeenCalledWith(CHAT_ID);
    expect(updates).toHaveLength(0);
  });

  test('persists context when chat UUID belongs to the requested instance', async () => {
    const { app, getById, updates } = mountHarness(INSTANCE_B);

    const res = await app.request('/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: INSTANCE_B, chatId: CHAT_ID }),
    });

    expect(res.status).toBe(200);
    expect(getById).toHaveBeenCalledWith(CHAT_ID);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.contextInstanceId).toBe(INSTANCE_B);
    expect(updates[0]?.contextChatId).toBe(CHAT_ID);
  });

  test('rejects chat-only context when chat does not belong to active instance', async () => {
    const { app, updates } = mountHarness(INSTANCE_A, { activeInstanceId: INSTANCE_B });

    const res = await app.request('/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: CHAT_ID }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { message?: string; details?: Record<string, unknown> } };
    expect(json.error?.message).toBe('Chat does not belong to the requested instance');
    expect(json.error?.details?.instanceId).toBe(INSTANCE_B);
    expect(updates).toHaveLength(0);
  });

  test('returns 404 when chat lookup returns null', async () => {
    const { app, updates } = mountHarness(null, { activeInstanceId: INSTANCE_B });

    const res = await app.request('/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: CHAT_ID }),
    });

    expect(res.status).toBe(404);
    expect(updates).toHaveLength(0);
  });
});

describe('POST /context/use', () => {
  test('switches active instance and clears stale chat context', async () => {
    const { app, updates } = mountHarness(INSTANCE_A);

    const res = await app.request('/context/use', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: INSTANCE_B }),
    });

    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.activeInstanceId).toBe(INSTANCE_B);
    expect(updates[0]?.contextInstanceId).toBe(INSTANCE_B);
    expect(updates[0]?.contextChatId).toBeNull();
    expect(updates[0]?.contextMessageId).toBeNull();
  });
});
