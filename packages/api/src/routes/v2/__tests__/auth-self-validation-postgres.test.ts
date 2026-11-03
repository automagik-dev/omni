/**
 * `POST /auth/validate` for any authenticated credential, over REAL PostgreSQL (#1461).
 *
 * A device key may never carry `auth:*` (login/config.ts FORBIDDEN_SCOPE), so until this
 * change the scope enforcer refused it on the one route that tells a credential whether it
 * works, and `omni auth login --api-key <device key>` failed. The enforcer now lets exactly
 * that route through without its SCOPE_MAP scope. These tests drive real keys through the
 * real auth middleware, scope enforcer and rate limiter, on an app mounted the way app.ts
 * mounts it (`/api/v2` -> protected app -> `/auth`), and pin three things:
 *
 *   * the exemption gives a credential facts about itself only, and refuses what it did
 *     before: revoked, expired and unknown keys (including another server's key) get 401;
 *   * it matches the registered route only: every other spelling, method or mount still
 *     gets the normal scope check (403) or no route (404);
 *   * the rate limit still applies.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts` does that
 * for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type Database, createDbHandle } from '@omni/db';
import { pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { dropDatabaseOrThrow } from '@omni/db/pg-testing';
import { Hono } from 'hono';
import { DEFAULT_DEVICE_KEY_SCOPES, deviceKeysFor } from '../../../login/config';
import { authMiddleware } from '../../../middleware/auth';
import { rateLimitMiddleware } from '../../../middleware/rate-limit';
import { scopeEnforcerMiddleware } from '../../../middleware/scope-enforcer';
import type { Services } from '../../../services';
import { ApiKeyService } from '../../../services/api-keys';
import type { AppVariables } from '../../../types';
import { authRoutes } from '../auth';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

/** The fields `/auth/validate` returns for a legacy (non-tenant) key on dev, and no more. */
const VALIDATE_FIELDS = ['keyName', 'keyPrefix', 'scopes', 'server', 'valid'];

/** The app.ts shape: the protected chain on a sub-app mounted at /api/v2, v2 routes under it. */
function buildApp(apiKeys: ApiKeyService) {
  const services = { apiKeys } as unknown as Services;
  const reached: string[] = [];
  const v2 = new Hono<{ Variables: AppVariables }>();
  v2.route('/auth', authRoutes);
  // Another auth:* route (SCOPE_MAP 'POST /owner/claim' = auth:admin), stubbed: it must stay refused.
  v2.post('/owner/claim', (c) => {
    reached.push('POST /owner/claim');
    return c.json({ data: { reached: true } });
  });
  const protectedApp = new Hono<{ Variables: AppVariables }>();
  protectedApp.use('*', async (c, next) => {
    c.set('services', services);
    await next();
  });
  protectedApp.use('*', authMiddleware);
  protectedApp.use('*', scopeEnforcerMiddleware);
  protectedApp.use('*', rateLimitMiddleware);
  protectedApp.route('/', v2);
  const app = new Hono();
  app.route('/api/v2', protectedApp);
  return { app, reached };
}

async function send(app: Hono, path: string, key: string, method = 'POST') {
  const response = await app.request(`http://omni.test${path}`, { method, headers: { 'x-api-key': key } });
  const text = method === 'HEAD' ? '' : await response.text();
  return { status: response.status, text, json: parseJson(text) };
}

/** The body as JSON, or null for an empty or plain-text one (Hono's own 404 is text). */
function parseJson(text: string): Record<string, unknown> | null {
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

postgresDescribe('POST /auth/validate for any authenticated credential', () => {
  const dbName = `omni_selfval_${crypto.randomUUID().replaceAll('-', '')}`;
  const otherDbName = `omni_selfval_other_${crypto.randomUUID().replaceAll('-', '')}`;
  const closers: Array<() => Promise<void>> = [];
  let db: Database;
  let apiKeys: ApiKeyService;
  let otherServerKeys: ApiKeyService;
  let app: Hono;
  let reached: string[];

  /** A key shaped as routes/v2/login.ts mintDeviceKey makes it for the omni-cli client. */
  const deviceKey = (extra: { expiresAt?: Date } = {}, on = apiKeys) =>
    on.create({
      name: 'device: omni CLI on test-host',
      description: 'Authorized by the owner for the omni command line, from 127.0.0.1',
      scopes: deviceKeysFor('omni-cli', DEFAULT_DEVICE_KEY_SCOPES).scopes,
      createdBy: 'login:owner-test',
      ...extra,
    });

  beforeAll(() => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    provisionMigratedDatabase({ superUrl, psqlBin }, otherDbName);
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, dbName), maxConnections: 4 });
    const other = createDbHandle({ url: pgRoleUrl(superUrl, otherDbName), maxConnections: 2 });
    closers.push(handle.close, other.close);
    db = handle.db;
    apiKeys = new ApiKeyService(db);
    otherServerKeys = new ApiKeyService(other.db);
    ({ app, reached } = buildApp(apiKeys));
  });

  afterAll(async () => {
    for (const close of closers) await close().catch(() => undefined);
    dropDatabaseOrThrow({ superUrl, psqlBin }, dbName);
    dropDatabaseOrThrow({ superUrl, psqlBin }, otherDbName);
  });

  test('an omni-cli device key validates with its own facts only, and no key material', async () => {
    const minted = await deviceKey();
    // A second credential in the same database: nothing of it may appear in the reply.
    const bystander = await apiKeys.create({ name: 'bystander-operator', scopes: ['*'] });

    const reply = await send(app, '/api/v2/auth/validate', minted.plainTextKey);
    expect(reply.status).toBe(200);
    const data = reply.json?.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(VALIDATE_FIELDS);
    expect(data.valid).toBe(true);
    expect(data.keyPrefix).toBe(`omni_sk_${minted.key.id.substring(0, 8)}...`);
    expect(data.keyName).toBe('device: omni CLI on test-host');
    expect(data.scopes).toEqual([...DEFAULT_DEVICE_KEY_SCOPES]);

    for (const secret of [minted.plainTextKey, minted.key.keyHash, minted.key.id]) {
      expect(reply.text).not.toContain(secret);
    }
    for (const foreign of [bystander.plainTextKey, bystander.key.id, bystander.key.name, bystander.key.keyHash]) {
      expect(reply.text).not.toContain(foreign);
    }
    expect(reply.text).not.toMatch(/apiKey|secret|keyHash|plainText/i);
  });

  test('a key with no scopes, or only an unrelated one, sees only itself', async () => {
    const bystander = await apiKeys.create({ name: 'bystander-device', scopes: ['messages:send'] });
    for (const scopes of [[], ['tts:read']]) {
      const own = await apiKeys.create({ name: `self-${scopes.length}`, scopes });
      const reply = await send(app, '/api/v2/auth/validate', own.plainTextKey);
      expect(reply.status).toBe(200);
      const data = reply.json?.data as Record<string, unknown>;
      expect(Object.keys(data).sort()).toEqual(VALIDATE_FIELDS);
      expect(data.keyPrefix).toBe(`omni_sk_${own.key.id.substring(0, 8)}...`);
      expect(data.keyName).toBe(`self-${scopes.length}`);
      expect(data.scopes).toEqual(scopes);
      for (const foreign of [bystander.plainTextKey, bystander.key.id, bystander.key.name]) {
        expect(reply.text).not.toContain(foreign);
      }
    }
  });

  test('a revoked device key is refused', async () => {
    const minted = await deviceKey();
    expect((await send(app, '/api/v2/auth/validate', minted.plainTextKey)).status).toBe(200);
    await apiKeys.revoke(minted.key.id, 'test');
    expect((await send(app, '/api/v2/auth/validate', minted.plainTextKey)).status).toBe(401);
  });

  test('an expired device key is refused', async () => {
    const minted = await deviceKey({ expiresAt: new Date(Date.now() - 60_000) });
    expect((await send(app, '/api/v2/auth/validate', minted.plainTextKey)).status).toBe(401);
  });

  test("another server's device key is refused", async () => {
    const foreign = await deviceKey({}, otherServerKeys);
    expect((await send(app, '/api/v2/auth/validate', foreign.plainTextKey)).status).toBe(401);
    // And a well-formed key no server minted.
    expect((await send(app, '/api/v2/auth/validate', `omni_sk_${'0'.repeat(32)}`)).status).toBe(401);
  });

  test('only the registered route is exempt: every other spelling keeps its normal refusal', async () => {
    const minted = await deviceKey();
    const key = minted.plainTextKey;
    const refusals: Array<[string, string, number]> = [
      ['POST', '/api/v2/auth/validate/', 403], // trailing slash
      ['POST', '/api/v2//auth/validate', 403], // double slash
      ['POST', '/api/v2/auth/%76alidate', 403], // percent-encoded spelling of the same route
      ['POST', '/api/v2/auth/VALIDATE', 403], // case variant
      ['POST', '/api/v2/AUTH/validate', 403],
      ['GET', '/api/v2/auth/validate', 403],
      ['HEAD', '/api/v2/auth/validate', 403],
      ['OPTIONS', '/api/v2/auth/validate', 403],
      ['POST', '/auth/validate', 404], // without its mounted prefix
      ['POST', '/api/v3/auth/validate', 404], // a wrong prefix
      ['POST', '/api/v2/owner/claim', 403], // another auth:* route
    ];
    for (const [method, path, status] of refusals) {
      const reply = await send(app, path, key, method);
      expect({ method, path, status: reply.status }).toEqual({ method, path, status });
      expect(reply.json?.data).toBeUndefined();
    }
    expect(reached).toEqual([]);
    // A query string does not change the matched path: the same route, the same answer.
    expect((await send(app, '/api/v2/auth/validate?x=1', key)).status).toBe(200);
  });

  test('the rate limit still applies to a key without auth:validate', async () => {
    const own = await apiKeys.create({ name: 'rate-limited', scopes: [] });
    let status = 0;
    let calls = 0;
    while (calls < 1_100) {
      calls += 1;
      status = (await send(app, '/api/v2/auth/validate', own.plainTextKey)).status;
      if (status !== 200) break;
    }
    expect(status).toBe(429);
    expect(calls).toBe(1_001);
  });
});
