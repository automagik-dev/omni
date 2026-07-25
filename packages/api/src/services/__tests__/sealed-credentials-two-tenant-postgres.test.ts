/**
 * Deliverable (g) over REAL PostgreSQL + RLS — the credential surfaces run14
 * sealed (wish: omni-full-multitenancy, Group G5; ADR-0008;
 * OWNERSHIP_MANIFEST `filesystem_session_state`).
 *
 * The unit probes prove the CODEC and the service wiring against fakes. This
 * suite proves the thing a fake cannot: that the seal survives a round trip
 * through actual columns, under actual row-level security, with two tenants
 * whose rows sit in the same tables — and that the two protections are
 * INDEPENDENT rather than one dressed up as two.
 *
 * That independence is the point worth testing. RLS alone would already hide
 * tenant A's instance from tenant B, so a cross-tenant read failing proves
 * nothing about the sealing. So the adversary here is stronger than RLS: the
 * final block reads the ciphertext out with a SUPERUSER connection — the
 * database-level bypass an RLS-only design has no answer for — and then tries to
 * open it as the other tenant. It still fails, because the tenant is both the
 * HKDF salt for the DEK and the AEAD associated data.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you (it auto-discovers `*-postgres.test.ts` suites, so this file
 * needs no gate edit). No ambient `DATABASE_URL` is read.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTenantSecretMasterKey } from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  createDbHandle,
} from '@omni/db';
import { isSealedCredentialField, openCredentialField } from '../../tenancy/sealed-credentials';
import { runInWorkerTenantScope } from '../../tenancy/worker-tenant-context';
import { InstanceService } from '../instances';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const TENANT_A = '11111111-1111-4111-8111-1111111111da';
const TENANT_B = '22222222-2222-4222-8222-2222222222db';
const INSTANCE_A = '55555555-5555-4555-8555-5555555555da';
const INSTANCE_B = '55555555-5555-4555-8555-5555555555db';
const SHARED_TIMESTAMP = '2026-01-01 00:00:00+00';

/**
 * Repo-local, synthetic, per-run key material. Never read from an environment
 * variable, a file, or a secret store — live KMS/Vault custody is the named G5
 * deferral, and this file must not be the thing that quietly introduces it.
 */
const MASTER_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));

/** The plaintext bot tokens. If either appears in a column, the leg has failed. */
const TOKEN_A = 'discord-bot-token-for-tenant-A';
const TOKEN_B = 'discord-bot-token-for-tenant-B';

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stdout: string; stderr: string } {
  const file = join(tmpdir(), `omni-g5-sealed-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [psqlBin, '-X', '--no-psqlrc', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  } finally {
    rmSync(file, { force: true });
  }
}

function urlFor(base: string, database: string, user?: { name: string; password: string }): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  if (user) {
    url.username = user.name;
    url.password = user.password;
  }
  return url.toString();
}

postgresDescribe('two-tenant sealed credentials at rest (real PostgreSQL)', () => {
  const dbName = `omni_g5_seal_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  let runtimeDb: Database;
  let superDbUrl: string;

  function openDb(url: string, maxConnections: number): Database {
    const handle = createDbHandle({ url, maxConnections });
    closers.push(() => handle.close().catch(() => undefined));
    return handle.db;
  }

  beforeAll(async () => {
    const created = runSqlOn(superUrl, `CREATE DATABASE "${dbName}";`);
    if (created.exitCode !== 0) throw new Error(`could not create database: ${created.stderr}`);

    const migrations = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(drizzleDir, f), 'utf-8'))
      .join('\n');
    superDbUrl = urlFor(superUrl, dbName);
    const migrated = runSqlOn(superDbUrl, migrations);
    if (migrated.exitCode !== 0) throw new Error(`migrations failed: ${migrated.stderr}`);

    const seeded = runSqlOn(
      superDbUrl,
      `
      INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
        ('${TENANT_A}', 'seal-tenant-a', 'Tenant A', 86400, 100, 100),
        ('${TENANT_B}', 'seal-tenant-b', 'Tenant B', 86400, 100, 100);

      -- Both instances exist BEFORE any sealing, with NULL credential columns:
      -- the service updates them under each tenant's scope below, which is the
      -- real write path (routes/v2/instances.ts calls exactly this).
      INSERT INTO instances (id, name, channel, tenant_id, created_at) VALUES
        ('${INSTANCE_A}', 'seal-inst-a', 'discord', '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${INSTANCE_B}', 'seal-inst-b', 'discord', '${TENANT_B}', '${SHARED_TIMESTAMP}');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    // maxConnections=2, for the same reason as the sibling suites: an ambient
    // (un-scoped) access takes the second connection, where `app.tenant_id` is
    // unset and `omni_current_tenant_id()` RAISES — a loud failure, not a leak.
    runtimeDb = openDb(urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }), 2);
  }, 180_000);

  afterAll(async () => {
    setTenantSecretMasterKey(null);
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  afterEach(() => setTenantSecretMasterKey(null));

  /** Read a credential column with the SUPERUSER connection — bypassing RLS. */
  function readColumnAsSuperuser(instanceId: string, column: string): string {
    const result = runSqlOn(
      superDbUrl,
      `SELECT coalesce("${column}", '<null>') FROM instances WHERE id = '${instanceId}';`,
    );
    if (result.exitCode !== 0) throw new Error(`superuser read failed: ${result.stderr}`);
    return result.stdout.trim();
  }

  test('flag-off (no master key): the column holds the plaintext token, byte-identical', async () => {
    setTenantSecretMasterKey(null);
    const svc = new InstanceService(runtimeDb, null);

    await runInWorkerTenantScope(runtimeDb, TENANT_A, () =>
      svc.update(INSTANCE_A, { discordBotToken: 'plaintext-legacy-token' }),
    );

    expect(readColumnAsSuperuser(INSTANCE_A, 'discord_bot_token')).toBe('plaintext-legacy-token');

    const read = await runInWorkerTenantScope(runtimeDb, TENANT_A, () => svc.getById(INSTANCE_A));
    expect(read.discordBotToken).toBe('plaintext-legacy-token');
  });

  test('with a key: the column holds NO plaintext, and the owner still reads its token', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const svc = new InstanceService(runtimeDb, null);

    await runInWorkerTenantScope(runtimeDb, TENANT_A, () => svc.update(INSTANCE_A, { discordBotToken: TOKEN_A }));
    await runInWorkerTenantScope(runtimeDb, TENANT_B, () => svc.update(INSTANCE_B, { discordBotToken: TOKEN_B }));

    const atRestA = readColumnAsSuperuser(INSTANCE_A, 'discord_bot_token');
    expect(atRestA).not.toContain(TOKEN_A);
    expect(isSealedCredentialField(atRestA)).toBe(true);

    const aReadsA = await runInWorkerTenantScope(runtimeDb, TENANT_A, () => svc.getById(INSTANCE_A));
    expect(aReadsA.discordBotToken).toBe(TOKEN_A);

    const bReadsB = await runInWorkerTenantScope(runtimeDb, TENANT_B, () => svc.getById(INSTANCE_B));
    expect(bReadsB.discordBotToken).toBe(TOKEN_B);
  });

  test('RLS hides the row: tenant B’s scope cannot even load tenant A’s instance', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const svc = new InstanceService(runtimeDb, null);

    await runInWorkerTenantScope(runtimeDb, TENANT_A, () => svc.update(INSTANCE_A, { discordBotToken: TOKEN_A }));

    // `getById` throws NotFoundError rather than returning a foreign row — the
    // first of the two independent layers.
    await expect(runInWorkerTenantScope(runtimeDb, TENANT_B, () => svc.getById(INSTANCE_A))).rejects.toThrow();
  });

  test('SEALING SURVIVES AN RLS BYPASS: the ciphertext lifted by a superuser is still unopenable as tenant B', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const svc = new InstanceService(runtimeDb, null);

    await runInWorkerTenantScope(runtimeDb, TENANT_A, () => svc.update(INSTANCE_A, { discordBotToken: TOKEN_A }));

    // The adversary an RLS-only design cannot answer: a database-level read that
    // ignores every policy. It gets the bytes — and the bytes are useless.
    const stolen = readColumnAsSuperuser(INSTANCE_A, 'discord_bot_token');
    expect(isSealedCredentialField(stolen)).toBe(true);

    expect(openCredentialField(TENANT_B, stolen)).toBeNull();
    // Rewriting the stored tenant label does not help either: the label is not
    // what the key or the AAD is derived from.
    const forged = JSON.stringify({ ...JSON.parse(stolen), t: TENANT_B });
    expect(openCredentialField(TENANT_B, forged)).toBeNull();

    // ...and the rightful owner opens it, so this is a binding, not a brick.
    expect(openCredentialField(TENANT_A, stolen)).toBe(TOKEN_A);
  });

  test('the seal is re-derived per tenant: two tenants sealing the SAME secret produce different bytes', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const svc = new InstanceService(runtimeDb, null);
    const sameSecret = 'identical-token-in-both-tenants';

    await runInWorkerTenantScope(runtimeDb, TENANT_A, () => svc.update(INSTANCE_A, { discordBotToken: sameSecret }));
    await runInWorkerTenantScope(runtimeDb, TENANT_B, () => svc.update(INSTANCE_B, { discordBotToken: sameSecret }));

    const atRestA = readColumnAsSuperuser(INSTANCE_A, 'discord_bot_token');
    const atRestB = readColumnAsSuperuser(INSTANCE_B, 'discord_bot_token');
    expect(atRestA).not.toBe(atRestB);
    expect(openCredentialField(TENANT_A, atRestB)).toBeNull();
    expect(openCredentialField(TENANT_B, atRestA)).toBeNull();
  });

  test('a row sealed for A degrades to null — never the envelope — when the key is withdrawn', async () => {
    setTenantSecretMasterKey(MASTER_KEY);
    const svc = new InstanceService(runtimeDb, null);
    await runInWorkerTenantScope(runtimeDb, TENANT_A, () => svc.update(INSTANCE_A, { discordBotToken: TOKEN_A }));

    setTenantSecretMasterKey(null);
    const read = await runInWorkerTenantScope(runtimeDb, TENANT_A, () => svc.getById(INSTANCE_A));
    expect(read.discordBotToken).toBeNull();
  });
});
