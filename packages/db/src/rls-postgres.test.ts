/**
 * Real PostgreSQL enforcement for the G3 tenant boundary
 * (wish: omni-full-multitenancy, Group G3; ADR-0003, ADR-0004, ADR-0005).
 *
 * Set `OMNI_G3_POSTGRES_URL` to a DISPOSABLE PostgreSQL superuser URL. Every run
 * creates its own database, provisions its own synthetic role passwords, and
 * drops the database afterwards. No ambient `DATABASE_URL`, no shared cluster,
 * no application data. `scripts/pg-gate.ts` stands one up for you.
 *
 * WHY A SERVER IS MANDATORY HERE
 * ------------------------------
 * Every claim G3 makes is a claim about what PostgreSQL DENIES, and a denial
 * cannot be asserted from a string. "The policy fails closed", "FORCE binds the
 * owner", "a NOBYPASSRLS role cannot turn row security off", "the setting does
 * not survive the transaction on a pooled connection" — each of those is a
 * property of the server, and the only honest test is to try it and be refused.
 *
 * The suite builds BOTH worlds the wish's state machine describes:
 *
 *   * a LEGACY database — migrations applied, nothing else — which must behave
 *     exactly as it does at G2, NULL owners and all;
 *   * an ENFORCED database — same migrations, then roles, then policies — where
 *     every isolation property must hold.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { type Database, createDbHandle } from './client';
import { DEFAULT_ROLE_NAMES, applyTenantRlsEnforcement, readEnforcementState } from './tenancy-rls';
import { applyTenancyRoles, readRoleAttributes, roleAttributeViolations } from './tenancy-roles';
import { EnforcementStartupError, assertEnforcedRuntimeIdentity } from './tenancy-startup';

const superUrl = process.env.OMNI_G3_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G3_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', 'drizzle');

/** Every committed migration, in order — the real schema, not a hand-written subset. */
const allMigrations = readdirSync(drizzleDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(drizzleDir, f), 'utf-8'))
  .join('\n');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const PRINCIPAL_A = '33333333-3333-4333-8333-333333333331';
const PRINCIPAL_B = '33333333-3333-4333-8333-333333333332';
const MEMBERSHIP_A = '44444444-4444-4444-8444-444444444441';
const MEMBERSHIP_B = '44444444-4444-4444-8444-444444444442';
const INSTANCE_A = '55555555-5555-4555-8555-555555555551';
const INSTANCE_B = '55555555-5555-4555-8555-555555555552';
const LEGACY_INSTANCE = '55555555-5555-4555-8555-55555555550f';

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

interface SqlResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Multi-statement script through psql. A temp file, because stdin truncates ~120 KB of migrations. */
function runSqlOn(url: string, script: string): SqlResult {
  const file = join(tmpdir(), `omni-g3-${crypto.randomUUID()}.sql`);
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

function createDatabase(name: string): void {
  const result = runSqlOn(superUrl, `CREATE DATABASE "${name}";`);
  if (result.exitCode !== 0) throw new Error(`could not create ${name}: ${result.stderr}`);
}

/**
 * Rows both worlds start from: one legacy NULL-owner instance (exactly what a
 * pre-tenant deployment holds), plus two tenants with one instance each.
 */
const SEED = `
INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
  ('${TENANT_A}', 'tenant-a', 'Tenant A', 86400, 100, 100),
  ('${TENANT_B}', 'tenant-b', 'Tenant B', 86400, 100, 100);
INSERT INTO principals (id, type, subject) VALUES
  ('${PRINCIPAL_A}', 'human', 'subject-a'),
  ('${PRINCIPAL_B}', 'human', 'subject-b');
INSERT INTO tenant_memberships (id, tenant_id, principal_id, role) VALUES
  ('${MEMBERSHIP_A}', '${TENANT_A}', '${PRINCIPAL_A}', 'tenant-admin'),
  ('${MEMBERSHIP_B}', '${TENANT_B}', '${PRINCIPAL_B}', 'tenant-admin');
INSERT INTO instances (id, name, channel, tenant_id) VALUES
  ('${LEGACY_INSTANCE}', 'legacy-instance', 'whatsapp', NULL),
  ('${INSTANCE_A}', 'instance-a', 'whatsapp', '${TENANT_A}'),
  ('${INSTANCE_B}', 'instance-b', 'whatsapp', '${TENANT_B}');
INSERT INTO tenant_key_lineage (id, tenant_id, principal_id, membership_id, actor_role, name, key_prefix,
                                scopes, root_key_id) VALUES
  ('77777777-7777-4777-8777-777777777771', '${TENANT_A}', '${PRINCIPAL_A}', '${MEMBERSHIP_A}', 'tenant-admin',
   'key-a', 'omni_a', ARRAY['messages:read'], '77777777-7777-4777-8777-777777777771'),
  ('77777777-7777-4777-8777-777777777772', '${TENANT_B}', '${PRINCIPAL_B}', '${MEMBERSHIP_B}', 'tenant-admin',
   'key-b', 'omni_b', ARRAY['messages:read'], '77777777-7777-4777-8777-777777777772');
INSERT INTO tenant_audit_logs (id, tenant_id, actor_principal_id, actor_credential_id, action, request_id) VALUES
  ('88888888-8888-4888-8888-888888888881', '${TENANT_A}', '${PRINCIPAL_A}', '${PRINCIPAL_A}', 'seed', 'req-seed-a'),
  ('88888888-8888-4888-8888-888888888882', '${TENANT_B}', '${PRINCIPAL_B}', '${PRINCIPAL_B}', 'seed', 'req-seed-b');
INSERT INTO chats (id, external_id, chat_type, channel, instance_id) VALUES
  ('66666666-6666-4666-8666-66666666660f', 'legacy-chat', 'direct', 'whatsapp', '${LEGACY_INSTANCE}'),
  ('66666666-6666-4666-8666-666666666661', 'chat-a', 'direct', 'whatsapp', '${INSTANCE_A}'),
  ('66666666-6666-4666-8666-666666666662', 'chat-b', 'direct', 'whatsapp', '${INSTANCE_B}');
`;

interface Handle {
  /** Drizzle handle, for the modules under test. */
  readonly db: Database;
  /** Raw postgres.js handle, for the probes that must issue exact SQL. */
  readonly raw: postgres.Sql;
  readonly close: () => Promise<void>;
}

/**
 * One pool per identity. `createDbHandle` rather than `createDb` because four
 * of these are open simultaneously and each must be closable on its own.
 */
function connect(url: string, max = 5): Handle {
  const raw = postgres(url, { max, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
  const handle = createDbHandle({ url, maxConnections: max });
  return {
    db: handle.db,
    raw,
    close: async () => {
      await handle.close().catch(() => undefined);
      await raw.end({ timeout: 5 }).catch(() => undefined);
    },
  };
}

/** Run `fn` inside a transaction stamped with `tenantId`, exactly as `withTenantTransaction` does. */
async function inTenant<T>(handle: Handle, tenantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return handle.raw.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx as postgres.TransactionSql);
  });
}

/** Assert a query is REFUSED, and return the error for message assertions. */
async function refused(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the query to be refused, but it succeeded');
}

// ---------------------------------------------------------------------------

postgresDescribe('G3 enforcement (real PostgreSQL)', () => {
  const enforcedDbName = `omni_g3_enforced_${crypto.randomUUID().replaceAll('-', '')}`;
  const legacyDbName = `omni_g3_legacy_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };

  let provisioner: Handle;
  let ddl: Handle;
  let runtime: Handle;
  /** max: 1 so every query provably reuses ONE physical connection. */
  let pooledRuntime: Handle;
  let authPlane: Handle;
  let legacy: Handle;

  beforeAll(async () => {
    // ---- enforced world -------------------------------------------------
    createDatabase(enforcedDbName);
    const enforcedSuperUrl = urlFor(superUrl, enforcedDbName);
    const migrated = runSqlOn(enforcedSuperUrl, allMigrations);
    if (migrated.exitCode !== 0) throw new Error(`migrations failed: ${migrated.stderr}`);
    const seeded = runSqlOn(enforcedSuperUrl, SEED);
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    provisioner = connect(enforcedSuperUrl);
    // Order matters: the policy helper functions must EXIST before the role
    // plan can GRANT EXECUTE on them.
    await applyTenantRlsEnforcement(provisioner.db);
    await applyTenancyRoles(provisioner.db, passwords, DEFAULT_ROLE_NAMES, enforcedDbName);

    ddl = connect(urlFor(superUrl, enforcedDbName, { name: DEFAULT_ROLE_NAMES.ddl, password: passwords.ddl }));
    runtime = connect(
      urlFor(superUrl, enforcedDbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }),
    );
    pooledRuntime = connect(
      urlFor(superUrl, enforcedDbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }),
      1,
    );
    authPlane = connect(
      urlFor(superUrl, enforcedDbName, { name: DEFAULT_ROLE_NAMES.authPlane, password: passwords.authPlane }),
    );

    // ---- legacy world ---------------------------------------------------
    createDatabase(legacyDbName);
    const legacySuperUrl = urlFor(superUrl, legacyDbName);
    const legacyMigrated = runSqlOn(legacySuperUrl, allMigrations);
    if (legacyMigrated.exitCode !== 0) throw new Error(`legacy migrations failed: ${legacyMigrated.stderr}`);
    const legacySeeded = runSqlOn(legacySuperUrl, SEED);
    if (legacySeeded.exitCode !== 0) throw new Error(`legacy seed failed: ${legacySeeded.stderr}`);
    legacy = connect(legacySuperUrl);
  }, 180_000);

  afterAll(async () => {
    for (const handle of [provisioner, ddl, runtime, pooledRuntime, authPlane, legacy]) {
      if (handle) await handle.close();
    }
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${enforcedDbName}" WITH (FORCE);`);
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${legacyDbName}" WITH (FORCE);`);
  });

  // -------------------------------------------------------------------------
  describe('world (a): the DEFAULT applied state is legacy and unchanged', () => {
    test('migrations alone leave no RLS enforced anywhere', async () => {
      const state = await readEnforcementState(legacy.db);
      expect(state.state).toBe('legacy');
      expect(state.forced).toEqual([]);
    });

    test('legacy NULL-owner rows are readable with no tenant context at all', async () => {
      const rows = await legacy.raw`SELECT id, tenant_id FROM instances ORDER BY name`;
      expect(rows).toHaveLength(3);
      expect(rows.some((r) => r.id === LEGACY_INSTANCE && r.tenant_id === null)).toBe(true);
    });

    test('a legacy write with no tenant context still succeeds', async () => {
      await legacy.raw`INSERT INTO instances (name, channel) VALUES ('legacy-write', 'whatsapp')`;
      const [row] = await legacy.raw`SELECT tenant_id FROM instances WHERE name = 'legacy-write'`;
      expect(row?.tenant_id).toBeNull();
    });

    test('no policy exists to be evaluated, so there is nothing to fail closed on', async () => {
      const rows = await legacy.raw`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`;
      expect(rows[0]?.n).toBe(0);
    });

    test('the context helper function does not even exist in a legacy database', async () => {
      const rows = await legacy.raw`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'omni_current_tenant_id'`;
      expect(rows[0]?.n).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('world (b): enforcement state', () => {
    test('every one of the 37 tables is ENABLE + FORCE with all four policies', async () => {
      const state = await readEnforcementState(provisioner.db);
      expect(state.missing).toEqual([]);
      expect(state.missingPolicies).toEqual([]);
      expect(state.forced).toHaveLength(37);
      expect(state.state).toBe('enforced');
    });

    test('FORCE is set, not merely ENABLE — otherwise the owner would read everything', async () => {
      const rows = await provisioner.raw`
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relrowsecurity AND NOT c.relforcerowsecurity`;
      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('transaction-local context on pooled connections', () => {
    test('the setting is visible inside the transaction that set it', async () => {
      const value = await inTenant(pooledRuntime, TENANT_A, async (tx) => {
        const [row] = await tx`SELECT current_setting('app.tenant_id', true) AS v`;
        return row?.v as string;
      });
      expect(value).toBe(TENANT_A);
    });

    test('the setting does NOT survive the transaction on the same pooled connection', async () => {
      await inTenant(pooledRuntime, TENANT_A, async (tx) => tx`SELECT 1`);
      // max:1 — this is provably the same physical connection.
      const [row] = await pooledRuntime.raw`SELECT current_setting('app.tenant_id', true) AS v`;
      expect(row?.v === null || row?.v === '').toBe(true);
    });

    test('a second transaction on the reused connection sees ONLY its own tenant', async () => {
      const first = await inTenant(pooledRuntime, TENANT_A, async (tx) => tx`SELECT id FROM instances`);
      const second = await inTenant(pooledRuntime, TENANT_B, async (tx) => tx`SELECT id FROM instances`);
      expect(first.map((r) => r.id)).toEqual([INSTANCE_A]);
      expect(second.map((r) => r.id)).toEqual([INSTANCE_B]);
    });

    test('a rolled-back tenant transaction leaves nothing behind either', async () => {
      await pooledRuntime.raw
        .begin(async (tx) => {
          await tx`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
          throw new Error('rollback');
        })
        .catch(() => undefined);
      const [row] = await pooledRuntime.raw`SELECT current_setting('app.tenant_id', true) AS v`;
      expect(row?.v === null || row?.v === '').toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('missing and invalid context fail closed', () => {
    test('a SELECT with no context is REFUSED, not merely empty', async () => {
      const error = await refused(() => runtime.raw`SELECT id FROM instances`);
      expect(error.message).toContain('app.tenant_id is not set');
    });

    test('an INSERT with no context is refused', async () => {
      const error = await refused(
        () => runtime.raw`INSERT INTO instances (name, channel) VALUES ('no-context', 'whatsapp')`,
      );
      expect(error.message).toContain('app.tenant_id is not set');
    });

    test('an empty context string is refused rather than treated as a wildcard', async () => {
      const error = await refused(() =>
        runtime.raw.begin(async (tx) => {
          await tx`SELECT set_config('app.tenant_id', '', true)`;
          return tx`SELECT id FROM instances`;
        }),
      );
      expect(error.message).toContain('app.tenant_id is not set');
    });

    test('a malformed context is refused by the uuid cast, not silently ignored', async () => {
      const error = await refused(() =>
        runtime.raw.begin(async (tx) => {
          await tx`SELECT set_config('app.tenant_id', 'not-a-uuid', true)`;
          return tx`SELECT id FROM instances`;
        }),
      );
      expect(error.message).toMatch(/invalid input syntax for type uuid/i);
    });

    test('legacy NULL-owner rows are invisible under enforcement, to everyone', async () => {
      const rows = await inTenant(runtime, TENANT_A, async (tx) => tx`SELECT id FROM instances`);
      expect(rows.map((r) => r.id)).toEqual([INSTANCE_A]);
      const asOwner = await inTenant(ddl, TENANT_A, async (tx) => tx`SELECT id FROM instances`);
      expect(asOwner.map((r) => r.id)).toEqual([INSTANCE_A]);
    });
  });

  // -------------------------------------------------------------------------
  describe('FORCE binds the table owner too', () => {
    test('the DDL role OWNS the tenant tables', async () => {
      const [row] = await provisioner.raw`
        SELECT pg_get_userbyid(c.relowner)::text AS owner
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'instances'`;
      expect(row?.owner).toBe(DEFAULT_ROLE_NAMES.ddl);
    });

    test('the owner still cannot read another tenant', async () => {
      const rows = await inTenant(ddl, TENANT_A, async (tx) => tx`SELECT id FROM instances`);
      expect(rows.map((r) => r.id)).toEqual([INSTANCE_A]);
      expect(rows.map((r) => r.id)).not.toContain(INSTANCE_B);
    });

    test('the owner with no context is refused like anyone else', async () => {
      const error = await refused(() => ddl.raw`SELECT id FROM instances`);
      expect(error.message).toContain('app.tenant_id is not set');
    });
  });

  // -------------------------------------------------------------------------
  describe('cross-tenant denial on the 29 manifest tables', () => {
    test('SELECT: tenant A sees only A', async () => {
      const rows = await inTenant(runtime, TENANT_A, async (tx) => tx`SELECT id, tenant_id FROM chats`);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenant_id).toBe(TENANT_A);
    });

    test('SELECT by primary key: tenant B row is invisible to tenant A, no existence leak', async () => {
      const rows = await inTenant(
        runtime,
        TENANT_A,
        async (tx) => tx`SELECT id FROM instances WHERE id = ${INSTANCE_B}`,
      );
      expect(rows).toHaveLength(0);
    });

    test('INSERT with another tenant id is rejected by WITH CHECK', async () => {
      const error = await refused(() =>
        inTenant(
          runtime,
          TENANT_A,
          async (tx) => tx`INSERT INTO instances (name, channel, tenant_id) VALUES ('cross', 'whatsapp', ${TENANT_B})`,
        ),
      );
      expect(error.message).toMatch(/row-level security policy/i);
    });

    test('INSERT with a NULL tenant id is rejected too — no new unowned rows under enforcement', async () => {
      const error = await refused(() =>
        inTenant(
          runtime,
          TENANT_A,
          async (tx) => tx`INSERT INTO instances (name, channel) VALUES ('null-owner', 'whatsapp')`,
        ),
      );
      expect(error.message).toMatch(/row-level security policy/i);
    });

    test('INSERT with the transaction tenant is accepted', async () => {
      const rows = await inTenant(
        runtime,
        TENANT_A,
        async (tx) =>
          tx`INSERT INTO instances (name, channel, tenant_id) VALUES ('accepted-a', 'whatsapp', ${TENANT_A}) RETURNING id, tenant_id`,
      );
      expect(rows[0]?.tenant_id).toBe(TENANT_A);
      // Clean up so later counts stay predictable.
      await inTenant(runtime, TENANT_A, async (tx) => tx`DELETE FROM instances WHERE name = 'accepted-a'`);
    });

    test('UPDATE of another tenant row affects zero rows', async () => {
      const rows = await inTenant(
        runtime,
        TENANT_A,
        async (tx) => tx`UPDATE instances SET name = 'hijacked' WHERE id = ${INSTANCE_B} RETURNING id`,
      );
      expect(rows).toHaveLength(0);
      const [check] = await provisioner.raw`SELECT name FROM instances WHERE id = ${INSTANCE_B}`;
      expect(check?.name).toBe('instance-b');
    });

    test('UPDATE re-tenanting an own row is rejected by WITH CHECK', async () => {
      const error = await refused(() =>
        inTenant(
          runtime,
          TENANT_A,
          async (tx) => tx`UPDATE instances SET tenant_id = ${TENANT_B} WHERE id = ${INSTANCE_A}`,
        ),
      );
      expect(error.message).toMatch(/row-level security policy/i);
    });

    test('DELETE of another tenant row affects zero rows', async () => {
      const rows = await inTenant(
        runtime,
        TENANT_A,
        async (tx) => tx`DELETE FROM instances WHERE id = ${INSTANCE_B} RETURNING id`,
      );
      expect(rows).toHaveLength(0);
      const [check] = await provisioner.raw`SELECT count(*)::int AS n FROM instances WHERE id = ${INSTANCE_B}`;
      expect(check?.n).toBe(1);
    });

    test('aggregates and counts are filtered before counting', async () => {
      const rows = await inTenant(runtime, TENANT_A, async (tx) => tx`SELECT count(*)::int AS n FROM instances`);
      expect(rows[0]?.n).toBe(1);
    });

    test('a join cannot pull another tenant through a child table', async () => {
      const rows = await inTenant(
        runtime,
        TENANT_A,
        async (tx) => tx`SELECT c.id FROM chats c JOIN instances i ON i.id = c.instance_id`,
      );
      expect(rows).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('cross-tenant denial on the G1 tenant-plane tables', () => {
    for (const table of ['tenant_memberships', 'tenant_key_lineage', 'tenant_audit_logs'] as const) {
      test(`${table}: a tenant-scoped read returns only its own tenant`, async () => {
        // Both tenants are seeded in every one of these tables, so a filtered
        // result is a real filter rather than an empty table.
        const [all] = await provisioner.raw`SELECT count(*)::int AS n FROM ${provisioner.raw(table)}`;
        expect(all?.n).toBeGreaterThanOrEqual(2);
        const rows = await inTenant(runtime, TENANT_A, async (tx) => tx`SELECT tenant_id FROM ${runtime.raw(table)}`);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) expect(row.tenant_id).toBe(TENANT_A);
      });

      test(`${table}: no context is refused`, async () => {
        const error = await refused(() => runtime.raw`SELECT 1 FROM ${runtime.raw(table)}`);
        expect(error.message).toContain('app.tenant_id is not set');
      });
    }

    test('tenant_memberships: tenant B membership is invisible to tenant A', async () => {
      const rows = await inTenant(
        runtime,
        TENANT_A,
        async (tx) => tx`SELECT id FROM tenant_memberships WHERE id = ${MEMBERSHIP_B}`,
      );
      expect(rows).toHaveLength(0);
    });

    test('tenant_memberships: cross-tenant INSERT is rejected by WITH CHECK', async () => {
      const error = await refused(() =>
        inTenant(
          runtime,
          TENANT_A,
          async (tx) => tx`
            INSERT INTO tenant_memberships (tenant_id, principal_id, role)
            VALUES (${TENANT_B}, ${PRINCIPAL_A}, 'tenant-owner')`,
        ),
      );
      expect(error.message).toMatch(/row-level security policy/i);
    });

    test('tenant_audit_logs: an audit row cannot be written for another tenant', async () => {
      const error = await refused(() =>
        inTenant(
          runtime,
          TENANT_A,
          async (tx) => tx`
            INSERT INTO tenant_audit_logs (tenant_id, actor_credential_id, action, request_id)
            VALUES (${TENANT_B}, ${PRINCIPAL_A}, 'forged', 'req-x')`,
        ),
      );
      expect(error.message).toMatch(/row-level security policy/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('the isolated auth plane (ADR-0003)', () => {
    test('the auth-plane role CAN read the two pre-context tables without a tenant context', async () => {
      const rows = await authPlane.raw`SELECT id FROM tenant_memberships ORDER BY id`;
      expect(rows.map((r) => r.id).sort()).toEqual([MEMBERSHIP_A, MEMBERSHIP_B].sort());
      await authPlane.raw`SELECT count(*) FROM tenant_key_lineage`;
    });

    test('the auth-plane exemption is a role membership, NOT bypassrls', async () => {
      const attributes = await readRoleAttributes(provisioner.db, DEFAULT_ROLE_NAMES.authPlane);
      expect(attributes?.bypassRls).toBe(false);
      expect(attributes?.superuser).toBe(false);
      expect(roleAttributeViolations(attributes as never)).toEqual([]);
    });

    test('the exemption is SELECT-only — the auth plane cannot write a membership', async () => {
      const error = await refused(
        () => authPlane.raw`
          INSERT INTO tenant_memberships (tenant_id, principal_id, role)
          VALUES (${TENANT_A}, ${PRINCIPAL_B}, 'tenant-owner')`,
      );
      expect(error.message).toMatch(/permission denied/i);
    });

    test('the exemption does NOT extend to a tenant business table', async () => {
      const error = await refused(() => authPlane.raw`SELECT id FROM instances`);
      // Denied by privilege (no grant) rather than by policy — strictly stronger.
      expect(error.message).toMatch(/permission denied|app\.tenant_id is not set/i);
    });

    test('the runtime role cannot enumerate the credential index at all', async () => {
      const error = await refused(() => runtime.raw`SELECT key_hash FROM auth_credentials`);
      expect(error.message).toMatch(/permission denied/i);
    });

    test('a tenant-scoped transaction cannot reach the credential index either', async () => {
      const error = await refused(() =>
        inTenant(runtime, TENANT_A, async (tx) => tx`SELECT count(*) FROM auth_credentials`),
      );
      expect(error.message).toMatch(/permission denied/i);
    });

    test('only the auth-plane role holds the marker role', async () => {
      const rows = await provisioner.raw`
        SELECT r.rolname::text AS member
        FROM pg_auth_members m
        JOIN pg_roles g ON g.oid = m.roleid
        JOIN pg_roles r ON r.oid = m.member
        WHERE g.rolname = ${DEFAULT_ROLE_NAMES.authPlaneMarker}`;
      expect(rows.map((r) => r.member)).toEqual([DEFAULT_ROLE_NAMES.authPlane]);
    });

    test('the runtime role cannot grant itself the marker', async () => {
      const error = await refused(
        () =>
          runtime.raw`GRANT ${runtime.raw(DEFAULT_ROLE_NAMES.authPlaneMarker)} TO ${runtime.raw(DEFAULT_ROLE_NAMES.runtime)}`,
      );
      expect(error.message).toMatch(/permission denied|must have admin option/i);
    });

    test('the runtime role cannot reach the platform key or principal tables', async () => {
      for (const table of ['platform_api_keys', 'principals', 'tenants']) {
        const error = await refused(() => runtime.raw`SELECT 1 FROM ${runtime.raw(table)}`);
        expect(error.message).toMatch(/permission denied/i);
      }
    });

    test('an auth plane that cannot validate freshness fails closed rather than falling back', async () => {
      // Simulate the auth plane losing its read: the lookup must ERROR, and
      // there is no other identity in the process that could answer instead.
      await provisioner.raw`REVOKE SELECT ON tenant_memberships FROM ${provisioner.raw(DEFAULT_ROLE_NAMES.authPlane)}`;
      try {
        const error = await refused(() => authPlane.raw`SELECT id FROM tenant_memberships`);
        expect(error.message).toMatch(/permission denied/i);
        // And the runtime role still cannot answer in its place.
        const fallback = await refused(() => runtime.raw`SELECT id FROM tenant_memberships`);
        expect(fallback.message).toContain('app.tenant_id is not set');
      } finally {
        await provisioner.raw`GRANT SELECT ON tenant_memberships TO ${provisioner.raw(DEFAULT_ROLE_NAMES.authPlane)}`;
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('runtime role capabilities (ADR-0004)', () => {
    test('attributes: NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', async () => {
      const attributes = await readRoleAttributes(provisioner.db, DEFAULT_ROLE_NAMES.runtime);
      expect(attributes).not.toBeNull();
      expect(roleAttributeViolations(attributes as never)).toEqual([]);
      expect(attributes?.bypassRls).toBe(false);
    });

    test('the runtime role owns no table in public', async () => {
      const rows = await provisioner.raw`
        SELECT c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles r ON r.oid = c.relowner
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND r.rolname = ${DEFAULT_ROLE_NAMES.runtime}`;
      expect(rows).toHaveLength(0);
    });

    test('the runtime role cannot CREATE TABLE', async () => {
      const error = await refused(() => runtime.raw`CREATE TABLE rogue (id int)`);
      expect(error.message).toMatch(/permission denied/i);
    });

    test('the runtime role cannot ALTER a tenant table', async () => {
      const error = await refused(() => runtime.raw`ALTER TABLE instances ADD COLUMN rogue int`);
      expect(error.message).toMatch(/must be owner|permission denied/i);
    });

    test('the runtime role cannot turn FORCE off', async () => {
      const error = await refused(() => runtime.raw`ALTER TABLE instances NO FORCE ROW LEVEL SECURITY`);
      expect(error.message).toMatch(/must be owner|permission denied/i);
    });

    test('the runtime role cannot ALTER or DROP a policy', async () => {
      const alter = await refused(() => runtime.raw`ALTER POLICY instances_tenant_select ON instances USING (true)`);
      expect(alter.message).toMatch(/must be owner|permission denied/i);
      const drop = await refused(() => runtime.raw`DROP POLICY instances_tenant_select ON instances`);
      expect(drop.message).toMatch(/must be owner|permission denied/i);
    });

    test('the runtime role cannot CREATE a permissive policy of its own', async () => {
      const error = await refused(() => runtime.raw`CREATE POLICY wide_open ON instances FOR SELECT USING (true)`);
      expect(error.message).toMatch(/must be owner|permission denied/i);
    });

    test('the runtime role cannot SET ROLE to the owner or the auth plane', async () => {
      for (const target of [DEFAULT_ROLE_NAMES.ddl, DEFAULT_ROLE_NAMES.authPlane]) {
        const error = await refused(() => runtime.raw`SET ROLE ${runtime.raw(target)}`);
        expect(error.message).toMatch(/permission denied/i);
      }
    });

    test('the effective no-bypass property: row_security=off cannot read an RLS table', async () => {
      // A NOBYPASSRLS role may SET row_security=off — the setting is not
      // privileged. What it cannot do is USE it: PostgreSQL refuses the query
      // outright rather than returning unfiltered rows. Testing the property
      // rather than the forbidden SET is the point.
      const error = await refused(() =>
        runtime.raw.begin(async (tx) => {
          await tx`SET LOCAL row_security = off`;
          await tx`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
          return tx`SELECT id FROM instances`;
        }),
      );
      expect(error.message).toMatch(/row.level security|row_security/i);
    });

    test('the runtime role cannot create a function to shadow the policy helper', async () => {
      const error = await refused(
        () => runtime.raw`CREATE FUNCTION public.omni_evil() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$`,
      );
      expect(error.message).toMatch(/permission denied/i);
    });

    test('PUBLIC holds no CREATE on schema public', async () => {
      const [row] = await provisioner.raw`
        SELECT pg_catalog.has_schema_privilege('public', 'public', 'CREATE') AS has_create`;
      expect(row?.has_create).toBe(false);
    });

    test('ledger history UPDATE and DELETE are revoked from the runtime role', async () => {
      for (const privilege of ['UPDATE', 'DELETE']) {
        const [row] = await provisioner.raw`
          SELECT pg_catalog.has_table_privilege(
            ${DEFAULT_ROLE_NAMES.runtime}, 'tenant_migration_ledger_history', ${privilege}) AS allowed`;
        expect(row?.allowed).toBe(false);
      }
    });

    test('the ledger itself is unreachable from the runtime role', async () => {
      const error = await refused(() => runtime.raw`SELECT 1 FROM tenant_migration_ledger`);
      expect(error.message).toMatch(/permission denied/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('enforced startup fails closed', () => {
    test('a correctly provisioned runtime identity passes the startup probe', async () => {
      const report = await assertEnforcedRuntimeIdentity(runtime.db);
      expect(report.currentUser).toBe(DEFAULT_ROLE_NAMES.runtime);
      expect(report.ownedTables).toEqual([]);
      expect(report.hasSchemaCreate).toBe(false);
      expect(report.enforcement.state).toBe('enforced');
    });

    test('a superuser connection is REFUSED as a runtime identity — no fallback', async () => {
      // This is the exact scenario role-cutover.ts falls back to today. Under
      // enforcement it must be a startup failure, not a warning.
      await expect(assertEnforcedRuntimeIdentity(provisioner.db)).rejects.toThrow(EnforcementStartupError);
      await expect(assertEnforcedRuntimeIdentity(provisioner.db)).rejects.toThrow(/SUPERUSER/);
    });

    test('the owning DDL identity is refused as a runtime identity', async () => {
      await expect(assertEnforcedRuntimeIdentity(ddl.db)).rejects.toThrow(/owns \d+ table/);
    });

    test('startup is refused when enforcement is not actually installed', async () => {
      await expect(assertEnforcedRuntimeIdentity(legacy.db)).rejects.toThrow(EnforcementStartupError);
    });
  });

  // -------------------------------------------------------------------------
  describe('platform-admin target-tenant access (ADR-0005)', () => {
    test('a platform operation reaches exactly one tenant through the same forced policies', async () => {
      const rows = await inTenant(runtime, TENANT_B, async (tx) => tx`SELECT id FROM instances`);
      expect(rows.map((r) => r.id)).toEqual([INSTANCE_B]);
    });

    test('an audit row is written inside the same transaction as the operation', async () => {
      const auditId = await inTenant(runtime, TENANT_B, async (tx) => {
        await tx`UPDATE instances SET is_active = true WHERE id = ${INSTANCE_B}`;
        const [row] = await tx`
          INSERT INTO tenant_audit_logs (tenant_id, actor_principal_id, actor_credential_id, action, target_type,
                                         target_id, request_id, metadata)
          VALUES (${TENANT_B}, ${PRINCIPAL_B}, ${PRINCIPAL_B}, 'tenant.instance.activate', 'tenant', ${TENANT_B},
                  'req-platform-1', ${tx.json({ reason: 'support ticket 42', before: false, after: true })})
          RETURNING id`;
        return row?.id as string;
      });
      expect(auditId).toBeTruthy();

      // `tx.json(...)` rather than a pre-stringified object: postgres.js
      // serialises jsonb parameters itself, so handing it a string produces a
      // JSON string SCALAR rather than a JSON object, and every key lookup on
      // it then returns null.
      //
      // `metadata->>'reason'` rather than a client-side property read: a
      // driver that round-trips jsonb as a STRING would make a property read
      // silently undefined, and this assertion is about what the server stored.
      const [audit] = await provisioner.raw`
        SELECT tenant_id, action, request_id,
               metadata->>'reason' AS reason,
               metadata->>'after' AS after
        FROM tenant_audit_logs WHERE id = ${auditId}`;
      expect(audit?.tenant_id).toBe(TENANT_B);
      expect(audit?.request_id).toBe('req-platform-1');
      expect(audit?.reason).toBe('support ticket 42');
      expect(audit?.after).toBe('true');
    });

    test('a rolled-back platform operation leaves no audit row', async () => {
      await runtime.raw
        .begin(async (tx) => {
          await tx`SELECT set_config('app.tenant_id', ${TENANT_B}, true)`;
          await tx`
            INSERT INTO tenant_audit_logs (tenant_id, actor_credential_id, action, request_id)
            VALUES (${TENANT_B}, ${PRINCIPAL_B}, 'tenant.rollback.probe', 'req-rollback')`;
          throw new Error('rollback');
        })
        .catch(() => undefined);
      const [row] = await provisioner.raw`
        SELECT count(*)::int AS n FROM tenant_audit_logs WHERE request_id = 'req-rollback'`;
      expect(row?.n).toBe(0);
    });

    test('a platform operation cannot see a second tenant in the same transaction', async () => {
      const rows = await inTenant(
        runtime,
        TENANT_B,
        async (tx) => tx`SELECT id FROM instances WHERE id = ${INSTANCE_A}`,
      );
      expect(rows).toHaveLength(0);
    });

    test('none of the four provisioned roles holds BYPASSRLS or SUPERUSER', async () => {
      const provisioned = Object.values(DEFAULT_ROLE_NAMES);
      const rows = await provisioner.raw`
        SELECT rolname::text AS name FROM pg_roles
        WHERE (rolbypassrls OR rolsuper) AND rolname = ANY(${provisioned})`;
      expect(rows).toHaveLength(0);
      // Sanity: the roles exist, so the query above is not vacuously empty.
      const present =
        await provisioner.raw`SELECT rolname::text AS name FROM pg_roles WHERE rolname = ANY(${provisioned})`;
      expect(present).toHaveLength(provisioned.length);
    });
  });
});
