/**
 * Route-layer guard for admin key minting.
 *
 * Contract (from WISH Group 7):
 *   POST /keys with `profile: "admin"` MUST return 403 regardless of
 *   caller scopes or any `operator_confirmed`-style bypass field. Admin
 *   keys are CLI-only and human-gated by construction.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { keysRoutes } from '../keys';

function mountKeysRoutes(): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  // Minimal stub services — the admin guard runs before the zValidator body
  // parse, so no service calls should fire for these cases.
  app.use('*', async (c, next) => {
    c.set('services', {
      apiKeys: {
        create: async () => {
          throw new Error('services.apiKeys.create must not be called when admin is rejected');
        },
      },
    } as never);
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/keys', keysRoutes);
  return app;
}

async function postJson(
  app: Hono<{ Variables: AppVariables }>,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await app.request('/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

describe('POST /keys — admin profile guard', () => {
  test('rejects profile: "admin" with 403', async () => {
    const app = mountKeysRoutes();
    const { status, json } = await postJson(app, {
      name: 'god-key',
      profile: 'admin',
    });
    expect(status).toBe(403);
    expect((json as { error?: { code?: string } }).error?.code).toBe('FORBIDDEN');
  });

  test('rejects profile: "admin" even with operator_confirmed: true in body', async () => {
    const app = mountKeysRoutes();
    const { status, json } = await postJson(app, {
      name: 'god-key',
      profile: 'admin',
      operator_confirmed: true,
    });
    expect(status).toBe(403);
    expect((json as { error?: { code?: string } }).error?.code).toBe('FORBIDDEN');
  });

  test('rejects profile: "admin" even with a name missing (guard runs before zod)', async () => {
    const app = mountKeysRoutes();
    const { status, json } = await postJson(app, { profile: 'admin' });
    expect(status).toBe(403);
    expect((json as { error?: { code?: string } }).error?.code).toBe('FORBIDDEN');
  });

  test('accepts profile: "cs" (non-admin) and proceeds past the guard', async () => {
    // We don't have a full service container wired — expect a non-403 response.
    // zod validation will fail because chatAllowlist/instanceAllowlist are required
    // by the resolver for cs, so the route should produce a 400 (not a 403).
    const app = mountKeysRoutes();
    const { status } = await postJson(app, {
      name: 'cs-key',
      profile: 'cs',
    });
    expect(status).not.toBe(403);
  });
});
