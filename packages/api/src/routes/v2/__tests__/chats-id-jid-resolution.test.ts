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
import { NotFoundError } from '@omni/core';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import { scopeEnforcerMiddleware } from '../../../middleware/scope-enforcer';
import type { ApiKeyData, AppVariables } from '../../../types';
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
  /**
   * When set, the API key is restricted to these `instanceIds` (mirroring the
   * `apiKeys.instanceIds` column). Default `null` = unrestricted. Used by the
   * cross-instance oracle tests to flip the api key into a scoped state.
   */
  apiKeyInstanceIds?: string[] | null;
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
    c.set('apiKey', {
      id: 'test-key',
      name: 'test',
      scopes: ['*'],
      instanceIds: options.apiKeyInstanceIds ?? null,
      expiresAt: null,
    } as never);
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

// ---------------------------------------------------------------------------
// Sweep coverage — POST/DELETE :id routes (PR follow-up)
//
// The first PR (omni#591) covered the GET handlers that were 500ing in
// production. This sweep applies the same resolution to the remaining
// POST/DELETE/PATCH `:id*` routes — they share the latent bug but are less
// frequently called. Tests here pin the unresolvable-id → 404 path on a
// representative subset; full happy-path coverage isn't worth the harness
// expansion (each POST needs additional service stubs + channelRegistry).
// ---------------------------------------------------------------------------

describe('POST /chats/:id/* — JID/external-id resolution sweep', () => {
  test('POST /:id/read with JID + no active instance returns 404 (not 500)', async () => {
    const { app } = mountHarness({ apiKeyRow: null });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: ACTIVE_INSTANCE_ID }),
    });

    // Pre-fix this hit `services.chats.getById(jid)` and bombed with the
    // postgres uuid syntax error → 500. After the sweep, the explicit
    // body.instanceId is fed to the resolver and a 404 is returned when
    // `findByExternalIdSmart` finds nothing (resolvedChat is null by default).
    expect(res.status).toBe(404);
  });

  test('POST /:id/archive uses body.instanceId for resolution (no active-context lookup needed)', async () => {
    // No apiKeyRow → getActiveInstanceId would return null. The route MUST
    // still succeed in resolving when body.instanceId is provided, because
    // resolveChatIdParam takes the explicit instanceId path. Mock returns
    // null so we observe the 404 path; the key assertion is that
    // findByExternalIdSmart was called WITH the body's instanceId.
    const { app, calls } = mountHarness({ apiKeyRow: null });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: ACTIVE_INSTANCE_ID }),
    });

    expect(res.status).toBe(404);
    expect(calls.findByExternalIdSmart).toEqual([{ instanceId: ACTIVE_INSTANCE_ID, externalId: WHATSAPP_GROUP_JID }]);
  });

  test('POST /:id/pin with required instanceId in body resolves via that instance', async () => {
    const { app, calls } = mountHarness({ apiKeyRow: null });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: ACTIVE_INSTANCE_ID }),
    });

    expect(res.status).toBe(404);
    expect(calls.findByExternalIdSmart).toEqual([{ instanceId: ACTIVE_INSTANCE_ID, externalId: WHATSAPP_GROUP_JID }]);
  });

  test('POST /:id/hide (no body) falls back to active-instance context', async () => {
    const { app, calls } = mountHarness({
      apiKeyRow: { activeInstanceId: ACTIVE_INSTANCE_ID, contextInstanceId: null },
    });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/hide`, {
      method: 'POST',
    });

    expect(res.status).toBe(404);
    expect(calls.findByExternalIdSmart).toEqual([{ instanceId: ACTIVE_INSTANCE_ID, externalId: WHATSAPP_GROUP_JID }]);
  });

  test('DELETE /:id/participants/:platformUserId resolves the chat id from active instance', async () => {
    const { app, calls } = mountHarness({
      apiKeyRow: { activeInstanceId: ACTIVE_INSTANCE_ID, contextInstanceId: null },
    });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/participants/some-platform-user`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(404);
    expect(calls.findByExternalIdSmart).toEqual([{ instanceId: ACTIVE_INSTANCE_ID, externalId: WHATSAPP_GROUP_JID }]);
  });

  test('PATCH /:id/participants/:platformUserId/role resolves before the role update', async () => {
    const { app, calls } = mountHarness({
      apiKeyRow: { activeInstanceId: ACTIVE_INSTANCE_ID, contextInstanceId: null },
    });

    const res = await app.request(
      `/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/participants/some-platform-user/role`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      },
    );

    expect(res.status).toBe(404);
    expect(calls.findByExternalIdSmart).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Cross-instance existence oracle (codex P2 review on omni#592)
//
// `resolveChatIdParam` originally called `findByExternalIdSmart(instanceId,
// raw)` BEFORE any instance-access check. That made unauthorized callers
// observe two distinct response shapes for the same forbidden instance:
//
//   - chat exists in instance + caller can't access  → 403 VALIDATION
//     (after `checkInstanceAccess` later in the handler)
//   - chat absent in instance + caller can't access  → 404 NOT_FOUND
//     (resolver returns null, route returns 404)
//
// → cross-instance existence oracle. The fix moves `checkInstanceAccess`
// inside the resolver so both cases return the same 403 BEFORE any DB
// lookup. These tests pin that contract: scoped API keys must see 403
// regardless of whether the chat exists in the requested instance.
// ---------------------------------------------------------------------------

const FORBIDDEN_INSTANCE_ID = 'cccccccc-cccc-cccc-8ccc-cccccccccccc';
const ALLOWED_INSTANCE_ID = 'dddddddd-dddd-dddd-8ddd-dddddddddddd';

describe('cross-instance existence oracle — checkInstanceAccess runs BEFORE findByExternalIdSmart', () => {
  test('explicit body.instanceId outside the API key scope → 403, no DB lookup', async () => {
    // API key is scoped to ALLOWED_INSTANCE_ID only. Caller passes a JID
    // with body.instanceId=FORBIDDEN_INSTANCE_ID. Resolver must throw
    // 403 BEFORE looking up the chat — otherwise the response code leaks
    // whether the chat exists in the forbidden instance.
    const { app, calls } = mountHarness({
      apiKeyInstanceIds: [ALLOWED_INSTANCE_ID],
      // Even if findByExternalIdSmart WOULD have returned a chat, we must
      // not get there. resolvedChat: { id: ... } proves it: if the resolver
      // ran the lookup, the route would 200; we expect 403/4xx instead.
      resolvedChat: { id: RESOLVED_UUID },
    });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: FORBIDDEN_INSTANCE_ID }),
    });

    // checkInstanceAccess throws OmniError with VALIDATION code.
    // The omni global error handler maps that to a non-2xx response — the
    // exact shape depends on the OmniError middleware, but it's guaranteed
    // not to be a 200 (no chat data returned) and not a 404 (no existence
    // signal). The critical assertion: findByExternalIdSmart MUST NOT have
    // been called.
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(404);
    expect(calls.findByExternalIdSmart).toHaveLength(0);
  });

  test('UUID input outside the API key scope is NOT pre-checked here (handler-level checks remain)', async () => {
    // UUID input bypasses the resolver entirely (no DB lookup needed). For
    // UUID-shaped IDs the existing handler-level `checkInstanceAccess` and
    // service-layer guards remain authoritative. The resolver's job is
    // narrowly: prevent the JID-shaped existence oracle. Document that
    // here so future refactors don't accidentally start enforcing access
    // on UUIDs in a way that breaks legitimate operator workflows.
    const { app, calls } = mountHarness({
      apiKeyInstanceIds: [ALLOWED_INSTANCE_ID],
    });

    const res = await app.request(`/chats/${VALID_UUID}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: FORBIDDEN_INSTANCE_ID }),
    });

    // Either way, no findByExternalIdSmart was called (UUID path bypasses
    // the resolver). The handler-level checkInstanceAccess kicks in and
    // returns the standard VALIDATION error.
    expect(res.status).not.toBe(200);
    expect(calls.findByExternalIdSmart).toHaveLength(0);
  });

  test('unrestricted API key (instanceIds === null) still resolves normally', async () => {
    // The access check must be a no-op for unrestricted keys — otherwise
    // we'd break existing single-instance deployments that don't scope keys.
    const { app, calls } = mountHarness({
      apiKeyInstanceIds: null, // unrestricted — same as default
      apiKeyRow: { activeInstanceId: ACTIVE_INSTANCE_ID, contextInstanceId: null },
      resolvedChat: { id: RESOLVED_UUID },
    });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/messages`);

    expect(res.status).toBe(200);
    expect(calls.findByExternalIdSmart).toHaveLength(1);
    expect(calls.getChatMessages[0]?.chatId).toBe(RESOLVED_UUID);
  });

  test('scoped API key resolving WITHIN its allowed instance still works', async () => {
    // Sanity: the access check authorises legitimate within-scope traffic.
    const { app, calls } = mountHarness({
      apiKeyInstanceIds: [ALLOWED_INSTANCE_ID],
      resolvedChat: { id: RESOLVED_UUID },
    });

    await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: ALLOWED_INSTANCE_ID }),
    });

    // Route handlers may still 4xx for downstream reasons (channel not
    // wired, plugin missing) but the resolver and access check both
    // succeeded — findByExternalIdSmart was called with the allowed
    // instance, returned the resolved chat. Response status is irrelevant
    // here; the only invariant we pin is the resolver's call shape.
    expect(calls.findByExternalIdSmart).toEqual([{ instanceId: ALLOWED_INSTANCE_ID, externalId: WHATSAPP_GROUP_JID }]);
  });

  test('active-instance fallback ALSO honours the access check', async () => {
    // The active-instance was set via POST /context/use which itself
    // checks `instanceIds` at write time. But if the API key's instanceIds
    // CHANGED after context was set (rotation, scope tightening), the
    // stale active context would still be used by the resolver. The
    // checkInstanceAccess inside resolveChatIdParam catches that drift
    // too — defense in depth.
    const { app, calls } = mountHarness({
      apiKeyInstanceIds: [ALLOWED_INSTANCE_ID],
      // active context points at a now-forbidden instance (drift case).
      apiKeyRow: { activeInstanceId: FORBIDDEN_INSTANCE_ID, contextInstanceId: null },
      resolvedChat: { id: RESOLVED_UUID },
    });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/messages`);

    // Resolver must throw VALIDATION before findByExternalIdSmart runs.
    expect(res.status).not.toBe(200);
    expect(calls.findByExternalIdSmart).toHaveLength(0);
  });
});

describe('GET /chats/by-external — reachable, and scoped like the rest', () => {
  test('is not taken for a chat id by /:id', async () => {
    const { app, calls } = mountHarness({ resolvedChat: { id: RESOLVED_UUID } });

    const res = await app.request(
      `/chats/by-external?instanceId=${ALLOWED_INSTANCE_ID}&externalId=${encodeURIComponent(WHATSAPP_DM_JID)}`,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { id: RESOLVED_UUID } });
    expect(calls.findByExternalIdSmart).toEqual([{ instanceId: ALLOWED_INSTANCE_ID, externalId: WHATSAPP_DM_JID }]);
    expect(calls.getById).toHaveLength(0);
  });

  test('a key scoped to other instances is refused before any lookup', async () => {
    const { app, calls } = mountHarness({
      apiKeyInstanceIds: [ALLOWED_INSTANCE_ID],
      resolvedChat: { id: RESOLVED_UUID },
    });

    const res = await app.request(
      `/chats/by-external?instanceId=${FORBIDDEN_INSTANCE_ID}&externalId=${encodeURIComponent(WHATSAPP_DM_JID)}`,
    );

    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(404);
    expect(calls.findByExternalIdSmart).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// One resolution: the scope lock resolves `:id` for a key with an instance
// lock and hands the row to the route, which reads it instead of resolving
// again — so the lock and the route always name the same chat.
// ---------------------------------------------------------------------------

const LOCKED_INSTANCE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const LOCKED_CHAT_ID = '55555555-5555-4555-8555-555555555555';
const MISSING_CHAT_ID = '66666666-6666-4666-8666-666666666666';

interface LockedCalls {
  getChatMessages: string[];
  getById: string[];
  findByExternalIdSmart: Array<{ instanceId: string; externalId: string }>;
}

function chatKey(overrides: Partial<ApiKeyData> = {}): ApiKeyData {
  return {
    id: 'chat-key',
    name: `chat:${LOCKED_CHAT_ID}`,
    scopes: ['messages:send', 'chats:read', 'context:write', 'turns:close'],
    instanceIds: [LOCKED_INSTANCE_ID],
    expiresAt: null,
    profile: 'cs',
    chatAllowlist: [LOCKED_CHAT_ID, WHATSAPP_DM_JID],
    instanceAllowlist: [LOCKED_INSTANCE_ID],
    outboundRecipientAllowlist: [WHATSAPP_DM_JID],
    ...overrides,
  };
}

function mountLocked(
  key: ApiKeyData,
  contextInstanceId: string | null,
  handOver?: { raw: string; chatId: string },
): { app: Hono<{ Variables: AppVariables }>; calls: LockedCalls } {
  const calls: LockedCalls = { getChatMessages: [], getById: [], findByExternalIdSmart: [] };
  const row = { id: LOCKED_CHAT_ID, instanceId: LOCKED_INSTANCE_ID, externalId: WHATSAPP_DM_JID };
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('apiKey', key);
    c.set('db', {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ activeInstanceId: null, contextInstanceId }] }),
        }),
      }),
    } as never);
    c.set('services', {
      messages: {
        getChatMessages: mock(async (chatId: string) => {
          calls.getChatMessages.push(chatId);
          return [];
        }),
      },
      chats: {
        getById: mock(async (id: string) => {
          calls.getById.push(id);
          if (id !== LOCKED_CHAT_ID) throw new NotFoundError('Chat', id);
          return row;
        }),
        findByExternalIdSmart: mock(async (instanceId: string, externalId: string) => {
          calls.findByExternalIdSmart.push({ instanceId, externalId });
          return instanceId === LOCKED_INSTANCE_ID && externalId === WHATSAPP_DM_JID ? row : null;
        }),
        pin: mock(async () => row),
      },
      instances: {
        getById: mock(async (id: string) => ({ id, channel: 'whatsapp-baileys' })),
      },
    } as never);
    if (handOver) c.set('resolvedChat', { raw: handOver.raw, chat: { ...row, id: handOver.chatId } as never });
    await next();
  });
  if (!handOver) app.use('*', scopeEnforcerMiddleware);
  app.route('/chats', chatsRoutes);
  return { app, calls };
}

describe('chat key — /chats/:id/messages resolves once, in the lock', () => {
  test('a JID with a context instance inside the lock works and names the chat the lock resolved', async () => {
    const { app, calls } = mountLocked(chatKey(), LOCKED_INSTANCE_ID);

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_DM_JID)}/messages`);

    expect(res.status).toBe(200);
    // One lookup (the lock's); the route read the row it was handed.
    expect(calls.findByExternalIdSmart).toEqual([{ instanceId: LOCKED_INSTANCE_ID, externalId: WHATSAPP_DM_JID }]);
    expect(calls.getChatMessages).toEqual([LOCKED_CHAT_ID]);
  });

  test('a context instance outside the lock gets 403 before any lookup', async () => {
    const { app, calls } = mountLocked(chatKey(), FORBIDDEN_INSTANCE_ID);

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_DM_JID)}/messages`);

    expect(res.status).toBe(403);
    expect(calls.findByExternalIdSmart).toHaveLength(0);
    expect(calls.getChatMessages).toHaveLength(0);
  });

  test('history by UUID works without x-omni-instance', async () => {
    const { app, calls } = mountLocked(chatKey(), null);

    const res = await app.request(`/chats/${LOCKED_CHAT_ID}/messages`);

    expect(res.status).toBe(200);
    expect(calls.getChatMessages).toEqual([LOCKED_CHAT_ID]);
  });

  test('history fails closed when the row is missing', async () => {
    const { app, calls } = mountLocked(chatKey({ chatAllowlist: [MISSING_CHAT_ID, WHATSAPP_DM_JID] }), null);

    const res = await app.request(`/chats/${MISSING_CHAT_ID}/messages`);

    expect(res.status).toBe(403);
    expect(calls.getChatMessages).toHaveLength(0);
  });

  test("another chat's history is refused", async () => {
    const { app, calls } = mountLocked(chatKey(), LOCKED_INSTANCE_ID);

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/messages`);

    expect(res.status).toBe(403);
    expect(calls.getChatMessages).toHaveLength(0);
  });
});

describe('chat key — a chats.ts route with an explicit instanceId', () => {
  // A chat- and instance-locked key with chats:write and no recipient lock.
  const writer = () => chatKey({ scopes: ['chats:write'], outboundRecipientAllowlist: [] });

  test('the lock resolves the JID on the body instanceId, and the route reuses that row', async () => {
    const { app, calls } = mountLocked(writer(), FORBIDDEN_INSTANCE_ID);

    await app.request(`/chats/${encodeURIComponent(WHATSAPP_DM_JID)}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: LOCKED_INSTANCE_ID }),
    });

    expect(calls.findByExternalIdSmart).toEqual([{ instanceId: LOCKED_INSTANCE_ID, externalId: WHATSAPP_DM_JID }]);
  });

  test('a body instanceId outside the lock is refused before any lookup', async () => {
    const { app, calls } = mountLocked(writer(), LOCKED_INSTANCE_ID);

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_DM_JID)}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: FORBIDDEN_INSTANCE_ID }),
    });

    expect(res.status).toBe(403);
    expect(calls.findByExternalIdSmart).toHaveLength(0);
  });
});

describe('the route reads the row the lock handed over', () => {
  test('for the same raw id it does not resolve again', async () => {
    const handedId = '77777777-7777-4777-8777-777777777777';
    const { app, calls } = mountLocked(chatKey(), LOCKED_INSTANCE_ID, { raw: WHATSAPP_DM_JID, chatId: handedId });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_DM_JID)}/messages`);

    expect(res.status).toBe(200);
    expect(calls.findByExternalIdSmart).toHaveLength(0);
    expect(calls.getChatMessages).toEqual([handedId]);
  });

  test('for another raw id it resolves as before', async () => {
    const { app, calls } = mountLocked(chatKey(), LOCKED_INSTANCE_ID, { raw: WHATSAPP_GROUP_JID, chatId: VALID_UUID });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_DM_JID)}/messages`);

    expect(res.status).toBe(200);
    expect(calls.findByExternalIdSmart).toEqual([{ instanceId: LOCKED_INSTANCE_ID, externalId: WHATSAPP_DM_JID }]);
    expect(calls.getChatMessages).toEqual([LOCKED_CHAT_ID]);
  });
});

describe('a +json body (application/merge-patch+json) resolves as on the base', () => {
  test('an unlocked key: the route looks the JID up on the validated body instanceId', async () => {
    const { app, calls } = mountHarness({ apiKeyRow: null });

    const res = await app.request(`/chats/${encodeURIComponent(WHATSAPP_GROUP_JID)}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/merge-patch+json' },
      body: JSON.stringify({ instanceId: ACTIVE_INSTANCE_ID }),
    });

    expect(res.status).toBe(404);
    expect(calls.findByExternalIdSmart).toEqual([{ instanceId: ACTIVE_INSTANCE_ID, externalId: WHATSAPP_GROUP_JID }]);
  });

  test('an instance-locked key: a body instanceId outside the lock is refused before any lookup', async () => {
    const key = chatKey({ scopes: ['chats:write'], outboundRecipientAllowlist: [] });
    const { app, calls } = mountLocked(key, LOCKED_INSTANCE_ID);

    const res = await app.request(`/chats/${LOCKED_CHAT_ID}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/merge-patch+json' },
      body: JSON.stringify({ instanceId: FORBIDDEN_INSTANCE_ID }),
    });

    expect(res.status).toBe(403);
    expect(calls.getById).toHaveLength(0);
  });
});
