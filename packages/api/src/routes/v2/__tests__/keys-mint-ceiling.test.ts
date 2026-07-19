/**
 * API-key authority-ceiling enforcement (WISH omni-appkit-gap, Group 2 — HIGH-1).
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
 *   - Instance access is bounded on every enforcement surface: route-specific
 *     legacy `instanceIds`, profile-aware `instanceAllowlist`, and routes where
 *     both restrictions intersect. The ceiling also accounts for historical
 *     routes that treat an empty legacy list as inactive. Unrestricted
 *     authority, contradictory restrictions, malformed context, and UUID case
 *     differences must not bypass any ceiling.
 *
 * These tests mount the REAL `scopeEnforcerMiddleware` in front of the REAL
 * keys routes (the existing mint tests omit it — reviewer LOW-2), so the proof
 * runs through the same authorization path production uses.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { ApiKey } from '@omni/db';
import { Hono } from 'hono';
import { CONSOLE_ADMIN_SCOPES } from '../../../constants/profiles';
import { scopeEnforcerMiddleware } from '../../../middleware/scope-enforcer';
import type { ApiKeyAuthorityGuard, UpdateApiKeyOptions } from '../../../services/api-keys';
import type { ApiKeyData, AppVariables } from '../../../types';
import { keysRoutes } from '../keys';

const INSTANCE_A = '11111111-1111-4111-8111-111111111111';
const INSTANCE_B = '22222222-2222-4222-8222-222222222222';
const INSTANCE_CASED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface CreatedKey {
  name: string;
  scopes: string[];
  profile?: string | null;
  instanceIds?: string[];
  instanceAllowlist?: string[];
}

interface UpdatedKey {
  id: string;
  name?: string;
  scopes?: string[];
  instanceIds?: string[] | null;
}

interface MountOptions {
  /** Simulate a verified signing host even when its scope context is missing. */
  signedBy?: string;
  /** Disable the general scope enforcer to exercise the route ceiling directly. */
  withScopeEnforcer?: boolean;
  /** Legacy instance-access ceiling carried by the authenticated caller. */
  callerInstanceIds?: string[] | null;
  /** Profile whose lock semantics apply to the authenticated caller. */
  callerProfile?: ApiKeyData['profile'];
  /** Profile-aware instance ceiling carried by the authenticated caller. */
  callerInstanceAllowlist?: string[];
  /** Simulate malformed runtime context with the caller profile missing. */
  omitCallerProfile?: boolean;
  /** Simulate malformed runtime context with the caller instance allowlist missing. */
  omitCallerInstanceAllowlist?: boolean;
  /** Persisted target scopes retained when PATCH omits scopes. */
  targetScopes?: string[];
  /** Persisted target profile used to derive post-PATCH effective authority. */
  targetProfile?: ApiKeyData['profile'];
  /** Persisted target legacy restriction used when PATCH omits instanceIds. */
  targetInstanceIds?: string[] | null;
  /** Persisted target profile-aware restriction retained across PATCH. */
  targetInstanceAllowlist?: string[];
}

/**
 * Mount the real scope enforcer + real keys routes behind a caller key with the
 * given scopes. `profile: null` + empty allowlists means the enforcer's
 * profile-aware locks are inactive, so only scope + ceiling checks decide.
 */
function mount(
  callerScopes: string[],
  signedByScopes?: string[] | null,
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
        updateWithAuthorityGuard: mock(
          async (id: string, updateOptions: UpdateApiKeyOptions, guard: ApiKeyAuthorityGuard) => {
            const current = {
              id,
              name: 'target',
              scopes: options.targetScopes ?? ['keys:write'],
              instanceIds: options.targetInstanceIds ?? null,
              profile: options.targetProfile ?? null,
              instanceAllowlist: options.targetInstanceAllowlist ?? [],
            } as ApiKey;
            const next = { ...current, ...updateOptions } as ApiKey;
            if (!(await guard(current, next))) return { status: 'denied' as const };

            const row = { id, ...updateOptions } as UpdatedKey;
            updated.push(row);
            return { status: 'updated' as const, key: next };
          },
        ),
        getById: mock(async (id: string) => ({
          id,
          name: 'target',
          scopes: options.targetScopes ?? ['keys:write'],
          instanceIds: options.targetInstanceIds ?? null,
          expiresAt: null,
          profile: options.targetProfile ?? null,
          chatAllowlist: [],
          instanceAllowlist: options.targetInstanceAllowlist ?? [],
          outboundRecipientAllowlist: [],
        })),
      },
    } as never);
    c.set('apiKey', {
      id: 'minter',
      name: 'minter',
      scopes: callerScopes,
      instanceIds: options.callerInstanceIds ?? null,
      expiresAt: null,
      profile: options.omitCallerProfile ? undefined : (options.callerProfile ?? null),
      chatAllowlist: [],
      instanceAllowlist: options.omitCallerInstanceAllowlist ? undefined : (options.callerInstanceAllowlist ?? []),
      outboundRecipientAllowlist: [],
    } as never);
    const signedBy = options.signedBy ?? (signedByScopes !== undefined ? 'test-host' : undefined);
    if (signedBy) {
      c.set('signedBy', signedBy);
    }
    if (signedByScopes !== undefined) {
      c.set('signedByScopes', signedByScopes as never);
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

    test('null signing-host scope context fails closed in the route ceiling during create', async () => {
      const { app, created } = mount(['*'], null, {
        signedBy: 'test-host',
        withScopeEnforcer: false,
      });

      const { status, json } = await postKey(app, { name: 'null-host-scopes', scopes: ['*'] });

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

  describe('instance access ceiling', () => {
    test('instanceAllowlist-restricted caller cannot mint an unrestricted legacy key', async () => {
      const { app, created } = mount(['*'], undefined, {
        callerProfile: 'personal',
        callerInstanceAllowlist: [INSTANCE_A],
        withScopeEnforcer: false,
      });

      const { status, json } = await postKey(app, { name: 'unrestricted-child', scopes: ['*'] });

      expect(status).toBe(403);
      expect((json as { error?: { code?: string } }).error?.code).toBe('FORBIDDEN');
      expect(created).toHaveLength(0);
    });

    test('instanceAllowlist-restricted caller cannot mint a profile key for another instance', async () => {
      const { app, created } = mount(['*'], undefined, {
        callerProfile: 'personal',
        callerInstanceAllowlist: [INSTANCE_A],
        withScopeEnforcer: false,
      });

      const { status } = await postKey(app, {
        name: 'cross-instance-child',
        profile: 'personal',
        instanceAllowlist: [INSTANCE_B],
      });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('instanceAllowlist-restricted caller can mint a profile key for its own instance', async () => {
      const { app, created } = mount(['*'], undefined, {
        callerProfile: 'personal',
        callerInstanceAllowlist: [INSTANCE_A],
        withScopeEnforcer: false,
      });

      const { status } = await postKey(app, {
        name: 'same-instance-child',
        profile: 'personal',
        instanceAllowlist: [INSTANCE_A],
      });

      expect(status).toBe(201);
      expect(created).toHaveLength(1);
      expect(created[0]?.instanceAllowlist).toEqual([INSTANCE_A]);
    });

    test('caller authority is the intersection of instanceIds and instanceAllowlist', async () => {
      const { app, created } = mount(['*'], undefined, {
        callerInstanceIds: [INSTANCE_A, INSTANCE_B],
        callerProfile: 'personal',
        callerInstanceAllowlist: [INSTANCE_A],
        withScopeEnforcer: false,
      });

      const { status } = await postKey(app, {
        name: 'outside-effective-intersection',
        scopes: ['*'],
        instanceIds: [INSTANCE_B],
      });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('contradictory child restrictions cannot hide broader profile authority behind an empty intersection', async () => {
      const { app, created } = mount(['*'], undefined, {
        callerInstanceIds: [INSTANCE_A, INSTANCE_B],
        callerProfile: 'personal',
        callerInstanceAllowlist: [INSTANCE_A],
        withScopeEnforcer: false,
      });

      const { status } = await postKey(app, {
        name: 'split-authority-child',
        profile: 'personal',
        instanceIds: [INSTANCE_A],
        instanceAllowlist: [INSTANCE_B],
      });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('contradictory child restrictions cannot hide broader legacy authority behind an empty intersection', async () => {
      const { app, created } = mount(['*'], undefined, {
        callerInstanceIds: [INSTANCE_A],
        callerProfile: 'personal',
        callerInstanceAllowlist: [INSTANCE_A],
        withScopeEnforcer: false,
      });

      const { status } = await postKey(app, {
        name: 'split-legacy-authority-child',
        profile: 'personal',
        instanceIds: [INSTANCE_B],
        instanceAllowlist: [INSTANCE_A],
      });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('profile-locked caller cannot delegate through legacy instanceIds alone', async () => {
      const { app, created } = mount(['*'], undefined, {
        callerProfile: 'personal',
        callerInstanceAllowlist: [INSTANCE_A],
        withScopeEnforcer: false,
      });

      const { status } = await postKey(app, {
        name: 'legacy-only-child',
        scopes: ['*'],
        instanceIds: [INSTANCE_A],
      });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('UUID case differences are normalized before authority comparison', async () => {
      const { app, created } = mount(['*'], undefined, {
        callerProfile: 'personal',
        callerInstanceAllowlist: [INSTANCE_CASED.toUpperCase()],
        withScopeEnforcer: false,
      });

      const { status } = await postKey(app, {
        name: 'same-instance-different-case-child',
        profile: 'personal',
        instanceAllowlist: [INSTANCE_CASED],
      });

      expect(status).toBe(201);
      expect(created).toHaveLength(1);
    });

    test('malformed caller instance context fails closed even for a deny-all child', async () => {
      const { app, created } = mount(['*'], undefined, {
        callerInstanceIds: 'malformed' as never,
        withScopeEnforcer: false,
      });

      const { status } = await postKey(app, {
        name: 'deny-all-child-from-malformed-caller',
        scopes: ['*'],
        instanceIds: [],
      });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('missing caller profile fails closed instead of becoming unrestricted', async () => {
      const { app, created } = mount(['*'], undefined, {
        omitCallerProfile: true,
        withScopeEnforcer: false,
      });

      const { status } = await postKey(app, {
        name: 'child-from-missing-profile-context',
        scopes: ['*'],
        instanceIds: [],
      });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('missing caller instance allowlist fails closed instead of becoming unrestricted', async () => {
      const { app, created } = mount(['*'], undefined, {
        omitCallerInstanceAllowlist: true,
        withScopeEnforcer: false,
      });

      const { status } = await postKey(app, {
        name: 'child-from-missing-allowlist-context',
        scopes: ['*'],
        instanceIds: [],
      });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('restricted caller cannot omit instanceIds and mint an unrestricted legacy key', async () => {
      const { app, created } = mount(['keys:write'], undefined, { callerInstanceIds: [INSTANCE_A] });

      const { status, json } = await postKey(app, { name: 'unrestricted-child', scopes: ['keys:write'] });

      expect(status).toBe(403);
      expect((json as { error?: { code?: string } }).error?.code).toBe('FORBIDDEN');
      expect(created).toHaveLength(0);
    });

    test('restricted caller cannot mint a key for an instance it cannot access', async () => {
      const { app, created } = mount(['keys:write'], undefined, { callerInstanceIds: [INSTANCE_A] });

      const { status } = await postKey(app, {
        name: 'outside-instance',
        scopes: ['keys:write'],
        instanceIds: [INSTANCE_B],
      });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('restricted caller cannot omit instanceIds through the profile create branch', async () => {
      const { app, created } = mount([...CONSOLE_ADMIN_SCOPES], undefined, {
        callerInstanceIds: [INSTANCE_A],
      });

      const { status } = await postKey(app, { name: 'profile-unrestricted', profile: 'console-admin' });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('restricted caller can mint a key for a subset of its own instances', async () => {
      const { app, created } = mount(['keys:write'], undefined, {
        callerInstanceIds: [INSTANCE_A, INSTANCE_B],
      });

      const { status } = await postKey(app, {
        name: 'bounded-instance',
        scopes: ['keys:write'],
        instanceIds: [INSTANCE_A],
      });

      expect(status).toBe(201);
      expect(created).toHaveLength(1);
      expect(created[0]?.instanceIds).toEqual([INSTANCE_A]);
    });

    test('deny-all caller can mint only a deny-all instance subset', async () => {
      const { app, created } = mount(['keys:write'], undefined, { callerInstanceIds: [] });

      const { status } = await postKey(app, {
        name: 'deny-all-child',
        scopes: ['keys:write'],
        instanceIds: [],
      });

      expect(status).toBe(201);
      expect(created).toHaveLength(1);
      expect(created[0]?.instanceIds).toEqual([]);
    });

    test('restricted caller cannot mint an empty legacy grant that historical routes treat as unrestricted', async () => {
      const { app, created } = mount(['keys:write'], undefined, { callerInstanceIds: [INSTANCE_A] });

      const { status } = await postKey(app, {
        name: 'empty-legacy-compatibility-child',
        scopes: ['keys:write'],
        instanceIds: [],
      });

      expect(status).toBe(403);
      expect(created).toHaveLength(0);
    });

    test('unrestricted caller can still omit instanceIds when minting a key', async () => {
      const { app, created } = mount(['keys:write']);

      const { status } = await postKey(app, { name: 'unrestricted-ok', scopes: ['keys:write'] });

      expect(status).toBe(201);
      expect(created).toHaveLength(1);
      expect(created[0]?.instanceIds).toBeUndefined();
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

  test('legacy-restricted caller cannot change scopes on an unrestricted target key', async () => {
    const { app, updated } = mount(['keys:write'], undefined, {
      callerInstanceIds: [INSTANCE_A],
      targetInstanceIds: null,
      withScopeEnforcer: false,
    });

    const { status } = await patchKey(app, 'target', { scopes: ['keys:write'] });

    expect(status).toBe(403);
    expect(updated).toHaveLength(0);
  });

  test('profile-restricted caller cannot change scopes on a target outside its instance authority', async () => {
    const { app, updated } = mount(['*'], undefined, {
      callerProfile: 'personal',
      callerInstanceAllowlist: [INSTANCE_A],
      targetProfile: 'personal',
      targetInstanceAllowlist: [INSTANCE_B],
      withScopeEnforcer: false,
    });

    const { status } = await patchKey(app, 'target', { scopes: ['keys:write'] });

    expect(status).toBe(403);
    expect(updated).toHaveLength(0);
  });

  test('instance-only PATCH cannot activate retained scopes the caller does not hold', async () => {
    const { app, updated } = mount(['keys:write'], undefined, {
      callerInstanceIds: [INSTANCE_A],
      targetScopes: ['messages:send'],
      targetInstanceIds: [],
      withScopeEnforcer: false,
    });

    const { status } = await patchKey(app, 'target', { instanceIds: [INSTANCE_A] });

    expect(status).toBe(403);
    expect(updated).toHaveLength(0);
  });

  test('legacy-restricted caller can change scopes on a target within its instance authority', async () => {
    const { app, updated } = mount(['keys:write', 'chats:read'], undefined, {
      callerInstanceIds: [INSTANCE_A, INSTANCE_B],
      targetInstanceIds: [INSTANCE_A],
      withScopeEnforcer: false,
    });

    const { status } = await patchKey(app, 'target', { scopes: ['chats:read'] });

    expect(status).toBe(200);
    expect(updated).toEqual([{ id: 'target', scopes: ['chats:read'] }]);
  });

  test('profile-restricted caller can change scopes on a target within its instance authority', async () => {
    const { app, updated } = mount(['*'], undefined, {
      callerProfile: 'personal',
      callerInstanceAllowlist: [INSTANCE_A],
      targetProfile: 'personal',
      targetInstanceAllowlist: [INSTANCE_A],
      withScopeEnforcer: false,
    });

    const { status } = await patchKey(app, 'target', { scopes: ['keys:write'] });

    expect(status).toBe(200);
    expect(updated).toEqual([{ id: 'target', scopes: ['keys:write'] }]);
  });

  test('restricted caller cannot update a key to unrestricted instance access', async () => {
    const { app, updated } = mount(['keys:write'], undefined, { callerInstanceIds: [INSTANCE_A] });

    const { status, json } = await patchKey(app, 'target', { instanceIds: null });

    expect(status).toBe(403);
    expect((json as { error?: { code?: string } }).error?.code).toBe('FORBIDDEN');
    expect(updated).toHaveLength(0);
  });

  test('instanceAllowlist-restricted caller cannot make a legacy target unrestricted', async () => {
    const { app, updated } = mount(['*'], undefined, {
      callerProfile: 'personal',
      callerInstanceAllowlist: [INSTANCE_A],
      withScopeEnforcer: false,
    });

    const { status, json } = await patchKey(app, 'target', { instanceIds: null });

    expect(status).toBe(403);
    expect((json as { error?: { code?: string } }).error?.code).toBe('FORBIDDEN');
    expect(updated).toHaveLength(0);
  });

  test('PATCH retains the target profile lock when deriving its effective authority', async () => {
    const { app, updated } = mount(['*'], undefined, {
      callerProfile: 'personal',
      callerInstanceAllowlist: [INSTANCE_A],
      targetProfile: 'personal',
      targetInstanceAllowlist: [INSTANCE_A],
      withScopeEnforcer: false,
    });

    const { status } = await patchKey(app, 'target', { instanceIds: null });

    expect(status).toBe(200);
    expect(updated).toEqual([{ id: 'target', instanceIds: null }]);
  });

  test('PATCH rejects a target profile lock outside the caller effective authority', async () => {
    const { app, updated } = mount(['*'], undefined, {
      callerProfile: 'personal',
      callerInstanceAllowlist: [INSTANCE_A],
      targetProfile: 'personal',
      targetInstanceAllowlist: [INSTANCE_B],
      withScopeEnforcer: false,
    });

    const { status } = await patchKey(app, 'target', { instanceIds: null });

    expect(status).toBe(403);
    expect(updated).toHaveLength(0);
  });

  test('PATCH cannot hide an outside profile lock behind a contradictory legacy restriction', async () => {
    const { app, updated } = mount(['*'], undefined, {
      callerInstanceIds: [INSTANCE_A, INSTANCE_B],
      callerProfile: 'personal',
      callerInstanceAllowlist: [INSTANCE_A],
      targetProfile: 'personal',
      targetInstanceAllowlist: [INSTANCE_B],
      withScopeEnforcer: false,
    });

    const { status } = await patchKey(app, 'target', { instanceIds: [INSTANCE_A] });

    expect(status).toBe(403);
    expect(updated).toHaveLength(0);
  });

  test('PATCH cannot hide an outside legacy grant behind the caller profile lock', async () => {
    const { app, updated } = mount(['*'], undefined, {
      callerInstanceIds: [INSTANCE_A],
      callerProfile: 'personal',
      callerInstanceAllowlist: [INSTANCE_A],
      targetProfile: 'personal',
      targetInstanceAllowlist: [INSTANCE_A],
      withScopeEnforcer: false,
    });

    const { status } = await patchKey(app, 'target', { instanceIds: [INSTANCE_B] });

    expect(status).toBe(403);
    expect(updated).toHaveLength(0);
  });

  test('PATCH cannot replace a required profile lock with legacy restriction alone', async () => {
    const { app, updated } = mount(['*'], undefined, {
      callerProfile: 'personal',
      callerInstanceAllowlist: [INSTANCE_A],
      targetProfile: null,
      targetInstanceAllowlist: [],
      withScopeEnforcer: false,
    });

    const { status } = await patchKey(app, 'target', { instanceIds: [INSTANCE_A] });

    expect(status).toBe(403);
    expect(updated).toHaveLength(0);
  });

  test('restricted caller cannot update a key to an instance it cannot access', async () => {
    const { app, updated } = mount(['keys:write'], undefined, { callerInstanceIds: [INSTANCE_A] });

    const { status } = await patchKey(app, 'target', { instanceIds: [INSTANCE_B] });

    expect(status).toBe(403);
    expect(updated).toHaveLength(0);
  });

  test('restricted caller can update a key to a subset of its own instances', async () => {
    const { app, updated } = mount(['keys:write'], undefined, {
      callerInstanceIds: [INSTANCE_A, INSTANCE_B],
    });

    const { status } = await patchKey(app, 'target', { instanceIds: [INSTANCE_A] });

    expect(status).toBe(200);
    expect(updated).toEqual([{ id: 'target', instanceIds: [INSTANCE_A] }]);
  });

  test('deny-all caller can update a key only to deny-all instance access', async () => {
    const { app, updated } = mount(['keys:write'], undefined, { callerInstanceIds: [] });

    const { status } = await patchKey(app, 'target', { instanceIds: [] });

    expect(status).toBe(200);
    expect(updated).toEqual([{ id: 'target', instanceIds: [] }]);
  });

  test('restricted caller cannot PATCH an empty legacy grant that historical routes treat as unrestricted', async () => {
    const { app, updated } = mount(['keys:write'], undefined, { callerInstanceIds: [INSTANCE_A] });

    const { status } = await patchKey(app, 'target', { instanceIds: [] });

    expect(status).toBe(403);
    expect(updated).toHaveLength(0);
  });

  test('unrestricted caller can update a key to unrestricted instance access', async () => {
    const { app, updated } = mount(['keys:write']);

    const { status } = await patchKey(app, 'target', { instanceIds: null });

    expect(status).toBe(200);
    expect(updated).toEqual([{ id: 'target', instanceIds: null }]);
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

  test('restricted caller cannot metadata-only update an unrestricted target key', async () => {
    const { app, updated } = mount(['keys:write'], undefined, { callerInstanceIds: [INSTANCE_A] });

    const { status } = await patchKey(app, 'target', { name: 'renamed-key' });

    expect(status).toBe(403);
    expect(updated).toHaveLength(0);
  });

  test('metadata-only updates remain allowed when the target is within the caller instance authority', async () => {
    const { app, updated } = mount(['keys:write'], undefined, {
      callerInstanceIds: [INSTANCE_A],
      targetInstanceIds: [INSTANCE_A],
    });

    const { status } = await patchKey(app, 'target', { name: 'renamed-key' });

    expect(status).toBe(200);
    expect(updated).toEqual([{ id: 'target', name: 'renamed-key' }]);
  });
});
