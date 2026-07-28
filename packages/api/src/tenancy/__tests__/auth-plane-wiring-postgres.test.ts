/**
 * Auth-plane connection wiring against real PostgreSQL
 * (wish: omni-full-multitenancy, Group G4; ADR-0003, ADR-0004).
 *
 * G3's review left this as its one residual: under enforcement,
 * `MembershipSelectionService` — and therefore `RequestAuthenticator`'s
 * confirming-hint path — must read on the AUTH-PLANE role's connection. Wired to
 * the runtime role it fails closed rather than open, which is safe and still
 * wrong: a caller sending a correct tenant header would be rejected while the
 * same caller sending no header succeeds.
 *
 * "Fails closed if miswired" is exactly the kind of claim that a mock cannot
 * settle, because the thing being asserted IS the server's policy decision. So
 * this suite provisions the real roles against the real schema with RLS forced
 * and asks the server directly, on both identities.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  ENFORCEMENT_ENV_VAR,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  createDbHandle,
} from '@omni/db';
import { AUTH_PLANE_URL_ENV_VAR, resolveAuthPlaneConnection } from '../auth-plane-connection';
import { MembershipSelectionService } from '../request-auth';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL_A = '33333333-3333-4333-8333-333333333331';
const MEMBERSHIP_A = '44444444-4444-4444-8444-444444444441';

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-g4-authplane-${crypto.randomUUID()}.sql`);
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

postgresDescribe('auth-plane wiring (real PostgreSQL)', () => {
  const dbName = `omni_g4_authplane_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  let runtimeUrl = '';
  let authPlaneUrl = '';
  let runtimeDb: Database;

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
      INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget)
        VALUES ('${TENANT_A}', 'tenant-a', 'Tenant A', 86400, 100, 100);
      INSERT INTO principals (id, type, subject) VALUES ('${PRINCIPAL_A}', 'human', 'subject-a');
      INSERT INTO tenant_memberships (id, tenant_id, principal_id, role, status)
        VALUES ('${MEMBERSHIP_A}', '${TENANT_A}', '${PRINCIPAL_A}', 'tenant-admin', 'active');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    runtimeUrl = urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime });
    authPlaneUrl = urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.authPlane, password: passwords.authPlane });
    runtimeDb = openDb(runtimeUrl, 2);
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test('MISWIRED to the runtime role, the confirming-hint membership read fails closed', async () => {
    // This is the state G3 shipped. It is asserted rather than described,
    // because "it would fail closed" is the premise the fix rests on: if this
    // ever started returning true, the runtime role would have gained
    // pre-context read access to tenant_memberships and the fix below would be
    // hiding a much worse regression.
    const miswired = new MembershipSelectionService(runtimeDb);
    let active: boolean;
    try {
      active = await miswired.isActiveMembership(TENANT_A, PRINCIPAL_A, MEMBERSHIP_A);
    } catch {
      // Denied by grant/policy before returning a row — also closed.
      active = false;
    }
    expect(active).toBe(false);
  });

  test('WIRED to the auth-plane role, the same read succeeds', async () => {
    const authPlaneDb = openDb(authPlaneUrl, 2);
    const wired = new MembershipSelectionService(authPlaneDb);
    expect(await wired.isActiveMembership(TENANT_A, PRINCIPAL_A, MEMBERSHIP_A)).toBe(true);
  });

  test('the auth-plane read is identity-checked, not merely status-checked', async () => {
    const authPlaneDb = openDb(authPlaneUrl, 2);
    const wired = new MembershipSelectionService(authPlaneDb);
    // Right tenant, right principal, WRONG membership row id: a grant that was
    // replaced is a different grant.
    expect(await wired.isActiveMembership(TENANT_A, PRINCIPAL_A, '44444444-4444-4444-8444-4444444444ff')).toBe(false);
  });

  test('resolveAuthPlaneConnection returns the dedicated pool under enforcement', async () => {
    const connection = resolveAuthPlaneConnection(runtimeDb, {
      [ENFORCEMENT_ENV_VAR]: 'on',
      [AUTH_PLANE_URL_ENV_VAR]: authPlaneUrl,
    });
    closers.push(() => connection.close().catch(() => undefined));

    expect(connection.source).toBe('dedicated-auth-plane-role');
    expect(connection.db).not.toBe(runtimeDb);
    // And it is genuinely the auth-plane identity, not just a second pool.
    expect(
      await new MembershipSelectionService(connection.db).isActiveMembership(TENANT_A, PRINCIPAL_A, MEMBERSHIP_A),
    ).toBe(true);
  });

  test('legacy mode shares the runtime handle and opens nothing', async () => {
    // The dual-world invariant, asserted against a real connection: with the
    // enforcement variable absent, the auth plane is byte-for-byte the object
    // the service layer used before G4.
    const connection = resolveAuthPlaneConnection(runtimeDb, {});
    expect(connection.source).toBe('runtime-shared');
    expect(connection.db).toBe(runtimeDb);
    await connection.close();
  });

  test('enforcement without an auth-plane URL keeps G3’s documented shared fallback', async () => {
    const connection = resolveAuthPlaneConnection(runtimeDb, { [ENFORCEMENT_ENV_VAR]: 'on' });
    expect(connection.source).toBe('runtime-shared');
    expect(connection.db).toBe(runtimeDb);
    await connection.close();
  });
});
