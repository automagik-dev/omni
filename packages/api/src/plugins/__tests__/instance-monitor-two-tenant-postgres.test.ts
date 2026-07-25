/**
 * The instance monitor's converted sweeps over real PostgreSQL + RLS
 * (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0003).
 *
 * WHY A REAL-POSTGRES SUITE FOR THIS FILE SPECIFICALLY
 * ----------------------------------------------------
 * The in-memory probes fake `select()` with a stub that returns the seeded rows
 * regardless of scope and never raises. They therefore cannot test the premise
 * the whole `runForEachActiveTenantRow` shape rests on: that under RLS
 * enforcement a whole-table scan is NOT EXPRESSIBLE, so a cron must enumerate.
 * Against a stub, an implementation that opens a tenant scope and then queries
 * the ambient pool is indistinguishable from one that queries the tenant
 * transaction — and that was exactly the state of this file: it never called
 * `scopedHandle`, so every "scoped" read went to a different pooled connection
 * that never saw `set_config('app.tenant_id', …, true)`. Under enforcement each
 * pass would have RAISED `insufficient_privilege`, been swallowed by the
 * fan-out's per-tenant catch, and instance health monitoring plus auto-reconnect
 * would have stopped for EVERY tenant with all unit tests green.
 *
 * So these tests are the counter-evidence: the same sweeps, run by the runtime
 * (NOBYPASSRLS) role against FORCE RLS, asserting that each tenant's pass sees
 * its OWN instances and only those.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChannelRegistry } from '@omni/channel-sdk';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  createDbHandle,
  instances,
} from '@omni/db';
import { eq } from 'drizzle-orm';
import { MULTITENANCY_FLAG_ENV } from '../../tenancy/feature-flag';
import { __resetInstanceOwnerRegistry, rememberInstanceOwners } from '../../tenancy/instance-owner-registry';
import { InstanceMonitor, reconnectWithPool } from '../instance-monitor';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const INSTANCE_A = '55555555-5555-4555-8555-55555555555a';
const INSTANCE_B = '55555555-5555-4555-8555-55555555555b';
const SEED_TIMESTAMP = '2026-01-01 00:00:00+00';

/** Flag ON and enforcement ON. `'on'` is the only value `resolveEnforcementMode` accepts. */
const ENFORCED_ENV: NodeJS.ProcessEnv = { [MULTITENANCY_FLAG_ENV]: 'true', OMNI_DB_ENFORCEMENT: 'on' };

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-g5-im-${crypto.randomUUID()}.sql`);
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

/** A registry that reports every instance healthy and records what it was asked about. */
function makeRegistry(probed: string[], connected: string[]): ChannelRegistry {
  return {
    get: () => ({
      getStatus: async (instanceId: string) => {
        probed.push(instanceId);
        return { state: 'connected' as const };
      },
      connect: async (instanceId: string) => {
        connected.push(instanceId);
      },
    }),
  } as unknown as ChannelRegistry;
}

postgresDescribe('instance-monitor sweeps under real RLS enforcement', () => {
  const dbName = `omni_g5_im_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  let runtimeDb: Database;
  let authPlaneDb: Database;

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

      INSERT INTO instances (id, name, channel, tenant_id, is_active, owner_identifier, created_at) VALUES
        ('${INSTANCE_A}', 'inst-a', 'whatsapp-baileys', '${TENANT_A}', true, 'owner-a', '${SEED_TIMESTAMP}'),
        ('${INSTANCE_B}', 'inst-b', 'whatsapp-baileys', '${TENANT_B}', true, 'owner-b', '${SEED_TIMESTAMP}');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    // More than one connection deliberately: a regression that queries the
    // ambient pool from INSIDE a worker transaction would deadlock on a
    // single-connection pool (waiting for the connection the transaction holds)
    // instead of failing, and a hang is a much worse gate than an assertion.
    runtimeDb = openDb(urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }), 5);
    // ADR-0003: the auth plane is the only runtime-process identity that may
    // enumerate `tenants`, which is what the fan-out needs.
    authPlaneDb = openDb(
      urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.authPlane, password: passwords.authPlane }),
      2,
    );
  }, 180_000);

  afterEach(() => __resetInstanceOwnerRegistry());

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test('the CONTROL: an unscoped whole-table instances read is refused, not empty', async () => {
    // This is the premise the enumeration exists for. `omni_current_tenant_id()`
    // RAISES with no transaction context, so the pre-G5 ambient scan is not
    // expressible at all under enforcement — it is an ERROR, not a silent [].
    // Awaited inside an async thunk: a drizzle query builder is thenable but not
    // a Promise, and `expect(...).rejects` requires a real one.
    await expect(
      (async () => runtimeDb.select().from(instances).where(eq(instances.isActive, true)))(),
    ).rejects.toThrow(/app\.tenant_id/);
  });

  test('the 30s health sweep probes EVERY tenant’s instances, and only its own per pass', async () => {
    const probed: string[] = [];
    const monitor = new InstanceMonitor(runtimeDb, makeRegistry(probed, []));
    monitor.setAuthPlane(authPlaneDb, ENFORCED_ENV);

    await monitor.runHealthCheck();

    // Both tenants were enumerated and each pass's scoped read succeeded. A
    // read issued on the ambient pool inside the scope would have raised, the
    // fan-out would have swallowed it as `periodic tenant pass failed`, and this
    // would be `[]` — health monitoring silently dead for every tenant.
    expect(probed.sort()).toEqual([INSTANCE_A, INSTANCE_B].sort());
  });

  test('the once-per-boot reconnect sweep reconnects every tenant’s instances', async () => {
    const connected: string[] = [];

    const results = await reconnectWithPool(runtimeDb, makeRegistry([], connected), {
      delayBetweenMs: 0,
      authPlaneDb,
      env: ENFORCED_ENV,
    });

    expect(results.attempted).toBe(2);
    expect(results.failed).toBe(0);
    expect(connected.sort()).toEqual([INSTANCE_A, INSTANCE_B].sort());
  });

  test('the single-row read runs in the INSTANCE’s own tenant scope', async () => {
    // The registry is the trusted instance→tenant derivation; a boot/health
    // sweep seeds it from the rows it loaded, exactly as here.
    rememberInstanceOwners([{ id: INSTANCE_A, tenantId: TENANT_A }]);
    const connected: string[] = [];
    const monitor = new InstanceMonitor(runtimeDb, makeRegistry([], connected), {
      backoffBaseMs: 1,
      maxReconnectAttempts: 5,
    });
    monitor.setAuthPlane(authPlaneDb, ENFORCED_ENV);

    // `forceReconnect` → `fetchInstanceById`: it must find the row (its scope is
    // the instance's own tenant) rather than fail closed.
    await expect(monitor.forceReconnect(INSTANCE_A)).resolves.toBeUndefined();
  });

  test('an instance whose ownership was never observed fails closed rather than reading globally', async () => {
    // No `rememberInstanceOwners` for B: `tenantOf` yields null, the block stays
    // ambient, and under enforcement an ambient `instances` read is refused —
    // the correct posture, and emphatically not a global read.
    const monitor = new InstanceMonitor(runtimeDb, makeRegistry([], []));
    monitor.setAuthPlane(authPlaneDb, ENFORCED_ENV);

    await expect(monitor.forceReconnect(INSTANCE_B)).rejects.toThrow(/app\.tenant_id/);
  });
});
