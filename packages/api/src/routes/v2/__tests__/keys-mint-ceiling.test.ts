/**
 * Mint scope-ceiling enforcement (WISH omni-appkit-gap, Group 2 — HIGH-1).
 *
 * Threat: `console-admin` holds `keys:write`, so the scope-enforcer admits its
 * `POST /keys` calls. Without a ceiling it could mint a `scopes: ['*']` key and
 * use it → a one-hop god key, defeating the wish's core promise that
 * `console-admin` is BOUNDED and is NOT the god key.
 *
 * Contract:
 *   - A caller may only mint a key whose scopes are a SUBSET of its own.
 *   - A concrete-scoped caller (e.g. `console-admin`) requesting `*`, a
 *     `namespace:*` super-scope it lacks, or any scope it does not hold → 403.
 *   - A `*`-scoped caller (real god key / `admin` profile) may still mint
 *     anything → 2xx (god-key / agent-provisioning unbroken).
 *   - The ceiling applies to BOTH the non-profile branch (raw `scopes`) and the
 *     profile branch (resolved profile scopes), so a bounded caller can't
 *     escalate by requesting a broader profile than it holds.
 *
 * These tests mount the REAL `scopeEnforcerMiddleware` in front of the REAL
 * keys routes (the existing mint tests omit it — reviewer LOW-2), so the proof
 * runs through the same authorization path production uses.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { CONSOLE_ADMIN_SCOPES } from '../../../constants/profiles';
import { scopeEnforcerMiddleware } from '../../../middleware/scope-enforcer';
import type { AppVariables } from '../../../types';
import { keysRoutes } from '../keys';

interface CreatedKey {
  name: string;
  scopes: string[];
  profile?: string | null;
}

/**
 * Mount the real scope enforcer + real keys routes behind a caller key with the
 * given scopes. `profile: null` + empty allowlists means the enforcer's
 * profile-aware locks are inactive, so only scope + ceiling checks decide.
 */
function mount(callerScopes: string[]): { app: Hono<{ Variables: AppVariables }>; created: CreatedKey[] } {
  const created: CreatedKey[] = [];
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('*', async (c, next) => {
    c.set('services', {
      apiKeys: {
        create: mock(async (options: CreatedKey) => {
          created.push(options);
          return { key: { id: 'k_1', ...options }, plainTextKey: 'omni_test_key' };
        }),
      },
    } as never);
    c.set('apiKey', {
      id: 'minter',
      name: 'minter',
      scopes: callerScopes,
      instanceIds: null,
      expiresAt: null,
      profile: null,
      chatAllowlist: [],
      instanceAllowlist: [],
      outboundRecipientAllowlist: [],
    } as never);
    await next();
  });
  app.use('*', scopeEnforcerMiddleware);
  app.route('/keys', keysRoutes);

  return { app, created };
}

async function postKey(
  app: Hono<{ Variables: AppVariables }>,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await app.request('/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe('POST /keys — mint scope ceiling', () => {
  describe('bounded caller cannot escalate (non-profile branch)', () => {
    test('console-admin minting scopes: ["*"] is denied (403) — the god-key gap', async () => {
      const { app, created } = mount([...CONSOLE_ADMIN_SCOPES]);

      const { status, json } = await postKey(app, { name: 'sneaky-god', scopes: ['*'] });

      expect(status).toBe(403);
      expect((json as { error?: { code?: string } }).error?.code).toBe('FORBIDDEN');
      expect(created).toHaveLength(0);
    });

    test('console-admin minting a namespace super-scope it lacks (instances:*) is denied (403)', async () => {
      const { app, created } = mount([...CONSOLE_ADMIN_SCOPES]);

      const { status } = await postKey(app, { name: 'ns-super', scopes: ['instances:*'] });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('minting a concrete scope the caller does not hold is denied (403)', async () => {
      // Holds keys:write (passes the enforcer for POST /keys) + chats:read only.
      const { app, created } = mount(['keys:write', 'chats:read']);

      const { status } = await postKey(app, { name: 'over-reach', scopes: ['chats:read', 'instances:write'] });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('minting a subset of the caller’s own scopes succeeds (2xx)', async () => {
      const { app, created } = mount(['keys:write', 'chats:read', 'chats:write']);

      const { status } = await postKey(app, { name: 'bounded', scopes: ['chats:read', 'chats:write'] });

      expect(status).toBe(201);
      expect(created).toHaveLength(1);
      expect(created[0]?.scopes).toEqual(['chats:read', 'chats:write']);
    });
  });

  describe('bounded caller cannot escalate (profile branch)', () => {
    test('a keys:write-only caller cannot mint a broader profile (console-viewer) → 403', async () => {
      const { app, created } = mount(['keys:write']);

      const { status } = await postKey(app, { name: 'via-profile', profile: 'console-viewer' });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('console-admin CAN mint a console profile whose scopes it fully holds (console-admin) → 201', async () => {
      const { app, created } = mount([...CONSOLE_ADMIN_SCOPES]);

      const { status } = await postKey(app, { name: 'per-user-admin', profile: 'console-admin' });

      expect(status).toBe(201);
      expect(created).toHaveLength(1);
      expect(created[0]?.scopes).not.toContain('*');
    });
  });

  describe('god key is unbroken', () => {
    test('a *-scoped caller can still mint scopes: ["*"] (2xx)', async () => {
      const { app, created } = mount(['*']);

      const { status } = await postKey(app, { name: 'god', scopes: ['*'] });

      expect(status).toBe(201);
      expect(created).toHaveLength(1);
      expect(created[0]?.scopes).toEqual(['*']);
    });

    test('a *-scoped caller can still mint any profile (console-admin) (2xx)', async () => {
      const { app, created } = mount(['*']);

      const { status } = await postKey(app, { name: 'god-mints-console', profile: 'console-admin' });

      expect(status).toBe(201);
      expect(created).toHaveLength(1);
    });

    test('profile "admin" stays 403-blocked even with the enforcer mounted (guard fires pre-zod)', async () => {
      // Regression: the admin guard must fire even after the enforcer consumes
      // the request body. Uses c.req.json() (cached), not raw.clone().json().
      const { app, created } = mount(['*']);

      const { status, json } = await postKey(app, { name: 'god-key', profile: 'admin' });

      expect(status).toBe(403);
      expect((json as { error?: { code?: string } }).error?.code).toBe('FORBIDDEN');
      expect(created).toHaveLength(0);
    });
  });
});
