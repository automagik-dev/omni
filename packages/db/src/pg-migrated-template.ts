/**
 * Migrated-template cache for the real-PostgreSQL suites (#967).
 *
 * Nearly every `*-postgres.test.ts` used to provision its private database by
 * replaying the ENTIRE committed migration chain through psql — once per
 * suite, ~25 identical replays per pg-gate run. This helper replays a given
 * SQL body ONCE per cluster into a template database whose name pins the
 * SHA-256 of the exact bytes, then hands every suite a
 * `CREATE DATABASE ... TEMPLATE <template>` clone, which PostgreSQL performs
 * as a file-level copy in milliseconds.
 *
 * The pg-gate's "loud and complete, zero skips" contract is untouched:
 *
 *   - Only SETUP is cached, never results. Every suite still runs every
 *     assertion against its own private clone.
 *   - The template name embeds the digest of the SQL it was built from, so
 *     changing any migration byte abandons the old template and replays the
 *     new chain. On the gate's ephemeral cluster the template never outlives
 *     the run; on a kept-warm cluster (scripts/pg-gate-warm.ts) it is exactly
 *     the cross-run cache we want.
 *   - A half-built template is unobservable: the SQL is replayed into a
 *     staging database first and only RENAMEd into place when it completed.
 *     A failed replay drops the staging database and stays loud.
 *
 * Like backfill/pg-testing.ts, this file is generic only — it contains no
 * tenant-table SQL — and is imported directly by test files.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { Sql } from 'postgres';
import type { Database } from './client';
import { unwrapDbError } from './errors';
import { POSTGRES_URL_VARS, assertPgTestTarget } from './pg-test-target';

export { assertPgTestTarget } from './pg-test-target';

// Test-facing prerequisite builders for additive-state runtime-role fixtures.
export {
  connectorIngressRoleStatements,
  contextFunctionStatements,
  connectorIngressFunctionStatements,
} from './tenancy-rls';

// Refuse unsafe suite configuration before setup OR teardown hooks register.
// Some suites invoke psql directly during cleanup even if their setup failed.
for (const variable of POSTGRES_URL_VARS) {
  const url = process.env[variable];
  if (url) assertPgTestTarget(url);
}

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', 'drizzle');

/** How a suite reaches the DISPOSABLE cluster (the pg-gate's, never shared). */
export interface PgSuperAccess {
  /** Superuser URL of the disposable cluster. */
  readonly superUrl: string;
  /** psql binary the suite resolved from its OMNI_G*_PSQL_BIN variable. */
  readonly psqlBin: string;
}

interface SqlResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runSql(access: PgSuperAccess, url: string, script: string): SqlResult {
  assertPgTestTarget(url);
  const file = join(tmpdir(), `omni-pg-template-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [access.psqlBin, '-X', '--no-psqlrc', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  } finally {
    rmSync(file, { force: true });
  }
}

function runSqlOrThrow(access: PgSuperAccess, url: string, script: string, label: string): void {
  const result = runSql(access, url, script);
  if (result.exitCode !== 0) throw new Error(`${label}: ${result.stderr || result.stdout}`);
}

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

let cachedChain: { digest: string; sql: string } | null = null;

/**
 * The committed migration chain, concatenated in order, plus the SHA-256 that
 * pins its exact bytes (each `filename + NUL + bytes + NUL`, sorted — the same
 * shape the release rehearsals pin).
 */
function migrationChain(): { digest: string; sql: string } {
  if (cachedChain) return cachedChain;
  const files = readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const hash = createHash('sha256');
  const parts: string[] = [];
  for (const file of files) {
    const sql = readFileSync(join(drizzleDir, file), 'utf-8');
    hash.update(file);
    hash.update('\0');
    hash.update(sql);
    hash.update('\0');
    parts.push(sql);
  }
  cachedChain = { digest: hash.digest('hex'), sql: parts.join('\n') };
  return cachedChain;
}

/**
 * A template name that pins the SQL it will hold: `<prefix>_<sha256[0..16)>`.
 * Suites that template a custom SQL body (e.g. a migration PREFIX) use this so
 * a byte change in the body abandons the stale template automatically.
 */
export function sqlTemplateName(prefix: string, sql: string): string {
  return `${prefix}_${createHash('sha256').update(sql).digest('hex').slice(0, 16)}`;
}

function templateExists(access: PgSuperAccess, templateName: string): boolean {
  const result = runSql(access, access.superUrl, `SELECT 1 FROM pg_database WHERE datname = '${templateName}';`);
  return result.exitCode === 0 && result.stdout.trim() === '1';
}

/**
 * Ensure a template database named `templateName` holding the result of
 * replaying `sql` exists on the cluster. `templateName` MUST embed a digest of
 * `sql` — the name is the cache key.
 */
export function ensureSqlTemplate(access: PgSuperAccess, templateName: string, sql: string): void {
  if (templateExists(access, templateName)) return;
  const staging = `${templateName}_b${process.pid}`;
  runSqlOrThrow(
    access,
    access.superUrl,
    `DROP DATABASE IF EXISTS "${staging}" WITH (FORCE);\nCREATE DATABASE "${staging}";`,
    'template staging database',
  );
  try {
    runSqlOrThrow(access, urlFor(access.superUrl, staging), sql, 'template replay');
    runSqlOrThrow(
      access,
      access.superUrl,
      `ALTER DATABASE "${staging}" RENAME TO "${templateName}";`,
      'template rename',
    );
  } catch (error) {
    runSql(access, access.superUrl, `DROP DATABASE IF EXISTS "${staging}" WITH (FORCE);`);
    // Lost a rename race to another builder? Its template is just as good.
    if (templateExists(access, templateName)) return;
    throw error;
  }
}

/** `CREATE DATABASE ... TEMPLATE` — the near-instant clone every suite gets. */
export function createDatabaseFromTemplate(access: PgSuperAccess, database: string, templateName: string): void {
  runSqlOrThrow(
    access,
    access.superUrl,
    `CREATE DATABASE "${database}" TEMPLATE "${templateName}";`,
    `clone of ${templateName}`,
  );
}

/**
 * Create `database` fully migrated with the committed chain: template built on
 * first use, file-level clone afterwards. Drop-in replacement for the
 * per-suite "CREATE DATABASE + replay every migration" block.
 */
export function provisionMigratedDatabase(access: PgSuperAccess, database: string): void {
  const chain = migrationChain();
  const templateName = `omni_migrated_tmpl_${chain.digest.slice(0, 16)}`;
  ensureSqlTemplate(access, templateName, chain.sql);
  createDatabaseFromTemplate(access, database, templateName);
}

/**
 * drizzle >= 0.44 wraps driver errors in DrizzleQueryError; the server's
 * refusal message (RLS policy, missing tenant GUC, WITH CHECK) lives on the
 * PostgresError beneath. Wrap a rejecting promise in this so
 * `expect(...).rejects.toThrow(pattern)` keeps matching the driver's message.
 */
export const driverRejection = <T>(p: Promise<T>): Promise<T> =>
  p.catch((error) => {
    throw unwrapDbError(error);
  });

/** Test-only role URLs shared by the disposable PostgreSQL suites (#1470).
 * Hostless runs use trust-authenticated Unix sockets; PGHOST/PGPORT select the
 * socket, and the startup user parameter works in both postgres.js and libpq.
 */
export function pgRoleUrl(
  base: string,
  database: string,
  role?: { name: string; password: string },
  env: Record<string, string | undefined> = process.env,
): string {
  assertPgTestTarget(base, env);
  const url = new URL(base);
  url.pathname = `/${database}`;
  if (role) {
    if (url.hostname) {
      url.username = role.name;
      url.password = role.password;
      url.searchParams.delete('user');
    } else {
      // URL.username silently refuses credentials when the authority is empty.
      url.searchParams.set('user', role.name);
    }
  }
  return url.toString();
}

/** Prove the CONNECTED identity, not merely that a named role was provisioned. */
export async function assertPgTestRole(db: Database | Pick<Sql, 'unsafe'>, expected: string): Promise<void> {
  const query = `SELECT current_user::text AS name, rolsuper, rolbypassrls
    FROM pg_catalog.pg_roles WHERE rolname = current_user`;
  const rows = 'unsafe' in db ? await db.unsafe(query) : await db.execute(sql.raw(query));
  const row = rows[0];
  if (row?.name !== expected || row?.rolsuper !== false || row?.rolbypassrls !== false) {
    throw new Error(
      `PostgreSQL test role mismatch: expected ${expected} with SUPERUSER=false and BYPASSRLS=false; ` +
        `got ${row?.name ?? 'no row'} (SUPERUSER=${row?.rolsuper}, BYPASSRLS=${row?.rolbypassrls})`,
    );
  }
}
