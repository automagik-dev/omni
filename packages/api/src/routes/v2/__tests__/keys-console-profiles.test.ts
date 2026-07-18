/**
 * Console-profile minting over HTTP.
 *
 * Contract (WISH omni-appkit-gap, Group 2):
 *   The khal-ui BFF mints a per-user Omni key on every console session, so the
 *   three `console-*` profiles MUST be mintable over HTTP by a `keys:write`
 *   caller — while `profile: "admin"` stays 403-blocked (regression guard).
 *   Console keys are lock-free (no chat/instance/recipient allowlist) and their
 *   scope tiers are strictly nested: viewer ⊂ operator ⊂ admin.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import {
  CONSOLE_ADMIN_SCOPES,
  CONSOLE_OPERATOR_SCOPES,
  CONSOLE_PROFILES,
  CONSOLE_VIEWER_SCOPES,
  PROFILES,
} from '../../../constants/profiles';
import type { AppVariables } from '../../../types';
import { keysRoutes } from '../keys';

interface CreatedKey {
  name: string;
  scopes: string[];
  profile?: string | null;
  chatAllowlist?: string[];
  instanceAllowlist?: string[];
  outboundRecipientAllowlist?: string[];
}

function mountKeysRoutes(): { app: Hono<{ Variables: AppVariables }>; created: CreatedKey[] } {
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
    // Caller is the platform primary/minting key (`*`). The scope ceiling
    // (keys.ts `enforceScopeCeiling`) requires the requested scopes to be a
    // subset of the caller's own, and console profiles resolve to broad scope
    // sets — so the minter must legitimately hold those scopes. In production
    // the khal-ui BFF mints per-user console keys with the platform primary
    // key (or a `console-admin` key, which likewise covers every console
    // scope); a `keys:write`-only caller is now correctly rejected and is
    // covered by keys-mint-ceiling.test.ts.
    c.set('apiKey', {
      id: 'minter',
      name: 'minter',
      scopes: ['*'],
      instanceIds: null,
      expiresAt: null,
    } as never);
    await next();
  });

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

describe('POST /keys — console profiles', () => {
  for (const profile of CONSOLE_PROFILES) {
    test(`mints ${profile} over HTTP without any lock`, async () => {
      const { app, created } = mountKeysRoutes();

      const { status } = await postKey(app, { name: `${profile}-key`, profile });

      expect(status).toBe(201);
      expect(created).toHaveLength(1);
      const row = created[0] as CreatedKey;
      expect(row.profile).toBe(profile);
      // Lock-free: no allowlist was required at creation time and none was set.
      expect(row.chatAllowlist).toEqual([]);
      expect(row.instanceAllowlist).toEqual([]);
      expect(row.outboundRecipientAllowlist).toEqual([]);
      // Never a god key.
      expect(row.scopes).not.toContain('*');
      expect(row.scopes.length).toBeGreaterThan(0);
    });

    test(`${profile} declares no requiresLocks in its template`, () => {
      expect(PROFILES[profile].requiresLocks).toEqual([]);
    });
  }

  test('profile: "admin" is still 403-blocked over HTTP (regression guard)', async () => {
    const { app, created } = mountKeysRoutes();

    const { status, json } = await postKey(app, { name: 'god-key', profile: 'admin' });

    expect(status).toBe(403);
    expect((json as { error?: { code?: string } }).error?.code).toBe('FORBIDDEN');
    expect(created).toHaveLength(0);
  });

  test('console-viewer resolves to read-only scopes (no writes, no keys:read)', async () => {
    const { app, created } = mountKeysRoutes();
    await postKey(app, { name: 'viewer', profile: 'console-viewer' });

    const scopes = (created[0] as CreatedKey).scopes;
    expect(scopes).toEqual([...CONSOLE_VIEWER_SCOPES].sort());
    const writeLike = scopes.filter(
      (s) => s.endsWith(':write') || s.endsWith(':send') || s.endsWith(':close') || s.endsWith(':admin'),
    );
    expect(writeLike).toEqual([]);
    expect(scopes).not.toContain('keys:read');
    expect(scopes).not.toContain('instances:write');
  });

  test('console-operator adds operational writes but no key/tenant administration', async () => {
    const { app, created } = mountKeysRoutes();
    await postKey(app, { name: 'operator', profile: 'console-operator' });

    const scopes = (created[0] as CreatedKey).scopes;
    expect(scopes).toEqual([...CONSOLE_OPERATOR_SCOPES].sort());
    expect(scopes).toContain('messages:send');
    expect(scopes).toContain('turns:close');
    expect(scopes).toContain('instances:write');
    for (const forbidden of [
      'keys:write',
      'keys:read',
      'settings:write',
      'access:write',
      'providers:write',
      'webhooks:write',
      'agents:write',
      'payloads:write',
    ]) {
      expect(scopes).not.toContain(forbidden);
    }
  });

  test('console-admin gets the full console surface including key management', async () => {
    const { app, created } = mountKeysRoutes();
    await postKey(app, { name: 'admin-console', profile: 'console-admin' });

    const scopes = (created[0] as CreatedKey).scopes;
    expect(scopes).toEqual([...CONSOLE_ADMIN_SCOPES].sort());
    expect(scopes).toContain('keys:write');
    expect(scopes).toContain('settings:write');
  });

  test('console scope tiers are strictly nested: viewer ⊂ operator ⊂ admin', () => {
    const viewer = new Set(CONSOLE_VIEWER_SCOPES);
    const operator = new Set(CONSOLE_OPERATOR_SCOPES);
    const admin = new Set(CONSOLE_ADMIN_SCOPES);

    for (const s of viewer) expect(operator.has(s)).toBe(true);
    for (const s of operator) expect(admin.has(s)).toBe(true);
    expect(operator.size).toBeGreaterThan(viewer.size);
    expect(admin.size).toBeGreaterThan(operator.size);
  });
});
