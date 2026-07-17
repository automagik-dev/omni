/**
 * API-key scope-ceiling enforcement (WISH omni-appkit-gap, Group 2 — HIGH-1).
 *
 * Threat: `console-admin` holds `keys:write`, so the scope-enforcer admits its
 * key-management writes. Without a ceiling it could create or update a key to
 * `scopes: ['*']` and use it → a one-hop god key, defeating the wish's core
 * promise that `console-admin` is BOUNDED and is NOT the god key.
 *
 * Contract:
 *   - A caller may only create or update a key whose scopes are a SUBSET of
 *     its own. For signed requests the grant must be covered by BOTH the bearer
 *     and signing-host scopes (their effective authorization intersection).
 *   - A concrete-scoped caller (e.g. `console-admin`) requesting `*`, a
 *     `namespace:*` super-scope it lacks, or any scope it does not hold → 403.
 *   - A `*`-scoped caller (real god key / `admin` profile) may still grant
 *     anything → 2xx (god-key / agent-provisioning unbroken).
 *   - The ceiling applies to the non-profile create branch (raw `scopes`), the
 *     profile create branch (resolved profile scopes), and PATCH updates, so a
 *     bounded caller cannot escalate through any key-management write path.
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

interface UpdatedKey {
  id: string;
  name?: string;
  scopes?: string[];
}

interface MountOptions {
  /** Simulate a verified signing host even when its scope context is missing. */
  signedBy?: string;
  /** Disable the general scope enforcer to exercise the route ceiling directly. */
  withScopeEnforcer?: boolean;
}

/**
 * Mount the real scope enforcer + real keys routes behind a caller key with the
 * given scopes. `profile: null` + empty allowlists means the enforcer's
 * profile-aware locks are inactive, so only scope + ceiling checks decide.
 */
function mount(
  callerScopes: string[],
  signedByScopes?: string[],
  options: MountOptions = {},
): {
  app: Hono<{ Variables: AppVariables }>;
  created: CreatedKey[];
  updated: UpdatedKey[];
} {
  const created: CreatedKey[] = [];
  const updated: UpdatedKey[] = [];
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('*', async (c, next) => {
    c.set('services', {
      apiKeys: {
        create: mock(async (options: CreatedKey) => {
          created.push(options);
          return { key: { id: 'k_1', ...options }, plainTextKey: 'omni_test_key' };
        }),
        update: mock(async (id: string, options: Omit<UpdatedKey, 'id'>) => {
          const row = { id, ...options };
          updated.push(row);
          return row;
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
    const signedBy = options.signedBy ?? (signedByScopes !== undefined ? 'test-host' : undefined);
    if (signedBy) {
      c.set('signedBy', signedBy);
    }
    if (signedByScopes !== undefined) {
      c.set('signedByScopes', signedByScopes);
    }
    await next();
  });
  if (options.withScopeEnforcer !== false) {
    app.use('*', scopeEnforcerMiddleware);
  }
  app.route('/keys', keysRoutes);

  return { app, created, updated };
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

async function patchKey(
  app: Hono<{ Variables: AppVariables }>,
  id: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await app.request(`/keys/${id}`, {
    method: 'PATCH',
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

    test('narrow signing-host scopes cap a wildcard bearer during create', async () => {
      const { app, created } = mount(['*'], ['keys:write']);

      const { status } = await postKey(app, { name: 'host-escalation', scopes: ['*'] });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('missing signing-host scope context fails closed in the route ceiling during create', async () => {
      const { app, created } = mount(['*'], undefined, {
        signedBy: 'test-host',
        withScopeEnforcer: false,
      });

      const { status, json } = await postKey(app, { name: 'missing-host-scopes', scopes: ['*'] });

      expect(status).toBe(403);
      expect((json as { error?: { code?: string } }).error?.code).toBe('FORBIDDEN');
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

describe('PATCH /keys/:id — update scope ceiling', () => {
  test('console-admin cannot update its own key to scopes: ["*"]', async () => {
    const { app, updated } = mount([...CONSOLE_ADMIN_SCOPES]);

    const { status, json } = await patchKey(app, 'minter', { scopes: ['*'] });

    expect(status).toBe(403);
    expect((json as { error?: { code?: string } }).error?.code).toBe('FORBIDDEN');
    expect(updated).toHaveLength(0);
  });

  test('narrow signing-host scopes cap a wildcard bearer during update', async () => {
    const { app, updated } = mount(['*'], ['keys:write']);

    const { status } = await patchKey(app, 'target', { scopes: ['*'] });

    expect(status).toBe(403);
    expect(updated).toHaveLength(0);
  });

  test('missing signing-host scope context fails closed in the route ceiling during update', async () => {
    const { app, updated } = mount(['*'], undefined, {
      signedBy: 'test-host',
      withScopeEnforcer: false,
    });

    const { status, json } = await patchKey(app, 'target', { scopes: ['*'] });

    expect(status).toBe(403);
    expect((json as { error?: { code?: string } }).error?.code).toBe('FORBIDDEN');
    expect(updated).toHaveLength(0);
  });

  test('bounded caller cannot update another key to a namespace super-scope it lacks', async () => {
    const { app, updated } = mount(['keys:write', 'instances:read']);

    const { status } = await patchKey(app, 'target', { scopes: ['instances:*'] });

    expect(status).toBe(403);
    expect(updated).toHaveLength(0);
  });

  test('bounded caller can update a key to a subset of its own scopes', async () => {
    const { app, updated } = mount(['keys:write', 'chats:read', 'chats:write']);

    const { status } = await patchKey(app, 'target', { scopes: ['chats:read'] });

    expect(status).toBe(200);
    expect(updated).toEqual([{ id: 'target', scopes: ['chats:read'] }]);
  });

  test('wildcard bearer can grant a scope covered by its narrowed signing host', async () => {
    const { app, updated } = mount(['*'], ['keys:write', 'chats:read']);

    const { status } = await patchKey(app, 'target', { scopes: ['chats:read'] });

    expect(status).toBe(200);
    expect(updated).toEqual([{ id: 'target', scopes: ['chats:read'] }]);
  });

  test('god key can update a key to scopes: ["*"]', async () => {
    const { app, updated } = mount(['*']);

    const { status } = await patchKey(app, 'target', { scopes: ['*'] });

    expect(status).toBe(200);
    expect(updated).toEqual([{ id: 'target', scopes: ['*'] }]);
  });

  test('metadata-only updates remain allowed for a keys:write caller', async () => {
    const { app, updated } = mount(['keys:write']);

    const { status } = await patchKey(app, 'target', { name: 'renamed-key' });

    expect(status).toBe(200);
    expect(updated).toEqual([{ id: 'target', name: 'renamed-key' }]);
  });
});
