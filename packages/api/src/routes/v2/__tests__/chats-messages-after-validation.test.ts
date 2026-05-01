/**
 * Regression test for automagik-dev/omni#462
 *
 * Contract:
 *   GET /chats/:id/messages MUST return HTTP 400 (not 500) when
 *   `before` or `after` query parameters are not parseable date
 *   strings. Previously, invalid values (e.g. a UUID) flowed into
 *   `new Date(...)` producing an `Invalid Date` that surfaced as a
 *   500 INTERNAL_ERROR via a downstream Drizzle comparison.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { chatsRoutes } from '../chats';

type CallArgs = { chatId: string; options: Record<string, unknown> };

function mountChatsRoutes(calls: CallArgs[]): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      messages: {
        getChatMessages: mock(async (chatId: string, options: Record<string, unknown>) => {
          calls.push({ chatId, options });
          return [];
        }),
      },
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
  app.route('/chats', chatsRoutes);
  return app;
}

describe('GET /chats/:id/messages — date parameter validation (#462)', () => {
  test('returns 400 when `after` is a UUID (unparseable as date)', async () => {
    const calls: CallArgs[] = [];
    const app = mountChatsRoutes(calls);

    const res = await app.request(
      '/chats/11111111-1111-1111-8111-111111111111/messages?after=550e8400-e29b-41d4-a716-446655440000',
    );

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0); // service must not be called with Invalid Date
  });

  test('returns 400 when `after` is arbitrary garbage', async () => {
    const calls: CallArgs[] = [];
    const app = mountChatsRoutes(calls);

    const res = await app.request('/chats/11111111-1111-1111-8111-111111111111/messages?after=not-a-date-at-all');

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 400 when `before` is a UUID (same class of bug)', async () => {
    const calls: CallArgs[] = [];
    const app = mountChatsRoutes(calls);

    const res = await app.request(
      '/chats/11111111-1111-1111-8111-111111111111/messages?before=550e8400-e29b-41d4-a716-446655440000',
    );

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test('returns 200 and passes a Date to the service when `after` is valid ISO 8601', async () => {
    const calls: CallArgs[] = [];
    const app = mountChatsRoutes(calls);

    const res = await app.request(
      '/chats/11111111-1111-1111-8111-111111111111/messages?after=2024-01-01T00:00:00.000Z',
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.chatId).toBe('11111111-1111-1111-8111-111111111111');
    const after = calls[0]?.options.after;
    expect(after).toBeInstanceOf(Date);
    expect((after as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  test('returns 200 and omits `after`/`before` when no parameters are provided', async () => {
    const calls: CallArgs[] = [];
    const app = mountChatsRoutes(calls);

    const res = await app.request('/chats/11111111-1111-1111-8111-111111111111/messages');

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options.after).toBeUndefined();
    expect(calls[0]?.options.before).toBeUndefined();
  });

  test('honours `mediaOnly=true`', async () => {
    const calls: CallArgs[] = [];
    const app = mountChatsRoutes(calls);

    const res = await app.request('/chats/11111111-1111-1111-8111-111111111111/messages?mediaOnly=true');

    expect(res.status).toBe(200);
    expect(calls[0]?.options.mediaOnly).toBe(true);
  });
});
