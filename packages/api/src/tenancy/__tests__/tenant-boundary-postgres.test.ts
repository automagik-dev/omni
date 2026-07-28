/**
 * End-to-end tenant boundary against real PostgreSQL
 * (wish: omni-full-multitenancy, Group G3; ADR-0004, ADR-0005).
 *
 * `packages/db/src/rls-postgres.test.ts` proves the SERVER side: the policies,
 * the roles, the pooled-connection reset. This suite proves the APPLICATION
 * side against the same enforced schema — that `withTenantTransaction`,
 * `TenantInstanceRepository`, and `withPlatformTargetTenant` actually produce
 * those guarantees when a real request-shaped call goes through them, rather
 * than a hand-written `SELECT` that merely resembles what they emit.
 *
 * Set `OMNI_G3_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  createDbHandle,
} from '@omni/db';
import { sql } from 'drizzle-orm';
import { type PlatformAuthContext, type TenantAuthContext, freezeContext } from '../auth-context';
import { withPlatformTargetTenant } from '../platform-target-tenant';
import { TenantInstanceRepository } from '../tenant-repository';
import { TenantContextError, readTransactionTenantId, withTenantTransaction } from '../tenant-transaction';

const superUrl = process.env.OMNI_G3_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G3_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const PRINCIPAL_A = '33333333-3333-4333-8333-333333333331';
const INSTANCE_A = '55555555-5555-4555-8555-555555555551';
const INSTANCE_B = '55555555-5555-4555-8555-555555555552';
const CREDENTIAL_PLATFORM = '99999999-9999-4999-8999-999999999991';
const CREDENTIAL_TENANT = '99999999-9999-4999-8999-999999999992';

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-g3-api-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [psqlBin, '-X', '--no-psqlrc', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exitCode: result.exitCode, stderr: result.stderr.toString() };
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

function tenantContext(tenantId: string): TenantAuthContext {
  return freezeContext({
    credentialClass: 'tenant',
    requestId: 'req-boundary',
    principalId: PRINCIPAL_A,
    credentialId: CREDENTIAL_TENANT,
    tenantId,
    actorRole: 'tenant-admin',
    scopes: ['instances:write'],
    membershipId: '44444444-4444-4444-8444-444444444441',
    resourceConstraints: {},
    expiresAt: null,
    rateLimit: null,
    budget: null,
    delegationDepth: 0,
    rootKeyId: 'root-1',
    policyVersion: 1,
    revocationEpoch: 0,
    tenantKeyLineageId: 'lin-1',
  }) as TenantAuthContext;
}

const platformContext = freezeContext({
  credentialClass: 'platform',
  requestId: 'req-platform',
  principalId: PRINCIPAL_A,
  credentialId: CREDENTIAL_PLATFORM,
  scopes: ['platform:tenants:write'],
  platformApiKeyId: 'pk-1',
  platformAction: null,
  targetTenantId: null,
}) as PlatformAuthContext;

postgresDescribe('tenant boundary end-to-end (real PostgreSQL)', () => {
  const dbName = `omni_g3_api_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  let provisioner: Database;
  let runtimeDb: Database;
  const closers: (() => Promise<void>)[] = [];

  /** Independent pools, each closable on its own — see `createDbHandle`. */
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
    const superDbUrl = urlFor(superUrl, dbName);
    const migrated = runSqlOn(superDbUrl, migrations);
    if (migrated.exitCode !== 0) throw new Error(`migrations failed: ${migrated.stderr}`);

    const seeded = runSqlOn(
      superDbUrl,
      `
      INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
        ('${TENANT_A}', 'tenant-a', 'Tenant A', 86400, 100, 100),
        ('${TENANT_B}', 'tenant-b', 'Tenant B', 86400, 100, 100);
      INSERT INTO principals (id, type, subject) VALUES ('${PRINCIPAL_A}', 'human', 'subject-a');
      INSERT INTO instances (id, name, channel, tenant_id) VALUES
        ('${INSTANCE_A}', 'instance-a', 'whatsapp-baileys', '${TENANT_A}'),
        ('${INSTANCE_B}', 'instance-b', 'whatsapp-baileys', '${TENANT_B}');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    // max: 1 — every call below provably shares ONE physical connection, which
    // is what makes the leakage assertions meaningful.
    runtimeDb = openDb(urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }), 1);
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  describe('withTenantTransaction', () => {
    test('stamps the context and the repository sees only its own tenant', async () => {
      const rows = await withTenantTransaction(runtimeDb, tenantContext(TENANT_A), (tx) =>
        TenantInstanceRepository.list(tx),
      );
      expect(rows.map((r) => r.id)).toEqual([INSTANCE_A]);
    });

    test('the setting is transaction-local — it does not survive on the pooled connection', async () => {
      await withTenantTransaction(runtimeDb, tenantContext(TENANT_A), async (tx) => {
        expect(await readTransactionTenantId(tx)).toBe(TENANT_A);
      });
      expect(await readTransactionTenantId(runtimeDb)).toBeNull();
    });

    test('a second transaction on the reused connection is scoped to ITS tenant', async () => {
      const a = await withTenantTransaction(runtimeDb, tenantContext(TENANT_A), (tx) =>
        TenantInstanceRepository.list(tx),
      );
      const b = await withTenantTransaction(runtimeDb, tenantContext(TENANT_B), (tx) =>
        TenantInstanceRepository.list(tx),
      );
      expect(a.map((r) => r.id)).toEqual([INSTANCE_A]);
      expect(b.map((r) => r.id)).toEqual([INSTANCE_B]);
    });

    test('a cross-tenant id lookup returns nothing rather than leaking existence', async () => {
      const row = await withTenantTransaction(runtimeDb, tenantContext(TENANT_A), (tx) =>
        TenantInstanceRepository.findById(tx, INSTANCE_B),
      );
      expect(row).toBeUndefined();
    });

    test('a repository query outside the boundary is refused by the server', async () => {
      // Drizzle's `execute` returns a thenable builder, not a Promise, so it is
      // awaited inside an async wrapper before the rejection is asserted.
      await expect(
        (async () => {
          await runtimeDb.execute(sql`SELECT id FROM instances`);
        })(),
      ).rejects.toThrow(/app\.tenant_id is not set/);
    });

    test('a tenant-less context is refused before any statement runs', async () => {
      await expect(withTenantTransaction(runtimeDb, platformContext, async () => 'unreachable')).rejects.toThrow(
        TenantContextError,
      );
      // The connection is untouched and still usable.
      expect(await readTransactionTenantId(runtimeDb)).toBeNull();
    });

    test('an error inside the boundary rolls back and leaves no context behind', async () => {
      await expect(
        withTenantTransaction(runtimeDb, tenantContext(TENANT_A), async (tx) => {
          await TenantInstanceRepository.create(tx, {
            name: 'rolled-back',
            channel: 'whatsapp-baileys',
            tenantId: TENANT_A,
          });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      const rows = await withTenantTransaction(runtimeDb, tenantContext(TENANT_A), (tx) =>
        TenantInstanceRepository.list(tx),
      );
      expect(rows.map((r) => r.name)).not.toContain('rolled-back');
      expect(await readTransactionTenantId(runtimeDb)).toBeNull();
    });
  });

  describe('repository writes under policy', () => {
    test('an in-tenant insert is accepted and stamped', async () => {
      const created = await withTenantTransaction(runtimeDb, tenantContext(TENANT_A), (tx) =>
        TenantInstanceRepository.create(tx, { name: 'created-a', channel: 'whatsapp-baileys', tenantId: TENANT_A }),
      );
      expect(created.tenantId).toBe(TENANT_A);
      await withTenantTransaction(runtimeDb, tenantContext(TENANT_A), (tx) =>
        TenantInstanceRepository.remove(tx, created.id),
      );
    });

    test('an insert carrying another tenant id is rejected by WITH CHECK', async () => {
      await expect(
        withTenantTransaction(runtimeDb, tenantContext(TENANT_A), (tx) =>
          TenantInstanceRepository.create(tx, { name: 'cross', channel: 'whatsapp-baileys', tenantId: TENANT_B }),
        ),
      ).rejects.toThrow(/row-level security policy/i);
    });

    test('re-tenanting an own row is rejected by WITH CHECK', async () => {
      await expect(
        withTenantTransaction(runtimeDb, tenantContext(TENANT_A), (tx) =>
          TenantInstanceRepository.setTenant(tx, INSTANCE_A, TENANT_B),
        ),
      ).rejects.toThrow(/row-level security policy/i);
    });

    test('updating another tenant row affects nothing', async () => {
      const updated = await withTenantTransaction(runtimeDb, tenantContext(TENANT_A), (tx) =>
        TenantInstanceRepository.rename(tx, INSTANCE_B, 'hijacked'),
      );
      expect(updated).toBeUndefined();
    });

    test('deleting another tenant row affects nothing', async () => {
      const deleted = await withTenantTransaction(runtimeDb, tenantContext(TENANT_A), (tx) =>
        TenantInstanceRepository.remove(tx, INSTANCE_B),
      );
      expect(deleted).toBe(0);
    });
  });

  describe('platform-admin target tenant (ADR-0005)', () => {
    test('one target tenant, same forced policies, audit row in the same transaction', async () => {
      const result = await withPlatformTargetTenant(
        runtimeDb,
        platformContext,
        {
          targetTenantId: TENANT_B,
          action: 'tenant.instance.rename',
          reason: 'support ticket 42',
          before: { name: 'instance-b' },
        },
        async (tx) => {
          const renamed = await TenantInstanceRepository.rename(tx, INSTANCE_B, 'instance-b-renamed');
          return { value: renamed?.name ?? null, after: { name: renamed?.name } };
        },
      );

      expect(result.value).toBe('instance-b-renamed');
      expect(result.targetTenantId).toBe(TENANT_B);
      expect(result.auditId).toBeTruthy();

      const audit = (await provisioner.execute(
        sql`SELECT tenant_id, action, request_id, metadata FROM tenant_audit_logs WHERE id = ${result.auditId}`,
      )) as unknown as { tenant_id: string; action: string; request_id: string; metadata: Record<string, unknown> }[];
      expect(audit[0]?.tenant_id).toBe(TENANT_B);
      expect(audit[0]?.action).toBe('tenant.instance.rename');
      expect(audit[0]?.request_id).toBe('req-platform');
      expect(audit[0]?.metadata.reason).toBe('support ticket 42');
      expect(audit[0]?.metadata.before).toEqual({ name: 'instance-b' });
      expect(audit[0]?.metadata.after).toEqual({ name: 'instance-b-renamed' });

      // Restore for any later ordering.
      await withPlatformTargetTenant(
        runtimeDb,
        platformContext,
        { targetTenantId: TENANT_B, action: 'tenant.instance.rename', reason: 'restore' },
        async (tx) => ({ value: await TenantInstanceRepository.rename(tx, INSTANCE_B, 'instance-b') }),
      );
    });

    test('the platform operation cannot see a second tenant in the same transaction', async () => {
      const seen = await withPlatformTargetTenant(
        runtimeDb,
        platformContext,
        { targetTenantId: TENANT_B, action: 'tenant.instance.read', reason: 'audit' },
        async (tx) => ({ value: await TenantInstanceRepository.findById(tx, INSTANCE_A) }),
      );
      expect(seen.value).toBeUndefined();
    });

    test('a missing reason is refused before the transaction opens', async () => {
      await expect(
        withPlatformTargetTenant(
          runtimeDb,
          platformContext,
          { targetTenantId: TENANT_B, action: 'tenant.instance.read', reason: '  ' },
          async () => ({ value: null }),
        ),
      ).rejects.toThrow(/explicit reason is required/);
    });

    test('a tenant-class credential cannot use the platform path', async () => {
      await expect(
        withPlatformTargetTenant(
          runtimeDb,
          tenantContext(TENANT_A) as unknown as PlatformAuthContext,
          { targetTenantId: TENANT_B, action: 'tenant.instance.read', reason: 'escalation attempt' },
          async () => ({ value: null }),
        ),
      ).rejects.toThrow(/platform-class credential is required/);
    });

    test('a failed platform operation writes no audit row', async () => {
      await expect(
        withPlatformTargetTenant(
          runtimeDb,
          platformContext,
          { targetTenantId: TENANT_B, action: 'tenant.instance.fail', reason: 'probe' },
          async () => {
            throw new Error('operation failed');
          },
        ),
      ).rejects.toThrow('operation failed');

      const rows = (await provisioner.execute(
        sql`SELECT count(*)::int AS n FROM tenant_audit_logs WHERE action = 'tenant.instance.fail'`,
      )) as unknown as { n: number }[];
      expect(Number(rows[0]?.n)).toBe(0);
    });
  });
});
