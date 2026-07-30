/**
 * Deliverable (g) — the remaining credential surfaces sealed at rest
 * (G5; ADR-0008; WISH "Async and storage enforcement").
 *
 * Run9 sealed `agent_sessions.provider_session_data`. The credential material
 * that survived that leg lives in three more places, and this file is their
 * contract:
 *
 *   * `instances.*` channel tokens — the Discord/Slack/Telegram/Gupshup/Twilio
 *     bot tokens and signing secrets. The tenant is the instance row's OWN
 *     persisted `tenant_id` (the G2 ownership root), so the binding needs no
 *     resolver seam at all.
 *   * `agent_providers.api_key` + the OpenClaw Ed25519 device key material in
 *     `schema_config` (`devicePrivateKey`, `deviceToken`). `agent_providers` is
 *     a G0-`split` table with no `tenant_id` yet, so the binding is the ACTIVE
 *     tenant scope — a provider configured inside tenant A's context is sealed
 *     for A and fails closed everywhere else.
 *   * `global_settings.value` where `is_secret` — same split-table situation,
 *     same active-scope binding. Sealing here also stops the plaintext from
 *     being copied into `setting_change_history`, which ADR-0008 names
 *     explicitly ("plaintext never appears in ... migration receipts").
 *
 * Every case below is asserted in BOTH worlds. The flag-off/key-absent
 * assertions are the important half: they are what proves the deliverable is
 * inert, and they would fail loudly if a future edit made sealing
 * unconditional.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { setTenantSecretMasterKey } from '@omni/core';
import type { Database } from '@omni/db';
import { settingChangeHistory } from '@omni/db';
import { isSealedCredentialField } from '../../tenancy/sealed-credentials';
import { runInTenantScope } from '../../tenancy/tenant-scope';
import { buildWorkerTenantContext } from '../../tenancy/worker-tenant-context';
import { InstanceService } from '../instances';
import { ProviderService } from '../providers';
import { SettingsService } from '../settings';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const MASTER_KEY = Buffer.alloc(32, 5);

afterEach(() => setTenantSecretMasterKey(null));

/**
 * Run `fn` inside a real tenant scope for `tenantId`.
 *
 * `runInTenantScope` opens `withTenantTransaction`, so the fake db must model
 * `transaction()` — it hands back the same handle, which is what a Drizzle
 * transaction looks like from the query builder's side. Real transactional
 * isolation is proven against PostgreSQL in the two-tenant PG suites; what this
 * harness needs is only that `scopedHandle()` resolves and that the scope's
 * tenant is observable by the service.
 */
function inTenantScope<T>(db: Database, tenantId: string, fn: () => Promise<T>): Promise<T> {
  return runInTenantScope(db, buildWorkerTenantContext(tenantId), fn);
}

// ---------------------------------------------------------------------------
// instances.* channel tokens
// ---------------------------------------------------------------------------

/** One-row stand-in for `instances`; stores whatever the service writes. */
function makeInstancesDb() {
  const rows: Array<Record<string, unknown>> = [];
  const db: Record<string, unknown> = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    execute: async () => undefined,
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const row = { id: 'inst-1', channel: 'discord', ...v };
          rows.push(row);
          return [row];
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const row = rows[0];
            if (!row) return [];
            Object.assign(row, v);
            return [row];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (rows[0] ? [rows[0]] : []),
        }),
      }),
    }),
  };
  return { db: db as unknown as Database, rows };
}

describe('(g) instances.* channel tokens', () => {
  test('flag-off (no scope, no key): the token is stored as plaintext, byte-identical', async () => {
    const { db, rows } = makeInstancesDb();
    const svc = new InstanceService(db, null);
    await svc.create({ name: 'i', channel: 'discord', discordBotToken: 'MTIz.bot.token' } as never);
    expect(rows[0]?.discordBotToken).toBe('MTIz.bot.token');
  });

  test('KEY PRESENT but NO tenant scope (the legacy/worker/CLI write): still plaintext', async () => {
    // The risk-carrying half of the dual world. With no key, "no tenant" and "no
    // key" are indistinguishable — both collapse to the identity function — so a
    // no-key probe cannot attribute the inertness to the tenant guard at all.
    // Only this combination can, and a future edit that gave the write path a
    // fallback tenant would seal under a tenant no reader ever presents.
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeInstancesDb();
    const svc = new InstanceService(db, null);
    const created = await svc.create({ name: 'i', channel: 'discord', discordBotToken: 'MTIz.bot.token' } as never);
    expect(isSealedCredentialField(rows[0]?.discordBotToken)).toBe(false);
    expect(rows[0]?.discordBotToken).toBe('MTIz.bot.token');
    expect(created.discordBotToken).toBe('MTIz.bot.token');
  });

  test('tenant scope but NO master key: still plaintext (the deliverable is inert)', async () => {
    setTenantSecretMasterKey(null);
    const { db, rows } = makeInstancesDb();
    const svc = new InstanceService(db, null);
    await inTenantScope(db, TENANT_A, () =>
      svc.create({ name: 'i', channel: 'discord', discordBotToken: 'MTIz.bot.token', tenantId: TENANT_A } as never),
    );
    expect(rows[0]?.discordBotToken).toBe('MTIz.bot.token');
  });

  test('tenant scope + key: sealed at rest, and the owner reads the plaintext back', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeInstancesDb();
    const svc = new InstanceService(db, null);

    const created = await inTenantScope(db, TENANT_A, () =>
      svc.create({ name: 'i', channel: 'discord', discordBotToken: 'MTIz.bot.token', tenantId: TENANT_A } as never),
    );

    // At rest: no plaintext anywhere in the row.
    expect(isSealedCredentialField(rows[0]?.discordBotToken)).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain('MTIz.bot.token');
    // Returned to the caller: plaintext, so route/plugin callers are unchanged.
    expect(created.discordBotToken).toBe('MTIz.bot.token');

    const read = await inTenantScope(db, TENANT_A, () => svc.getById('inst-1'));
    expect(read.discordBotToken).toBe('MTIz.bot.token');
  });

  test('every declared channel-credential column is sealed, not just the first', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeInstancesDb();
    const svc = new InstanceService(db, null);
    await inTenantScope(db, TENANT_A, () =>
      svc.create({
        name: 'i',
        channel: 'slack',
        tenantId: TENANT_A,
        slackBotToken: 'xoxb-A',
        slackAppToken: 'xapp-A',
        slackSigningSecret: 'sign-A',
        telegramBotToken: 'tg-A',
        gupshupAuthToken: 'gup-A',
        webhookVerifyToken: 'hook-A',
        twilioAuthToken: 'tw-A',
      } as never),
    );
    const at = JSON.stringify(rows[0]);
    for (const secret of ['xoxb-A', 'xapp-A', 'sign-A', 'tg-A', 'gup-A', 'hook-A', 'tw-A']) {
      expect(at).not.toContain(secret);
    }
  });

  test('a NON-credential column is never reshaped (profileName stays plaintext)', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeInstancesDb();
    const svc = new InstanceService(db, null);
    await inTenantScope(db, TENANT_A, () =>
      svc.create({ name: 'i', channel: 'discord', tenantId: TENANT_A, profileName: 'Support Bot' } as never),
    );
    expect(rows[0]?.profileName).toBe('Support Bot');
  });

  test('tenant B cannot read tenant A’s sealed token — it fails closed to null', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeInstancesDb();
    const svc = new InstanceService(db, null);
    await inTenantScope(db, TENANT_A, () =>
      svc.create({ name: 'i', channel: 'discord', discordBotToken: 'MTIz.bot.token', tenantId: TENANT_A } as never),
    );

    // The row is served back under B's scope; only the seal stands between them.
    const row = rows[0];
    if (row) row.tenantId = TENANT_B;
    const read = await inTenantScope(db, TENANT_B, () => svc.getById('inst-1'));
    expect(read.discordBotToken).toBeNull();
  });

  test('update seals a rotated token and returns the new plaintext', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeInstancesDb();
    const svc = new InstanceService(db, null);
    await inTenantScope(db, TENANT_A, () =>
      svc.create({ name: 'i', channel: 'discord', discordBotToken: 'old-token', tenantId: TENANT_A } as never),
    );
    const updated = await inTenantScope(db, TENANT_A, () => svc.update('inst-1', { discordBotToken: 'new-token' }));

    expect(isSealedCredentialField(rows[0]?.discordBotToken)).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain('new-token');
    expect(updated.discordBotToken).toBe('new-token');
  });

  test('a legacy plaintext row still reads through while sealing is on (transitional)', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeInstancesDb();
    rows.push({ id: 'inst-1', channel: 'discord', tenantId: TENANT_A, discordBotToken: 'legacy-plain' });
    const svc = new InstanceService(db, null);
    const read = await inTenantScope(db, TENANT_A, () => svc.getById('inst-1'));
    expect(read.discordBotToken).toBe('legacy-plain');
  });
});

// ---------------------------------------------------------------------------
// agent_providers.api_key + OpenClaw Ed25519 material in schema_config
// ---------------------------------------------------------------------------

function makeProvidersDb() {
  const rows: Array<Record<string, unknown>> = [];
  const db: Record<string, unknown> = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    execute: async () => undefined,
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const row = { id: 'prov-1', ...v };
          rows.push(row);
          return [row];
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const row = rows[0];
            if (!row) return [];
            Object.assign(row, v);
            return [row];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (rows[0] ? [rows[0]] : []) }),
        $dynamic: () => ({
          where: () => ({ orderBy: async () => rows }),
          orderBy: async () => rows,
        }),
      }),
      $dynamic: () => ({
        from: () => ({ orderBy: async () => rows }),
      }),
    }),
  };
  return { db: db as unknown as Database, rows };
}

describe('(g) agent_providers.api_key + OpenClaw device key', () => {
  test('flag-off: api_key and device key stay plaintext', async () => {
    const { db, rows } = makeProvidersDb();
    const svc = new ProviderService(db);
    await svc.create({
      name: 'p',
      baseUrl: 'ws://x',
      apiKey: 'sk-provider',
      schemaConfig: { devicePrivateKey: 'ed25519-priv', deviceToken: 'dev-tok', origin: 'https://x' },
    } as never);
    expect(rows[0]?.apiKey).toBe('sk-provider');
    expect((rows[0]?.schemaConfig as Record<string, unknown>).devicePrivateKey).toBe('ed25519-priv');
  });

  test('KEY PRESENT but NO tenant scope: api_key and device key stay plaintext', async () => {
    // Same reasoning as the instances case above: this is the combination that
    // distinguishes `sealProviderSecrets`'s own `if (!tenantId) return data`
    // guard from the codec's key check, and it is the one a "default tenant for
    // legacy writes" regression would break.
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeProvidersDb();
    const svc = new ProviderService(db);
    const created = await svc.create({
      name: 'p',
      baseUrl: 'ws://x',
      apiKey: 'sk-provider',
      schemaConfig: { devicePrivateKey: 'ed25519-priv', deviceToken: 'dev-tok', origin: 'https://x' },
    } as never);
    expect(rows[0]?.apiKey).toBe('sk-provider');
    expect((rows[0]?.schemaConfig as Record<string, unknown>).devicePrivateKey).toBe('ed25519-priv');
    expect((rows[0]?.schemaConfig as Record<string, unknown>).deviceToken).toBe('dev-tok');
    expect(created.apiKey).toBe('sk-provider');
  });

  test('tenant scope + key: api_key, devicePrivateKey and deviceToken are all sealed', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeProvidersDb();
    const svc = new ProviderService(db);

    const created = await inTenantScope(db, TENANT_A, () =>
      svc.create({
        name: 'p',
        baseUrl: 'ws://x',
        apiKey: 'sk-provider',
        schemaConfig: {
          devicePrivateKey: 'ed25519-priv',
          deviceToken: 'dev-tok',
          devicePublicKey: 'ed25519-pub',
          origin: 'https://x',
        },
      } as never),
    );

    const at = JSON.stringify(rows[0]);
    expect(at).not.toContain('sk-provider');
    expect(at).not.toContain('ed25519-priv');
    expect(at).not.toContain('dev-tok');
    // The PUBLIC key and non-secret config are untouched — sealing is scoped to
    // key material, not to the whole blob.
    expect((rows[0]?.schemaConfig as Record<string, unknown>).devicePublicKey).toBe('ed25519-pub');
    expect((rows[0]?.schemaConfig as Record<string, unknown>).origin).toBe('https://x');

    expect(created.apiKey).toBe('sk-provider');
    expect((created.schemaConfig as Record<string, unknown>).devicePrivateKey).toBe('ed25519-priv');
  });

  test('the owning tenant reads the provider secrets back; another tenant gets null', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db } = makeProvidersDb();
    const svc = new ProviderService(db);
    await inTenantScope(db, TENANT_A, () =>
      svc.create({
        name: 'p',
        baseUrl: 'ws://x',
        apiKey: 'sk-provider',
        schemaConfig: { devicePrivateKey: 'ed25519-priv' },
      } as never),
    );

    const asA = await inTenantScope(db, TENANT_A, () => svc.getById('prov-1'));
    expect(asA.apiKey).toBe('sk-provider');

    const asB = await inTenantScope(db, TENANT_B, () => svc.getById('prov-1'));
    expect(asB.apiKey).toBeNull();
    expect((asB.schemaConfig as Record<string, unknown>).devicePrivateKey).toBeNull();
  });

  test('list() opens the secrets too — a read path missed here would fail closed silently', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db } = makeProvidersDb();
    const svc = new ProviderService(db);
    await inTenantScope(db, TENANT_A, () =>
      svc.create({ name: 'p', baseUrl: 'ws://x', apiKey: 'sk-provider' } as never),
    );
    const listed = await inTenantScope(db, TENANT_A, () => svc.list());
    expect(listed[0]?.apiKey).toBe('sk-provider');
  });
});

// ---------------------------------------------------------------------------
// global_settings.value where is_secret
// ---------------------------------------------------------------------------

function makeSettingsDb() {
  const rows: Array<Record<string, unknown>> = [];
  const history: Array<Record<string, unknown>> = [];
  const db: Record<string, unknown> = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    execute: async () => undefined,
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        const isHistory = table === settingChangeHistory;
        const promise = (async () => {
          if (isHistory) history.push(v);
        })();
        return Object.assign(promise, {
          returning: async () => {
            const row = { id: 'set-1', isSecret: true, ...v };
            rows.push(row);
            return [row];
          },
        });
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const row = rows[0];
            if (!row) return [];
            Object.assign(row, v);
            return [row];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (rows[0] ? [rows[0]] : []) }),
        $dynamic: () => ({ where: () => ({ orderBy: async () => rows }), orderBy: async () => rows }),
      }),
      $dynamic: () => ({ from: () => ({ orderBy: async () => rows }) }),
    }),
  };
  return { db: db as unknown as Database, rows, history };
}

describe('(g) global_settings secret values', () => {
  test('flag-off: a secret setting is stored as plaintext, byte-identical', async () => {
    const { db, rows } = makeSettingsDb();
    const svc = new SettingsService(db);
    await svc.setValue('elevenlabs.api_key', 'el-secret');
    expect(rows[0]?.value).toBe('el-secret');
  });

  test('KEY PRESENT but NO tenant scope: a secret setting stays plaintext and reads back', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeSettingsDb();
    const svc = new SettingsService(db);
    await svc.setValue('elevenlabs.api_key', 'el-secret');
    expect(isSealedCredentialField(rows[0]?.value)).toBe(false);
    expect(rows[0]?.value).toBe('el-secret');
    // And the scope-less reader still gets it — the surface is inert, not broken.
    expect(await svc.getSecret('elevenlabs.api_key')).toBe('el-secret');
  });

  test('tenant scope + key: an is_secret value is sealed at rest and opens for its tenant', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeSettingsDb();
    const svc = new SettingsService(db);

    await inTenantScope(db, TENANT_A, () => svc.setValue('elevenlabs.api_key', 'el-secret'));
    expect(isSealedCredentialField(rows[0]?.value)).toBe(true);
    expect(String(rows[0]?.value)).not.toContain('el-secret');

    const got = await inTenantScope(db, TENANT_A, () => svc.getSecret('elevenlabs.api_key'));
    expect(got).toBe('el-secret');
  });

  test('the change-history receipt records the SEALED value, never the plaintext', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, history } = makeSettingsDb();
    const svc = new SettingsService(db);
    await inTenantScope(db, TENANT_A, () => svc.setValue('elevenlabs.api_key', 'first-secret'));
    await inTenantScope(db, TENANT_A, () => svc.setValue('elevenlabs.api_key', 'second-secret'));

    expect(history.length).toBe(1);
    expect(JSON.stringify(history)).not.toContain('first-secret');
    expect(JSON.stringify(history)).not.toContain('second-secret');
  });

  test('a NON-secret setting is never sealed', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db, rows } = makeSettingsDb();
    rows.push({ id: 'set-1', key: 'tts.provider', value: 'elevenlabs', valueType: 'string', isSecret: false });
    const svc = new SettingsService(db);
    await inTenantScope(db, TENANT_A, () => svc.setValue('tts.provider', 'openai'));
    expect(rows[0]?.value).toBe('openai');
  });

  test('another tenant reading the sealed setting gets null, not the envelope', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const { db } = makeSettingsDb();
    const svc = new SettingsService(db);
    await inTenantScope(db, TENANT_A, () => svc.setValue('elevenlabs.api_key', 'el-secret'));
    const got = await inTenantScope(db, TENANT_B, () => svc.getSecret('elevenlabs.api_key'));
    expect(got).toBeUndefined();
  });
});
