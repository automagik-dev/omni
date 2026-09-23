/**
 * Deployment Slack app settings (wish: slack-personal-oauth, Group 1).
 *
 * The five keys behind `SLACK_APP_SETTINGS` are registered in the settings
 * registry BEFORE any write path exists, because sealing at rest and masking
 * on `GET /settings` are decided by that registry (`isSecretSetting`), never
 * by the PUT body. This file is the contract for that registration:
 *
 *   * the three secrets (`client_secret`, `signing_secret`, `app_token`) seed
 *     as `valueType: 'secret', isSecret: true`, seal under a tenant scope +
 *     master key, open for their tenant, and read back as `********` on the
 *     settings route;
 *   * the two identifiers (`slack.app.client_id`, `server.public_url`) stay in
 *     the clear under the same conditions;
 *   * `getString` / `getSecret` fall back to the documented env variables.
 *
 * The fake `global_settings` below mirrors the one in
 * `sealed-credential-surfaces.test.ts`, extended to many rows keyed by
 * `key`, so `seedDefaults` + `setValue` + `list` behave as they do on Postgres.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setTenantSecretMasterKey } from '@omni/core';
import type { Database } from '@omni/db';
import { settingChangeHistory } from '@omni/db';
import { Param, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { SLACK_APP_SETTINGS, SLACK_OAUTH_CALLBACK_PATH } from '../../constants/slack-app';
import { settingsRoutes } from '../../routes/v2/settings';
import { isSealedCredentialField } from '../../tenancy/sealed-credentials';
import { runInTenantScope } from '../../tenancy/tenant-scope';
import { buildWorkerTenantContext } from '../../tenancy/worker-tenant-context';
import type { AppVariables } from '../../types';
import { SettingsService } from '../settings';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const MASTER_KEY = Buffer.alloc(32, 7);

const SECRET_KEYS = [
  SLACK_APP_SETTINGS.clientSecret.key,
  SLACK_APP_SETTINGS.signingSecret.key,
  SLACK_APP_SETTINGS.appToken.key,
] as const;
const CLEAR_KEYS = [SLACK_APP_SETTINGS.clientId.key, SLACK_APP_SETTINGS.publicUrl.key] as const;

afterEach(() => setTenantSecretMasterKey(null));

function inTenantScope<T>(db: Database, tenantId: string, fn: () => Promise<T>): Promise<T> {
  return runInTenantScope(db, buildWorkerTenantContext(tenantId), fn);
}

/** The bound string in an `eq(globalSettings.key, <key>)` predicate. */
function boundKey(condition: unknown): string | undefined {
  if (condition instanceof Param) return typeof condition.value === 'string' ? condition.value : undefined;
  const chunks = (condition as SQL | undefined)?.queryChunks;
  if (!Array.isArray(chunks)) return undefined;
  for (const chunk of chunks) {
    const found = boundKey(chunk);
    if (found !== undefined) return found;
  }
  return undefined;
}

type Row = Record<string, unknown> & { key: string };

/** Many-row stand-in for `global_settings`, keyed by `key`. */
function makeSettingsDb() {
  const rows: Row[] = [];
  const history: Array<Record<string, unknown>> = [];
  const byKey = (condition: unknown): Row[] => {
    const key = boundKey(condition);
    return rows.filter((row) => row.key === key);
  };
  const db: Record<string, unknown> = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    execute: async () => undefined,
    insert: (table: unknown) => ({
      values: (v: Row) => {
        const isHistory = table === settingChangeHistory;
        const insertRow = (): Row => {
          const row: Row = { id: `set-${rows.length + 1}`, isSecret: false, ...v };
          rows.push(row);
          return row;
        };
        const promise = (async () => {
          if (isHistory) history.push(v);
          else insertRow();
        })();
        return Object.assign(promise, {
          returning: async () => [insertRow()],
        });
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: (condition: unknown) => ({
          returning: async () => {
            const row = byKey(condition)[0];
            if (!row) return [];
            Object.assign(row, v);
            return [row];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({ limit: async () => byKey(condition).slice(0, 1) }),
        $dynamic: () => ({
          where: () => ({ orderBy: async () => rows }),
          orderBy: async () => rows,
        }),
      }),
    }),
  };
  return { db: db as unknown as Database, rows, history };
}

function mountSettingsRoutes(svc: SettingsService): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', { settings: svc } as never);
    await next();
  });
  app.route('/settings', settingsRoutes);
  return app;
}

describe('SLACK_APP_SETTINGS registry', () => {
  test('every key is seeded, the three secrets as secret and the two identifiers in the clear', async () => {
    const { db, rows } = makeSettingsDb();
    await new SettingsService(db).seedDefaults();

    const seeded = new Map(rows.map((row) => [row.key, row]));
    for (const key of SECRET_KEYS) {
      const row = seeded.get(key);
      expect(row).toBeDefined();
      expect(row?.isSecret).toBe(true);
      expect(row?.valueType).toBe('secret');
      expect(row?.category).toBe('slack');
    }
    for (const key of CLEAR_KEYS) {
      const row = seeded.get(key);
      expect(row).toBeDefined();
      expect(row?.isSecret).toBe(false);
      expect(row?.valueType).toBe('string');
    }
    expect(seeded.get(SLACK_APP_SETTINGS.clientId.key)?.category).toBe('slack');
    // A general server setting, not a Slack one.
    expect(seeded.get(SLACK_APP_SETTINGS.publicUrl.key)?.category).toBe('server');
  });

  test('the callback path is fixed under the v2 API', () => {
    expect(SLACK_OAUTH_CALLBACK_PATH).toBe('/api/v2/slack/oauth/callback');
  });
});

describe('sealing: tenant scope + master key', () => {
  test('each secret is sealed at rest and opens for its tenant, even before seedDefaults ran', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeSettingsDb();
    const svc = new SettingsService(db);

    for (const key of SECRET_KEYS) {
      const plaintext = `value-of-${key}`;
      await inTenantScope(db, TENANT_A, () => svc.setValue(key, plaintext));
      const row = rows.find((r) => r.key === key);
      expect(isSealedCredentialField(row?.value)).toBe(true);
      expect(String(row?.value)).not.toContain(plaintext);
      expect(await inTenantScope(db, TENANT_A, () => svc.getSecret(key))).toBe(plaintext);
    }
  });

  test('client_id and server.public_url are stored and read back in the clear', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeSettingsDb();
    const svc = new SettingsService(db);

    await inTenantScope(db, TENANT_A, () => svc.setValue(SLACK_APP_SETTINGS.clientId.key, '1234.5678'));
    await inTenantScope(db, TENANT_A, () => svc.setValue(SLACK_APP_SETTINGS.publicUrl.key, 'https://omni.example.com'));

    expect(rows.find((r) => r.key === SLACK_APP_SETTINGS.clientId.key)?.value).toBe('1234.5678');
    expect(rows.find((r) => r.key === SLACK_APP_SETTINGS.publicUrl.key)?.value).toBe('https://omni.example.com');
    expect(await inTenantScope(db, TENANT_A, () => svc.getString(SLACK_APP_SETTINGS.clientId.key))).toBe('1234.5678');
    expect(await inTenantScope(db, TENANT_A, () => svc.getString(SLACK_APP_SETTINGS.publicUrl.key))).toBe(
      'https://omni.example.com',
    );
  });

  test('GET /settings masks the three secrets as ******** and returns the identifiers in the clear', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db } = makeSettingsDb();
    const svc = new SettingsService(db);
    await svc.seedDefaults();
    await inTenantScope(db, TENANT_A, async () => {
      for (const key of SECRET_KEYS) await svc.setValue(key, `value-of-${key}`);
      await svc.setValue(SLACK_APP_SETTINGS.clientId.key, '1234.5678');
      await svc.setValue(SLACK_APP_SETTINGS.publicUrl.key, 'https://omni.example.com');
    });

    const app = mountSettingsRoutes(svc);
    const res = await inTenantScope(db, TENANT_A, () => Promise.resolve(app.request('/settings')));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ key: string; value: unknown }> };
    const byKey = new Map(body.items.map((item) => [item.key, item.value]));

    for (const key of SECRET_KEYS) expect(byKey.get(key)).toBe('********');
    expect(byKey.get(SLACK_APP_SETTINGS.clientId.key)).toBe('1234.5678');
    expect(byKey.get(SLACK_APP_SETTINGS.publicUrl.key)).toBe('https://omni.example.com');
    expect(JSON.stringify(body)).not.toContain('value-of-');
  });
});

describe('env fallbacks', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const { env } of Object.values(SLACK_APP_SETTINGS)) {
      saved.set(env, process.env[env]);
      delete process.env[env];
    }
  });

  afterEach(() => {
    for (const [env, value] of saved) {
      if (value === undefined) delete process.env[env];
      else process.env[env] = value;
    }
    saved.clear();
  });

  test('an unset key reads from its documented env variable', async () => {
    const { db } = makeSettingsDb();
    const svc = new SettingsService(db);

    process.env[SLACK_APP_SETTINGS.clientId.env] = 'env-client-id';
    process.env[SLACK_APP_SETTINGS.clientSecret.env] = 'env-client-secret';
    process.env[SLACK_APP_SETTINGS.publicUrl.env] = 'https://env.example.com';

    expect(await svc.getString(SLACK_APP_SETTINGS.clientId.key, SLACK_APP_SETTINGS.clientId.env)).toBe('env-client-id');
    expect(await svc.getSecret(SLACK_APP_SETTINGS.clientSecret.key, SLACK_APP_SETTINGS.clientSecret.env)).toBe(
      'env-client-secret',
    );
    expect(await svc.getString(SLACK_APP_SETTINGS.publicUrl.key, SLACK_APP_SETTINGS.publicUrl.env)).toBe(
      'https://env.example.com',
    );
    expect(await svc.getSecret(SLACK_APP_SETTINGS.appToken.key, SLACK_APP_SETTINGS.appToken.env)).toBeUndefined();
  });

  test('a stored value wins over the env variable', async () => {
    const { db } = makeSettingsDb();
    const svc = new SettingsService(db);
    process.env[SLACK_APP_SETTINGS.clientId.env] = 'env-client-id';
    await svc.setValue(SLACK_APP_SETTINGS.clientId.key, 'db-client-id');

    expect(await svc.getString(SLACK_APP_SETTINGS.clientId.key, SLACK_APP_SETTINGS.clientId.env)).toBe('db-client-id');
  });
});
