/**
 * Unit tests for scope-enforcer primitives.
 *
 * These tests exercise the three allowlist checks and the route-target
 * extractor in isolation — no HTTP, no DB. The middleware body itself is
 * integration-tested via Group 5's QA wave.
 */

import { describe, expect, test } from 'bun:test';
import { NotFoundError } from '@omni/core';
import { Hono } from 'hono';
import { CS_CHILD_SCOPES } from '../../services/api-keys';
import type { ApiKeyData, AppVariables } from '../../types';
import {
  enforceAllowlist,
  enforceChatAllowlist,
  enforceInstanceAllowlist,
  enforceOutboundRecipientAllowlist,
  extractLockTargets,
  isLockActive,
  scopeEnforcerMiddleware,
} from '../scope-enforcer';

function mkKey(overrides: Partial<ApiKeyData> = {}): ApiKeyData {
  return {
    id: 'k1',
    name: 'test',
    scopes: ['*'],
    instanceIds: null,
    expiresAt: null,
    profile: null,
    chatAllowlist: [],
    instanceAllowlist: [],
    outboundRecipientAllowlist: [],
    ...overrides,
  };
}

describe('isLockActive — profile-aware empty-allowlist semantics', () => {
  test('legacy (profile=null) key with empty chat allowlist → inactive', () => {
    expect(isLockActive(null, 'chatAllowlist', [])).toBe(false);
  });

  test('legacy key with non-empty chat allowlist → active', () => {
    expect(isLockActive(null, 'chatAllowlist', ['chat-1'])).toBe(true);
  });

  test('cs profile with empty chat allowlist → active (deny-all)', () => {
    // cs requires chatAllowlist + instanceAllowlist
    expect(isLockActive('cs', 'chatAllowlist', [])).toBe(true);
    expect(isLockActive('cs', 'instanceAllowlist', [])).toBe(true);
  });

  test('cs profile with empty outbound recipient allowlist → inactive (not a required lock for cs)', () => {
    expect(isLockActive('cs', 'outboundRecipientAllowlist', [])).toBe(false);
  });

  test('scout profile with empty outbound recipient allowlist → active (deny-all)', () => {
    expect(isLockActive('scout', 'outboundRecipientAllowlist', [])).toBe(true);
  });

  test('personal profile (instance lock required) with empty chat allowlist → inactive', () => {
    expect(isLockActive('personal', 'chatAllowlist', [])).toBe(false);
    expect(isLockActive('personal', 'instanceAllowlist', [])).toBe(true);
  });

  test('admin profile with empty allowlists → inactive (admin has no requiresLocks)', () => {
    expect(isLockActive('admin', 'chatAllowlist', [])).toBe(false);
    expect(isLockActive('admin', 'instanceAllowlist', [])).toBe(false);
    expect(isLockActive('admin', 'outboundRecipientAllowlist', [])).toBe(false);
  });
});

describe('enforceAllowlist — generic allow/deny logic', () => {
  test('inactive lock → always allowed (no target check)', () => {
    const r = enforceAllowlist(null, 'chatAllowlist', [], null);
    expect(r.allowed).toBe(true);
  });

  test('non-empty list, target in list → allowed', () => {
    const r = enforceAllowlist(null, 'chatAllowlist', ['chat-1', 'chat-2'], 'chat-1');
    expect(r.allowed).toBe(true);
  });

  test('non-empty list, target missing from list → denied with reason not-in-allowlist', () => {
    const r = enforceAllowlist(null, 'chatAllowlist', ['chat-1'], 'chat-2');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not-in-allowlist');
    expect(r.attempted).toBe('chat-2');
  });

  test('non-empty list, target missing entirely → denied with empty attempted', () => {
    const r = enforceAllowlist(null, 'chatAllowlist', ['chat-1'], null);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not-in-allowlist');
  });

  test('profile key with requiresLocks + empty list + any target → denied with deny-all reason', () => {
    const r = enforceAllowlist('cs', 'chatAllowlist', [], 'some-chat');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('deny-all-profile-requires-lock');
    expect(r.attempted).toBe('some-chat');
  });
});

describe('enforceChatAllowlist — cs profile (allowlist required)', () => {
  test('cs-locked key: target chat in allowlist → allowed', () => {
    const key = mkKey({ profile: 'cs', chatAllowlist: ['chat-1'] });
    expect(enforceChatAllowlist(key, 'chat-1').allowed).toBe(true);
  });

  test('cs-locked key: target chat NOT in allowlist → denied with lock=chatAllowlist semantics', () => {
    const key = mkKey({ profile: 'cs', chatAllowlist: ['chat-1'] });
    const r = enforceChatAllowlist(key, 'chat-other');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not-in-allowlist');
    expect(r.attempted).toBe('chat-other');
  });

  test('cs-locked key with cleared allowlist → deny-all (not "no lock")', () => {
    const key = mkKey({ profile: 'cs', chatAllowlist: [] });
    const r = enforceChatAllowlist(key, 'chat-1');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('deny-all-profile-requires-lock');
  });

  test('legacy (profile=null) key with empty allowlist → allowed (no lock, backward compat)', () => {
    const key = mkKey({ profile: null, chatAllowlist: [] });
    const r = enforceChatAllowlist(key, 'chat-any');
    expect(r.allowed).toBe(true);
  });
});

describe('enforceInstanceAllowlist', () => {
  test('instance-locked key with matching instance → allowed', () => {
    const key = mkKey({ profile: 'personal', instanceAllowlist: ['inst-1'] });
    expect(enforceInstanceAllowlist(key, 'inst-1').allowed).toBe(true);
  });

  test('instance-locked key with non-matching instance → denied', () => {
    const key = mkKey({ profile: 'personal', instanceAllowlist: ['inst-1'] });
    const r = enforceInstanceAllowlist(key, 'inst-2');
    expect(r.allowed).toBe(false);
    expect(r.attempted).toBe('inst-2');
  });

  test('personal profile with cleared instance allowlist → deny-all', () => {
    const key = mkKey({ profile: 'personal', instanceAllowlist: [] });
    const r = enforceInstanceAllowlist(key, 'inst-1');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('deny-all-profile-requires-lock');
  });

  test('legacy key (profile=null) with empty instance allowlist → allowed', () => {
    const key = mkKey({ profile: null, instanceAllowlist: [] });
    expect(enforceInstanceAllowlist(key, 'inst-any').allowed).toBe(true);
  });
});

describe('enforceOutboundRecipientAllowlist — scout profile', () => {
  test('scout key: recipient in allowlist → allowed', () => {
    const key = mkKey({ profile: 'scout', outboundRecipientAllowlist: ['owner-jid'] });
    expect(enforceOutboundRecipientAllowlist(key, 'owner-jid').allowed).toBe(true);
  });

  test('scout key: recipient NOT in allowlist → denied', () => {
    const key = mkKey({ profile: 'scout', outboundRecipientAllowlist: ['owner-jid'] });
    const r = enforceOutboundRecipientAllowlist(key, 'other-jid');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not-in-allowlist');
    expect(r.attempted).toBe('other-jid');
  });

  test('scout key: cleared recipient allowlist → deny-all', () => {
    const key = mkKey({ profile: 'scout', outboundRecipientAllowlist: [] });
    const r = enforceOutboundRecipientAllowlist(key, 'owner-jid');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('deny-all-profile-requires-lock');
  });

  test('legacy key with empty recipient allowlist → allowed', () => {
    const key = mkKey({ profile: null, outboundRecipientAllowlist: [] });
    expect(enforceOutboundRecipientAllowlist(key, 'any-jid').allowed).toBe(true);
  });
});

describe('extractLockTargets — route & body target extraction', () => {
  test('POST /messages/send — body.to becomes recipient AND chat target', () => {
    const t = extractLockTargets('POST', '/api/v2/messages/send', {
      instanceId: 'inst-1',
      to: '5511999999999@s.whatsapp.net',
      text: 'hi',
    });
    expect(t.instance).toBe('inst-1');
    expect(t.recipient).toBe('5511999999999@s.whatsapp.net');
    expect(t.chat).toBe('5511999999999@s.whatsapp.net');
  });

  test('POST /messages/send/media — same extraction as /send', () => {
    const t = extractLockTargets('POST', '/api/v2/messages/send/media', {
      instanceId: 'inst-1',
      to: 'chat-jid',
      type: 'image',
      url: 'https://example.com/a.png',
    });
    expect(t.recipient).toBe('chat-jid');
  });

  test('PATCH /chats/:id — path param becomes chat target', () => {
    const t = extractLockTargets('PATCH', '/api/v2/chats/chat-abc', { name: 'renamed' });
    expect(t.chat).toBe('chat-abc');
    expect(t.recipient).toBeNull();
  });

  test('PATCH /instances/:id — path param becomes instance target', () => {
    const t = extractLockTargets('PATCH', '/api/v2/instances/inst-7', { status: 'active' });
    expect(t.instance).toBe('inst-7');
  });

  test('GET with no body — targets are null', () => {
    const t = extractLockTargets('GET', '/api/v2/messages', null);
    expect(t.instance).toBeNull();
    expect(t.chat).toBeNull();
    expect(t.recipient).toBeNull();
  });

  test('non-send route with `to` in body is treated as chat target, not recipient', () => {
    const t = extractLockTargets('POST', '/api/v2/something-else', { to: 'chat-x' });
    expect(t.recipient).toBeNull();
    expect(t.chat).toBe('chat-x');
  });

  test('empty string body fields are treated as missing', () => {
    const t = extractLockTargets('POST', '/api/v2/messages/send', { instanceId: '', to: '', text: 'x' });
    expect(t.instance).toBeNull();
    expect(t.recipient).toBeNull();
  });

  // ── Precedence: route-derived targets win over the body (scope-bypass guard) ──

  test('path instance wins over a conflicting body.instanceId (no body-injection bypass)', () => {
    const t = extractLockTargets('PATCH', '/api/v2/instances/real-inst', { instanceId: 'allowlisted-inst' });
    expect(t.instance).toBe('real-inst');
  });

  test('path chat wins over a conflicting body.chatId', () => {
    const t = extractLockTargets('PATCH', '/api/v2/chats/real-chat', { chatId: 'allowlisted-chat' });
    expect(t.chat).toBe('real-chat');
  });

  // ── Header-derived targets (x-omni-*) are extracted and rank above the body ──

  test('x-omni-instance / x-omni-chat headers become targets (header-scoped routes)', () => {
    const t = extractLockTargets('POST', '/api/v2/turns/close', null, {
      instance: 'hdr-inst',
      chat: 'hdr-chat',
    });
    expect(t.instance).toBe('hdr-inst');
    expect(t.chat).toBe('hdr-chat');
  });

  test('header target wins over a conflicting body target', () => {
    const t = extractLockTargets('POST', '/api/v2/turns/close', { instanceId: 'body-inst' }, { instance: 'hdr-inst' });
    expect(t.instance).toBe('hdr-inst');
  });

  test('outside POST /turns/close the x-omni-* headers are not targets', () => {
    const send = extractLockTargets(
      'POST',
      '/api/v2/messages/send',
      { instanceId: 'body-inst', to: 'other-jid', text: 'x' },
      { instance: 'hdr-inst', chat: 'own-jid' },
    );
    expect(send).toEqual({ instance: 'body-inst', chat: 'other-jid', recipient: 'other-jid', sourceChat: null });

    const history = extractLockTargets('GET', '/api/v2/chats/chat-1/messages', null, {
      instance: 'hdr-inst',
      chat: 'hdr-chat',
    });
    expect(history).toEqual({ instance: null, chat: 'chat-1', recipient: null, sourceChat: null });
  });

  test('a percent-encoded chat path param is decoded as the route decodes it', () => {
    const t = extractLockTargets('GET', '/api/v2/chats/120363425563375486%40g.us/messages', null);
    expect(t.chat).toBe('120363425563375486@g.us');
  });

  test('path target still wins over the header', () => {
    const t = extractLockTargets('PATCH', '/api/v2/instances/path-inst', null, { instance: 'hdr-inst' });
    expect(t.instance).toBe('path-inst');
  });

  // ── GET /media/:instanceId/* embeds the instance in the path (PR #770 LOW-9) ──

  test('GET /media/:instanceId/* — first path segment becomes the instance target', () => {
    const t = extractLockTargets('GET', '/api/v2/media/inst-9/2026-07/msg-1.ogg', null);
    expect(t.instance).toBe('inst-9');
    expect(t.chat).toBeNull();
    expect(t.recipient).toBeNull();
  });

  test('POST /media/tts — the verb segment is NOT treated as an instance target', () => {
    const t = extractLockTargets('POST', '/api/v2/media/tts', { text: 'hello' });
    expect(t.instance).toBeNull();
  });

  test('body is still used when neither path nor header supplies the target', () => {
    const t = extractLockTargets(
      'POST',
      '/api/v2/messages/send',
      { instanceId: 'body-inst', to: 'jid', text: 'x' },
      {},
    );
    expect(t.instance).toBe('body-inst');
  });
});

describe('Integration scenarios from wish acceptance criteria', () => {
  test('cs-locked key sending to a non-allowlisted chat → denied with lock=chatAllowlist', () => {
    const key = mkKey({
      profile: 'cs',
      chatAllowlist: ['locked-chat'],
      instanceAllowlist: ['locked-inst'],
    });
    const targets = extractLockTargets('POST', '/api/v2/messages/send', {
      instanceId: 'locked-inst',
      to: 'other-chat',
      text: 'hi',
    });
    expect(enforceInstanceAllowlist(key, targets.instance).allowed).toBe(true);
    const chatResult = enforceChatAllowlist(key, targets.chat);
    expect(chatResult.allowed).toBe(false);
    expect(chatResult.attempted).toBe('other-chat');
  });

  test('scout key sending to a non-owner recipient → denied with lock=outboundRecipientAllowlist', () => {
    const key = mkKey({
      profile: 'scout',
      outboundRecipientAllowlist: ['owner-jid'],
    });
    const targets = extractLockTargets('POST', '/api/v2/messages/send', {
      instanceId: 'inst-any',
      to: 'random-user',
      text: 'hi',
    });
    const r = enforceOutboundRecipientAllowlist(key, targets.recipient);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not-in-allowlist');
    expect(r.attempted).toBe('random-user');
  });

  test('request against instance not in instance_allowlist → denied with lock=instanceAllowlist', () => {
    const key = mkKey({
      profile: 'personal',
      instanceAllowlist: ['allowed-inst'],
    });
    const targets = extractLockTargets('PATCH', '/api/v2/instances/other-inst', { status: 'connected' });
    const r = enforceInstanceAllowlist(key, targets.instance);
    expect(r.allowed).toBe(false);
    expect(r.attempted).toBe('other-inst');
  });

  test('instance-allowlisted key CAN read its own media and CANNOT read another instance media (LOW-9)', () => {
    const key = mkKey({ profile: 'personal', instanceAllowlist: ['inst-own'] });

    const own = extractLockTargets('GET', '/api/v2/media/inst-own/2026-07/msg-1.jpg', null);
    expect(enforceInstanceAllowlist(key, own.instance).allowed).toBe(true);

    const other = extractLockTargets('GET', '/api/v2/media/inst-other/2026-07/msg-2.jpg', null);
    const denied = enforceInstanceAllowlist(key, other.instance);
    expect(denied.allowed).toBe(false);
    expect(denied.attempted).toBe('inst-other');
  });
});

// ============================================================================
// Through the middleware: a chat key (a `cs` child locked to one chat)
// ============================================================================

const OWN_INSTANCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_INSTANCE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWN_CHAT = '11111111-1111-4111-8111-111111111111';
const OTHER_CHAT = '22222222-2222-4222-8222-222222222222';
const FOREIGN_CHAT = '33333333-3333-4333-8333-333333333333';
const MISSING_CHAT = '44444444-4444-4444-8444-444444444444';
const OWN_JID = '5511999990000@s.whatsapp.net';
const OTHER_JID = '5511888880000@s.whatsapp.net';

interface ChatRow {
  id: string;
  instanceId: string;
  externalId: string;
}

/** OWN and OTHER live on the key's instance; FOREIGN carries the same JID on another instance. */
const CHAT_ROWS: ChatRow[] = [
  { id: OWN_CHAT, instanceId: OWN_INSTANCE, externalId: OWN_JID },
  { id: OTHER_CHAT, instanceId: OWN_INSTANCE, externalId: OTHER_JID },
  { id: FOREIGN_CHAT, instanceId: OTHER_INSTANCE, externalId: OWN_JID },
];

function chatKey(overrides: Partial<ApiKeyData> = {}): ApiKeyData {
  return mkKey({
    id: 'child-key',
    name: `chat:${OWN_CHAT}`,
    scopes: [...CS_CHILD_SCOPES],
    instanceIds: [OWN_INSTANCE],
    profile: 'cs',
    chatAllowlist: [OWN_CHAT, OWN_JID],
    instanceAllowlist: [OWN_INSTANCE],
    outboundRecipientAllowlist: [OWN_JID],
    ...overrides,
  });
}

interface LockHarness {
  app: Hono<{ Variables: AppVariables }>;
  lookups: { byId: string[]; byExternal: Array<{ instanceId: string; externalId: string }> };
}

/** Mounts only the scope lock in front of a stub handler that echoes the chat the lock handed over. */
function mountLock(key: ApiKeyData, contextInstanceId: string | null = null): LockHarness {
  const lookups: LockHarness['lookups'] = { byId: [], byExternal: [] };
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('apiKey', key);
    c.set('db', {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ activeInstanceId: null, contextInstanceId }],
          }),
        }),
      }),
    } as never);
    c.set('services', {
      chats: {
        getById: async (id: string) => {
          lookups.byId.push(id);
          const row = CHAT_ROWS.find((r) => r.id === id);
          if (!row) throw new NotFoundError('Chat', id);
          return row;
        },
        findByExternalIdSmart: async (instanceId: string, externalId: string) => {
          lookups.byExternal.push({ instanceId, externalId });
          return CHAT_ROWS.find((r) => r.instanceId === instanceId && r.externalId === externalId) ?? null;
        },
      },
    } as never);
    await next();
  });
  app.use('*', scopeEnforcerMiddleware);
  app.all('/api/v2/*', (c) => c.json({ ok: true, resolved: c.get('resolvedChat')?.chat.id ?? null }));
  return { app, lookups };
}

function call(
  app: Hono<{ Variables: AppVariables }>,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return app.request(`/api/v2${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json', ...headers } : headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function errorOf(res: Response): Promise<Record<string, unknown>> {
  return ((await res.json()) as { error: Record<string, unknown> }).error;
}

describe('chat key — sends stay in its own chat', () => {
  test('a send to its own chat passes', async () => {
    const { app } = mountLock(chatKey());
    const res = await call(app, 'POST', '/messages/send', { instanceId: OWN_INSTANCE, to: OWN_JID, text: 'hi' });
    expect(res.status).toBe(200);
  });

  test('a send to another chat is refused', async () => {
    const { app } = mountLock(chatKey());
    const res = await call(app, 'POST', '/messages/send', { instanceId: OWN_INSTANCE, to: OTHER_JID, text: 'hi' });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'chatAllowlist', attempted: OTHER_JID });
  });

  test('x-omni-chat naming its own chat does not open a send to another chat', async () => {
    const { app } = mountLock(chatKey());
    const res = await call(
      app,
      'POST',
      '/messages/send',
      { instanceId: OWN_INSTANCE, to: OTHER_JID, text: 'hi' },
      { 'x-omni-chat': OWN_JID },
    );
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'chatAllowlist', attempted: OTHER_JID });
  });

  test('x-omni-instance naming its own instance while body instanceId is another is refused, naming the header', async () => {
    const { app } = mountLock(chatKey());
    const res = await call(
      app,
      'POST',
      '/messages/send',
      { instanceId: OTHER_INSTANCE, to: OWN_JID, text: 'hi' },
      { 'x-omni-instance': OWN_INSTANCE },
    );
    expect(res.status).toBe(403);
    const error = await errorOf(res);
    expect(error).toMatchObject({ code: 'FORBIDDEN', header: 'x-omni-instance', attempted: OWN_INSTANCE });
    expect(String(error.message)).toContain('x-omni-instance');
  });

  test('an x-omni-instance that differs from the body is refused for an unlocked key too', async () => {
    const { app } = mountLock(mkKey({ scopes: ['messages:send'] }));
    const res = await call(
      app,
      'POST',
      '/messages/send',
      { instanceId: OTHER_INSTANCE, to: OWN_JID, text: 'hi' },
      { 'x-omni-instance': OWN_INSTANCE },
    );
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ header: 'x-omni-instance' });
  });

  test('an x-omni-instance that matches the body passes', async () => {
    const { app } = mountLock(chatKey());
    const res = await call(
      app,
      'POST',
      '/messages/send',
      { instanceId: OWN_INSTANCE, to: OWN_JID, text: 'hi' },
      { 'x-omni-instance': OWN_INSTANCE },
    );
    expect(res.status).toBe(200);
  });

  test('a reaction to another chat is refused', async () => {
    const { app } = mountLock(chatKey());
    const res = await call(app, 'POST', '/messages/send/reaction', {
      instanceId: OWN_INSTANCE,
      to: OTHER_JID,
      messageId: 'MSG-1',
      emoji: '👍',
    });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'chatAllowlist', attempted: OTHER_JID });
  });

  test('a forward from another chat into its own chat is refused', async () => {
    const { app } = mountLock(chatKey());
    const res = await call(app, 'POST', '/messages/send/forward', {
      instanceId: OWN_INSTANCE,
      to: OWN_JID,
      messageId: 'MSG-1',
      fromChatId: OTHER_JID,
    });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'chatAllowlist', attempted: OTHER_JID });
  });

  test('a forward inside its own chat passes', async () => {
    const { app } = mountLock(chatKey());
    const res = await call(app, 'POST', '/messages/send/forward', {
      instanceId: OWN_INSTANCE,
      to: OWN_JID,
      messageId: 'MSG-1',
      fromChatId: OWN_JID,
    });
    expect(res.status).toBe(200);
  });

  test('/messages/delete-channel is refused', async () => {
    const { app } = mountLock(chatKey());
    const res = await call(app, 'POST', '/messages/delete-channel', {
      instanceId: OWN_INSTANCE,
      channelId: OWN_JID,
      messageId: 'MSG-1',
    });
    expect(res.status).toBe(403);
  });

  test('media reads are refused: GET /media/*, POST /media/vision, POST /messages/media/download', async () => {
    const { app } = mountLock(chatKey());
    expect((await call(app, 'GET', `/media/${OWN_INSTANCE}/2026-07/msg-1.jpg`)).status).toBe(403);
    expect((await call(app, 'POST', '/media/vision', { url: 'https://example.com/a.png' })).status).toBe(403);
    expect((await call(app, 'POST', '/messages/media/download', { messageId: OWN_CHAT })).status).toBe(403);
  });
});

describe('chat key — the recipient lock binds what it delivers, not what it reads', () => {
  test('a non-delivering route (history, turn close) needs no recipient for a chat-locked key', async () => {
    const { app } = mountLock(chatKey());
    expect((await call(app, 'GET', `/chats/${OWN_CHAT}/messages`)).status).toBe(200);
    const close = await call(
      app,
      'POST',
      '/turns/close',
      { action: 'message' },
      { 'x-omni-instance': OWN_INSTANCE, 'x-omni-chat': OWN_JID },
    );
    expect(close.status).toBe(200);
  });

  test('a delivering route without a recipient stays refused for it', async () => {
    const { app } = mountLock(chatKey({ scopes: ['chats:write'] }));
    const res = await call(app, 'POST', `/chats/${OWN_CHAT}/pin`, { instanceId: OWN_INSTANCE });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'outboundRecipientAllowlist' });
  });

  test('a read outside the named routes (POST /messages/media/download) keeps the recipient lock', async () => {
    const { app } = mountLock(chatKey({ scopes: [...CS_CHILD_SCOPES, 'messages:read'] }));
    // Own instance and chat in the body pass those locks; the route would read `messageId`, any chat's message.
    const res = await call(app, 'POST', '/messages/media/download', {
      instanceId: OWN_INSTANCE,
      chatId: OWN_CHAT,
      messageId: OTHER_CHAT,
    });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'outboundRecipientAllowlist' });
  });

  test('the static GET /chats/by-external is not one of them', async () => {
    const { app } = mountLock(chatKey());
    const res = await call(app, 'GET', `/chats/by-external?instanceId=${OWN_INSTANCE}&externalId=${OWN_JID}`);
    expect(res.status).toBe(403);
  });

  test('a recipient-locked key without a chat lock (scout) is unchanged: no recipient, no route', async () => {
    const scout = mkKey({ scopes: ['chats:read'], profile: 'scout', outboundRecipientAllowlist: [OWN_JID] });
    const { app } = mountLock(scout, OWN_INSTANCE);
    const res = await call(app, 'GET', `/chats/${OWN_CHAT}/messages`);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'outboundRecipientAllowlist' });
  });
});

describe('chat key — POST /keys/children/self/revoke is the one route past the locks', () => {
  test('a cs child with its locks set reaches the self-revoke route', async () => {
    const { app } = mountLock(chatKey());
    expect((await call(app, 'POST', '/keys/children/self/revoke')).status).toBe(200);
    // A body naming another chat changes nothing: the route names no target.
    const withBody = await call(app, 'POST', '/keys/children/self/revoke', { chatId: OTHER_CHAT, to: OTHER_JID });
    expect(withBody.status).toBe(200);
  });

  test('the scope check still runs first: no chats:read, no route', async () => {
    const { app } = mountLock(chatKey({ scopes: ['messages:send'] }));
    const res = await call(app, 'POST', '/keys/children/self/revoke');
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ message: 'Insufficient permissions. Required scope: chats:read' });
  });

  test('no other route skips the allowlist checks, even for a key whose scopes reach every route', async () => {
    // '*' passes every scope check, so only the locks can refuse these.
    const { app } = mountLock(chatKey({ scopes: ['*'] }));
    expect((await call(app, 'POST', '/keys/children/self/revoke')).status).toBe(200);
    for (const [method, path] of [
      ['POST', '/keys/children/self/revoke/x'],
      ['POST', '/keys/children/self/revoke/'],
      ['POST', '/keys/children/self'],
      ['GET', '/keys/children/self/revoke'],
      ['DELETE', '/keys/children/self/revoke'],
      ['POST', '/keys/children/child-key/revoke'],
      ['POST', '/keys/children'],
      ['POST', '/keys/child-key/revoke'],
      ['POST', '/x/keys/children/self/revoke'],
    ] as const) {
      const res = await call(app, method, path);
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 403 });
      expect(await errorOf(res)).toHaveProperty('lock');
    }
    const send = await call(app, 'POST', '/messages/send', { instanceId: OWN_INSTANCE, to: OTHER_JID, text: 'hi' });
    expect(send.status).toBe(403);
  });
});

describe('the lock reads every body the route validator reads (application/*+json)', () => {
  const MERGE_PATCH = { 'content-type': 'application/merge-patch+json' };

  test('a +json body naming an instance outside the lock is refused on a chat route', async () => {
    const key = mkKey({ scopes: ['chats:write'], profile: 'personal', instanceAllowlist: [OWN_INSTANCE] });
    const { app } = mountLock(key);
    const res = await call(app, 'POST', `/chats/${OWN_CHAT}/pin`, { instanceId: OTHER_INSTANCE }, MERGE_PATCH);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'instanceAllowlist', attempted: OTHER_INSTANCE });
  });

  test('a +json send naming an instance outside the lock is refused', async () => {
    const { app } = mountLock(chatKey());
    const res = await call(
      app,
      'POST',
      '/messages/send',
      { instanceId: OTHER_INSTANCE, to: OWN_JID, text: 'hi' },
      MERGE_PATCH,
    );
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'instanceAllowlist', attempted: OTHER_INSTANCE });
  });

  test('a body the lock cannot read on a chat route is refused for an instance-locked key', async () => {
    const key = mkKey({ scopes: ['chats:write'], profile: 'personal', instanceAllowlist: [OWN_INSTANCE] });
    const { app } = mountLock(key);
    const res = await app.request(`/api/v2/chats/${OWN_CHAT}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ instanceId: OTHER_INSTANCE }),
    });
    expect(res.status).toBe(403);
  });

  test('an empty body that still names a content type is no unread body', async () => {
    const key = mkKey({ scopes: ['chats:write'], profile: 'personal', instanceAllowlist: [OWN_INSTANCE] });
    const { app } = mountLock(key);
    const res = await app.request(`/api/v2/chats/${OWN_CHAT}/hide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '0' },
    });
    expect(res.status).toBe(200);
  });
});

describe('chat key — POST /turns/close keeps its header targets', () => {
  test('headers naming its own instance and chat pass (omni done)', async () => {
    const { app } = mountLock(chatKey());
    const res = await call(
      app,
      'POST',
      '/turns/close',
      { action: 'message' },
      { 'x-omni-instance': OWN_INSTANCE, 'x-omni-chat': OWN_JID },
    );
    expect(res.status).toBe(200);
  });

  test('a header naming another chat is still refused there', async () => {
    const { app } = mountLock(chatKey());
    const res = await call(
      app,
      'POST',
      '/turns/close',
      { action: 'message' },
      { 'x-omni-instance': OWN_INSTANCE, 'x-omni-chat': OTHER_JID },
    );
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'chatAllowlist', attempted: OTHER_JID });
  });
});

describe('chat key — /chats/:id/* resolves the chat as the route does', () => {
  test('history by UUID works without x-omni-instance and hands the row to the route', async () => {
    const { app, lookups } = mountLock(chatKey());
    const res = await call(app, 'GET', `/chats/${OWN_CHAT}/messages`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { resolved: string }).resolved).toBe(OWN_CHAT);
    expect(lookups.byId).toEqual([OWN_CHAT]);
  });

  test("another chat's history is refused", async () => {
    const { app } = mountLock(chatKey());
    const res = await call(app, 'GET', `/chats/${OTHER_CHAT}/messages`);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'chatAllowlist', attempted: OTHER_CHAT });
  });

  test('an id with no row fails closed', async () => {
    const { app } = mountLock(chatKey({ chatAllowlist: [MISSING_CHAT, OWN_JID] }));
    const res = await call(app, 'GET', `/chats/${MISSING_CHAT}/messages`);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'chatAllowlist', attempted: MISSING_CHAT });
  });

  test('a UUID row on another instance is refused the same way as a missing one', async () => {
    const { app } = mountLock(chatKey({ chatAllowlist: [FOREIGN_CHAT, OWN_JID] }));
    const res = await call(app, 'GET', `/chats/${FOREIGN_CHAT}/messages`);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'chatAllowlist', attempted: FOREIGN_CHAT });
  });

  test('a JID with a context instance inside the lock resolves on it', async () => {
    const { app, lookups } = mountLock(chatKey(), OWN_INSTANCE);
    const res = await call(app, 'GET', `/chats/${encodeURIComponent(OWN_JID)}/messages`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { resolved: string }).resolved).toBe(OWN_CHAT);
    expect(lookups.byExternal).toEqual([{ instanceId: OWN_INSTANCE, externalId: OWN_JID }]);
  });

  test('a JID with a context instance outside the lock is refused before any lookup', async () => {
    const { app, lookups } = mountLock(chatKey(), OTHER_INSTANCE);
    const res = await call(app, 'GET', `/chats/${encodeURIComponent(OWN_JID)}/messages`);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'instanceAllowlist', attempted: OTHER_INSTANCE });
    expect(lookups.byExternal).toHaveLength(0);
  });

  test('a JID with no instance to look it up on fails closed', async () => {
    const { app, lookups } = mountLock(chatKey(), null);
    const res = await call(app, 'GET', `/chats/${encodeURIComponent(OWN_JID)}/messages`);
    expect(res.status).toBe(403);
    expect(lookups.byExternal).toHaveLength(0);
  });

  test('another chat by JID is refused', async () => {
    const { app } = mountLock(chatKey(), OWN_INSTANCE);
    const res = await call(app, 'GET', `/chats/${encodeURIComponent(OTHER_JID)}/messages`);
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'chatAllowlist' });
  });

  test("a route's explicit body instanceId inside the lock is the one the JID is looked up on", async () => {
    const key = chatKey({ scopes: ['chats:write'], outboundRecipientAllowlist: [] });
    const { app, lookups } = mountLock(key, OTHER_INSTANCE);
    const res = await call(app, 'POST', `/chats/${encodeURIComponent(OWN_JID)}/pin`, { instanceId: OWN_INSTANCE });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { resolved: string }).resolved).toBe(OWN_CHAT);
    expect(lookups.byExternal).toEqual([{ instanceId: OWN_INSTANCE, externalId: OWN_JID }]);
  });

  test("a route's explicit body instanceId outside the lock is refused before any lookup", async () => {
    const key = chatKey({ scopes: ['chats:write'], outboundRecipientAllowlist: [] });
    const { app, lookups } = mountLock(key, OWN_INSTANCE);
    const res = await call(app, 'POST', `/chats/${encodeURIComponent(OWN_JID)}/pin`, { instanceId: OTHER_INSTANCE });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'instanceAllowlist', attempted: OTHER_INSTANCE });
    expect(lookups.byExternal).toHaveLength(0);
  });

  test('a body instanceId outside the lock is refused on a UUID too', async () => {
    const key = chatKey({ scopes: ['chats:write'], outboundRecipientAllowlist: [] });
    const { app } = mountLock(key);
    const res = await call(app, 'POST', `/chats/${OWN_CHAT}/pin`, { instanceId: OTHER_INSTANCE });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ lock: 'instanceAllowlist', attempted: OTHER_INSTANCE });
  });

  test("an x-omni-instance other than the chat row's instance is refused, naming the header", async () => {
    const { app } = mountLock(chatKey());
    const res = await call(app, 'GET', `/chats/${OWN_CHAT}/messages`, undefined, {
      'x-omni-instance': OTHER_INSTANCE,
    });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ header: 'x-omni-instance', attempted: OTHER_INSTANCE });
  });

  test('the static /chats/* routes are not resolved as a chat id', async () => {
    const { app, lookups } = mountLock(chatKey());
    const res = await call(app, 'GET', `/chats/by-external?instanceId=${OWN_INSTANCE}&externalId=${OWN_JID}`);
    expect(res.status).toBe(403);
    expect(lookups.byId).toHaveLength(0);
    expect(lookups.byExternal).toHaveLength(0);
  });

  test('a key without an instance lock is left to the route (no lookup in the lock)', async () => {
    const { app, lookups } = mountLock(mkKey({ scopes: ['chats:read'] }), OWN_INSTANCE);
    const res = await call(app, 'GET', `/chats/${encodeURIComponent(OWN_JID)}/messages`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { resolved: string | null }).resolved).toBeNull();
    expect(lookups.byExternal).toHaveLength(0);
  });

  test('an instance-locked key without a chat lock reaches any chat on its instance', async () => {
    const key = mkKey({ scopes: ['chats:read'], profile: 'personal', instanceAllowlist: [OWN_INSTANCE] });
    const { app } = mountLock(key, OWN_INSTANCE);
    const own = await call(app, 'GET', `/chats/${encodeURIComponent(OTHER_JID)}/messages`);
    expect(own.status).toBe(200);
    expect(((await own.json()) as { resolved: string }).resolved).toBe(OTHER_CHAT);
    expect((await call(app, 'GET', `/chats/${FOREIGN_CHAT}/messages`)).status).toBe(403);
  });
});
