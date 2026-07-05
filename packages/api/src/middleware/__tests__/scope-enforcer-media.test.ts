/**
 * Instance-allowlist enforcement over GET /media/:instanceId/* (PR #770 LOW-9).
 *
 * Before this fix the scope enforcer extracted instance targets only from
 * /instances/ and /chats/ paths, so the media route was invisible to
 * instanceAllowlist: a broad media:read key could fetch ANY instance's media
 * (given a leaked messageId) while an allowlisted key was denied even its OWN
 * media (null target against a non-empty allowlist).
 *
 * Strategy mirrors scope-enforcer-host-scopes.test.ts: mount ONLY the scope
 * enforcer in front of a stub media route, pre-set `apiKey` on the context,
 * and assert status codes. No DB, no real media backend — this locks down the
 * authorization decision, while media-route.test.ts covers the serving.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ApiKeyData, AppVariables } from '../../types';
import { scopeEnforcerMiddleware } from '../scope-enforcer';

const OWN_INSTANCE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_INSTANCE = '99999999-8888-4777-8666-555555555555';

interface KeyOverrides {
  scopes?: string[];
  profile?: ApiKeyData['profile'];
  instanceAllowlist?: string[];
}

function mountWithKey(overrides: KeyOverrides = {}): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    const apiKey: ApiKeyData = {
      id: 'k-media',
      name: 'media-test',
      scopes: overrides.scopes ?? ['media:read'],
      instanceIds: null,
      expiresAt: null,
      profile: overrides.profile ?? null,
      chatAllowlist: [],
      instanceAllowlist: overrides.instanceAllowlist ?? [],
      outboundRecipientAllowlist: [],
    };
    c.set('apiKey', apiKey);
    await next();
  });
  app.use('*', scopeEnforcerMiddleware);
  // Stub the actual media handler — enforcement happens before it runs.
  app.get('/api/v2/media/:instanceId/*', (c) => c.json({ served: c.req.param('instanceId') }));
  app.post('/api/v2/media/tts', (c) => c.json({ ok: true }));
  return app;
}

function mediaPath(instanceId: string): string {
  return `/api/v2/media/${instanceId}/2026-07/msg-1.ogg`;
}

describe('scope-enforcer × GET /media/:instanceId/* (LOW-9)', () => {
  test('instance-allowlisted key CAN read its own instance media', async () => {
    const app = mountWithKey({ profile: 'personal', instanceAllowlist: [OWN_INSTANCE] });
    const res = await app.request(mediaPath(OWN_INSTANCE));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { served: string };
    expect(json.served).toBe(OWN_INSTANCE);
  });

  test('instance-allowlisted key CANNOT read another instance media', async () => {
    const app = mountWithKey({ profile: 'personal', instanceAllowlist: [OWN_INSTANCE] });
    const res = await app.request(mediaPath(OTHER_INSTANCE));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { lock: string; attempted: string } };
    expect(json.error.lock).toBe('instanceAllowlist');
    expect(json.error.attempted).toBe(OTHER_INSTANCE);
  });

  test('legacy allowlisted key (profile=null, non-empty list) is scoped the same way', async () => {
    const app = mountWithKey({ instanceAllowlist: [OWN_INSTANCE] });
    expect((await app.request(mediaPath(OWN_INSTANCE))).status).toBe(200);
    expect((await app.request(mediaPath(OTHER_INSTANCE))).status).toBe(403);
  });

  test('broad key (no allowlist) still reads any instance media', async () => {
    const app = mountWithKey();
    expect((await app.request(mediaPath(OWN_INSTANCE))).status).toBe(200);
    expect((await app.request(mediaPath(OTHER_INSTANCE))).status).toBe(200);
  });

  test('wildcard key without allowlist still reads any instance media', async () => {
    const app = mountWithKey({ scopes: ['*'] });
    expect((await app.request(mediaPath(OTHER_INSTANCE))).status).toBe(200);
  });

  test('legacy key still uses POST /media verbs (no instance lock, no regression)', async () => {
    const app = mountWithKey({ scopes: ['tts:synthesize'] });
    const res = await app.request('/api/v2/media/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(res.status).toBe(200);
  });

  test('POST /media verbs never treat the verb segment as an instance target', async () => {
    // Adversarial: if "tts" were extracted as the path instance, this absurd
    // allowlist would ALLOW the request. The GET-only gate keeps the target
    // null, so the active lock denies with attempted="" (missing target), not
    // attempted="tts".
    const app = mountWithKey({
      profile: 'personal',
      instanceAllowlist: ['tts'],
      scopes: ['tts:synthesize'],
    });
    const res = await app.request('/api/v2/media/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { lock: string; attempted: string } };
    expect(json.error.lock).toBe('instanceAllowlist');
    expect(json.error.attempted).toBe('');
  });
});
