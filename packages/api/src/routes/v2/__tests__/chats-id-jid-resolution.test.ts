/**
 * Regression test for the dormant /:id-resolution bug:
 *
 *   GET /api/v2/chats/120363425563375486@g.us/messages → 500
 *   GET /api/v2/chats/65315744/messages                → 500
 *
 *   PostgresError: invalid input syntax for type uuid: "120363...@g.us"
 *
 * The route handlers passed `c.req.param('id')` straight to a service method
 * that called `eq(messages.chatId, raw)` against a UUID column. WhatsApp JIDs
 * (`<num>@g.us`, `<num>@s.whatsapp.net`, `@lid`) and Telegram numeric chat ids
 * tripped postgres's UUID parser → 500 INTERNAL_ERROR.
 *
 * Bug latent since `04b8a5a9` (2026-02-01, unified messages schema) — the
 * companion LID fix `b5929040` migrated 7 call sites to
 * `findByExternalIdSmart` but missed the routes that didn't go through
 * `getByExternalId` (`getById`, `getChatMessages`, `getParticipants`).
 *
 * The fix in routes/v2/chats.ts adds `resolveChatIdParam(c, raw)`:
 *   - UUID → returned unchanged.
 *   - Anything else → looked up via `findByExternalIdSmart` against the API
 *     key's active instance. Returns null when no instance context is set
 *     OR no chat with that external id exists. Caller responds 404 with an
 *     actionable message instead of letting postgres return a 500.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { chatsRoutes } from '../chats';

const VALID_UUID = '11111111-1111-1111-8111-111111111111';
const RESOLVED_UUID = '22222222-2222-2222-8222-222222222222';
const ACTIVE_INSTANCE_ID = 'aaaaaaaa-aaaa-aaaa-8aaa-aaaaaaaaaaaa';

const WHATSAPP_GROUP_JID = '120363425563375486@g.us';
const WHATSAPP_DM_JID = '5511987654321@s.whatsapp.net';
const TELEGRAM_NUMERIC_ID = '65315744';

interface HarnessOptions {
  /**
   * When set, the harness returns this row from `db.select(...).from(apiKeys)`.
   * Pass `null` explicitly to simulate "no row found" (api key was deleted /
   * not recognized) — tests use that to exercise the unresolvable-id path.
   */
  apiKeyRow?: { activeInstanceId: string | null; contextInstanceId: string | null } | null;
  /** When set, `findByExternalIdSmart` returns this chat (id-only). null = not found. */
  resolvedChat?: { id: string } | null;
}

interface HarnessCalls {
  getChatMessages: Array<{ chatId: string; options: Record<string, unknown> }>;
  getById: Array<string>;
  getParticipants: Array<string>;
  findByExternalIdSmart: Array<{ instanceId: string; externalId: string }>;
}

function mountHarness(options: HarnessOptions = {}): {
  app: Hono<{ Variables: AppVariables }>;
  calls: HarnessCalls;
} {
  const calls: HarnessCalls = {
    getChatMessages: [],
    getById: [],
    getParticipants: [],
    findByExternalIdSmart: [],
  };
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    // Stub the API key context resolver: any select against the apiKeys table
    // returns the harness-controlled row. We fake just enough of the drizzle
    // builder chain (select → from → where → limit) for the helper to reach
    // the awaited result.
    c.set('db', {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (options.apiKeyRow ? [options.apiKeyRow] : []),
          }),
        }),
      }),
    } as never);
    c.set('services', {
      messages: {
        getChatMessages: mock(async (chatId: string, opts: Record<string, unknown>) => {
          calls.getChatMessages.push({ chatId, options: opts });
          return [];
        }),
      },
      chats: {
        getById: mock(async (id: string) => {
          calls.getById.push(id);
          return { id, instanceId: ACTIVE_INSTANCE_ID };
        }),
        getParticipants: mock(async (id: string) => {
          calls.getParticipants.push(id);
          return [];
        }),
        findByExternalIdSmart: mock(async (instanceId: string, externalId: string) => {
          calls.findByExternalIdSmart.push({ instanceId, externalId });
          return options.resolvedChat ?? null;
        }),
      },
    } as never);
    c.set('apiKey', { id: 'test-key', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/chats', chatsRoutes);
  return { app, calls };
}

describe('GET /chats/:id/messages — JID/external-id resolution', () => {
  test('UUID input flows straight through (no resolution lookup)', async () => {
    const { app, calls } = mountHarness();

    const res = await app.request(`/chats/${VALID_UUID}/messages`);

    expect(res.status).toBe(200);
    expect(calls.getChatMessages).toHaveLength(1);
    expect(calls.getChatMessages[0]?.chatId).toBe(VALID_UUID);
    // findByExternalIdSmart MUST NOT be called for UUID input — that's a
    // wasted DB roundtrip on the hot path.
    expect(calls.findByExternalIdSmart).toHaveLength(0);
  });

  test('WhatsApp group JID resolves via findByExternalIdSmart and forwards the resolved UUID', async () => {
    const { app, calls } = mountHarness({
      apiKeyRow: { activeInstanceId: ACTIVE_INSTANCE_ID, contextInstanceId: null },
      resolvedChat: { id: RESOLVED_UUID },
    });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/messages`);

    expect(res.status).toBe(200);
    expect(calls.findByExternalIdSmart).toEqual([{ instanceId: ACTIVE_INSTANCE_ID, externalId: WHATSAPP_GROUP_JID }]);
    expect(calls.getChatMessages).toHaveLength(1);
    expect(calls.getChatMessages[0]?.chatId).toBe(RESOLVED_UUID);
  });

  test('Telegram numeric id resolves the same way', async () => {
    const { app, calls } = mountHarness({
      apiKeyRow: { activeInstanceId: ACTIVE_INSTANCE_ID, contextInstanceId: null },
      resolvedChat: { id: RESOLVED_UUID },
    });

    const res = await app.request(`/chats/${TELEGRAM_NUMERIC_ID}/messages`);

    expect(res.status).toBe(200);
    expect(calls.findByExternalIdSmart[0]?.externalId).toBe(TELEGRAM_NUMERIC_ID);
    expect(calls.getChatMessages[0]?.chatId).toBe(RESOLVED_UUID);
  });

  test('contextInstanceId takes precedence over activeInstanceId', async () => {
    const CONTEXT_INSTANCE_ID = 'bbbbbbbb-bbbb-bbbb-8bbb-bbbbbbbbbbbb';
    const { app, calls } = mountHarness({
      apiKeyRow: { activeInstanceId: ACTIVE_INSTANCE_ID, contextInstanceId: CONTEXT_INSTANCE_ID },
      resolvedChat: { id: RESOLVED_UUID },
    });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_DM_JID)}/messages`);

    expect(res.status).toBe(200);
    expect(calls.findByExternalIdSmart[0]?.instanceId).toBe(CONTEXT_INSTANCE_ID);
  });

  test('returns 404 (not 500) when no active instance is set on the API key', async () => {
    // Pre-fix this hit the postgres uuid parser and bombed with a 500.
    // After the fix, the route 404s with an actionable message before
    // touching postgres.
    const { app, calls } = mountHarness({
      apiKeyRow: { activeInstanceId: null, contextInstanceId: null },
    });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/messages`);

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain(WHATSAPP_GROUP_JID);
    // Service must NOT have been called — postgres is never touched on the
    // unresolvable-id path.
    expect(calls.getChatMessages).toHaveLength(0);
    expect(calls.findByExternalIdSmart).toHaveLength(0);
  });

  test('returns 404 when JID has no matching chat in the active instance', async () => {
    const { app, calls } = mountHarness({
      apiKeyRow: { activeInstanceId: ACTIVE_INSTANCE_ID, contextInstanceId: null },
      resolvedChat: null,
    });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/messages`);

    expect(res.status).toBe(404);
    expect(calls.findByExternalIdSmart).toHaveLength(1);
    expect(calls.getChatMessages).toHaveLength(0);
  });
});

describe('GET /chats/:id — JID/external-id resolution (sister bug)', () => {
  test('UUID flows through to getById', async () => {
    const { app, calls } = mountHarness();

    const res = await app.request(`/chats/${VALID_UUID}`);

    expect(res.status).toBe(200);
    expect(calls.getById).toEqual([VALID_UUID]);
    expect(calls.findByExternalIdSmart).toHaveLength(0);
  });

  test('JID resolves and getById is called with the resolved UUID', async () => {
    const { app, calls } = mountHarness({
      apiKeyRow: { activeInstanceId: ACTIVE_INSTANCE_ID, contextInstanceId: null },
      resolvedChat: { id: RESOLVED_UUID },
    });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}`);

    expect(res.status).toBe(200);
    expect(calls.findByExternalIdSmart).toHaveLength(1);
    expect(calls.getById).toEqual([RESOLVED_UUID]);
  });

  test('JID with no active instance returns 404 (not 500)', async () => {
    const { app, calls } = mountHarness({ apiKeyRow: null });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}`);

    expect(res.status).toBe(404);
    expect(calls.getById).toHaveLength(0);
  });
});

describe('GET /chats/:id/participants — JID/external-id resolution (sister bug)', () => {
  test('JID resolves and getParticipants is called with the resolved UUID', async () => {
    const { app, calls } = mountHarness({
      apiKeyRow: { activeInstanceId: ACTIVE_INSTANCE_ID, contextInstanceId: null },
      resolvedChat: { id: RESOLVED_UUID },
    });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/participants`);

    expect(res.status).toBe(200);
    expect(calls.findByExternalIdSmart).toHaveLength(1);
    expect(calls.getParticipants).toEqual([RESOLVED_UUID]);
  });

  test('JID with no active instance returns 404 (not 500)', async () => {
    const { app, calls } = mountHarness({ apiKeyRow: null });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/participants`);

    expect(res.status).toBe(404);
    expect(calls.getParticipants).toHaveLength(0);
  });
});
